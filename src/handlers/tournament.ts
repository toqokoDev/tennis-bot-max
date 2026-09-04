import { TXT, fmt } from '../texts.js';
import { Keyboard } from '@maxhub/max-bot-api';
import type { AppContext } from '../context.js';
import { getMessageText, getCtxUserId } from '../context.js';
import { env, isAdmin } from '../config/env.js';
import { COUNTRIES } from '../config/profile.js';
import {
  TOURNAMENT_CATEGORIES,
  TOURNAMENT_GENDER_BUTTONS,
  TOURNAMENT_TYPES,
  TOURNAMENT_SPORT_ROWS,
  DISTRICTS_MOSCOW,
  MIN_PARTICIPANTS,
  generateTournamentName,
  autoCategoryAndAge,
  isLevelMatch,
  getJoinBlockReason,
} from '../config/tournament.js';
import { storage } from '../storage/jsonStorage.js';
import { clearState, getState, getStateData, setState, getPrevMessageId, setPrevMessageId } from '../middleware/session.js';
import {
  CreateTournamentStates,
  TournamentPaymentStates,
  ViewTournamentsStates,
} from '../types/states.js';
import type { SportType, Tournament, UserProfile } from '../types/models.js';
import { chunkButtons, showCurrentMessage, askText, backButton } from '../utils/bot.js';
import {
  addParticipant,
  canStartTournament,
  isParticipant,
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

type ProposedTournament = {
  sport: SportType;
  country: string;
  city: string;
  district?: string;
  type: Tournament['type'];
  gender: string;
  category: string;
  level: string;
  age_group: 'Взрослые' | 'Дети';
  duration: string;
  participants_count: number;
  show_in_list: boolean;
  hide_bracket: boolean;
  comment: string;
};

type ViewData = {
  sport?: SportType;
  country?: string;
  city?: string;
  district?: string;
  gender?: string;
  category?: string;
  age_group?: 'Взрослые' | 'Дети';
  duration?: string;
  playerLevel?: string;
  levelRange?: string | null;
  proposed?: ProposedTournament;
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
  withImage?: boolean;
};

type Btn = ReturnType<typeof Keyboard.button.callback>;

function mainMenuRow(): Btn[] {
  return [Keyboard.button.callback(TXT.common.main_menu, 'main_menu')];
}

function withMainMenu(rows: Btn[][]): Btn[][] {
  return [...rows, mainMenuRow()];
}

function tournamentSportKeyboard(prefix: string): Btn[][] {
  return withMainMenu(
    TOURNAMENT_SPORT_ROWS.map((row) =>
      row.map((s) => Keyboard.button.callback(s, `${prefix}${encodeURIComponent(s)}`)),
    ),
  );
}

function orderedCountries(): string[] {
  const keys = Object.keys(COUNTRIES);
  return ['🇷🇺 Россия', ...keys.filter((c) => c !== '🇷🇺 Россия')];
}

function genderKeyboard(prefix: string): Btn[][] {
  const rows = chunkButtons(
    TOURNAMENT_GENDER_BUTTONS,
    (g) => Keyboard.button.callback(g.label, `${prefix}${encodeURIComponent(g.value)}`),
    2,
  );
  return withMainMenu(rows);
}

function removeCountryFlag(country: string): string {
  return country.replace(/^[^\p{L}\p{N}]+/u, '').trim() || country;
}

function filterBrowseTournaments(all: Record<string, Tournament>, data: ViewData): Tournament[] {
  return Object.values(all)
    .filter((t) => {
      if (!t.show_in_list || t.status === 'cancelled') return false;
      if (t.status !== 'active' && t.status !== 'started') return false;
      if (data.sport && t.sport !== data.sport) return false;
      if (data.country && t.country !== data.country) return false;
      if (data.city && t.city !== data.city) return false;
      if (data.city === 'Москва' && data.district) {
        if ((t.district || '') !== data.district) return false;
      }
      if (data.gender && t.gender !== data.gender) return false;
      if (data.category && t.category !== data.category) return false;
      if (data.age_group && t.age_group !== data.age_group) return false;
      if (data.duration && (t.duration || data.duration) !== data.duration) return false;
      if (!isLevelMatch(data.playerLevel, t.level)) return false;
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

async function getOtherCountriesFromTournaments(sport?: SportType): Promise<string[]> {
  const all = await storage.getTournaments();
  const known = new Set(Object.keys(COUNTRIES));
  const found = new Set<string>();
  for (const t of Object.values(all)) {
    if (sport && t.sport !== sport) continue;
    if (t.status !== 'active' && t.status !== 'started') continue;
    if (t.country && !known.has(t.country)) found.add(t.country);
  }
  return [...found].sort().slice(0, 5);
}

async function getOtherCitiesFromTournaments(sport?: SportType, country?: string): Promise<string[]> {
  const all = await storage.getTournaments();
  const known = new Set(COUNTRIES[country ?? ''] ?? []);
  const found = new Set<string>();
  for (const t of Object.values(all)) {
    if (sport && t.sport !== sport) continue;
    if (country && t.country !== country) continue;
    if (t.status !== 'active' && t.status !== 'started') continue;
    if (t.city && !known.has(t.city)) found.add(t.city);
  }
  return [...found].sort().slice(0, 5);
}

export async function showTournamentMenu(ctx: AppContext): Promise<void> {
  const user = await requireRegistered(ctx);
  if (!user) return;
  const all = await storage.getTournaments();
  const activeCount = Object.values(all).filter((t) => t.status === 'active' || t.status === 'started').length;
  const buttons = [
    [Keyboard.button.callback(TXT.tournament.list, 'tournament_list')],
    [Keyboard.button.callback(TXT.tournament.my, 'tournament_my')],
  ];
  if (isAdmin(user.max_user_id)) {
    buttons.push([Keyboard.button.callback(TXT.tournament.create, 'create_tournament')]);
  }
  buttons.push(mainMenuRow());
  await showCurrentMessage(ctx, fmt(TXT.tournament.menu, { active_count: activeCount }), {
    attachments: [Keyboard.inlineKeyboard(buttons)],
  });
}

async function showBrowseSport(ctx: AppContext): Promise<void> {
  await setState(ctx, ViewTournamentsStates.SPORT, {});
  await showCurrentMessage(ctx, TXT.tournament.step1, {
    attachments: [Keyboard.inlineKeyboard(tournamentSportKeyboard('tviewsport_'))],
  });
}

async function showBrowseCountry(ctx: AppContext, data: ViewData): Promise<void> {
  await setState(ctx, ViewTournamentsStates.COUNTRY, data);
  const rows = chunkButtons(
    orderedCountries(),
    (c) => Keyboard.button.callback(c, `tviewcountry_${encodeURIComponent(c)}`),
    2,
  );
  rows.push([Keyboard.button.callback(TXT.tournament.other_country, 'tviewcountry_other')]);
  await showCurrentMessage(ctx, fmt(TXT.tournament.step2, { sport: data.sport! }), {
    attachments: [Keyboard.inlineKeyboard(withMainMenu(rows))],
  });
}

async function showBrowseCity(ctx: AppContext, data: ViewData): Promise<void> {
  await setState(ctx, ViewTournamentsStates.CITY_INPUT, data);
  const cities = COUNTRIES[data.country!] ?? [];
  const otherCities = await getOtherCitiesFromTournaments(data.sport, data.country);
  const rows = chunkButtons(
    cities,
    (c) => Keyboard.button.callback(c, `tviewcity_${encodeURIComponent(c)}`),
    2,
  );
  for (const city of otherCities) {
    if (!cities.includes(city)) {
      rows.push([Keyboard.button.callback(`📍 ${city}`, `tviewcity_${encodeURIComponent(city)}`)]);
    }
  }
  rows.push([Keyboard.button.callback(TXT.common.back, 'tournament_list')]);
  await showCurrentMessage(ctx, fmt(TXT.tournament.step3, {
    sport: data.sport!,
    country: data.country!,
  }), {
    attachments: [Keyboard.inlineKeyboard(withMainMenu(rows))],
  });
}

async function showBrowseDistrict(ctx: AppContext, data: ViewData): Promise<void> {
  await setState(ctx, ViewTournamentsStates.DISTRICT, data);
  const rows = chunkButtons(
    [...DISTRICTS_MOSCOW],
    (d) => Keyboard.button.callback(d, `tviewdistrict_${encodeURIComponent(d)}`),
    2,
  );
  await showCurrentMessage(ctx, fmt(TXT.tournament.step4_district, {
    sport: data.sport!,
    country: data.country!,
    city: data.city!,
  }), {
    attachments: [Keyboard.inlineKeyboard(withMainMenu(rows))],
  });
}

async function showBrowseGender(ctx: AppContext, data: ViewData): Promise<void> {
  await setState(ctx, ViewTournamentsStates.GENDER, data);
  const text = data.district
    ? fmt(TXT.tournament.step5_gender, {
      sport: data.sport!,
      country: data.country!,
      city: data.city!,
      district: data.district,
    })
    : fmt(TXT.tournament.step4_gender, {
      sport: data.sport!,
      country: data.country!,
      city: data.city!,
    });
  await showCurrentMessage(ctx, text, {
    attachments: [Keyboard.inlineKeyboard(genderKeyboard('tviewgender_'))],
  });
}

async function continueAfterGender(ctx: AppContext, data: ViewData, user: UserProfile): Promise<void> {
  const { category, ageGroup, playerLevel, levelRange } = autoCategoryAndAge(user);
  data.category = category;
  data.age_group = ageGroup;
  data.playerLevel = playerLevel;
  data.levelRange = levelRange;
  data.duration = 'Многодневные';
  data.page = 0;
  data.listMode = 'browse';

  const list = filterBrowseTournaments(await storage.getTournaments(), data);
  if (!list.length) {
    const proposed: ProposedTournament = {
      sport: data.sport!,
      country: data.country!,
      city: data.city!,
      district: data.city === 'Москва' ? data.district : undefined,
      type: 'Круговая',
      gender: data.gender!,
      category,
      level: levelRange || 'Не указан',
      age_group: ageGroup,
      duration: 'Многодневные',
      participants_count: MIN_PARTICIPANTS['Круговая'] ?? 4,
      show_in_list: true,
      hide_bracket: false,
      comment: '',
    };
    data.proposed = proposed;
    await setState(ctx, ViewTournamentsStates.PROPOSED, data);

    const all = await storage.getTournaments();
    const name = generateTournamentName({
      city: proposed.city,
      country: proposed.country,
      district: proposed.district,
      level: proposed.level,
      gender: proposed.gender,
      number: Object.keys(all).length + 1,
    });
    const location = proposed.district
      ? `${proposed.city} (${proposed.district}), ${removeCountryFlag(proposed.country)}`
      : `${proposed.city}, ${removeCountryFlag(proposed.country)}`;

    await showCurrentMessage(ctx, fmt(TXT.tournament.proposed_preview, {
      name,
      location,
      type: proposed.type,
      gender: proposed.gender,
      category: proposed.category,
      age_group: proposed.age_group,
      duration: proposed.duration,
      count: proposed.participants_count,
    }), {
      attachments: [Keyboard.inlineKeyboard(withMainMenu([
        [Keyboard.button.callback(TXT.tournament.join, 'apply_proposed_tournament')],
      ]))],
    });
    return;
  }

  await showTournamentList(ctx, data);
}

async function applyProposedTournament(ctx: AppContext): Promise<void> {
  const user = await requireRegistered(ctx);
  if (!user) return;
  const data = getStateData<ViewData>(ctx);
  const base = data.proposed;
  if (!base) {
    await showCurrentMessage(ctx, TXT.tournament.proposed_missing, {
      attachments: [Keyboard.inlineKeyboard(withMainMenu([
        [Keyboard.button.callback(TXT.tournament.list, 'tournament_list')],
      ]))],
    });
    return;
  }

  const all = await storage.getTournaments();
  const number = Object.keys(all).length + 1;
  const name = generateTournamentName({
    city: base.city,
    country: base.country,
    district: base.district,
    level: base.level,
    gender: base.gender,
    number,
  });
  const id = `t_${Date.now()}`;
  let tourn: Tournament = {
    id,
    name,
    sport: base.sport,
    country: base.country,
    city: base.city,
    district: base.district,
    type: base.type,
    gender: base.gender,
    category: base.category,
    level: base.level,
    age_group: base.age_group,
    duration: base.duration,
    participants_count: base.participants_count,
    participants: {},
    show_in_list: base.show_in_list,
    hide_bracket: base.hide_bracket,
    comment: base.comment,
    status: 'active',
    entry_fee: env.TOURNAMENT_ENTRY_FEE,
    payments: {},
    created_by: String(user.max_user_id),
    created_at: new Date().toISOString(),
  };
  tourn = addParticipant(tourn, user.max_user_id, `${user.first_name} ${user.last_name}`);
  if (shouldOpenPaymentWindow(tourn)) tourn = openPaymentWindow(tourn);
  await storage.saveTournament(tourn);
  await sendTournamentCreatedToChannel(ctx.api, tourn);
  await sendTournamentApplicationToChannel(ctx.api, tourn, user);

  data.proposed = undefined;
  data.listMode = 'my';
  await setState(ctx, ViewTournamentsStates.LIST, data);

  const count = Object.keys(tourn.participants).length;
  const buttons: Btn[][] = [];
  if (tourn.entry_fee > 0) {
    buttons.push([Keyboard.button.callback(TXT.tournament.pay, `pay_tournament:${tourn.id}`)]);
    buttons.push([Keyboard.button.callback(TXT.payments.check, `tournament_pay_check:${tourn.id}`)]);
  }
  buttons.push([Keyboard.button.callback(TXT.tournament.all_tournaments, 'tournament_list')]);
  buttons.push(mainMenuRow());

  await showCurrentMessage(ctx, fmt(TXT.tournament.applied_success, {
    name: tourn.name,
    current: count,
    total: tourn.participants_count,
  }), {
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
      attachments: [Keyboard.inlineKeyboard(withMainMenu([
        [Keyboard.button.callback(TXT.tournament.list, 'tournament_list')],
      ]))],
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

  const notify = async (text: string): Promise<void> => {
    if (fromDeepLink || !ctx.callback) {
      await ctx.reply(text);
    } else {
      await ctx.answerOnCallback({ notification: text });
    }
  };

  const showCard = async (t: typeof tourn, withImage = true): Promise<void> => {
    if (!t) return;
    await showTournamentCard(ctx, t, undefined, {
      mode: fromDeepLink || !ctx.callback ? 'new' : 'edit',
      withImage,
    });
  };

  const block = getJoinBlockReason(tourn, user);
  if (block) {
    const userLevel = user.player_level || 'не указан';
    const messages: Record<NonNullable<typeof block>, string> = {
      not_found: TXT.tournament.not_found,
      unavailable: TXT.tournament.unavailable,
      already_registered: TXT.tournament.already_registered,
      full: TXT.tournament.tournament_full,
      level: fmt(TXT.tournament.level_mismatch, {
        user_level: userLevel,
        tournament_level: tourn?.level || 'не указан',
      }),
      gender: fmt(TXT.tournament.gender_mismatch, { gender: tourn?.gender || '' }),
      age: fmt(TXT.tournament.age_mismatch, { age_group: tourn?.age_group || '' }),
      category: fmt(TXT.tournament.category_mismatch, { category: tourn?.category || '' }),
      sport: fmt(TXT.tournament.sport_mismatch, {
        sport: tourn?.sport || '',
        user_sport: user.sport || '',
      }),
    };
    await notify(messages[block]);
    if (tourn && (block === 'already_registered' || block === 'full' || block === 'level'
      || block === 'gender' || block === 'age' || block === 'category' || block === 'sport')) {
      await showCard(tourn, Boolean(fromDeepLink || !ctx.callback));
    }
    return;
  }

  tourn = addParticipant(tourn!, user.max_user_id, `${user.first_name} ${user.last_name}`);
  // Защита на случай гонки: ключ уже был / лимит
  if (!isParticipant(tourn, user.max_user_id)) {
    await notify(TXT.tournament.tournament_full);
    return;
  }

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
      payment_link: payment.paymentUrl,
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
      [Keyboard.button.callback(TXT.payments.check, `tournament_pay_check:${data.tournament_id}`)],
      mainMenuRow(),
    ])],
  });
  return true;
}

export async function handleTournamentBrowseMessage(ctx: AppContext): Promise<boolean> {
  const state = getState(ctx);
  const text = (getMessageText(ctx) || '').trim();
  if (!text) return false;

  if (state === ViewTournamentsStates.COUNTRY_INPUT) {
    const data = getStateData<ViewData>(ctx);
    data.country = text;
    data.city = undefined;
    data.district = undefined;
    await showBrowseCity(ctx, data);
    return true;
  }

  if (state === ViewTournamentsStates.CITY_INPUT) {
    const data = getStateData<ViewData>(ctx);
    data.city = text;
    data.district = undefined;
    if (text === 'Москва') {
      await showBrowseDistrict(ctx, data);
    } else {
      await showBrowseGender(ctx, data);
    }
    return true;
  }

  return false;
}

async function confirmTournamentPayment(ctx: AppContext, tournamentId: string): Promise<void> {
  const data = getStateData<TourPayData>(ctx);
  const stored = (await storage.getTournament(tournamentId))?.payments[String(getCtxUserId(ctx))];
  const paymentId = data.payment_id ?? stored?.payment_id;
  const provider = data.provider ?? stored?.provider ?? 'tinkoff';
  if (!paymentId) {
    await ctx.reply(TXT.tournament.payment_no_pending, { attachments: [backButton()] });
    return;
  }
  const status = await checkPaymentStatus(paymentId, provider);
  if (status !== 'succeeded') {
    const payUrl = data.payment_url || stored?.payment_link;
    const rows: Array<Array<ReturnType<typeof Keyboard.button.callback> | ReturnType<typeof Keyboard.button.link>>> = [];
    if (payUrl) {
      rows.push([Keyboard.button.link(TXT.payments.continue_pay, payUrl)]);
    }
    rows.push([Keyboard.button.callback(TXT.payments.confirm_pay, `tournament_pay_confirm:${tournamentId}`)]);
    rows.push([Keyboard.button.callback(TXT.payments.check, `tournament_pay_check:${tournamentId}`)]);
    rows.push(mainMenuRow());
    await ctx.reply(TXT.tournament.payment_not_confirmed, {
      attachments: [Keyboard.inlineKeyboard(rows)],
    });
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
  const buttons: Btn[][] = [];

  if (nav && nav.total > 1) {
    const prefix = nav.listMode === 'my' ? 'tmy_page' : 'tview_page';
    const prev = (nav.page - 1 + nav.total) % nav.total;
    const next = (nav.page + 1) % nav.total;
    buttons.push([
      Keyboard.button.callback(TXT.tournament.prev, `${prefix}:${prev}`),
      Keyboard.button.callback(TXT.tournament.next, `${prefix}:${next}`),
    ]);
  }

  const viewer = await storage.getUser(userId);
  const canJoin = viewer
    ? getJoinBlockReason(tourn, viewer) === null
    : tourn.status === 'active' && !isParticipant;
  if (canJoin) {
    buttons.push([Keyboard.button.callback(TXT.tournament.join, `join_tournament:${tourn.id}`)]);
  }
  if (isParticipant && tourn.status === 'active') {
    buttons.push([Keyboard.button.callback(TXT.tournament.leave, `leave_tournament:${tourn.id}`)]);
    if (tourn.entry_fee > 0 && !paid) {
      buttons.push([Keyboard.button.callback(TXT.tournament.pay, `pay_tournament:${tourn.id}`)]);
      buttons.push([Keyboard.button.callback(TXT.payments.check, `tournament_pay_check:${tourn.id}`)]);
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
  buttons.push(mainMenuRow());

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
      attachments: [Keyboard.inlineKeyboard(withMainMenu([
        [Keyboard.button.callback(TXT.common.back, 'tournament_list')],
      ]))],
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
  data.level = data.level ?? '3.5-4.5';
  data.age_group = data.age_group ?? 'Взрослые';
  data.duration = data.duration ?? 'Многодневные';
  data.participants_count = data.participants_count ?? 8;
  data.show_in_list = data.show_in_list ?? true;
  data.hide_bracket = data.hide_bracket ?? false;
  data.entry_fee = data.entry_fee ?? env.TOURNAMENT_ENTRY_FEE;
  data.comment = data.comment ?? '';
  const all = await storage.getTournaments();
  data.name = generateTournamentName({
    city: data.city!,
    country: data.country!,
    district: data.district,
    level: data.level!,
    gender: data.gender,
    number: Object.keys(all).length + 1,
  });
  const id = `t_${Date.now()}`;
  const tourn: Tournament = {
    id,
    name: data.name,
    sport: data.sport!,
    country: data.country!,
    city: data.city!,
    district: data.district,
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
  await ctx.reply(fmt(TXT.tournament.create_done, { name: tourn.name }), {
    attachments: [Keyboard.inlineKeyboard([mainMenuRow()])],
  });
}

export function registerTournamentHandlers(bot: import('@maxhub/max-bot-api').Bot<AppContext>): void {
  bot.action('tournament_list', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    await showBrowseSport(ctx);
  });

  bot.action('tournament_my', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    await showMyTournaments(ctx, 0);
  });

  bot.action(/^tviewsport_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<ViewData>(ctx);
    data.sport = decodeURIComponent(getCallbackPayload(ctx).replace('tviewsport_', '')) as SportType;
    await showBrowseCountry(ctx, data);
  });

  bot.action('tviewcountry_other', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<ViewData>(ctx);
    await setState(ctx, ViewTournamentsStates.COUNTRY_INPUT, data);
    const others = await getOtherCountriesFromTournaments(data.sport);
    const rows = chunkButtons(
      others,
      (c) => Keyboard.button.callback(c, `tviewcountry_${encodeURIComponent(c)}`),
      2,
    );
    rows.push([Keyboard.button.callback(TXT.common.back, 'tournament_list')]);
    await showCurrentMessage(ctx, fmt(TXT.tournament.step2_enter, { sport: data.sport! }), {
      attachments: [Keyboard.inlineKeyboard(withMainMenu(rows))],
    });
  });

  bot.action(/^tviewcountry_/, async (ctx) => {
    const payload = getCallbackPayload(ctx);
    if (payload === 'tviewcountry_other') return;
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<ViewData>(ctx);
    data.country = decodeURIComponent(payload.replace('tviewcountry_', ''));
    data.city = undefined;
    data.district = undefined;
    await showBrowseCity(ctx, data);
  });

  bot.action(/^tviewcity_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<ViewData>(ctx);
    data.city = decodeURIComponent(getCallbackPayload(ctx).replace('tviewcity_', ''));
    data.district = undefined;
    if (data.city === 'Москва') {
      await showBrowseDistrict(ctx, data);
    } else {
      await showBrowseGender(ctx, data);
    }
  });

  bot.action(/^tviewdistrict_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<ViewData>(ctx);
    data.district = decodeURIComponent(getCallbackPayload(ctx).replace('tviewdistrict_', ''));
    await showBrowseGender(ctx, data);
  });

  bot.action(/^tviewgender_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const user = await requireRegistered(ctx);
    if (!user) return;
    const data = getStateData<ViewData>(ctx);
    data.gender = decodeURIComponent(getCallbackPayload(ctx).replace('tviewgender_', ''));
    await continueAfterGender(ctx, data, user);
  });

  bot.action('apply_proposed_tournament', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    await applyProposedTournament(ctx);
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
          attachments: [Keyboard.inlineKeyboard(withMainMenu([
            [Keyboard.button.callback(TXT.tournament.list, 'tournament_list')],
          ]))],
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

  bot.action(/^tournament_pay_check:/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const id = getCallbackPayload(ctx).replace('tournament_pay_check:', '');
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
    await showCurrentMessage(ctx, TXT.tournament.choose_sport, {
      attachments: [Keyboard.inlineKeyboard(tournamentSportKeyboard('tcsport_'))],
    });
  });

  bot.action(/^tcsport_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<CreateData>(ctx);
    data.sport = decodeURIComponent(getCallbackPayload(ctx).replace('tcsport_', '')) as SportType;
    await setState(ctx, CreateTournamentStates.COUNTRY, data);
    await showCurrentMessage(ctx, TXT.tournament.choose_country, {
      attachments: [Keyboard.inlineKeyboard(withMainMenu(
        chunkButtons(orderedCountries(), (c) => Keyboard.button.callback(c, `tccountry_${encodeURIComponent(c)}`), 2),
      ))],
    });
  });

  bot.action(/^tccountry_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<CreateData>(ctx);
    data.country = decodeURIComponent(getCallbackPayload(ctx).replace('tccountry_', ''));
    await setState(ctx, CreateTournamentStates.CITY, data);
    const cities = COUNTRIES[data.country!] ?? [];
    await showCurrentMessage(ctx, fmt(TXT.tournament.choose_city, { country: data.country! }), {
      attachments: [Keyboard.inlineKeyboard(withMainMenu(
        chunkButtons(cities, (c) => Keyboard.button.callback(c, `tccity_${encodeURIComponent(c)}`), 2),
      ))],
    });
  });

  bot.action(/^tccity_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<CreateData>(ctx);
    data.city = decodeURIComponent(getCallbackPayload(ctx).replace('tccity_', ''));
    if (data.city === 'Москва') {
      await setState(ctx, CreateTournamentStates.DISTRICT, data);
      await showCurrentMessage(ctx, fmt(TXT.tournament.step4_district, {
        sport: data.sport!,
        country: data.country!,
        city: data.city!,
      }), {
        attachments: [Keyboard.inlineKeyboard(withMainMenu(
          chunkButtons([...DISTRICTS_MOSCOW], (d) => Keyboard.button.callback(d, `tcdistrict_${encodeURIComponent(d)}`), 2),
        ))],
      });
      return;
    }
    await setState(ctx, CreateTournamentStates.TYPE, data);
    await showCurrentMessage(ctx, TXT.tournament.create_type, {
      attachments: [Keyboard.inlineKeyboard(withMainMenu(
        TOURNAMENT_TYPES.map((tp) => [Keyboard.button.callback(tp, `tctype_${encodeURIComponent(tp)}`)]),
      ))],
    });
  });

  bot.action(/^tcdistrict_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<CreateData>(ctx);
    data.district = decodeURIComponent(getCallbackPayload(ctx).replace('tcdistrict_', ''));
    await setState(ctx, CreateTournamentStates.TYPE, data);
    await showCurrentMessage(ctx, TXT.tournament.create_type, {
      attachments: [Keyboard.inlineKeyboard(withMainMenu(
        TOURNAMENT_TYPES.map((tp) => [Keyboard.button.callback(tp, `tctype_${encodeURIComponent(tp)}`)]),
      ))],
    });
  });

  bot.action(/^tctype_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<CreateData>(ctx);
    data.type = decodeURIComponent(getCallbackPayload(ctx).replace('tctype_', '')) as Tournament['type'];
    await setState(ctx, CreateTournamentStates.GENDER, data);
    await showCurrentMessage(ctx, TXT.tournament.create_gender, {
      attachments: [Keyboard.inlineKeyboard(genderKeyboard('tcgender_'))],
    });
  });

  bot.action(/^tcgender_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<CreateData>(ctx);
    data.gender = decodeURIComponent(getCallbackPayload(ctx).replace('tcgender_', ''));
    await setState(ctx, CreateTournamentStates.CATEGORY, data);
    await showCurrentMessage(ctx, TXT.tournament.create_category, {
      attachments: [Keyboard.inlineKeyboard(withMainMenu(
        chunkButtons([...TOURNAMENT_CATEGORIES], (c) => Keyboard.button.callback(c, `tccategory_${encodeURIComponent(c)}`), 2),
      ))],
    });
  });

  bot.action(/^tccategory_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<CreateData>(ctx);
    data.category = decodeURIComponent(getCallbackPayload(ctx).replace('tccategory_', ''));
    await setState(ctx, CreateTournamentStates.CONFIRM, data);
    const preview = [
      data.sport,
      `${data.country}, ${data.city}${data.district ? ` (${data.district})` : ''}`,
      data.type,
      data.gender,
      data.category,
      fmt(TXT.tournament.create_fee, { fee: env.TOURNAMENT_ENTRY_FEE }),
      TXT.tournament.create_participants,
    ].join('\n');
    await showCurrentMessage(ctx, fmt(TXT.tournament.create_confirm, { preview }), {
      attachments: [Keyboard.inlineKeyboard(withMainMenu([
        [Keyboard.button.callback('✅ Создать', 'tcconfirm_yes')],
      ]))],
    });
  });

  bot.action('tcconfirm_yes', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    if (!isAdmin(getCtxUserId(ctx))) return;
    const data = getStateData<CreateData>(ctx);
    await finalizeTournamentCreate(ctx, data);
  });
}
