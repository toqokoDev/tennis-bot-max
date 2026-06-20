import { TXT, fmt } from '../texts.js';
import { Keyboard } from '@maxhub/max-bot-api';
import type { AppContext } from '../context.js';
import { getCtxUserId } from '../context.js';
import {
  COUNTRIES,
  COACH_PRICE_RANGES,
  SPORTS,
  calculateAge,
} from '../config/profile.js';
import { storage } from '../storage/jsonStorage.js';
import { getStateData, setState } from '../middleware/session.js';
import { FindCoachStates } from '../types/states.js';
import type { SportType, UserProfile } from '../types/models.js';
import { chunkButtons, paginate, showCurrentMessage } from '../utils/bot.js';
import { getCallbackPayload } from '../utils/callback.js';
import {
  countCoachesByField,
  countCoachesByLocation,
  getTopLocations,
  matchesCoachBase,
  sumCounts,
} from '../utils/searchUsers.js';
import { requireRegistered } from './registration.js';

const PRIMARY_COUNTRIES = Object.keys(COUNTRIES).slice(0, 5);
const RESULTS_PER_PAGE = 5;

type CoachSearchData = {
  sport?: SportType;
  country?: string;
  city?: string;
  priceMin?: number;
  priceMax?: number;
  page?: number;
  searchResults?: UserProfile[];
};

async function loadSearchContext(selfId: number) {
  const [all, banned] = await Promise.all([storage.getUsers(), storage.getBanned()]);
  const bannedIds = new Set(
    Object.keys(banned).map(Number).filter((id) => !Number.isNaN(id)),
  );
  return { all, bannedIds, selfId };
}

function filterSuffix(data: CoachSearchData): { sport: string; price: string } {
  const sport = data.sport ? fmt(TXT.coach_search.sport_suffix, { sport: data.sport }) : '';
  const price = data.priceMin != null && data.priceMax != null
    ? fmt(TXT.coach_search.price_suffix, { price_min: data.priceMin, price_max: data.priceMax })
    : '';
  return { sport, price };
}

function locationOpts(data: CoachSearchData, selfId: number, bannedIds: Set<number>) {
  return {
    sport: data.sport,
    country: data.country,
    priceMin: data.priceMin,
    priceMax: data.priceMax,
    excludeUserId: selfId,
    bannedIds,
  };
}

function filterCoaches(
  all: Record<string, UserProfile>,
  data: CoachSearchData,
  selfId: number,
  bannedIds: Set<number>,
): UserProfile[] {
  const results: UserProfile[] = [];
  for (const profile of Object.values(all)) {
    if (matchesCoachBase(profile, {
      sport: data.sport,
      country: data.country,
      city: data.city,
      priceMin: data.priceMin,
      priceMax: data.priceMax,
      excludeUserId: selfId,
      bannedIds,
    })) {
      results.push(profile);
    }
  }
  return results;
}

function shortName(user: UserProfile): string {
  if (user.last_name) return `${user.first_name[0]}. ${user.last_name}`;
  return user.first_name;
}

function formatCoachLabel(user: UserProfile): string {
  const genderIcon = user.gender === 'Мужской' ? '👨' : user.gender === 'Женский' ? '👩' : '👤';
  const age = calculateAge(user.birth_date);
  const price = user.price ?? '—';
  return `${genderIcon} ${shortName(user)} ${age} лет ${price}${TXT.coach_search.rub_short}`;
}

async function showSportSelection(ctx: AppContext): Promise<void> {
  const rows: ReturnType<typeof Keyboard.button.callback>[][] = [
    [Keyboard.button.callback(TXT.search.all_sports, 'coach_sport_any')],
    ...chunkButtons(SPORTS, (s) => Keyboard.button.callback(s, `coach_sport_${encodeURIComponent(s)}`), 2),
    [Keyboard.button.callback(TXT.common.back, 'menu:more')],
  ];
  await showCurrentMessage(ctx, TXT.coach_search.choose_sport, {
    attachments: [Keyboard.inlineKeyboard(rows)],
  });
}

async function showPriceSelection(ctx: AppContext, data: CoachSearchData): Promise<void> {
  const rows: ReturnType<typeof Keyboard.button.callback>[][] = [
    [Keyboard.button.callback(TXT.coach_search.any_price, 'coach_price_any')],
    ...COACH_PRICE_RANGES.map((range) => [
      Keyboard.button.callback(range.label, `coach_price_${range.min}_${range.max}`),
    ]),
    [Keyboard.button.callback(TXT.coach_search.back_to_sport, 'coach_back_to_sport')],
  ];
  await setState(ctx, FindCoachStates.SEARCH_PRICE_RANGE, data);
  await showCurrentMessage(ctx, TXT.coach_search.choose_price, {
    attachments: [Keyboard.inlineKeyboard(rows)],
  });
}

async function showCountrySelection(ctx: AppContext, data: CoachSearchData): Promise<void> {
  const selfId = getCtxUserId(ctx);
  const { all, bannedIds } = await loadSearchContext(selfId);
  const opts = locationOpts(data, selfId, bannedIds);
  const counts = countCoachesByField(all, 'country', opts);

  const rows: ReturnType<typeof Keyboard.button.callback>[][] = [];
  for (const country of PRIMARY_COUNTRIES) {
    const count = counts[country] ?? countCoachesByLocation(all, { ...opts, country });
    rows.push([Keyboard.button.callback(
      fmt(TXT.coach_search.country_item, { country, count }),
      `coach_search_country_${encodeURIComponent(country)}`,
    )]);
  }

  const otherCountries = getTopLocations(counts, 7, PRIMARY_COUNTRIES);
  const otherCount = sumCounts(otherCountries);
  if (otherCount > 0) {
    rows.push([Keyboard.button.callback(
      fmt(TXT.coach_search.other_countries, { count: otherCount }),
      'coach_search_other_country',
    )]);
  }
  rows.push([Keyboard.button.callback(TXT.coach_search.back_to_price, 'coach_back_to_price')]);

  await setState(ctx, FindCoachStates.SEARCH_COUNTRY, data);
  await showCurrentMessage(ctx, TXT.coach_search.choose_country, {
    attachments: [Keyboard.inlineKeyboard(rows)],
  });
}

async function showOtherCountries(ctx: AppContext, data: CoachSearchData): Promise<boolean> {
  const selfId = getCtxUserId(ctx);
  const { all, bannedIds } = await loadSearchContext(selfId);
  const opts = locationOpts(data, selfId, bannedIds);
  const counts = countCoachesByField(all, 'country', opts);
  const top = getTopLocations(counts, 7, PRIMARY_COUNTRIES);

  if (!top.length) return false;

  const rows = top.map(([country, count]) => [
    Keyboard.button.callback(
      fmt(TXT.coach_search.country_item, { country, count }),
      `coach_search_country_${encodeURIComponent(country)}`,
    ),
  ]);
  rows.push([Keyboard.button.callback(TXT.common.back, 'coach_back_to_countries')]);

  await setState(ctx, FindCoachStates.SEARCH_OTHER_COUNTRIES, data);
  await showCurrentMessage(ctx, TXT.coach_search.top_countries, {
    attachments: [Keyboard.inlineKeyboard(rows)],
  });
  return true;
}

async function buildCityRows(
  all: Record<string, UserProfile>,
  data: CoachSearchData,
  selfId: number,
  bannedIds: Set<number>,
): Promise<ReturnType<typeof Keyboard.button.callback>[][]> {
  const opts = locationOpts(data, selfId, bannedIds);
  const counts = countCoachesByField(all, 'city', opts);
  const rows: ReturnType<typeof Keyboard.button.callback>[][] = [];

  if (Object.keys(counts).length) {
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    for (const [city, count] of sorted.slice(0, 5)) {
      rows.push([Keyboard.button.callback(
        fmt(TXT.coach_search.city_item, { city, count }),
        `coach_search_city_${encodeURIComponent(city)}`,
      )]);
    }
    const otherCount = sumCounts(sorted.slice(5));
    if (otherCount > 0) {
      rows.push([Keyboard.button.callback(
        fmt(TXT.coach_search.other_cities, { count: otherCount }),
        'coach_search_other_city',
      )]);
    }
  } else if (data.country) {
    const cities = COUNTRIES[data.country] ?? [];
    for (const city of cities) {
      const count = countCoachesByLocation(all, { ...opts, city });
      rows.push([Keyboard.button.callback(
        fmt(TXT.coach_search.city_item, { city, count }),
        `coach_search_city_${encodeURIComponent(city)}`,
      )]);
    }
  }

  rows.push([Keyboard.button.callback(TXT.coach_search.back_to_countries, 'coach_back_to_countries')]);
  return rows;
}

async function showCitySelection(ctx: AppContext, data: CoachSearchData): Promise<void> {
  const selfId = getCtxUserId(ctx);
  const { all, bannedIds } = await loadSearchContext(selfId);
  const rows = await buildCityRows(all, data, selfId, bannedIds);

  await setState(ctx, FindCoachStates.SEARCH_CITY, data);
  await showCurrentMessage(ctx, fmt(TXT.coach_search.choose_city, { country: data.country! }), {
    attachments: [Keyboard.inlineKeyboard(rows)],
  });
}

async function showOtherCities(ctx: AppContext, data: CoachSearchData): Promise<boolean> {
  const selfId = getCtxUserId(ctx);
  const { all, bannedIds } = await loadSearchContext(selfId);
  const opts = locationOpts(data, selfId, bannedIds);
  const counts = countCoachesByField(all, 'city', opts);
  const exclude = data.country ? (COUNTRIES[data.country] ?? []) : [];
  const top = getTopLocations(counts, 7, exclude);

  if (!top.length) return false;

  const rows = top.map(([city, count]) => [
    Keyboard.button.callback(
      fmt(TXT.coach_search.city_item, { city, count }),
      `coach_search_city_${encodeURIComponent(city)}`,
    ),
  ]);
  rows.push([Keyboard.button.callback(TXT.common.back, 'coach_back_to_cities')]);

  await setState(ctx, FindCoachStates.SEARCH_OTHER_CITIES, data);
  await showCurrentMessage(ctx, fmt(TXT.coach_search.top_cities, { country: data.country! }), {
    attachments: [Keyboard.inlineKeyboard(rows)],
  });
  return true;
}

async function performSearch(ctx: AppContext, data: CoachSearchData): Promise<void> {
  const selfId = getCtxUserId(ctx);
  const { all, bannedIds } = await loadSearchContext(selfId);
  const results = filterCoaches(all, data, selfId, bannedIds);
  data.searchResults = results;
  data.page = 1;

  const suffix = filterSuffix(data);
  if (!results.length) {
    await setState(ctx, FindCoachStates.SEARCH_NO_RESULTS, data);
    await showCurrentMessage(ctx, fmt(TXT.coach_search.no_results, {
      city: data.city!,
      country: data.country!,
      sport: suffix.sport,
      price: suffix.price,
    }), {
      attachments: [Keyboard.inlineKeyboard([
        [Keyboard.button.callback(TXT.coach_search.back_to_cities, 'coach_back_to_cities')],
      ])],
    });
    return;
  }

  await setState(ctx, FindCoachStates.SEARCH_RESULTS, data);
  await showCoachResults(ctx);
}

export async function showCoachResults(ctx: AppContext): Promise<void> {
  const user = await requireRegistered(ctx);
  if (!user) return;

  const data = getStateData<CoachSearchData>(ctx);
  const selfId = getCtxUserId(ctx);

  if (!data.searchResults) {
    const { all, bannedIds } = await loadSearchContext(selfId);
    data.searchResults = filterCoaches(all, data, selfId, bannedIds);
  }

  const page = data.page ?? 1;
  const { items, page: p, totalPages } = paginate(data.searchResults, page, RESULTS_PER_PAGE);
  const suffix = filterSuffix(data);

  if (!items.length) {
    await setState(ctx, FindCoachStates.SEARCH_NO_RESULTS, data);
    await showCurrentMessage(ctx, fmt(TXT.coach_search.no_results, {
      city: data.city ?? '—',
      country: data.country ?? '—',
      sport: suffix.sport,
      price: suffix.price,
    }), {
      attachments: [Keyboard.inlineKeyboard([
        [Keyboard.button.callback(TXT.coach_search.back_to_cities, 'coach_back_to_cities')],
      ])],
    });
    return;
  }

  const buttons = items.map((u) => [
    Keyboard.button.callback(formatCoachLabel(u), `coach_show_profile_${u.max_user_id}`),
  ]);
  const nav: ReturnType<typeof Keyboard.button.callback>[] = [];
  if (p > 1) nav.push(Keyboard.button.callback('⬅️', `coach_page_${p - 1}`));
  if (p < totalPages) nav.push(Keyboard.button.callback('➡️', `coach_page_${p + 1}`));
  if (nav.length) buttons.push(nav);
  buttons.push([Keyboard.button.callback(TXT.coach_search.back_to_cities, 'coach_back_to_cities')]);

  await setState(ctx, FindCoachStates.SEARCH_RESULTS, data);
  await showCurrentMessage(ctx, fmt(TXT.coach_search.results_title, {
    count: data.searchResults.length,
    city: data.city!,
    country: data.country!,
    sport: suffix.sport,
    price: suffix.price,
    page: p,
    total: totalPages,
  }), {
    attachments: [Keyboard.inlineKeyboard(buttons)],
  });
}

export async function startFindCoach(ctx: AppContext): Promise<void> {
  const user = await requireRegistered(ctx);
  if (!user) return;
  await setState(ctx, FindCoachStates.SEARCH_SPORT, {});
  await showSportSelection(ctx);
}

export function registerFindCoachHandlers(bot: import('@maxhub/max-bot-api').Bot<AppContext>): void {
  bot.action(/^coach_sport_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const payload = getCallbackPayload(ctx);
    const data = getStateData<CoachSearchData>(ctx);

    if (payload === 'coach_sport_any') {
      delete data.sport;
    } else {
      data.sport = decodeURIComponent(payload.replace('coach_sport_', '')) as SportType;
    }

    await showPriceSelection(ctx, data);
  });

  bot.action('coach_back_to_sport', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    await setState(ctx, FindCoachStates.SEARCH_SPORT, getStateData<CoachSearchData>(ctx));
    await showSportSelection(ctx);
  });

  bot.action(/^coach_price_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const payload = getCallbackPayload(ctx);
    const data = getStateData<CoachSearchData>(ctx);

    if (payload === 'coach_price_any') {
      delete data.priceMin;
      delete data.priceMax;
    } else {
      const rest = payload.replace('coach_price_', '');
      const [min, max] = rest.split('_');
      data.priceMin = Number(min);
      data.priceMax = Number(max);
    }

    await showCountrySelection(ctx, data);
  });

  bot.action('coach_back_to_price', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    await showPriceSelection(ctx, getStateData<CoachSearchData>(ctx));
  });

  bot.action(/^coach_search_country_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<CoachSearchData>(ctx);
    data.country = decodeURIComponent(getCallbackPayload(ctx).replace('coach_search_country_', ''));
    delete data.city;
    await showCitySelection(ctx, data);
  });

  bot.action('coach_search_other_country', async (ctx) => {
    const shown = await showOtherCountries(ctx, getStateData<CoachSearchData>(ctx));
    await ctx.answerOnCallback({
      notification: shown ? 'OK' : TXT.coach_search.countries_not_found,
    });
  });

  bot.action('coach_back_to_countries', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<CoachSearchData>(ctx);
    delete data.country;
    delete data.city;
    await showCountrySelection(ctx, data);
  });

  bot.action(/^coach_search_city_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<CoachSearchData>(ctx);
    data.city = decodeURIComponent(getCallbackPayload(ctx).replace('coach_search_city_', ''));
    await performSearch(ctx, data);
  });

  bot.action('coach_search_other_city', async (ctx) => {
    const shown = await showOtherCities(ctx, getStateData<CoachSearchData>(ctx));
    await ctx.answerOnCallback({
      notification: shown ? 'OK' : TXT.coach_search.cities_not_found,
    });
  });

  bot.action('coach_back_to_cities', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<CoachSearchData>(ctx);
    delete data.city;
    delete data.searchResults;
    delete data.page;
    if (data.country) {
      await showCitySelection(ctx, data);
    } else {
      await showCountrySelection(ctx, data);
    }
  });

  bot.action(/^coach_page_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<CoachSearchData>(ctx);
    data.page = Number(getCallbackPayload(ctx).replace('coach_page_', ''));
    await showCoachResults(ctx);
  });
}
