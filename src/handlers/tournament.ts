import { TXT, fmt, MENU_LABELS } from '../texts.js';
import { Keyboard } from '@maxhub/max-bot-api';
import type { AppContext } from '../context.js';
import { getMessageText } from '../context.js';
import { env, isAdmin } from '../config/env.js';
import {
  COUNTRIES,
  SPORTS,
  MOSCOW_DISTRICTS,
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
import { clearState, getStateData, setState } from '../middleware/session.js';
import { CreateTournamentStates, ViewTournamentsStates } from '../types/states.js';
import type { SportType, Tournament } from '../types/models.js';
import { chunkButtons, showCurrentMessage } from '../utils/bot.js';
import {
  addParticipant,
  canStartTournament,
  openPaymentWindow,
  removeParticipant,
  shouldOpenPaymentWindow,
  startTournament,
} from '../utils/tournamentLifecycle.js';
import { bracketToText } from '../utils/bracket/index.js';
import {
  sendTournamentApplicationToChannel,
  sendTournamentCreatedToChannel,
  sendTournamentStartedToChannel,
} from '../services/channels.js';
import { createTournamentPayment } from '../services/payments.js';
import { getCallbackPayload } from '../utils/callback.js';
import { requireRegistered } from './registration.js';
import { getCtxUserId } from '../context.js';

type ViewData = Partial<Tournament> & { page?: number };
type CreateData = Partial<Tournament>;

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

export async function handleViewTournament(ctx: AppContext, id: string): Promise<void> {
  const tourn = await storage.getTournament(id);
  if (!tourn) {
    await ctx.reply('Tournament not found');
    return;
  }
  await showTournamentCard(ctx, tourn);
}

export async function handleJoinTournament(ctx: AppContext, id: string): Promise<void> {
  const user = await requireRegistered(ctx);
  if (!user) return;
  let tourn = await storage.getTournament(id);
  if (!tourn || tourn.status !== 'active') {
    await ctx.reply('Tournament unavailable');
    return;
  }
  tourn = addParticipant(tourn, user.max_user_id, `${user.first_name} ${user.last_name}`);
  if (shouldOpenPaymentWindow(tourn)) tourn = openPaymentWindow(tourn);
  if (canStartTournament(tourn)) tourn = startTournament(tourn);
  await storage.saveTournament(tourn);
  await sendTournamentApplicationToChannel(ctx.api, tourn, user.first_name);
  await ctx.reply(TXT.tournament.joined);
  await showTournamentCard(ctx, tourn);
}

export async function handlePayTournament(ctx: AppContext, id: string): Promise<void> {
  const user = await requireRegistered(ctx);
  if (!user) return;
  const tourn = await storage.getTournament(id);
  if (!tourn) return;
  const payment = await createTournamentPayment({
    userId: user.max_user_id,
    tournamentId: id,
    amount: tourn.entry_fee,
    email: env.EMAIL_ADMIN || 'user@example.com',
  });
  if (payment) {
    tourn.payments[String(user.max_user_id)] = { status: 'pending', payment_id: payment.paymentId };
    await storage.saveTournament(tourn);
    await ctx.reply(TXT.payments.pay_link, {
      attachments: [Keyboard.inlineKeyboard([[Keyboard.button.link('💳 Pay', payment.paymentUrl)]])],
    });
  }
}

async function showTournamentCard(ctx: AppContext, tourn: Tournament): Promise<void> {
  const count = Object.keys(tourn.participants).length;
  const text = fmt(TXT.tournament.card, {
    name: tourn.name,
    sport: tourn.sport,
    city: tourn.city,
    type: tourn.type,
    category: tourn.category,
    current: count,
    max: tourn.participants_count,
    fee: tourn.entry_fee,
  });
  const buttons = [
    [Keyboard.button.callback(TXT.tournament.join, `join_tournament:${tourn.id}`)],
    [Keyboard.button.callback(TXT.tournament.leave, `leave_tournament:${tourn.id}`)],
  ];
  if (tourn.entry_fee > 0) {
    buttons.push([Keyboard.button.callback(TXT.tournament.pay, `pay_tournament:${tourn.id}`)]);
  }
  if (tourn.status === 'started' && tourn.bracket) {
    buttons.push([Keyboard.button.callback(TXT.tournament.bracket, `view_bracket:${tourn.id}`)]);
  }
  buttons.push([Keyboard.button.callback(TXT.common.main_menu, 'main_menu')]);
  await showCurrentMessage(ctx, text, { attachments: [Keyboard.inlineKeyboard(buttons)] });
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
    const all = await storage.getTournaments();
    const list = Object.values(all).filter(
      (t) => t.show_in_list && t.sport === data.sport && t.country === data.country && t.status !== 'cancelled',
    );
    const buttons = list.map((t) => [Keyboard.button.callback(t.name, `view_tournament:${t.id}`)]);
    buttons.push([Keyboard.button.callback(TXT.common.main_menu, 'main_menu')]);
    await showCurrentMessage(ctx, TXT.tournament.list, {
      attachments: [Keyboard.inlineKeyboard(buttons)],
    });
  });

  bot.action(/^view_tournament:/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const id = getCallbackPayload(ctx).replace('view_tournament:', '');
    await handleViewTournament(ctx, id);
  });

  bot.action(/^join_tournament:/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    await handleJoinTournament(ctx, getCallbackPayload(ctx).replace('join_tournament:', ''));
  });

  bot.action(/^leave_tournament:/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const id = getCallbackPayload(ctx).replace('leave_tournament:', '');
    const userId = getCtxUserId(ctx);
    let tourn = await storage.getTournament(id);
    if (tourn) {
      tourn = removeParticipant(tourn, userId);
      await storage.saveTournament(tourn);
    }
    await ctx.reply(TXT.tournament.left);
  });

  bot.action(/^pay_tournament:/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    await handlePayTournament(ctx, getCallbackPayload(ctx).replace('pay_tournament:', ''));
  });

  bot.action(/^view_bracket:/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const id = getCallbackPayload(ctx).replace('view_bracket:', '');
    const tourn = await storage.getTournament(id);
    if (tourn?.bracket) {
      const text = bracketToText(tourn.bracket as unknown as import('../utils/bracket/index.js').BracketTree);
      await ctx.reply(text);
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
    await showCurrentMessage(ctx, TXT.search.choose_city, {
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
    await showCurrentMessage(ctx, 'Тип:', {
      attachments: [Keyboard.inlineKeyboard(
        TOURNAMENT_TYPES.map((tp) => [Keyboard.button.callback(tp, `tctype_${encodeURIComponent(tp)}`)]),
      )],
    });
  });

  bot.action(/^tctype_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<CreateData>(ctx);
    data.type = decodeURIComponent(getCallbackPayload(ctx).replace('tctype_', '')) as Tournament['type'];
    data.gender = TOURNAMENT_GENDERS[0];
    data.category = TOURNAMENT_CATEGORIES[2];
    data.level = TOURNAMENT_LEVELS[2];
    data.age_group = TOURNAMENT_AGE_GROUPS[0];
    data.duration = new Date().toLocaleDateString('ru-RU');
    data.participants_count = 8;
    data.show_in_list = true;
    data.hide_bracket = false;
    data.entry_fee = env.TOURNAMENT_ENTRY_FEE;
    data.comment = '';
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
      show_in_list: true,
      hide_bracket: false,
      status: 'active',
      entry_fee: data.entry_fee!,
      payments: {},
      created_by: String(getCtxUserId(ctx)),
      created_at: new Date().toISOString(),
    };
    await storage.saveTournament(tourn);
    await sendTournamentCreatedToChannel(ctx.api, tourn);
    await clearState(ctx);
    await ctx.reply(`✅ ${tourn.name}`);
  });
}
