import { TXT, fmt } from '../texts.js';
import { Keyboard } from '@maxhub/max-bot-api';
import type { AppContext } from '../context.js';
import { getCtxUserId, getMessageText } from '../context.js';
import { SPORTS, getSportCategory } from '../config/profile.js';
import { storage } from '../storage/jsonStorage.js';
import { clearState, getState, getStateData, setState } from '../middleware/session.js';
import { BrowseOffersStates } from '../types/states.js';
import type { GameOffer, SportType, UserProfile } from '../types/models.js';
import { backButton, chunkButtons, paginate, showCurrentMessage } from '../utils/bot.js';
import { notifyUser } from '../services/channels.js';
import { getCallbackPayload } from '../utils/callback.js';
import { requireRegistered } from './registration.js';
import { parseOfferDateTime } from '../utils/validation.js';

const ITEMS_PER_PAGE = 5;

type BrowseData = {
  sport?: SportType;
  country?: string;
  city?: string;
  page?: number;
  respondOffer?: { userId: number; gameId: number };
};

type ListedOffer = { user: UserProfile; offer: GameOffer };

function shortName(user: UserProfile): string {
  if (user.last_name) return `${user.first_name[0]}. ${user.last_name}`;
  return user.first_name;
}

function offerSortKey(offer: GameOffer): number {
  const dt = parseOfferDateTime(offer.date, offer.time);
  return dt ? dt.getTime() : 0;
}

function collectOffers(
  all: Record<string, UserProfile>,
  data: BrowseData,
  excludeUserId?: number,
): ListedOffer[] {
  const list: ListedOffer[] = [];
  for (const user of Object.values(all)) {
    if (excludeUserId && user.max_user_id === excludeUserId) continue;
    for (const offer of user.games ?? []) {
      if (!offer.active) continue;
      if (data.sport && offer.sport !== data.sport) continue;
      if (data.country && offer.country !== data.country) continue;
      if (data.city && offer.city !== data.city) continue;
      list.push({ user, offer });
    }
  }
  return list.sort((a, b) => offerSortKey(a.offer) - offerSortKey(b.offer));
}

function countByField(offers: ListedOffer[], field: 'country' | 'city'): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const { offer } of offers) {
    const value = offer[field];
    if (!value) continue;
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function sortCountries(counts: Record<string, number>): string[] {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const russia = entries.find(([c]) => c.includes('🇷🇺'));
  const rest = entries.filter(([c]) => !c.includes('🇷🇺'));
  return russia ? [russia[0], ...rest.map(([c]) => c)] : rest.map(([c]) => c);
}

function formatOfferListLabel(user: UserProfile, offer: GameOffer): string {
  const gender = user.gender === 'Мужской' ? '👨' : '👩';
  const level = user.player_level ? ` (${user.rating_points} lvl)` : '';
  const day = offer.date?.slice(0, 2) ?? '—';
  const district = offer.district ? ` ${offer.district}` : '';
  return `${day}е ${offer.time}${district} ${gender} ${shortName(user)}${level}`;
}

function formatOfferDetail(user: UserProfile, offer: GameOffer, viewerId: number): string {
  const cat = getSportCategory(offer.sport);
  const lines = [
    `<b>${offer.sport}</b>`,
    `👤 ${user.first_name} ${user.last_name}${user.username ? ` @${user.username}` : ''}`,
  ];

  if (cat === 'court_sport') {
    lines.push(
      `🏅 Рейтинг ${user.rating_points} (Лвл: ${user.player_level ?? '—'})`,
      `📊 Сыграно матчей: ${user.games_played}`,
      '',
    );
  }

  lines.push(
    `🌍 ${offer.country}, ${offer.city}${offer.district ? ` ${offer.district}` : ''}`,
    `📅 ${offer.date}`,
    `⏰ ${offer.time}`,
  );

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

  if (viewerId === user.max_user_id) {
    lines.push('', `<i>Ваше предложение #${offer.id}</i>`);
  }

  return lines.join('\n');
}

function emptyBrowseKeyboard(sport: SportType, backPayload: string): ReturnType<typeof Keyboard.inlineKeyboard> {
  return Keyboard.inlineKeyboard([
    [Keyboard.button.callback(TXT.game_offers.browse_offer_game, `new_offer_${encodeURIComponent(sport)}`)],
    [Keyboard.button.callback(TXT.profile.my_offers, 'my_offers')],
    [Keyboard.button.callback(TXT.game_offers.browse_back_sport, backPayload)],
    [Keyboard.button.callback(TXT.common.main_menu, 'main_menu')],
  ]);
}

function emptyCityKeyboard(sport: SportType): ReturnType<typeof Keyboard.inlineKeyboard> {
  return Keyboard.inlineKeyboard([
    [Keyboard.button.callback(TXT.game_offers.browse_offer_game, `new_offer_${encodeURIComponent(sport)}`)],
    [Keyboard.button.callback(TXT.profile.my_offers, 'my_offers')],
    [Keyboard.button.callback(TXT.game_offers.browse_back_city, 'browse_back_city')],
    [Keyboard.button.callback(TXT.common.main_menu, 'main_menu')],
  ]);
}

export async function startBrowseOffers(ctx: AppContext): Promise<void> {
  const user = await requireRegistered(ctx);
  if (!user) return;
  await setState(ctx, BrowseOffersStates.SELECT_SPORT, { page: 1 });
  const sportRows = chunkButtons(SPORTS, (s) => Keyboard.button.callback(s, `offersport_${encodeURIComponent(s)}`), 2);
  sportRows.push([Keyboard.button.callback(TXT.common.main_menu, 'main_menu')]);
  const mode = ctx.callback ? 'edit' : 'new';
  await showCurrentMessage(ctx, TXT.game_offers.browse_sport, {
    attachments: [Keyboard.inlineKeyboard(sportRows)],
  }, mode);
}

async function showCountrySelection(ctx: AppContext, data: BrowseData): Promise<void> {
  const viewerId = getCtxUserId(ctx);
  const all = await storage.getUsers();
  const offers = collectOffers(all, { sport: data.sport }, viewerId);
  const counts = countByField(offers, 'country');

  if (!Object.keys(counts).length) {
    await showCurrentMessage(ctx, [
      fmt(TXT.game_offers.browse_no_offers, { sport: data.sport! }),
      TXT.game_offers.browse_no_offers_hint,
    ].join('\n\n'), {
      attachments: [emptyBrowseKeyboard(data.sport!, 'browse_back_sport')],
    });
    return;
  }

  const countries = sortCountries(counts);
  const rows = countries.map((c) => [
    Keyboard.button.callback(
      fmt(TXT.game_offers.browse_country_item, { country: c, count: counts[c] }),
      `offercountry_${encodeURIComponent(c)}`,
    ),
  ]);
  rows.push([Keyboard.button.callback(TXT.game_offers.browse_offer_game, `new_offer_${encodeURIComponent(data.sport!)}`)]);
  rows.push([Keyboard.button.callback(TXT.game_offers.browse_back_sport, 'browse_back_sport')]);

  await showCurrentMessage(ctx, fmt(TXT.game_offers.browse_country, { sport: data.sport! }), {
    attachments: [Keyboard.inlineKeyboard(rows)],
  });
}

async function showCitySelection(ctx: AppContext, data: BrowseData): Promise<void> {
  const viewerId = getCtxUserId(ctx);
  const all = await storage.getUsers();
  const offers = collectOffers(all, { sport: data.sport, country: data.country }, viewerId);
  const counts = countByField(offers, 'city');

  if (!Object.keys(counts).length) {
    await showCurrentMessage(ctx, [
      fmt(TXT.game_offers.browse_no_offers_country, { country: data.country!, sport: data.sport! }),
      TXT.game_offers.browse_no_offers_hint,
    ].join('\n\n'), {
      attachments: [Keyboard.inlineKeyboard([
        [Keyboard.button.callback(TXT.game_offers.browse_offer_game, `new_offer_${encodeURIComponent(data.sport!)}`)],
        [Keyboard.button.callback(TXT.profile.my_offers, 'my_offers')],
        [Keyboard.button.callback(TXT.game_offers.browse_back_country, 'browse_back_country')],
        [Keyboard.button.callback(TXT.common.main_menu, 'main_menu')],
      ])],
    });
    return;
  }

  const cities = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([city]) => city);

  const rows = cities.map((c) => [
    Keyboard.button.callback(
      fmt(TXT.game_offers.browse_city_item, { city: c, count: counts[c] }),
      `offercity_${encodeURIComponent(c)}`,
    ),
  ]);
  rows.push([Keyboard.button.callback(TXT.game_offers.browse_offer_game, `new_offer_${encodeURIComponent(data.sport!)}`)]);
  rows.push([Keyboard.button.callback(TXT.game_offers.browse_back_country, 'browse_back_country')]);

  await showCurrentMessage(ctx, fmt(TXT.game_offers.browse_city, { sport: data.sport!, country: data.country! }), {
    attachments: [Keyboard.inlineKeyboard(rows)],
  });
}

async function showOfferList(ctx: AppContext): Promise<void> {
  const data = getStateData<BrowseData>(ctx);
  const viewerId = getCtxUserId(ctx);
  const all = await storage.getUsers();
  const offers = collectOffers(all, data, viewerId);
  const { items, page, totalPages } = paginate(offers, data.page ?? 1, ITEMS_PER_PAGE);

  if (!items.length) {
    await showCurrentMessage(ctx, [
      fmt(TXT.game_offers.browse_no_offers_city, { city: data.city! }),
      TXT.game_offers.browse_no_offers_hint,
    ].join('\n\n'), {
      attachments: [emptyCityKeyboard(data.sport!)],
    });
    return;
  }

  const buttons = items.map(({ user, offer }) => [
    Keyboard.button.callback(
      formatOfferListLabel(user, offer),
      `viewoffer_${user.max_user_id}_${offer.id}`,
    ),
  ]);
  const nav: ReturnType<typeof Keyboard.button.callback>[] = [];
  if (page > 1) nav.push(Keyboard.button.callback(TXT.common.prev, `offerpage_${page - 1}`));
  if (page < totalPages) nav.push(Keyboard.button.callback(TXT.common.next, `offerpage_${page + 1}`));
  if (nav.length) buttons.push(nav);
  buttons.push([Keyboard.button.callback(TXT.game_offers.browse_offer_game, `new_offer_${encodeURIComponent(data.sport!)}`)]);
  buttons.push([Keyboard.button.callback(TXT.game_offers.browse_back_city, 'browse_back_city')]);

  await showCurrentMessage(ctx, fmt(TXT.game_offers.browse_list, {
    sport: data.sport!,
    city: data.city!,
    page,
    total: totalPages,
  }), {
    attachments: [Keyboard.inlineKeyboard(buttons)],
  });
}

export function registerBrowseOffersHandlers(bot: import('@maxhub/max-bot-api').Bot<AppContext>): void {
  bot.action(/^offersport_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<BrowseData>(ctx);
    data.sport = decodeURIComponent(getCallbackPayload(ctx).replace('offersport_', '')) as SportType;
    data.page = 1;
    await setState(ctx, BrowseOffersStates.SELECT_COUNTRY, data);
    await showCountrySelection(ctx, data);
  });

  bot.action(/^offercountry_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<BrowseData>(ctx);
    data.country = decodeURIComponent(getCallbackPayload(ctx).replace('offercountry_', ''));
    data.page = 1;
    await setState(ctx, BrowseOffersStates.SELECT_CITY, data);
    await showCitySelection(ctx, data);
  });

  bot.action(/^offercity_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<BrowseData>(ctx);
    data.city = decodeURIComponent(getCallbackPayload(ctx).replace('offercity_', ''));
    data.page = 1;
    await setState(ctx, BrowseOffersStates.LIST, data);
    await showOfferList(ctx);
  });

  bot.action(/^offerpage_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<BrowseData>(ctx);
    data.page = Number(getCallbackPayload(ctx).replace('offerpage_', ''));
    await setState(ctx, BrowseOffersStates.LIST, data);
    await showOfferList(ctx);
  });

  bot.action(/^viewoffer_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const parts = getCallbackPayload(ctx).replace('viewoffer_', '').split('_');
    const gameId = Number(parts.pop());
    const userId = Number(parts.join('_'));
    const viewerId = getCtxUserId(ctx);
    const author = await storage.getUser(userId);
    const offer = author?.games.find((g) => g.id === gameId && g.active);
    if (!author || !offer) {
      await ctx.answerOnCallback({ notification: 'Предложение не найдено' });
      return;
    }

    const text = formatOfferDetail(author, offer, viewerId);
    const buttons: ReturnType<typeof Keyboard.button.callback>[][] = [];
    if (viewerId !== userId) {
      buttons.push([Keyboard.button.callback(TXT.game_offers.respond, `respond_offer_${userId}_${gameId}`)]);
    }
    buttons.push([Keyboard.button.callback(TXT.game_offers.browse_back_list, 'browse_back_list')]);

    await showCurrentMessage(ctx, text, {
      format: 'html',
      attachments: [Keyboard.inlineKeyboard(buttons)],
    });
  });

  bot.action(/^respond_offer_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const parts = getCallbackPayload(ctx).replace('respond_offer_', '').split('_');
    const gameId = Number(parts.pop());
    const userId = Number(parts.join('_'));
    const data = getStateData<BrowseData>(ctx);
    data.respondOffer = { userId, gameId };
    await setState(ctx, BrowseOffersStates.RESPOND, data);
    await showCurrentMessage(ctx, TXT.game_offers.respond_comment, {}, 'edit');
  });

  bot.action('browse_back_sport', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    await startBrowseOffers(ctx);
  });

  bot.action('browse_back_country', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<BrowseData>(ctx);
    await setState(ctx, BrowseOffersStates.SELECT_COUNTRY, data);
    await showCountrySelection(ctx, data);
  });

  bot.action('browse_back_city', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<BrowseData>(ctx);
    await setState(ctx, BrowseOffersStates.SELECT_CITY, data);
    await showCitySelection(ctx, data);
  });

  bot.action('browse_back_list', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<BrowseData>(ctx);
    await setState(ctx, BrowseOffersStates.LIST, data);
    await showOfferList(ctx);
  });
}

export async function handleBrowseRespondMessage(ctx: AppContext): Promise<boolean> {
  const state = getState(ctx);
  if (state !== BrowseOffersStates.RESPOND) return false;

  const data = getStateData<BrowseData>(ctx);
  if (!data.respondOffer) return false;

  const text = getMessageText(ctx);
  if (!text) return false;

  const responder = await requireRegistered(ctx);
  if (!responder) return true;

  const comment = text === '/skip' ? TXT.game_offers.respond_no_comment : text;
  const { userId, gameId } = data.respondOffer;

  const author = await storage.getUser(userId);
  const offer = author?.games.find((g) => g.id === gameId);

  await notifyUser(
    ctx.api,
    userId,
    `📩 Отклик от ${responder.first_name} ${responder.last_name}\n`
    + `🎾 ${offer?.sport ?? '—'} · ${offer?.date ?? '—'} ${offer?.time ?? '—'}\n`
    + `💬 ${comment}`,
  );

  data.respondOffer = undefined;
  await clearState(ctx);
  await showCurrentMessage(ctx, TXT.game_offers.respond_sent, { attachments: [backButton()] }, 'edit');
  return true;
}
