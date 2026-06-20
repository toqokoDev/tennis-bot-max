import { getSportFieldConfig } from '../config/profile.js';
import type { SportType, UserProfile } from '../types/models.js';

const MEETING_SPORTS: SportType[] = ['🍒Знакомства', '🍻По пиву', '☕️Бизнес-завтрак'];

export function isPartnerRoleRequired(sport?: SportType, profileSport?: SportType): boolean {
  const checkSport = sport ?? profileSport;
  if (!checkSport) return true;
  if (MEETING_SPORTS.includes(checkSport)) return false;
  return getSportFieldConfig(checkSport).hasRole;
}

export function matchesPartnerBase(
  profile: UserProfile,
  opts: {
    sport?: SportType;
    country?: string;
    city?: string;
    excludeUserId?: number;
    bannedIds?: Set<number>;
  },
): boolean {
  if (opts.excludeUserId && profile.max_user_id === opts.excludeUserId) return false;
  if (!profile.show_in_search) return false;
  if (opts.bannedIds?.has(profile.max_user_id)) return false;

  if (opts.sport && profile.sport !== opts.sport) return false;
  if (opts.country && profile.country !== opts.country) return false;
  if (opts.city && profile.city !== opts.city) return false;

  if (opts.sport && MEETING_SPORTS.includes(opts.sport)) {
    return true;
  }
  if (opts.sport) {
    if (isPartnerRoleRequired(opts.sport) && profile.role !== '🎯 Игрок') return false;
  } else if (!MEETING_SPORTS.includes(profile.sport)) {
    if (isPartnerRoleRequired(undefined, profile.sport) && profile.role !== '🎯 Игрок') return false;
  }

  return true;
}

export function countPartnersByLocation(
  users: Record<string, UserProfile>,
  opts: {
    sport?: SportType;
    country?: string;
    city?: string;
    excludeUserId?: number;
    bannedIds?: Set<number>;
  },
): number {
  let count = 0;
  for (const profile of Object.values(users)) {
    if (matchesPartnerBase(profile, opts)) count++;
  }
  return count;
}

export function countPartnersByField(
  users: Record<string, UserProfile>,
  field: 'country' | 'city',
  opts: {
    sport?: SportType;
    country?: string;
    excludeUserId?: number;
    bannedIds?: Set<number>;
  },
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const profile of Object.values(users)) {
    if (!matchesPartnerBase(profile, opts)) continue;
    const value = profile[field];
    if (!value) continue;
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

export function sortCountriesByCount(counts: Record<string, number>): string[] {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const russia = entries.find(([c]) => c.includes('🇷🇺'));
  const rest = entries.filter(([c]) => !c.includes('🇷🇺'));
  return russia ? [russia[0], ...rest.map(([c]) => c)] : rest.map(([c]) => c);
}

export function getTopLocations(
  counts: Record<string, number>,
  limit: number,
  exclude: string[] = [],
): [string, number][] {
  return Object.entries(counts)
    .filter(([loc]) => !exclude.includes(loc))
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
}

export function sumCounts(entries: [string, number][]): number {
  return entries.reduce((sum, [, c]) => sum + c, 0);
}

const COACH_ROLE = '👨‍🏫 Тренер';

export function matchesCoachBase(
  profile: UserProfile,
  opts: {
    sport?: SportType;
    country?: string;
    city?: string;
    priceMin?: number;
    priceMax?: number;
    excludeUserId?: number;
    bannedIds?: Set<number>;
  },
): boolean {
  if (profile.role !== COACH_ROLE) return false;
  if (!profile.show_in_search) return false;
  if (opts.excludeUserId && profile.max_user_id === opts.excludeUserId) return false;
  if (opts.bannedIds?.has(profile.max_user_id)) return false;
  if (opts.sport && profile.sport !== opts.sport) return false;
  if (opts.country && profile.country !== opts.country) return false;
  if (opts.city && profile.city !== opts.city) return false;

  if (opts.priceMin != null && opts.priceMax != null) {
    const price = profile.price;
    if (typeof price !== 'number' || price < opts.priceMin || price > opts.priceMax) return false;
  }

  return true;
}

export function countCoachesByLocation(
  users: Record<string, UserProfile>,
  opts: Parameters<typeof matchesCoachBase>[1],
): number {
  let count = 0;
  for (const profile of Object.values(users)) {
    if (matchesCoachBase(profile, opts)) count++;
  }
  return count;
}

export function countCoachesByField(
  users: Record<string, UserProfile>,
  field: 'country' | 'city',
  opts: Parameters<typeof matchesCoachBase>[1],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const profile of Object.values(users)) {
    if (!matchesCoachBase(profile, opts)) continue;
    const value = profile[field];
    if (!value) continue;
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

const PLAYER_ROLE = '🎯 Игрок';

export function matchesPlayerBase(
  profile: UserProfile,
  opts: {
    sport?: SportType;
    country?: string;
    city?: string;
    excludeUserId?: number;
    bannedIds?: Set<number>;
  },
): boolean {
  if (profile.role !== PLAYER_ROLE) return false;
  return matchesPartnerBase(profile, opts);
}

export function countPlayersByLocation(
  users: Record<string, UserProfile>,
  opts: Parameters<typeof matchesPlayerBase>[1],
): number {
  let count = 0;
  for (const profile of Object.values(users)) {
    if (matchesPlayerBase(profile, opts)) count++;
  }
  return count;
}

export function countPlayersByField(
  users: Record<string, UserProfile>,
  field: 'country' | 'city',
  opts: Parameters<typeof matchesPlayerBase>[1],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const profile of Object.values(users)) {
    if (!matchesPlayerBase(profile, opts)) continue;
    const value = profile[field];
    if (!value) continue;
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}
