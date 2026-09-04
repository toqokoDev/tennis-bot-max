import { TXT, fmt } from '../texts.js';
import { Keyboard } from '@maxhub/max-bot-api';
import type { AppContext } from '../context.js';
import { getMessageText, getCtxUserId } from '../context.js';
import { env, isAdmin } from '../config/env.js';
import {
  COUNTRIES,
  SPORTS,
} from '../config/profile.js';
import {
  TOURNAMENT_AGE_GROUPS,
  TOURNAMENT_CATEGORIES,
  TOURNAMENT_GENDERS,
  TOURNAMENT_LEVELS,
  TOURNAMENT_TYPES,
  generateTournamentName,
} from '../config/tournament.js';
import { storage } from '../storage/jsonStorage.js';
import { clearState, getState, getStateData, setState, getPrevMessageId, setPrevMessageId } from '../middleware/session.js';
import {
  CreateTournamentStates,
  TournamentPaymentStates,
  ViewTournamentsStates,
} from '../types/states.js';
import type { SportType, Tournament } from '../types/models.js';
import { chunkButtons, showCurrentMessage, askText, backButton } from '../utils/bot.js';
import {
  addParticipant,
  canStartTournament,
  openPaymentWindow,
  removeParticipant,
  shouldOpenPaymentWindow,
  startTournament,
} from '../utils/tournamentLifecycle.js';
import {
  sendTournamentApplicationToChannel,
  sendTournamentCreatedToChannel,
} from '../services/channels.js';
import { createTournamentPayment, checkPaymentStatus } from '../services/payments.js';
import { uploadBracketImage } from '../services/bracketImage.js';
import { getCallbackPayload } from '../utils/callback.js';
import { requireRegistered } from './registration.js';
import { isValidEmail } from '../utils/validation.js';

type ViewData = Partial<Tournament> & {
  page?: number;
  listMode?: 'browse' | 'my';
  tournamentIds?: string[];
};
type CreateData = Partial<Tournament>;
type TourPayData = {
  tournament_id?: string;
  tournament_fee?: number;
  email?: string;
  payment_id?: string;
  payment_url?: string;
  provider?: 'tinkoff' | 'yookassa';
};

type CardNav = {
  page: number;
  total: number;
  listMode: 'browse' | 'my';
};

type CardShowOptions = {
  mode?: 'new' | 'edit';
  /** If false, do not regenerate/upload bracket image (safer for editMessage). */
  withImage?: boolean;
};

function filterBrowseTournaments(all: Record<string, Tournament>, data: ViewData): Tournament[] {
  return Object.values(all)
    .filter((t) => {
      if (!t.show_in_list || t.status === 'cancelled') return false;
      if (data.sport && t.sport !== data.sport) return false;
      if (data.country && t.country !== data.country) return false;
      if (data.city && t.city !== data.city) return false;
      return true;
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

async function resolveTournamentList(ctx: AppContext, data: ViewData): Promise<Tournament[]> {
  const all = await storage.getTournaments();
  if (data.listMode === 'my') {
    const userId = getCtxUserId(ctx);
    return Object.values(all)
      .filter((t) => t.participants[String(userId)] && t.status !== 'cancelled')
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  return filterBrowseTournaments(all, data);
}

export async function showTournamentMenu(ctx: AppContext): Promise<void> {
  const user = await requireRegistered(ctx);
  if (!user) return;
  const buttons = [
    [Keyboard.button.callback(TXT.tournament.list, 'tournament_list')],
    [Keyboard.button.callback(TXT.tournament.my, 'tournament_my')],
  ];
  if (isAdmin(user.max_user_id)) {
    buttons.push([Keyboard.button.callback(TXT.tournament.create, 'create_tournament')]);
  }
  buttons.push([Keyboard.button.callback(TXT.common.main_menu, 'main_menu')]);
  await showCurrentMessage(ctx, TXT.tournament.menu, {
    attachments: [Keyboard.inlineKeyboard(buttons)],
  });
}

async function showMyTournaments(
  ctx: AppContext,
  page = 0,
  opts: CardShowOptions = { mode: 'edit', withImage: true },
): Promise<void> {
  const user = await requireRegistered(ctx);
  if (!user) return;
  const list = await resolveTournamentList(ctx, { listMode: 'my' });
  if (!list.length) {
    await showCurrentMessage(ctx, TXT.tournament.my_empty, {
      attachments: [Keyboard.inlineKeyboard([
        [Keyboard.button.callback(TXT.tournament.list, 'tournament_list')],
        [Keyboard.button.callback(TXT.common.main_menu, 'main_menu')],
      ])],
    }, opts.mode ?? 'edit');
    return;
  }
  const safePage = ((page % list.length) + list.length) % list.length;
  await setState(ctx, ViewTournamentsStates.LIST, {
    listMode: 'my',
    page: safePage,
    tournamentIds: list.map((t) => t.id),
  });
  await showTournamentCard(ctx, list[safePage], {
    page: safePage,
    total: list.length,
    listMode: 'my',
  }, opts);
}

export async function handleViewTournament(ctx: AppContext, id: string): Promise<void> {
  const tourn = await storage.getTournament(id);
  if (!tourn) {
    await ctx.reply(TXT.tournament.not_found);
    return;
  }
  const data = getStateData<ViewData>(ctx);
  const list = data.tournamentIds?.length
    ? (await Promise.all(data.tournamentIds.map((tid) => storage.getTournament(tid)))).filter(
      (t): t is Tournament => Boolean(t),
    )
    : await resolveTournamentList(ctx, data);
  const page = list.findIndex((t) => t.id === id);
  if (page >= 0 && list.length > 0) {
    await showTournamentCard(ctx, tourn, {
      page,
      total: list.length,
      listMode: data.listMode ?? 'browse',
    });
    return;
  }
  await showTournamentCard(ctx, tourn);
}

export async function handleJoinTournament(
  ctx: AppContext,
  id: string,
  opts: { fromDeepLink?: boolean } = {},
): Promise<void> {
  const fromDeepLink = Boolean(opts.fromDeepLink);
  const user = await requireRegistered(ctx);
  if (!user) {
    if (!fromDeepLink && ctx.callback) {
      await ctx.answerOnCallback({ notification: TXT.common.not_registered }).catch(() => undefined);
    }
    return;
  }
  let tourn = await storage.getTournament(id);
  if (!tourn || tourn.status !== 'active') {
    if (fromDeepLink || !ctx.callback) {
      await ctx.reply(TXT.tournament.unavailable);
    } else {
      await ctx.answerOnCallback({ notification: TXT.tournament.unavailable });
    }
    return;
  }
  tourn = addParticipant(tourn, user.max_user_id, `${user.first_name} ${user.last_name}`);
  if (shouldOpenPaymentWindow(tourn)) tourn = openPaymentWindow(tourn);
  if (canStartTournament(tourn)) tourn = startTournament(tourn);
  await storage.saveTournament(tourn);
  await sendTournamentApplicationToChannel(ctx.api, tourn, user);

  const data = getStateData<ViewData>(ctx);
  const list = await resolveTournamentList(ctx, { ...data, listMode: data.listMode ?? 'browse' });
  const page = Math.max(0, list.findIndex((t) => t.id === tourn.id));
  const nav: CardNav | undefined = list.length
    ? {
      page: page >= 0 ? page : 0,
      total: list.length,
      listMode: data.listMode ?? 'browse',
    }
    : undefined;
  const cardTourn = list.length ? (list[page] ?? tourn) : tourn;

  if (fromDeepLink || !ctx.callback) {
    await ctx.reply(TXT.tournament.joined);
    await showTournamentCard(ctx, cardTourn, nav, { mode: 'new', withImage: true });
    return;
  }

  await ctx.answerOnCallback({ notification: TXT.tournament.joined });
  await showTournamentCard(ctx, cardTourn, nav, { mode: 'edit', withImage: true });
}

export async function handlePayTournament(ctx: AppContext, id: string): Promise<void> {
  const user = await requireRegistered(ctx);
  if (!user) return;
  const tourn = await storage.getTournament(id);
  if (!tourn) {
    await ctx.reply(TXT.tournament.not_found);
    return;
  }
  if (!tourn.participants[String(user.max_user_id)]) {
    await ctx.reply(TXT.tournament.not_participant);
    return;
  }
  if (tourn.entry_fee <= 0) {
    await ctx.reply(TXT.tournament.payment_not_required);
    return;
  }
  if (tourn.payments[String(user.max_user_id)]?.status === 'succeeded') {
    await ctx.reply(TXT.tournament.already_paid);
    return;
  }
  await setState(ctx, TournamentPaymentStates.WAITING_EMAIL, {
    tournament_id: id,
    tournament_fee: tourn.entry_fee,
  });
  await askText(ctx, TXT.tournament.payment_email);
}

export async function handleTournamentPaymentMessage(ctx: AppContext): Promise<boolean> {
  const state = getState(ctx);
  if (state !== TournamentPaymentStates.WAITING_EMAIL) return false;

  const text = getMessageText(ctx);
  const data = getStateData<TourPayData>(ctx);
  if (!text || !isValidEmail(text)) {
    await askText(ctx, TXT.tournament.payment_email_invalid);
    return true;
  }
  if (!data.tournament_id || !data.tournament_fee) {
    await clearState(ctx);
    return true;
  }

  const userId = getCtxUserId(ctx);
  const payment = await createTournamentPayment({
    userId,
    tournamentId: data.tournament_id,
    amount: data.tournament_fee,
    email: text,
  });
  if (!payment) {
    await ctx.reply(TXT.common.error, { attachments: [backButton()] });
    await clearState(ctx);
    return true;
  }

  const tourn = await storage.getTournament(data.tournament_id);
  if (tourn) {
    tourn.payments[String(userId)] = {
      status: 'pending',
      payment_id: payment.paymentId,
      provider: payment.provider,
    };
    await storage.saveTournament(tourn);
  }

  data.email = text;
  data.payment_id = payment.paymentId;
  data.payment_url = payment.paymentUrl;
  data.provider = payment.provider;
  await setState(ctx, TournamentPaymentStates.CONFIRM_PAYMENT, data);
  await ctx.reply(TXT.tournament.payment_link, {
    attachments: [Keyboard.inlineKeyboard([
      [Keyboard.button.link(TXT.payments.continue_pay, payment.paymentUrl)],
      [Keyboard.button.callback(TXT.payments.confirm_pay, `tournament_pay_confirm:${data.tournament_id}`)],
      [Keyboard.button.callback(TXT.common.main_menu, 'main_menu')],
    ])],
  });
  return true;
}

async function confirmTournamentPayment(ctx: AppContext, tournamentId: string): Promise<void> {
  const data = getStateData<TourPayData>(ctx);
  const stored = (await storage.getTournament(tournamentId))?.payments[String(getCtxUserId(ctx))];
  const paymentId = data.payment_id ?? stored?.payment_id;
  const provider = data.provider ?? stored?.provider ?? 'tinkoff';
  if (!paymentId) {
    await ctx.reply(TXT.tournament.payment_not_confirmed, { attachments: [backButton()] });
    return;
  }
  const status = await checkPaymentStatus(paymentId, provider);
  if (status !== 'succeeded') {
    await ctx.reply(TXT.tournament.payment_not_confirmed, { attachments: [backButton()] });
    return;
  }
  const tourn = await storage.getTournament(tournamentId);
  if (!tourn) {
    await ctx.reply(TXT.tournament.not_found);
    return;
  }
  const userId = getCtxUserId(ctx);
  tourn.payments[String(userId)] = { status: 'succeeded', payment_id: paymentId, provider };
  if (tourn.participants[String(userId)]) {
    tourn.participants[String(userId)].paid = true;
  }
  await storage.saveTournament(tourn);
  await clearState(ctx);
  await ctx.reply(TXT.tournament.payment_confirmed, { attachments: [backButton()] });
  await showTournamentCard(ctx, tourn);
}

async function showTournamentCard(
  ctx: AppContext,
  tourn: Tournament,
  nav?: CardNav,
  opts: CardShowOptions = {},
): Promise<void> {
  const mode = opts.mode ?? 'edit';
  const withImage = opts.withImage ?? mode === 'new';

  const count = Object.keys(tourn.participants).length;
  let text = fmt(TXT.tournament.card, {
    name: tourn.name,
    sport: tourn.sport,
    city: tourn.city,
    type: tourn.type,
    category: tourn.category,
    current: count,
    max: tourn.participants_count,
    fee: tourn.entry_fee,
  });
  const userId = getCtxUserId(ctx);
  const isParticipant = Boolean(tourn.participants[String(userId)]);
  if (isParticipant) {
    text += `\n${TXT.tournament.you_registered}`;
  }
  if (nav && nav.total > 1) {
    text = fmt(TXT.tournament.card_page, {
      page: nav.page + 1,
      total: nav.total,
      card: text,
    });
  }

  const paid = tourn.payments[String(userId)]?.status === 'succeeded';
  const buttons: ReturnType<typeof Keyboard.button.callback>[][] = [];

  if (nav && nav.total > 1) {
    const prefix = nav.listMode === 'my' ? 'tmy_page' : 'tview_page';
    const prev = (nav.page - 1 + nav.total) % nav.total;
    const next = (nav.page + 1) % nav.total;
    buttons.push([
      Keyboard.button.callback(TXT.tournament.prev, `${prefix}:${prev}`),
      Keyboard.button.callback(TXT.tournament.next, `${prefix}:${next}`),
    ]);
  }

  if (tourn.status === 'active' && !isParticipant) {
    buttons.push([Keyboard.button.callback(TXT.tournament.join, `join_tournament:${tourn.id}`)]);
  }
  if (isParticipant && tourn.status === 'active') {
    buttons.push([Keyboard.button.callback(TXT.tournament.leave, `leave_tournament:${tourn.id}`)]);
    if (tourn.entry_fee > 0 && !paid) {
      buttons.push([Keyboard.button.callback(TXT.tournament.pay, `pay_tournament:${tourn.id}`)]);
    }
  }
  if (tourn.status === 'started' && (tourn.bracket || tourn.round_robin) && !tourn.hide_bracket) {
    buttons.push([Keyboard.button.callback(TXT.tournament.bracket, `view_bracket:${tourn.id}`)]);
  }
  if (nav?.listMode !== 'my') {
    buttons.push([Keyboard.button.callback(TXT.tournament.my, 'tournament_my')]);
  } else {
    buttons.push([Keyboard.button.callback(TXT.tournament.list, 'tournament_list')]);
  }
  buttons.push([Keyboard.button.callback(TXT.common.main_menu, 'main_menu')]);

  const keyboard = Keyboard.inlineKeyboard(buttons);
  let bracketImage: import('@maxhub/max-bot-api/types').AttachmentRequest | null = null;
  if (withImage) {
    try {
      bracketImage = await uploadBracketImage(ctx.api, tourn);
    } catch {
      /* keep card without image */
    }
  }

  const attachments = bracketImage ? [bracketImage, keyboard] : [keyboard];
  if (mode === 'new') {
    try {
      await showCurrentMessage(ctx, text, { attachments }, 'new');
    } catch {
      await showCurrentMessage(ctx, text, { attachments: [keyboard] }, 'new');
    }
    return;
  }

  // Edit in place — do not fall back to a new message
  const targetId = (ctx.callback && ctx.messageId) ? ctx.messageId : getPrevMessageId(ctx);
  if (!targetId) {
    await showCurrentMessage(ctx, text, { attachments }, 'new');
    return;
  }
  const body = { text, format: 'html' as const, attachments };
  try {
    await ctx.api.editMessage(targetId, body);
    await setPrevMessageId(ctx, targetId);
  } catch {
    try {
      await ctx.api.editMessage(targetId, { text, format: 'html', attachments: [keyboard] });
      await setPrevMessageId(ctx, targetId);
    } catch {
      /* keep existing message if edit is impossible */
    }
  }
}

async function showTournamentList(
  ctx: AppContext,
  data: ViewData,
  opts: CardShowOptions = { mode: 'edit', withImage: true },
): Promise<void> {
  const list = filterBrowseTournaments(await storage.getTournaments(), data);
  if (!list.length) {
    await showCurrentMessage(ctx, TXT.tournament.no_list, {
      attachments: [Keyboard.inlineKeyboard([
        [Keyboard.button.callback(TXT.common.back, 'tournament_list')],
        [Keyboard.button.callback(TXT.common.main_menu, 'main_menu')],
      ])],
    }, opts.mode ?? 'edit');
    return;
  }
  const page = data.page ?? 0;
  const safePage = ((page % list.length) + list.length) % list.length;
  data.listMode = 'browse';
  data.page = safePage;
  data.tournamentIds = list.map((t) => t.id);
  await setState(ctx, ViewTournamentsStates.LIST, data);
  await showTournamentCard(ctx, list[safePage], {
    page: safePage,
    total: list.length,
    listMode: 'browse',
  }, opts);
}

async function finalizeTournamentCreate(ctx: AppContext, data: CreateData): Promise<void> {
  data.level = data.level ?? TOURNAMENT_LEVELS[2];
  data.age_group = data.age_group ?? TOURNAMENT_AGE_GROUPS[0];
  data.duration = data.duration ?? new Date().toLocaleDateString('ru-RU');
  data.participants_count = data.participants_count ?? 8;
  data.show_in_list = data.show_in_list ?? true;
  data.hide_bracket = data.hide_bracket ?? false;
  data.entry_fee = data.entry_fee ?? env.TOURNAMENT_ENTRY_FEE;
  data.comment = data.comment ?? '';
  data.name = generateTournamentName({
    sport: data.sport!,
    city: data.city!,
    level: data.level!,
    gender: data.gender,
    date: data.duration!,
  });
  const id = `t_${Date.now()}`;
  const tourn: Tournament = {
    id,
    name: data.name,
    sport: data.sport!,
    country: data.country!,
    city: data.city!,
    type: data.type!,
    gender: data.gender,
    category: data.category!,
    level: data.level!,
    age_group: data.age_group!,
    duration: data.duration!,
    participants_count: data.participants_count!,
    participants: {},
    show_in_list: data.show_in_list!,
    hide_bracket: data.hide_bracket!,
    status: 'active',
    entry_fee: data.entry_fee!,
    payments: {},
    created_by: String(getCtxUserId(ctx)),
    created_at: new Date().toISOString(),
  };
  await storage.saveTournament(tourn);
  await sendTournamentCreatedToChannel(ctx.api, tourn);
  await clearState(ctx);
  await ctx.reply(fmt(TXT.tournament.create_done, { name: tourn.name }));
}

export function registerTournamentHandlers(bot: import('@maxhub/max-bot-api').Bot<AppContext>): void {
  bot.action('tournament_list', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    await setState(ctx, ViewTournamentsStates.SPORT, {});
    await showCurrentMessage(ctx, TXT.search.choose_sport, {
      attachments: [Keyboard.inlineKeyboard(
        chunkButtons(SPORTS, (s) => Keyboard.button.callback(s, `tviewsport_${encodeURIComponent(s)}`), 2),
      )],
    });
  });

  bot.action('tournament_my', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    await showMyTournaments(ctx, 0);
  });

  bot.action(/^tviewsport_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<ViewData>(ctx);
    data.sport = decodeURIComponent(getCallbackPayload(ctx).replace('tviewsport_', '')) as SportType;
    await setState(ctx, ViewTournamentsStates.COUNTRY, data);
    await showCurrentMessage(ctx, TXT.search.choose_country, {
      attachments: [Keyboard.inlineKeyboard(
        chunkButtons(Object.keys(COUNTRIES), (c) => Keyboard.button.callback(c, `tviewcountry_${encodeURIComponent(c)}`), 2),
      )],
    });
  });

  bot.action(/^tviewcountry_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<ViewData>(ctx);
    data.country = decodeURIComponent(getCallbackPayload(ctx).replace('tviewcountry_', ''));
    await setState(ctx, ViewTournamentsStates.CITY, data);
    const cities = COUNTRIES[data.country!] ?? [];
    await showCurrentMessage(ctx, TXT.tournament.choose_city, {
      attachments: [Keyboard.inlineKeyboard(
        chunkButtons(cities, (c) => Keyboard.button.callback(c, `tviewcity_${encodeURIComponent(c)}`), 2),
      )],
    });
  });

  bot.action(/^tviewcity_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<ViewData>(ctx);
    data.city = decodeURIComponent(getCallbackPayload(ctx).replace('tviewcity_', ''));
    data.page = 0;
    data.listMode = 'browse';
    await setState(ctx, ViewTournamentsStates.LIST, data);
    await showTournamentList(ctx, data);
  });

  bot.action(/^tview_page:/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const page = Number.parseInt(getCallbackPayload(ctx).replace('tview_page:', ''), 10) || 0;
    const data = getStateData<ViewData>(ctx);
    data.page = page;
    data.listMode = 'browse';
    await showTournamentList(ctx, data, { mode: 'edit', withImage: false });
  });

  bot.action(/^tmy_page:/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const page = Number.parseInt(getCallbackPayload(ctx).replace('tmy_page:', ''), 10) || 0;
    await showMyTournaments(ctx, page, { mode: 'edit', withImage: false });
  });

  bot.action(/^view_tournament:/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const id = getCallbackPayload(ctx).replace('view_tournament:', '');
    await handleViewTournament(ctx, id);
  });

  bot.action(/^join_tournament:/, async (ctx) => {
    await handleJoinTournament(ctx, getCallbackPayload(ctx).replace('join_tournament:', ''), {
      fromDeepLink: false,
    });
  });

  bot.action(/^leave_tournament:/, async (ctx) => {
    const id = getCallbackPayload(ctx).replace('leave_tournament:', '');
    const userId = getCtxUserId(ctx);
    let tourn = await storage.getTournament(id);
    if (tourn) {
      tourn = removeParticipant(tourn, userId);
      await storage.saveTournament(tourn);
    }
    await ctx.answerOnCallback({ notification: TXT.tournament.left });

    const data = getStateData<ViewData>(ctx);
    const editOpts: CardShowOptions = { mode: 'edit', withImage: false };

    if (data.listMode === 'my') {
      const list = await resolveTournamentList(ctx, { listMode: 'my' });
      if (!list.length) {
        await showCurrentMessage(ctx, TXT.tournament.my_empty, {
          attachments: [Keyboard.inlineKeyboard([
            [Keyboard.button.callback(TXT.tournament.list, 'tournament_list')],
            [Keyboard.button.callback(TXT.common.main_menu, 'main_menu')],
          ])],
        }, 'edit');
        return;
      }
      const page = Math.min(data.page ?? 0, list.length - 1);
      await setState(ctx, ViewTournamentsStates.LIST, {
        listMode: 'my',
        page,
        tournamentIds: list.map((t) => t.id),
      });
      await showTournamentCard(ctx, list[page], {
        page,
        total: list.length,
        listMode: 'my',
      }, editOpts);
      return;
    }

    if (tourn) {
      const list = await resolveTournamentList(ctx, { ...data, listMode: 'browse' });
      const page = Math.max(0, list.findIndex((t) => t.id === id));
      if (list.length) {
        await showTournamentCard(ctx, list[page], {
          page,
          total: list.length,
          listMode: 'browse',
        }, editOpts);
      } else {
        await showTournamentCard(ctx, tourn, undefined, editOpts);
      }
    }
  });

  bot.action(/^pay_tournament:/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    await handlePayTournament(ctx, getCallbackPayload(ctx).replace('pay_tournament:', ''));
  });

  bot.action(/^tournament_pay_confirm:/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const id = getCallbackPayload(ctx).replace('tournament_pay_confirm:', '');
    await confirmTournamentPayment(ctx, id);
  });

  bot.action(/^view_bracket:/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const id = getCallbackPayload(ctx).replace('view_bracket:', '');
    const tourn = await storage.getTournament(id);
    if (!tourn) {
      await ctx.reply(TXT.tournament.not_found);
      return;
    }
    const bracketImage = await uploadBracketImage(ctx.api, tourn);
    if (bracketImage) {
      await ctx.reply(TXT.tournament.bracket, { attachments: [bracketImage] });
    } else {
      await ctx.reply(TXT.tournament.bracket_unavailable);
    }
  });

  bot.action('create_tournament', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    if (!isAdmin(getCtxUserId(ctx))) return;
    await setState(ctx, CreateTournamentStates.SPORT, {});
    await showCurrentMessage(ctx, TXT.search.choose_sport, {
      attachments: [Keyboard.inlineKeyboard(
        chunkButtons(SPORTS, (s) => Keyboard.button.callback(s, `tcsport_${encodeURIComponent(s)}`), 2),
      )],
    });
  });

  bot.action(/^tcsport_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<CreateData>(ctx);
    data.sport = decodeURIComponent(getCallbackPayload(ctx).replace('tcsport_', '')) as SportType;
    await setState(ctx, CreateTournamentStates.COUNTRY, data);
    await showCurrentMessage(ctx, TXT.search.choose_country, {
      attachments: [Keyboard.inlineKeyboard(
        chunkButtons(Object.keys(COUNTRIES), (c) => Keyboard.button.callback(c, `tccountry_${encodeURIComponent(c)}`), 2),
      )],
    });
  });

  bot.action(/^tccountry_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<CreateData>(ctx);
    data.country = decodeURIComponent(getCallbackPayload(ctx).replace('tccountry_', ''));
    await setState(ctx, CreateTournamentStates.CITY, data);
    const cities = COUNTRIES[data.country!] ?? [];
    await showCurrentMessage(ctx, fmt(TXT.search.choose_city, { country: data.country! }), {
      attachments: [Keyboard.inlineKeyboard(
        chunkButtons(cities, (c) => Keyboard.button.callback(c, `tccity_${encodeURIComponent(c)}`), 2),
      )],
    });
  });

  bot.action(/^tccity_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<CreateData>(ctx);
    data.city = decodeURIComponent(getCallbackPayload(ctx).replace('tccity_', ''));
    await setState(ctx, CreateTournamentStates.TYPE, data);
    await showCurrentMessage(ctx, TXT.tournament.create_type, {
      attachments: [Keyboard.inlineKeyboard(
        TOURNAMENT_TYPES.map((tp) => [Keyboard.button.callback(tp, `tctype_${encodeURIComponent(tp)}`)]),
      )],
    });
  });

  bot.action(/^tctype_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<CreateData>(ctx);
    data.type = decodeURIComponent(getCallbackPayload(ctx).replace('tctype_', '')) as Tournament['type'];
    await setState(ctx, CreateTournamentStates.GENDER, data);
    await showCurrentMessage(ctx, TXT.tournament.create_gender, {
      attachments: [Keyboard.inlineKeyboard(
        TOURNAMENT_GENDERS.map((g) => [Keyboard.button.callback(g, `tcgender_${encodeURIComponent(g)}`)]),
      )],
    });
  });

  bot.action(/^tcgender_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<CreateData>(ctx);
    data.gender = decodeURIComponent(getCallbackPayload(ctx).replace('tcgender_', ''));
    await setState(ctx, CreateTournamentStates.CATEGORY, data);
    await showCurrentMessage(ctx, TXT.tournament.create_category, {
      attachments: [Keyboard.inlineKeyboard(
        TOURNAMENT_CATEGORIES.map((c) => [Keyboard.button.callback(c, `tccategory_${encodeURIComponent(c)}`)]),
      )],
    });
  });

  bot.action(/^tccategory_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<CreateData>(ctx);
    data.category = decodeURIComponent(getCallbackPayload(ctx).replace('tccategory_', ''));
    await setState(ctx, CreateTournamentStates.CONFIRM, data);
    const preview = [
      data.sport,
      `${data.country}, ${data.city}`,
      data.type,
      data.gender,
      data.category,
      fmt(TXT.tournament.create_fee, { fee: env.TOURNAMENT_ENTRY_FEE }),
      TXT.tournament.create_participants,
    ].join('\n');
    await showCurrentMessage(ctx, fmt(TXT.tournament.create_confirm, { preview }), {
      attachments: [Keyboard.inlineKeyboard([
        [Keyboard.button.callback('✅ Создать', 'tcconfirm_yes')],
        [Keyboard.button.callback(TXT.common.main_menu, 'main_menu')],
      ])],
    });
  });

  bot.action('tcconfirm_yes', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    if (!isAdmin(getCtxUserId(ctx))) return;
    const data = getStateData<CreateData>(ctx);
    await finalizeTournamentCreate(ctx, data);
  });
}
