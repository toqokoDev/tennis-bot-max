import { TXT, fmt } from '../texts.js';
import { Keyboard } from '@maxhub/max-bot-api';
import type { AppContext } from '../context.js';
import { getCtxUserId } from '../context.js';
import {
  COUNTRIES,
  calculateAge,
  DATING_GOALS,
  GENDERS,
  MOSCOW_DISTRICTS,
  NTRP_LEVELS,
  SPORTS,
  getSportFieldConfig,
} from '../config/profile.js';
import { storage } from '../storage/jsonStorage.js';
import { getStateData, setState } from '../middleware/session.js';
import { SearchPartnerStates } from '../types/states.js';
import type { SportType, UserProfile } from '../types/models.js';
import { chunkButtons, paginate, showCurrentMessage } from '../utils/bot.js';
import { getCallbackPayload } from '../utils/callback.js';
import {
  countPartnersByField,
  countPartnersByLocation,
  getTopLocations,
  sumCounts,
} from '../utils/searchUsers.js';
import { requireRegistered } from './registration.js';

const PRIMARY_COUNTRIES = Object.keys(COUNTRIES).slice(0, 5);
const RUSSIA = '🇷🇺 Россия';
const DATING_SPORT: SportType = '🍒Знакомства';
const TABLE_TENNIS: SportType = '🏓Настольный теннис';
const RESULTS_PER_PAGE = 10;

type SearchData = {
  sport?: SportType;
  country?: string;
  city?: string;
  district?: string;
  gender?: string;
  level?: string;
  ageRange?: string;
  datingGoal?: string;
  distance?: number;
  page?: number;
  searchResults?: UserProfile[];
};

const AGE_RANGES = [
  { key: '18-25', label: TXT.search.age_18_25 },
  { key: '26-35', label: TXT.search.age_26_35 },
  { key: '36-45', label: TXT.search.age_36_45 },
  { key: '46-55', label: TXT.search.age_46_55 },
  { key: '56+', label: TXT.search.age_56_plus },
];

const DISTANCES = [5, 10, 20, 50, 100];

async function loadSearchContext(selfId: number) {
  const [all, banned] = await Promise.all([storage.getUsers(), storage.getBanned()]);
  const bannedIds = new Set(
    Object.keys(banned).map(Number).filter((id) => !Number.isNaN(id)),
  );
  return { all, bannedIds, selfId };
}

function filterSuffix(data: SearchData): { sport: string; gender: string; level: string } {
  const sport = data.sport ? ` · ${data.sport}` : '';
  const gender = data.gender ? ` · ${data.gender}` : '';
  const level = data.level ? ` · ${data.level}` : '';
  return { sport, gender, level };
}

function matchesAgeRange(age: number, range?: string): boolean {
  if (!range || range === 'any') return true;
  if (range === '18-25') return age >= 18 && age <= 25;
  if (range === '26-35') return age >= 26 && age <= 35;
  if (range === '36-45') return age >= 36 && age <= 45;
  if (range === '46-55') return age >= 46 && age <= 55;
  if (range === '56+') return age >= 56;
  return true;
}

function matchesDatingGoal(profile: UserProfile, goalKey?: string): boolean {
  if (!goalKey || goalKey === 'any') return true;
  if (profile.dating_goal_key) return profile.dating_goal_key === goalKey;
  const target = DATING_GOALS.find((g) => g.key === goalKey)?.ru;
  return !target || profile.dating_goal === target;
}

function filterUsers(
  all: Record<string, UserProfile>,
  data: SearchData,
  selfId: number,
  bannedIds: Set<number>,
): UserProfile[] {
  const results: UserProfile[] = [];

  for (const profile of Object.values(all)) {
    if (profile.max_user_id === selfId) continue;
    if (!profile.show_in_search) continue;
    if (bannedIds.has(profile.max_user_id)) continue;

    const searchSport = data.sport;
    if (searchSport === DATING_SPORT || searchSport === '🍻По пиву' || searchSport === '☕️Бизнес-завтрак') {
      // no role check
    } else if (searchSport) {
      if (getSportFieldConfig(searchSport).hasRole && profile.role !== '🎯 Игрок') continue;
    } else if (!['🍒Знакомства', '🍻По пиву', '☕️Бизнес-завтрак'].includes(profile.sport)) {
      if (getSportFieldConfig(profile.sport).hasRole && profile.role !== '🎯 Игрок') continue;
    }

    if (data.country && profile.country !== data.country) continue;
    if (data.city && profile.city !== data.city) continue;
    if (data.district && profile.district !== data.district) continue;
    if (searchSport && profile.sport !== searchSport) continue;
    if (data.gender && profile.gender !== data.gender) continue;
    if (data.level && profile.player_level !== data.level) continue;

    if (searchSport === DATING_SPORT) {
      const age = calculateAge(profile.birth_date);
      if (!matchesAgeRange(age, data.ageRange)) continue;
      if (!matchesDatingGoal(profile, data.datingGoal)) continue;
    }

    results.push(profile);
  }

  return results;
}

function sortPartners(results: UserProfile[], sport?: SportType): UserProfile[] {
  if (sport === DATING_SPORT || !results.length) return results;

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

function shortName(user: UserProfile): string {
  if (user.last_name) return `${user.first_name[0]}. ${user.last_name}`;
  return user.first_name;
}

function formatPartnerLabel(user: UserProfile): string {
  const genderIcon = user.gender === 'Мужской' ? '👨' : user.gender === 'Женский' ? '👩' : '👤';
  const districtText = user.district ? ` ${user.district}` : '';
  const age = calculateAge(user.birth_date);
  let label = `${genderIcon} ${shortName(user)}${districtText} ${age} лет`;
  if (user.player_level && user.rating_points) {
    label += ` ${user.player_level} (${user.rating_points} lvl)`;
  } else if (user.player_level) {
    label += ` ${user.player_level}`;
  }
  return label;
}

function locationOpts(data: SearchData, selfId: number, bannedIds: Set<number>) {
  return {
    sport: data.sport,
    country: data.country,
    excludeUserId: selfId,
    bannedIds,
  };
}

export async function startSearch(ctx: AppContext): Promise<void> {
  const user = await requireRegistered(ctx);
  if (!user) return;
  await setState(ctx, SearchPartnerStates.SEARCH_SPORT, {});
  await showSportSelection(ctx);
}

async function showSportSelection(ctx: AppContext): Promise<void> {
  const rows: ReturnType<typeof Keyboard.button.callback>[][] = [
    [Keyboard.button.callback(TXT.search.all_sports, 'partner_sport_any')],
    ...chunkButtons(SPORTS, (s) => Keyboard.button.callback(s, `partner_sport_${encodeURIComponent(s)}`), 2),
    [Keyboard.button.callback(TXT.common.main_menu, 'main_menu')],
  ];
  await showCurrentMessage(ctx, TXT.search.choose_sport, {
    attachments: [Keyboard.inlineKeyboard(rows)],
  });
}

async function showCountrySelection(ctx: AppContext, data: SearchData): Promise<void> {
  const selfId = getCtxUserId(ctx);
  const { all, bannedIds } = await loadSearchContext(selfId);
  const opts = locationOpts(data, selfId, bannedIds);
  const counts = countPartnersByField(all, 'country', opts);

  const rows: ReturnType<typeof Keyboard.button.callback>[][] = [];
  for (const country of PRIMARY_COUNTRIES) {
    const count = counts[country] ?? countPartnersByLocation(all, { ...opts, country });
    rows.push([Keyboard.button.callback(
      fmt(TXT.search.country_item, { country, count }),
      `partner_search_country_${encodeURIComponent(country)}`,
    )]);
  }

  const otherCountries = getTopLocations(counts, 7, PRIMARY_COUNTRIES);
  const otherCount = sumCounts(otherCountries);
  if (otherCount > 0) {
    rows.push([Keyboard.button.callback(
      fmt(TXT.search.other_countries, { count: otherCount }),
      'partner_search_other_country',
    )]);
  }
  rows.push([Keyboard.button.callback(TXT.search.back_to_sport, 'partner_back_to_sport')]);

  await setState(ctx, SearchPartnerStates.SEARCH_COUNTRY, data);
  await showCurrentMessage(ctx, TXT.search.choose_country, {
    attachments: [Keyboard.inlineKeyboard(rows)],
  });
}

async function showOtherCountries(ctx: AppContext, data: SearchData): Promise<boolean> {
  const selfId = getCtxUserId(ctx);
  const { all, bannedIds } = await loadSearchContext(selfId);
  const opts = locationOpts(data, selfId, bannedIds);
  const counts = countPartnersByField(all, 'country', opts);
  const top = getTopLocations(counts, 7, PRIMARY_COUNTRIES);

  if (!top.length) return false;

  const rows = top.map(([country, count]) => [
    Keyboard.button.callback(
      fmt(TXT.search.country_item, { country, count }),
      `partner_search_country_${encodeURIComponent(country)}`,
    ),
  ]);
  rows.push([Keyboard.button.callback(TXT.common.back, 'partner_back_to_countries')]);

  await setState(ctx, SearchPartnerStates.SEARCH_OTHER_COUNTRIES, data);
  await showCurrentMessage(ctx, TXT.search.top_countries, {
    attachments: [Keyboard.inlineKeyboard(rows)],
  });
  return true;
}

async function buildCityRows(
  all: Record<string, UserProfile>,
  data: SearchData,
  selfId: number,
  bannedIds: Set<number>,
): Promise<ReturnType<typeof Keyboard.button.callback>[][]> {
  const opts = locationOpts(data, selfId, bannedIds);
  const counts = countPartnersByField(all, 'city', opts);
  const rows: ReturnType<typeof Keyboard.button.callback>[][] = [];

  if (Object.keys(counts).length) {
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    for (const [city, count] of sorted.slice(0, 5)) {
      rows.push([Keyboard.button.callback(
        fmt(TXT.search.city_item, { city, count }),
        `partner_search_city_${encodeURIComponent(city)}`,
      )]);
    }
    const otherCount = sumCounts(sorted.slice(5));
    if (otherCount > 0) {
      rows.push([Keyboard.button.callback(
        fmt(TXT.search.other_cities, { count: otherCount }),
        'partner_search_other_city',
      )]);
    }
  } else if (data.country) {
    const cities = COUNTRIES[data.country] ?? [];
    for (const city of cities) {
      const count = countPartnersByLocation(all, { ...opts, city });
      rows.push([Keyboard.button.callback(
        fmt(TXT.search.city_item, { city, count }),
        `partner_search_city_${encodeURIComponent(city)}`,
      )]);
    }
  }

  rows.push([Keyboard.button.callback(TXT.search.back_to_countries, 'partner_back_to_countries')]);
  return rows;
}

async function showCitySelection(ctx: AppContext, data: SearchData): Promise<void> {
  const selfId = getCtxUserId(ctx);
  const { all, bannedIds } = await loadSearchContext(selfId);
  const rows = await buildCityRows(all, data, selfId, bannedIds);

  await setState(ctx, SearchPartnerStates.SEARCH_CITY, data);
  await showCurrentMessage(ctx, fmt(TXT.search.choose_city, { country: data.country! }), {
    attachments: [Keyboard.inlineKeyboard(rows)],
  });
}

async function showOtherCities(ctx: AppContext, data: SearchData): Promise<boolean> {
  const selfId = getCtxUserId(ctx);
  const { all, bannedIds } = await loadSearchContext(selfId);
  const opts = locationOpts(data, selfId, bannedIds);
  const counts = countPartnersByField(all, 'city', opts);
  const exclude = data.country ? (COUNTRIES[data.country] ?? []) : [];
  const top = getTopLocations(counts, 7, exclude);

  if (!top.length) return false;

  const rows = top.map(([city, count]) => [
    Keyboard.button.callback(
      fmt(TXT.search.city_item, { city, count }),
      `partner_search_city_${encodeURIComponent(city)}`,
    ),
  ]);
  rows.push([Keyboard.button.callback(TXT.common.back, 'partner_back_to_cities')]);

  await setState(ctx, SearchPartnerStates.SEARCH_OTHER_CITIES, data);
  await showCurrentMessage(ctx, fmt(TXT.search.top_cities, { country: data.country! }), {
    attachments: [Keyboard.inlineKeyboard(rows)],
  });
  return true;
}

async function showDistrictSelection(ctx: AppContext, data: SearchData): Promise<void> {
  const rows: ReturnType<typeof Keyboard.button.callback>[][] = [
    [Keyboard.button.callback(TXT.search.any_district, 'partner_district_any')],
    ...chunkButtons(MOSCOW_DISTRICTS, (d) => Keyboard.button.callback(d, `partner_district_${d}`), 3),
    [Keyboard.button.callback(TXT.search.back_to_cities, 'partner_back_to_cities')],
  ];
  await setState(ctx, SearchPartnerStates.SEARCH_DISTRICT, data);
  await showCurrentMessage(ctx, fmt(TXT.search.choose_district, { city: data.city! }), {
    attachments: [Keyboard.inlineKeyboard(rows)],
  });
}

async function showGenderSelection(ctx: AppContext, data: SearchData): Promise<void> {
  const rows: ReturnType<typeof Keyboard.button.callback>[][] = [
    [Keyboard.button.callback(TXT.search.any_gender, 'partner_gender_any')],
    ...GENDERS.map((g) => [Keyboard.button.callback(g, `partner_gender_${encodeURIComponent(g)}`)]),
    [Keyboard.button.callback(TXT.search.back_to_cities, 'partner_back_to_cities')],
  ];
  await setState(ctx, SearchPartnerStates.SEARCH_GENDER, data);
  await showCurrentMessage(ctx, TXT.search.choose_gender, {
    attachments: [Keyboard.inlineKeyboard(rows)],
  });
}

async function showLevelSelection(ctx: AppContext, data: SearchData): Promise<void> {
  const rows: ReturnType<typeof Keyboard.button.callback>[][] = [
    [Keyboard.button.callback(TXT.search.any_level, 'partner_level_any')],
    ...chunkButtons(NTRP_LEVELS, (l) => Keyboard.button.callback(l, `partner_level_${l}`), 3),
    [Keyboard.button.callback(TXT.search.back_to_gender, 'partner_back_to_gender')],
  ];
  await setState(ctx, SearchPartnerStates.SEARCH_LEVEL, data);
  await showCurrentMessage(ctx, TXT.search.choose_level, {
    attachments: [Keyboard.inlineKeyboard(rows)],
  });
}

async function showAgeRangeSelection(ctx: AppContext, data: SearchData): Promise<void> {
  const rows: ReturnType<typeof Keyboard.button.callback>[][] = [
    [Keyboard.button.callback(TXT.search.age_any, 'partner_age_any')],
    ...chunkButtons(AGE_RANGES, (r) => Keyboard.button.callback(r.label, `partner_age_${r.key}`), 2),
    [Keyboard.button.callback(TXT.search.back_to_gender, 'partner_back_to_gender')],
  ];
  await setState(ctx, SearchPartnerStates.SEARCH_AGE_RANGE, data);
  await showCurrentMessage(ctx, TXT.search.choose_age, {
    attachments: [Keyboard.inlineKeyboard(rows)],
  });
}

async function showDatingGoalSelection(ctx: AppContext, data: SearchData): Promise<void> {
  const rows: ReturnType<typeof Keyboard.button.callback>[][] = [
    [Keyboard.button.callback(TXT.search.dating_goal_any, 'partner_dating_goal_any')],
    ...DATING_GOALS.map((g) => [Keyboard.button.callback(g.ru, `partner_dating_goal_${g.key}`)]),
    [Keyboard.button.callback(TXT.common.back, 'partner_back_to_age')],
  ];
  await setState(ctx, SearchPartnerStates.SEARCH_DATING_GOAL, data);
  await showCurrentMessage(ctx, TXT.search.choose_dating_goal, {
    attachments: [Keyboard.inlineKeyboard(rows)],
  });
}

async function showDistanceSelection(ctx: AppContext, data: SearchData): Promise<void> {
  const rows: ReturnType<typeof Keyboard.button.callback>[][] = [
    [Keyboard.button.callback(TXT.search.distance_any, 'partner_distance_any')],
    ...chunkButtons(DISTANCES, (km) => Keyboard.button.callback(
      fmt(TXT.search.distance_km, { km }),
      `partner_distance_${km}`,
    ), 2),
    [Keyboard.button.callback(TXT.common.back, 'partner_back_to_dating_goal')],
  ];
  await setState(ctx, SearchPartnerStates.SEARCH_DISTANCE, data);
  await showCurrentMessage(ctx, TXT.search.choose_distance, {
    attachments: [Keyboard.inlineKeyboard(rows)],
  });
}

async function performSearch(ctx: AppContext, data: SearchData): Promise<void> {
  const selfId = getCtxUserId(ctx);
  const { all, bannedIds } = await loadSearchContext(selfId);
  const results = sortPartners(filterUsers(all, data, selfId, bannedIds), data.sport);
  data.searchResults = results;
  data.page = 1;

  if (!results.length) {
    const suffix = filterSuffix(data);
    await setState(ctx, SearchPartnerStates.SEARCH_NO_RESULTS, data);
    await showCurrentMessage(ctx, fmt(TXT.search.no_results, {
      city: data.city!,
      country: data.country!,
      sport: suffix.sport,
      gender: suffix.gender,
      level: suffix.level,
    }), {
      attachments: [Keyboard.inlineKeyboard([
        [Keyboard.button.callback(TXT.common.back, 'partner_back_to_level')],
      ])],
    });
    return;
  }

  await setState(ctx, SearchPartnerStates.SEARCH_RESULTS, data);
  await showSearchResults(ctx);
}

export async function showSearchResults(ctx: AppContext): Promise<void> {
  const user = await requireRegistered(ctx);
  if (!user) return;

  const data = getStateData<SearchData>(ctx);
  const selfId = getCtxUserId(ctx);

  if (!data.searchResults) {
    const { all, bannedIds } = await loadSearchContext(selfId);
    data.searchResults = sortPartners(filterUsers(all, data, selfId, bannedIds), data.sport);
  }

  const page = data.page ?? 1;
  const { items, page: p, totalPages } = paginate(data.searchResults, page, RESULTS_PER_PAGE);
  const suffix = filterSuffix(data);

  if (!items.length) {
    await setState(ctx, SearchPartnerStates.SEARCH_NO_RESULTS, data);
    await showCurrentMessage(ctx, fmt(TXT.search.no_results, {
      city: data.city ?? '—',
      country: data.country ?? '—',
      sport: suffix.sport,
      gender: suffix.gender,
      level: suffix.level,
    }), {
      attachments: [Keyboard.inlineKeyboard([
        [Keyboard.button.callback(TXT.common.back, 'partner_back_to_level')],
      ])],
    });
    return;
  }

  const buttons = items.map((u) => [
    Keyboard.button.callback(formatPartnerLabel(u), `partner_show_profile_${u.max_user_id}`),
  ]);
  const nav: ReturnType<typeof Keyboard.button.callback>[] = [];
  if (p > 1) nav.push(Keyboard.button.callback('⬅️', `partner_page_${p - 1}`));
  if (p < totalPages) nav.push(Keyboard.button.callback('➡️', `partner_page_${p + 1}`));
  if (nav.length) buttons.push(nav);
  buttons.push([Keyboard.button.callback(TXT.common.back, 'partner_back_to_level')]);

  await setState(ctx, SearchPartnerStates.SEARCH_RESULTS, data);
  await showCurrentMessage(ctx, fmt(TXT.search.results_title, {
    count: data.searchResults.length,
    city: data.city!,
    country: data.country!,
    sport: suffix.sport,
    gender: suffix.gender,
    level: suffix.level,
    page: p,
    total: totalPages,
  }), {
    attachments: [Keyboard.inlineKeyboard(buttons)],
  });
}

async function afterCitySelected(ctx: AppContext, data: SearchData): Promise<void> {
  if (data.country === RUSSIA && data.city === 'Москва') {
    await showDistrictSelection(ctx, data);
    return;
  }
  await showGenderSelection(ctx, data);
}

export function registerSearchHandlers(bot: import('@maxhub/max-bot-api').Bot<AppContext>): void {
  bot.action(/^partner_sport_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const payload = getCallbackPayload(ctx);
    const data = getStateData<SearchData>(ctx);

    if (payload === 'partner_sport_any') {
      delete data.sport;
    } else {
      data.sport = decodeURIComponent(payload.replace('partner_sport_', '')) as SportType;
    }

    await showCountrySelection(ctx, data);
  });

  bot.action('partner_back_to_sport', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    await setState(ctx, SearchPartnerStates.SEARCH_SPORT, getStateData<SearchData>(ctx));
    await showSportSelection(ctx);
  });

  bot.action(/^partner_search_country_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<SearchData>(ctx);
    data.country = decodeURIComponent(getCallbackPayload(ctx).replace('partner_search_country_', ''));
    delete data.city;
    delete data.district;
    await showCitySelection(ctx, data);
  });

  bot.action('partner_search_other_country', async (ctx) => {
    const shown = await showOtherCountries(ctx, getStateData<SearchData>(ctx));
    await ctx.answerOnCallback({
      notification: shown ? 'OK' : TXT.search.countries_not_found,
    });
  });

  bot.action('partner_back_to_countries', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<SearchData>(ctx);
    delete data.country;
    delete data.city;
    delete data.district;
    await showCountrySelection(ctx, data);
  });

  bot.action(/^partner_search_city_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<SearchData>(ctx);
    data.city = decodeURIComponent(getCallbackPayload(ctx).replace('partner_search_city_', ''));
    delete data.district;
    await afterCitySelected(ctx, data);
  });

  bot.action('partner_search_other_city', async (ctx) => {
    const shown = await showOtherCities(ctx, getStateData<SearchData>(ctx));
    await ctx.answerOnCallback({
      notification: shown ? 'OK' : TXT.search.cities_not_found,
    });
  });

  bot.action('partner_back_to_cities', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<SearchData>(ctx);
    delete data.city;
    delete data.district;
    await showCitySelection(ctx, data);
  });

  bot.action(/^partner_district_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<SearchData>(ctx);
    const payload = getCallbackPayload(ctx);
    if (payload === 'partner_district_any') {
      delete data.district;
    } else {
      data.district = payload.replace('partner_district_', '');
    }
    await showGenderSelection(ctx, data);
  });

  bot.action(/^partner_gender_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<SearchData>(ctx);
    const payload = getCallbackPayload(ctx);
    if (payload === 'partner_gender_any') {
      delete data.gender;
    } else {
      data.gender = decodeURIComponent(payload.replace('partner_gender_', ''));
    }

    if (data.sport === DATING_SPORT) {
      await showAgeRangeSelection(ctx, data);
      return;
    }
    await showLevelSelection(ctx, data);
  });

  bot.action('partner_back_to_gender', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    await showGenderSelection(ctx, getStateData<SearchData>(ctx));
  });

  bot.action(/^partner_level_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<SearchData>(ctx);
    const payload = getCallbackPayload(ctx);
    if (payload === 'partner_level_any') {
      delete data.level;
    } else {
      data.level = payload.replace('partner_level_', '');
    }
    await performSearch(ctx, data);
  });

  bot.action('partner_back_to_level', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<SearchData>(ctx);
    if (data.sport === DATING_SPORT) {
      await showAgeRangeSelection(ctx, data);
      return;
    }
    await showLevelSelection(ctx, data);
  });

  bot.action(/^partner_age_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<SearchData>(ctx);
    const payload = getCallbackPayload(ctx);
    if (payload === 'partner_age_any') {
      delete data.ageRange;
    } else {
      data.ageRange = payload.replace('partner_age_', '');
    }
    await showDatingGoalSelection(ctx, data);
  });

  bot.action('partner_back_to_age', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    await showAgeRangeSelection(ctx, getStateData<SearchData>(ctx));
  });

  bot.action(/^partner_dating_goal_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<SearchData>(ctx);
    const payload = getCallbackPayload(ctx);
    if (payload === 'partner_dating_goal_any') {
      delete data.datingGoal;
    } else {
      data.datingGoal = payload.replace('partner_dating_goal_', '');
    }
    await showDistanceSelection(ctx, data);
  });

  bot.action('partner_back_to_dating_goal', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    await showDatingGoalSelection(ctx, getStateData<SearchData>(ctx));
  });

  bot.action(/^partner_distance_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<SearchData>(ctx);
    const payload = getCallbackPayload(ctx);
    if (payload === 'partner_distance_any') {
      delete data.distance;
    } else {
      data.distance = Number(payload.replace('partner_distance_', ''));
    }
    await performSearch(ctx, data);
  });

  bot.action(/^partner_page_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<SearchData>(ctx);
    data.page = Number(getCallbackPayload(ctx).replace('partner_page_', ''));
    await showSearchResults(ctx);
  });
}
