import { TXT, fmt } from '../texts.js';
import { Keyboard } from '@maxhub/max-bot-api';
import type { AppContext } from '../context.js';
import { getCtxUserId } from '../context.js';
import { COUNTRIES, SPORTS, calculateAge } from '../config/profile.js';
import { storage } from '../storage/jsonStorage.js';
import { getStateData, setState } from '../middleware/session.js';
import { AllPlayersStates } from '../types/states.js';
import type { SportType, UserProfile } from '../types/models.js';
import { chunkButtons, paginate, showCurrentMessage } from '../utils/bot.js';
import { getCallbackPayload } from '../utils/callback.js';
import {
  countPlayersByField,
  countPlayersByLocation,
  getTopLocations,
  matchesPlayerBase,
  sumCounts,
} from '../utils/searchUsers.js';
import { requireRegistered } from './registration.js';

const PRIMARY_COUNTRIES = Object.keys(COUNTRIES).slice(0, 5);
const TABLE_TENNIS: SportType = '🏓Настольный теннис';
const RESULTS_PER_PAGE = 5;

type PlayersSearchData = {
  sport?: SportType;
  country?: string;
  city?: string;
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

function filterSuffix(data: PlayersSearchData): { sport: string } {
  const sport = data.sport ? fmt(TXT.players_search.sport_suffix, { sport: data.sport }) : '';
  return { sport };
}

function locationOpts(data: PlayersSearchData, selfId: number, bannedIds: Set<number>) {
  return {
    sport: data.sport,
    country: data.country,
    excludeUserId: selfId,
    bannedIds,
  };
}

function sortPlayers(results: UserProfile[], sport?: SportType): UserProfile[] {
  if (!results.length) return results;

  return [...results].sort((a, b) => {
    if (sport === TABLE_TENNIS || (!sport && a.sport === TABLE_TENNIS)) {
      const ar = a.rating_points ?? Infinity;
      const br = b.rating_points ?? Infinity;
      return ar - br;
    }
    const parseLevel = (p: UserProfile): number => {
      const level = p.player_level;
      if (!level) return p.rating_points ?? Infinity;
      const n = Number.parseFloat(level.replace(',', '.'));
      return Number.isNaN(n) ? (p.rating_points ?? Infinity) : n;
    };
    return parseLevel(a) - parseLevel(b);
  });
}

function filterPlayers(
  all: Record<string, UserProfile>,
  data: PlayersSearchData,
  selfId: number,
  bannedIds: Set<number>,
): UserProfile[] {
  const results: UserProfile[] = [];
  for (const profile of Object.values(all)) {
    if (matchesPlayerBase(profile, {
      sport: data.sport,
      country: data.country,
      city: data.city,
      excludeUserId: selfId,
      bannedIds,
    })) {
      results.push(profile);
    }
  }
  return sortPlayers(results, data.sport);
}

function shortName(user: UserProfile): string {
  if (user.last_name) return `${user.first_name[0]}. ${user.last_name}`;
  return user.first_name;
}

function formatPlayerLabel(user: UserProfile): string {
  const genderIcon = user.gender === 'Мужской' ? '👨' : user.gender === 'Женский' ? '👩' : '👤';
  const age = calculateAge(user.birth_date);
  let label = `${genderIcon} ${shortName(user)} ${age} лет`;
  if (user.player_level && user.rating_points) {
    label += ` ${user.player_level} (${user.rating_points} lvl)`;
  } else if (user.player_level) {
    label += ` ${user.player_level}`;
  }
  return label;
}

async function showSportSelection(ctx: AppContext): Promise<void> {
  const rows: ReturnType<typeof Keyboard.button.callback>[][] = [
    [Keyboard.button.callback(TXT.search.all_sports, 'players_sport_any')],
    ...chunkButtons(SPORTS, (s) => Keyboard.button.callback(s, `players_sport_${encodeURIComponent(s)}`), 2),
    [Keyboard.button.callback(TXT.common.back, 'menu:more')],
  ];
  await showCurrentMessage(ctx, TXT.players_search.choose_sport, {
    attachments: [Keyboard.inlineKeyboard(rows)],
  });
}

async function showCountrySelection(ctx: AppContext, data: PlayersSearchData): Promise<void> {
  const selfId = getCtxUserId(ctx);
  const { all, bannedIds } = await loadSearchContext(selfId);
  const opts = locationOpts(data, selfId, bannedIds);
  const counts = countPlayersByField(all, 'country', opts);

  const rows: ReturnType<typeof Keyboard.button.callback>[][] = [];
  for (const country of PRIMARY_COUNTRIES) {
    const count = counts[country] ?? countPlayersByLocation(all, { ...opts, country });
    rows.push([Keyboard.button.callback(
      fmt(TXT.players_search.country_item, { country, count }),
      `players_search_country_${encodeURIComponent(country)}`,
    )]);
  }

  const otherCountries = getTopLocations(counts, 7, PRIMARY_COUNTRIES);
  const otherCount = sumCounts(otherCountries);
  if (otherCount > 0) {
    rows.push([Keyboard.button.callback(
      fmt(TXT.players_search.other_countries, { count: otherCount }),
      'players_search_other_country',
    )]);
  }
  rows.push([Keyboard.button.callback(TXT.players_search.back_to_sport, 'players_back_to_sport')]);

  await setState(ctx, AllPlayersStates.SEARCH_COUNTRY, data);
  await showCurrentMessage(ctx, TXT.players_search.choose_country, {
    attachments: [Keyboard.inlineKeyboard(rows)],
  });
}

async function showOtherCountries(ctx: AppContext, data: PlayersSearchData): Promise<boolean> {
  const selfId = getCtxUserId(ctx);
  const { all, bannedIds } = await loadSearchContext(selfId);
  const opts = locationOpts(data, selfId, bannedIds);
  const counts = countPlayersByField(all, 'country', opts);
  const top = getTopLocations(counts, 7, PRIMARY_COUNTRIES);

  if (!top.length) return false;

  const rows = top.map(([country, count]) => [
    Keyboard.button.callback(
      fmt(TXT.players_search.country_item, { country, count }),
      `players_search_country_${encodeURIComponent(country)}`,
    ),
  ]);
  rows.push([Keyboard.button.callback(TXT.common.back, 'players_back_to_countries')]);

  await setState(ctx, AllPlayersStates.SEARCH_OTHER_COUNTRIES, data);
  await showCurrentMessage(ctx, TXT.players_search.top_countries, {
    attachments: [Keyboard.inlineKeyboard(rows)],
  });
  return true;
}

async function buildCityRows(
  all: Record<string, UserProfile>,
  data: PlayersSearchData,
  selfId: number,
  bannedIds: Set<number>,
): Promise<ReturnType<typeof Keyboard.button.callback>[][]> {
  const opts = locationOpts(data, selfId, bannedIds);
  const counts = countPlayersByField(all, 'city', opts);
  const rows: ReturnType<typeof Keyboard.button.callback>[][] = [];

  if (Object.keys(counts).length) {
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    for (const [city, count] of sorted.slice(0, 5)) {
      rows.push([Keyboard.button.callback(
        fmt(TXT.players_search.city_item, { city, count }),
        `players_search_city_${encodeURIComponent(city)}`,
      )]);
    }
    const otherCount = sumCounts(sorted.slice(5));
    if (otherCount > 0) {
      rows.push([Keyboard.button.callback(
        fmt(TXT.players_search.other_cities, { count: otherCount }),
        'players_search_other_city',
      )]);
    }
  } else if (data.country) {
    const cities = COUNTRIES[data.country] ?? [];
    for (const city of cities) {
      const count = countPlayersByLocation(all, { ...opts, city });
      rows.push([Keyboard.button.callback(
        fmt(TXT.players_search.city_item, { city, count }),
        `players_search_city_${encodeURIComponent(city)}`,
      )]);
    }
  }

  rows.push([Keyboard.button.callback(TXT.players_search.back_to_countries, 'players_back_to_countries')]);
  return rows;
}

async function showCitySelection(ctx: AppContext, data: PlayersSearchData): Promise<void> {
  const selfId = getCtxUserId(ctx);
  const { all, bannedIds } = await loadSearchContext(selfId);
  const rows = await buildCityRows(all, data, selfId, bannedIds);

  await setState(ctx, AllPlayersStates.SEARCH_CITY, data);
  await showCurrentMessage(ctx, fmt(TXT.players_search.choose_city, { country: data.country! }), {
    attachments: [Keyboard.inlineKeyboard(rows)],
  });
}

async function showOtherCities(ctx: AppContext, data: PlayersSearchData): Promise<boolean> {
  const selfId = getCtxUserId(ctx);
  const { all, bannedIds } = await loadSearchContext(selfId);
  const opts = locationOpts(data, selfId, bannedIds);
  const counts = countPlayersByField(all, 'city', opts);
  const exclude = data.country ? (COUNTRIES[data.country] ?? []) : [];
  const top = getTopLocations(counts, 7, exclude);

  if (!top.length) return false;

  const rows = top.map(([city, count]) => [
    Keyboard.button.callback(
      fmt(TXT.players_search.city_item, { city, count }),
      `players_search_city_${encodeURIComponent(city)}`,
    ),
  ]);
  rows.push([Keyboard.button.callback(TXT.common.back, 'players_back_to_cities')]);

  await setState(ctx, AllPlayersStates.SEARCH_OTHER_CITIES, data);
  await showCurrentMessage(ctx, fmt(TXT.players_search.top_cities, { country: data.country! }), {
    attachments: [Keyboard.inlineKeyboard(rows)],
  });
  return true;
}

async function performSearch(ctx: AppContext, data: PlayersSearchData): Promise<void> {
  const selfId = getCtxUserId(ctx);
  const { all, bannedIds } = await loadSearchContext(selfId);
  const results = filterPlayers(all, data, selfId, bannedIds);
  data.searchResults = results;
  data.page = 1;

  const suffix = filterSuffix(data);
  if (!results.length) {
    await setState(ctx, AllPlayersStates.SEARCH_NO_RESULTS, data);
    await showCurrentMessage(ctx, fmt(TXT.players_search.no_results, {
      city: data.city!,
      country: data.country!,
      sport: suffix.sport,
    }), {
      attachments: [Keyboard.inlineKeyboard([
        [Keyboard.button.callback(TXT.players_search.back_to_cities, 'players_back_to_cities')],
      ])],
    });
    return;
  }

  await setState(ctx, AllPlayersStates.SEARCH_RESULTS, data);
  await showPlayersResults(ctx);
}

export async function showPlayersResults(ctx: AppContext): Promise<void> {
  const user = await requireRegistered(ctx);
  if (!user) return;

  const data = getStateData<PlayersSearchData>(ctx);
  const selfId = getCtxUserId(ctx);

  if (!data.searchResults) {
    const { all, bannedIds } = await loadSearchContext(selfId);
    data.searchResults = filterPlayers(all, data, selfId, bannedIds);
  }

  const page = data.page ?? 1;
  const { items, page: p, totalPages } = paginate(data.searchResults, page, RESULTS_PER_PAGE);
  const suffix = filterSuffix(data);

  if (!items.length) {
    await setState(ctx, AllPlayersStates.SEARCH_NO_RESULTS, data);
    await showCurrentMessage(ctx, fmt(TXT.players_search.no_results, {
      city: data.city ?? '—',
      country: data.country ?? '—',
      sport: suffix.sport,
    }), {
      attachments: [Keyboard.inlineKeyboard([
        [Keyboard.button.callback(TXT.players_search.back_to_cities, 'players_back_to_cities')],
      ])],
    });
    return;
  }

  const buttons = items.map((u) => [
    Keyboard.button.callback(formatPlayerLabel(u), `players_show_profile_${u.max_user_id}`),
  ]);
  const nav: ReturnType<typeof Keyboard.button.callback>[] = [];
  if (p > 1) nav.push(Keyboard.button.callback('⬅️', `players_page_${p - 1}`));
  if (p < totalPages) nav.push(Keyboard.button.callback('➡️', `players_page_${p + 1}`));
  if (nav.length) buttons.push(nav);
  buttons.push([Keyboard.button.callback(TXT.players_search.back_to_cities, 'players_back_to_cities')]);

  await setState(ctx, AllPlayersStates.SEARCH_RESULTS, data);
  await showCurrentMessage(ctx, fmt(TXT.players_search.results_title, {
    count: data.searchResults.length,
    city: data.city!,
    country: data.country!,
    sport: suffix.sport,
    page: p,
    total: totalPages,
  }), {
    attachments: [Keyboard.inlineKeyboard(buttons)],
  });
}

export async function startAllPlayers(ctx: AppContext): Promise<void> {
  const user = await requireRegistered(ctx);
  if (!user) return;
  await setState(ctx, AllPlayersStates.SEARCH_SPORT, {});
  await showSportSelection(ctx);
}

export function registerAllPlayersHandlers(bot: import('@maxhub/max-bot-api').Bot<AppContext>): void {
  bot.action(/^players_sport_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const payload = getCallbackPayload(ctx);
    const data = getStateData<PlayersSearchData>(ctx);

    if (payload === 'players_sport_any') {
      delete data.sport;
    } else {
      data.sport = decodeURIComponent(payload.replace('players_sport_', '')) as SportType;
    }

    await showCountrySelection(ctx, data);
  });

  bot.action('players_back_to_sport', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    await setState(ctx, AllPlayersStates.SEARCH_SPORT, getStateData<PlayersSearchData>(ctx));
    await showSportSelection(ctx);
  });

  bot.action(/^players_search_country_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<PlayersSearchData>(ctx);
    data.country = decodeURIComponent(getCallbackPayload(ctx).replace('players_search_country_', ''));
    delete data.city;
    await showCitySelection(ctx, data);
  });

  bot.action('players_search_other_country', async (ctx) => {
    const shown = await showOtherCountries(ctx, getStateData<PlayersSearchData>(ctx));
    await ctx.answerOnCallback({
      notification: shown ? 'OK' : TXT.players_search.countries_not_found,
    });
  });

  bot.action('players_back_to_countries', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<PlayersSearchData>(ctx);
    delete data.country;
    delete data.city;
    await showCountrySelection(ctx, data);
  });

  bot.action(/^players_search_city_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<PlayersSearchData>(ctx);
    data.city = decodeURIComponent(getCallbackPayload(ctx).replace('players_search_city_', ''));
    await performSearch(ctx, data);
  });

  bot.action('players_search_other_city', async (ctx) => {
    const shown = await showOtherCities(ctx, getStateData<PlayersSearchData>(ctx));
    await ctx.answerOnCallback({
      notification: shown ? 'OK' : TXT.players_search.cities_not_found,
    });
  });

  bot.action('players_back_to_cities', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<PlayersSearchData>(ctx);
    delete data.city;
    delete data.searchResults;
    delete data.page;
    if (data.country) {
      await showCitySelection(ctx, data);
    } else {
      await showCountrySelection(ctx, data);
    }
  });

  bot.action(/^players_page_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<PlayersSearchData>(ctx);
    data.page = Number(getCallbackPayload(ctx).replace('players_page_', ''));
    await showPlayersResults(ctx);
  });
}
