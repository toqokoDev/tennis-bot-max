import { TXT, fmt } from '../texts.js';
import { Keyboard } from '@maxhub/max-bot-api';
import type { AppContext } from '../context.js';
import { getMessageText } from '../context.js';
import { env, getDeepLink } from '../config/env.js';
import {
  COUNTRIES,
  DATING_GOALS,
  DATING_INTERESTS,
  GAME_TYPES,
  MOSCOW_DISTRICTS,
  PAYMENT_TYPES,
  SPORTS,
  getSportCategory,
} from '../config/profile.js';
import { storage } from '../storage/jsonStorage.js';
import { clearState, getState, getStateData, setState } from '../middleware/session.js';
import { GameOfferStates } from '../types/states.js';
import type { GameOffer, SportType, UserProfile } from '../types/models.js';
import { backButton, chunkButtons, showCurrentMessage } from '../utils/bot.js';
import {
  buildOfferDateButtons,
  buildOfferTimeButtons,
  getFirstGameStep,
  getGameCommentPrompt,
  getNextGameStep,
  getStepAfterSport,
  stepToState,
  type GameStep,
} from '../utils/game.js';
import { canCreateFreeOffer, hasProSubscription, isValidShortDate, isValidTime, parseOfferDateTime } from '../utils/validation.js';
import { sendGameOfferToChannel } from '../services/channels.js';
import { getCallbackPayload } from '../utils/callback.js';
import { requireRegistered } from './registration.js';

type OfferData = Partial<GameOffer> & {
  step?: GameStep;
  sport?: SportType;
  dating_interests?: string[];
  myOffers?: GameOffer[];
  myOfferIndex?: number;
};

function formatOfferDetails(offer: GameOffer): string {
  const lines = [
    `🗂 ${offer.sport}`,
    `🌍 ${offer.country}, ${offer.city}${offer.district ? ` — ${offer.district}` : ''}`,
  ];
  const cat = getSportCategory(offer.sport);
  if (cat !== 'meeting' || offer.date) {
    lines.push(`📅 ${offer.date}`, `⏰ ${offer.time}`);
  }
  if (cat === 'court_sport') {
    if (offer.game_type) lines.push(`🔍 ${offer.game_type}`);
    if (offer.payment_type) lines.push(`💳 ${offer.payment_type}`);
    if (offer.competitive !== undefined) {
      lines.push(`🏆 На счёт: ${offer.competitive ? 'Да' : 'Нет'}`);
    }
  }
  if (cat === 'dating') {
    if (offer.dating_goal) lines.push(`💕 ${offer.dating_goal}`);
    if (offer.dating_interests?.length) lines.push(`🎯 ${offer.dating_interests.join(', ')}`);
    if (offer.dating_additional) lines.push(`📝 ${offer.dating_additional}`);
  }
  if (offer.comment) lines.push(`💬 ${offer.comment}`);
  return lines.join('\n');
}

function formatPublishedOffer(offer: GameOffer, id: number): string {
  const cat = getSportCategory(offer.sport);
  const lines = [
    TXT.game_offers.published,
    '',
    fmt(TXT.game_offers.published_header, { id }),
    fmt(TXT.game_offers.view_sport, { sport: offer.sport }),
    '',
    fmt(TXT.game_offers.view_country, { country: offer.country }),
    offer.district
      ? fmt(TXT.game_offers.view_city_district, { city: offer.city, district: offer.district })
      : fmt(TXT.game_offers.view_city, { city: offer.city }),
  ];

  if (offer.date) lines.push(fmt(TXT.game_offers.view_date, { date: offer.date }));
  if (offer.time) lines.push(fmt(TXT.game_offers.view_time, { time: offer.time }));

  if (cat === 'court_sport') {
    if (offer.game_type) lines.push(fmt(TXT.game_offers.view_game_type, { game_type: offer.game_type }));
    if (offer.payment_type) lines.push(fmt(TXT.game_offers.view_payment, { payment: offer.payment_type }));
    if (offer.competitive !== undefined) {
      lines.push(fmt(TXT.game_offers.view_competitive, { value: offer.competitive ? 'Да' : 'Нет' }));
    }
  }
  if (cat === 'dating') {
    if (offer.dating_goal) lines.push(fmt(TXT.game_offers.view_dating_goal, { value: offer.dating_goal }));
    if (offer.dating_interests?.length) {
      lines.push(fmt(TXT.game_offers.view_dating_interests, { value: offer.dating_interests.join(', ') }));
    }
    if (offer.dating_additional) {
      lines.push(fmt(TXT.game_offers.view_dating_additional, { value: offer.dating_additional }));
    }
  }
  if (offer.comment) lines.push(fmt(TXT.game_offers.view_comment, { comment: offer.comment }));

  return lines.join('\n');
}

function formatPublishedOfferFooter(user: UserProfile, offer: GameOffer): string {
  if (hasProSubscription(user)) {
    return TXT.game_offers.subscription_active_offer;
  }
  const unlimitedFemale = user.gender === 'Женский'
    && (offer.sport === '🍒Знакомства' || offer.sport === '🍻По пиву');
  if (unlimitedFemale) {
    return TXT.game_offers.unlimited_female;
  }
  const remaining = Math.max(0, 1 - user.free_offers_used);
  return [
    '',
    fmt(TXT.game_offers.remaining_offers, { remaining }),
    TXT.game_offers.subscribe_unlimited,
  ].join('\n');
}

function datingInterestsKeyboard(selected: string[] = []) {
  const rows = DATING_INTERESTS.map((item) => {
    const mark = selected.includes(item.ru) ? '✅ ' : '';
    return [Keyboard.button.callback(`${mark}${item.ru}`, `gamedatinginterest_${encodeURIComponent(item.ru)}`)];
  });
  rows.push([Keyboard.button.callback(TXT.game_offers.dating_interests_done, 'gamedatinginterests_done')]);
  return Keyboard.inlineKeyboard(rows);
}

function formatOfferPaywall(user: UserProfile): string {
  const link = getDeepLink(`ref_${user.max_user_id}`);
  return [
    TXT.game_offers.paywall_title,
    '',
    TXT.game_offers.paywall_limit,
    '',
    TXT.game_offers.paywall_subscription_info,
    '',
    fmt(TXT.game_offers.paywall_price, { price: env.SUBSCRIPTION_PRICE }),
    fmt(TXT.game_offers.paywall_go_payments, { payments_section: TXT.menu.payments }),
    '',
    TXT.game_offers.paywall_invite_friends,
    '',
    `${TXT.game_offers.paywall_invite_link} ${link}`,
    '',
    fmt(TXT.game_offers.paywall_invite_stats, { invite_section: TXT.menu.invite }),
  ].join('\n');
}

function offerPaywallKeyboard(): ReturnType<typeof Keyboard.inlineKeyboard> {
  return Keyboard.inlineKeyboard([
    [Keyboard.button.callback(TXT.menu.payments, 'menu:payments')],
    [Keyboard.button.callback(TXT.menu.invite, 'menu:invite')],
    [Keyboard.button.callback(TXT.common.main_menu, 'main_menu')],
  ]);
}

export async function startNewOffer(ctx: AppContext, sport?: SportType): Promise<void> {
  const user = await requireRegistered(ctx);
  if (!user) return;

  if (!canCreateFreeOffer(user)) {
    const mode = ctx.callback ? 'edit' : 'new';
    await showCurrentMessage(ctx, formatOfferPaywall(user), {
      attachments: [offerPaywallKeyboard()],
    }, mode);
    return;
  }

  const data: OfferData = {
    sport: sport ?? user.sport,
    country: user.country,
    city: user.city,
  };

  if (sport) {
    data.step = getStepAfterSport(sport);
    await setState(ctx, stepToState(data.step), data);
    await promptStep(ctx, data);
    return;
  }

  const step = getFirstGameStep(data.sport!);
  data.step = step;
  await setState(ctx, stepToState(step), data);
  await promptStep(ctx, data);
}

async function promptStep(ctx: AppContext, data: OfferData, mode: 'new' | 'edit' = 'edit'): Promise<void> {
  const step = data.step!;
  switch (step) {
    case 'sport':
      await showCurrentMessage(ctx, TXT.game_offers.choose_sport, {
        attachments: [Keyboard.inlineKeyboard(
          chunkButtons(SPORTS, (s) => Keyboard.button.callback(s, `gamesport_${encodeURIComponent(s)}`), 2),
        )],
      }, mode);
      break;
    case 'country': {
      const countries = [...Object.keys(COUNTRIES), TXT.registration.other_country];
      await showCurrentMessage(ctx, fmt(TXT.game_offers.choose_country, { sport: data.sport! }), {
        attachments: [Keyboard.inlineKeyboard(
          chunkButtons(countries, (c) => Keyboard.button.callback(c, `gamecountry_${encodeURIComponent(c)}`), 2),
        )],
      }, mode);
      break;
    }
    case 'city': {
      const country = data.country ?? (await requireRegistered(ctx))?.country ?? '🇷🇺 Россия';
      data.country = country;
      const cities = [...(COUNTRIES[country] ?? []), TXT.registration.other_city];
      await showCurrentMessage(ctx, fmt(TXT.game_offers.choose_city, { country }), {
        attachments: [Keyboard.inlineKeyboard(
          chunkButtons(cities, (c) => Keyboard.button.callback(c, `gamecity_${encodeURIComponent(c)}`), 2),
        )],
      }, mode);
      break;
    }
    case 'district':
      await showCurrentMessage(ctx, TXT.registration.district, {
        attachments: [Keyboard.inlineKeyboard(
          chunkButtons(MOSCOW_DISTRICTS, (d) => Keyboard.button.callback(d, `gamedistrict_${d}`), 3),
        )],
      }, mode);
      break;
    case 'date': {
      const dates = buildOfferDateButtons();
      const rows = chunkButtons(dates, (d) => Keyboard.button.callback(d.label, `gamedate_${d.value}`), 3);
      rows.push([Keyboard.button.callback(TXT.game_offers.choose_date_manual, 'gamedate_manual')]);
      await showCurrentMessage(ctx, TXT.game_offers.choose_date, {
        attachments: [Keyboard.inlineKeyboard(rows)],
      }, mode);
      break;
    }
    case 'time': {
      const times = buildOfferTimeButtons();
      await showCurrentMessage(ctx, TXT.game_offers.choose_time, {
        attachments: [Keyboard.inlineKeyboard(
          chunkButtons(times, (t) => Keyboard.button.callback(`⏰ ${t}`, `gametime_${t}`), 3),
        )],
      }, mode);
      break;
    }
    case 'game_type':
      await showCurrentMessage(ctx, TXT.game_offers.choose_type, {
        attachments: [Keyboard.inlineKeyboard(
          chunkButtons(GAME_TYPES, (gt) => Keyboard.button.callback(gt, `gametype_${encodeURIComponent(gt)}`), 2),
        )],
      }, mode);
      break;
    case 'payment_type':
      await showCurrentMessage(ctx, TXT.game_offers.choose_payment, {
        attachments: [Keyboard.inlineKeyboard(
          chunkButtons(PAYMENT_TYPES, (p) => Keyboard.button.callback(p, `paytype_${encodeURIComponent(p)}`), 1),
        )],
      }, mode);
      break;
    case 'competitive':
      await showCurrentMessage(ctx, TXT.game_offers.competitive, {
        attachments: [Keyboard.inlineKeyboard([
          [Keyboard.button.callback(TXT.common.yes, 'gamecomp_yes'), Keyboard.button.callback(TXT.common.no, 'gamecomp_no')],
        ])],
      }, mode);
      break;
    case 'dating_goal':
      await showCurrentMessage(ctx, TXT.game_offers.dating_goal, {
        attachments: [Keyboard.inlineKeyboard(
          chunkButtons(DATING_GOALS, (g) => Keyboard.button.callback(g.ru, `gamedatinggoal_${encodeURIComponent(g.ru)}`), 1),
        )],
      }, mode);
      break;
    case 'dating_interests':
      await showCurrentMessage(ctx, TXT.game_offers.dating_interests, {
        attachments: [datingInterestsKeyboard(data.dating_interests)],
      }, mode);
      break;
    case 'dating_additional':
      await showCurrentMessage(ctx, TXT.game_offers.dating_additional, {}, mode === 'edit' ? 'edit' : 'new');
      break;
    case 'comment':
      await showCurrentMessage(ctx, getGameCommentPrompt(data.sport!), {}, mode);
      break;
    default:
      break;
  }
}

async function advance(ctx: AppContext, data: OfferData, mode: 'new' | 'edit' = 'edit'): Promise<void> {
  const next = getNextGameStep(data.sport!, data.step!, { city: data.city });
  if (!next || next === 'publish') {
    await publishOffer(ctx, data);
    return;
  }
  data.step = next;
  await setState(ctx, stepToState(next), data);
  await promptStep(ctx, data, mode);
}

async function publishOffer(ctx: AppContext, data: OfferData): Promise<void> {
  const user = await requireRegistered(ctx);
  if (!user) return;
  const id = await storage.nextOfferId();
  const offer: GameOffer = {
    id,
    sport: data.sport!,
    country: data.country ?? user.country,
    city: data.city ?? user.city,
    district: data.district,
    date: data.date!,
    time: data.time!,
    game_type: data.game_type,
    payment_type: data.payment_type,
    competitive: data.competitive,
    comment: data.comment,
    active: true,
    dating_goal: data.dating_goal,
    dating_interests: data.dating_interests,
    dating_additional: data.dating_additional,
    created_at: new Date().toISOString(),
  };
  user.games.push(offer);
  if (!hasProSubscription(user)) {
    const unlimitedFemale = user.gender === 'Женский'
      && (offer.sport === '🍒Знакомства' || offer.sport === '🍻По пиву');
    if (!unlimitedFemale) {
      user.free_offers_used += 1;
    }
  }
  await storage.saveUser(user);
  await sendGameOfferToChannel(ctx.api, user, offer);
  await clearState(ctx);

  let text = formatPublishedOffer(offer, id);
  text += formatPublishedOfferFooter(user, offer);
  await ctx.reply(text, { attachments: [backButton()] });
}

async function showMyOffer(ctx: AppContext, data: OfferData): Promise<void> {
  const offers = data.myOffers ?? [];
  const index = data.myOfferIndex ?? 0;
  if (!offers.length) {
    await showCurrentMessage(ctx, TXT.game_offers.my_offers_empty, {
      attachments: [Keyboard.inlineKeyboard([
        [Keyboard.button.callback(TXT.profile.new_offer, 'new_offer')],
        [Keyboard.button.callback(TXT.common.main_menu, 'main_menu')],
      ])],
    }, 'edit');
    return;
  }
  const offer = offers[index];
  const text = [
    fmt(TXT.game_offers.my_offers_title, { id: offer.id, index: index + 1, total: offers.length }),
    '',
    formatOfferDetails(offer),
  ].join('\n');

  const buttons: ReturnType<typeof Keyboard.button.callback>[][] = [];
  if (offers.length > 1) {
    const nav: ReturnType<typeof Keyboard.button.callback>[] = [];
    if (index > 0) nav.push(Keyboard.button.callback(TXT.common.prev, 'offer_prev'));
    if (index < offers.length - 1) nav.push(Keyboard.button.callback(TXT.common.next, 'offer_next'));
    if (nav.length) buttons.push(nav);
  }
  buttons.push([
    Keyboard.button.callback('❌ Удалить', `delete_offer_${offer.id}`),
    Keyboard.button.callback(TXT.common.main_menu, 'main_menu'),
  ]);

  await showCurrentMessage(ctx, text, {
    attachments: [Keyboard.inlineKeyboard(buttons)],
  }, 'edit');
}

export async function handleGameOfferMessage(ctx: AppContext): Promise<boolean> {
  const state = getState(ctx);
  if (!state || !Object.values(GameOfferStates).includes(state as GameOfferStates)) return false;
  const text = getMessageText(ctx);
  const data = getStateData<OfferData>(ctx);

  if (state === GameOfferStates.GAME_COUNTRY_INPUT && text) {
    data.country = text;
    data.step = 'country';
    await advance(ctx, data, 'new');
    return true;
  }
  if (state === GameOfferStates.GAME_CITY_INPUT && text) {
    data.city = text;
    data.step = 'city';
    await advance(ctx, data, 'new');
    return true;
  }
  if (state === GameOfferStates.GAME_DATE_MANUAL && text) {
    if (!isValidShortDate(text)) {
      await ctx.reply(TXT.game_offers.invalid_date);
      return true;
    }
    const parsed = parseOfferDateTime(text, '12:00');
    if (parsed && parsed < new Date(new Date().setHours(0, 0, 0, 0))) {
      await ctx.reply(TXT.game_offers.invalid_date_past);
      return true;
    }
    data.date = text;
    data.step = 'date';
    await advance(ctx, data, 'new');
    return true;
  }
  if (state === GameOfferStates.GAME_TIME && text) {
    if (!isValidTime(text)) {
      await ctx.reply(TXT.game_offers.invalid_time);
      return true;
    }
    data.time = text;
    data.step = 'time';
    await advance(ctx, data, 'new');
    return true;
  }
  if (state === GameOfferStates.DATING_ADDITIONAL && text) {
    data.dating_additional = text;
    data.step = 'dating_additional';
    await advance(ctx, data, 'new');
    return true;
  }
  if (state === GameOfferStates.GAME_COMMENT) {
    if (text && text !== '/skip') data.comment = text;
    await publishOffer(ctx, data);
    return true;
  }
  return false;
}

export function registerGameOfferHandlers(bot: import('@maxhub/max-bot-api').Bot<AppContext>): void {
  bot.action('new_offer', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    await startNewOffer(ctx);
  });

  bot.action(/^new_offer_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const sport = decodeURIComponent(getCallbackPayload(ctx).replace('new_offer_', '')) as SportType;
    await startNewOffer(ctx, sport);
  });

  bot.action(/^gamesport_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<OfferData>(ctx);
    data.sport = decodeURIComponent(getCallbackPayload(ctx).replace('gamesport_', '')) as SportType;
    data.step = 'sport';
    await advance(ctx, data);
  });

  bot.action(/^gamecountry_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const raw = decodeURIComponent(getCallbackPayload(ctx).replace('gamecountry_', ''));
    const data = getStateData<OfferData>(ctx);
    if (raw === TXT.registration.other_country) {
      data.step = 'country';
      await setState(ctx, GameOfferStates.GAME_COUNTRY_INPUT, data);
      await showCurrentMessage(ctx, TXT.registration.enter_country, {}, 'new');
      return;
    }
    data.country = raw;
    data.step = 'country';
    await advance(ctx, data);
  });

  bot.action(/^gamecity_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const raw = decodeURIComponent(getCallbackPayload(ctx).replace('gamecity_', ''));
    const data = getStateData<OfferData>(ctx);
    if (raw === TXT.registration.other_city) {
      data.step = 'city';
      await setState(ctx, GameOfferStates.GAME_CITY_INPUT, data);
      await showCurrentMessage(ctx, TXT.registration.enter_city, {}, 'new');
      return;
    }
    data.city = raw;
    data.step = 'city';
    await advance(ctx, data);
  });

  bot.action(/^gamedistrict_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<OfferData>(ctx);
    data.district = getCallbackPayload(ctx).replace('gamedistrict_', '');
    data.step = 'district';
    await advance(ctx, data);
  });

  bot.action('gamedate_manual', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<OfferData>(ctx);
    await setState(ctx, GameOfferStates.GAME_DATE_MANUAL, data);
    await showCurrentMessage(ctx, TXT.game_offers.enter_date, {}, 'new');
  });

  bot.action(/^gamedate_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const payload = getCallbackPayload(ctx);
    if (payload === 'gamedate_manual') return;
    const data = getStateData<OfferData>(ctx);
    data.date = payload.replace('gamedate_', '');
    data.step = 'date';
    await advance(ctx, data);
  });

  bot.action(/^gametime_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const time = getCallbackPayload(ctx).replace('gametime_', '');
    if (!isValidTime(time)) {
      await ctx.answerOnCallback({ notification: TXT.game_offers.invalid_time });
      return;
    }
    const data = getStateData<OfferData>(ctx);
    data.time = time;
    data.step = 'time';
    await advance(ctx, data);
  });

  bot.action(/^gametype_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<OfferData>(ctx);
    data.game_type = decodeURIComponent(getCallbackPayload(ctx).replace('gametype_', ''));
    data.step = 'game_type';
    await advance(ctx, data);
  });

  bot.action(/^paytype_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<OfferData>(ctx);
    data.payment_type = decodeURIComponent(getCallbackPayload(ctx).replace('paytype_', ''));
    data.step = 'payment_type';
    await advance(ctx, data);
  });

  bot.action('gamecomp_yes', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<OfferData>(ctx);
    data.competitive = true;
    data.step = 'competitive';
    await advance(ctx, data, 'edit');
  });

  bot.action('gamecomp_no', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<OfferData>(ctx);
    data.competitive = false;
    data.step = 'competitive';
    await advance(ctx, data, 'edit');
  });

  bot.action(/^gamedatinggoal_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<OfferData>(ctx);
    data.dating_goal = decodeURIComponent(getCallbackPayload(ctx).replace('gamedatinggoal_', ''));
    data.dating_interests = [];
    data.step = 'dating_goal';
    await advance(ctx, data);
  });

  bot.action(/^gamedatinginterest_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const interest = decodeURIComponent(getCallbackPayload(ctx).replace('gamedatinginterest_', ''));
    const data = getStateData<OfferData>(ctx);
    const list = data.dating_interests ?? [];
    if (list.includes(interest)) {
      data.dating_interests = list.filter((i) => i !== interest);
    } else {
      data.dating_interests = [...list, interest];
    }
    data.step = 'dating_interests';
    await setState(ctx, GameOfferStates.DATING_INTERESTS, data);
    await promptStep(ctx, data);
  });

  bot.action('gamedatinginterests_done', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<OfferData>(ctx);
    data.step = 'dating_interests';
    await advance(ctx, data);
  });

  bot.action('my_offers', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const user = await requireRegistered(ctx);
    if (!user) return;
    const active = user.games.filter((g) => g.active);
    if (!active.length) {
      await showCurrentMessage(ctx, TXT.game_offers.my_offers_empty, {
        attachments: [Keyboard.inlineKeyboard([
          [Keyboard.button.callback(TXT.profile.new_offer, 'new_offer')],
          [Keyboard.button.callback(TXT.common.main_menu, 'main_menu')],
        ])],
      }, 'edit');
      return;
    }
    const data = getStateData<OfferData>(ctx);
    data.myOffers = active;
    data.myOfferIndex = 0;
    await showMyOffer(ctx, data);
  });

  bot.action('offer_prev', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<OfferData>(ctx);
    if ((data.myOfferIndex ?? 0) > 0) {
      data.myOfferIndex = (data.myOfferIndex ?? 0) - 1;
      await showMyOffer(ctx, data);
    }
  });

  bot.action('offer_next', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<OfferData>(ctx);
    const offers = data.myOffers ?? [];
    if ((data.myOfferIndex ?? 0) < offers.length - 1) {
      data.myOfferIndex = (data.myOfferIndex ?? 0) + 1;
      await showMyOffer(ctx, data);
    }
  });

  bot.action(/^delete_offer_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const id = Number(getCallbackPayload(ctx).replace('delete_offer_', ''));
    await showCurrentMessage(ctx, fmt(TXT.game_offers.delete_confirm, { id }), {
      attachments: [Keyboard.inlineKeyboard([
        [Keyboard.button.callback(TXT.common.yes, `delete_yes_${id}`), Keyboard.button.callback(TXT.common.no, 'delete_no_single')],
      ])],
    }, 'edit');
  });

  bot.action('delete_no_single', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<OfferData>(ctx);
    await showMyOffer(ctx, data);
  });

  bot.action(/^delete_yes_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const id = Number(getCallbackPayload(ctx).replace('delete_yes_', ''));
    const user = await requireRegistered(ctx);
    if (!user) return;
    user.games = user.games.map((g) => (g.id === id ? { ...g, active: false } : g));
    await storage.saveUser(user);

    const data = getStateData<OfferData>(ctx);
    const active = user.games.filter((g) => g.active);
    if (!active.length) {
      await clearState(ctx);
      await showCurrentMessage(ctx, TXT.game_offers.offer_deleted, { attachments: [backButton()] }, 'edit');
      return;
    }
    let index = data.myOfferIndex ?? 0;
    if (index >= active.length) index = active.length - 1;
    data.myOffers = active;
    data.myOfferIndex = index;
    await showMyOffer(ctx, data);
  });
}
