import { storage } from '../storage/jsonStorage.js';
import type { UserProfile } from '../types/models.js';

export type Platform = 'telegram' | 'max';

export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('8')) {
    return `+7${digits.slice(1)}`;
  }
  if (digits.length === 10) return `+7${digits}`;
  return phone.startsWith('+') ? phone : `+${digits}`;
}

export function getUserPlatform(profile: UserProfile): Platform {
  if (profile.platform === 'telegram' || profile.platform === 'max') {
    return profile.platform;
  }
  if (profile.max_user_id && !profile.telegram_id) return 'max';
  return 'telegram';
}

export function formatPlatformLabel(profile: UserProfile): string {
  const platform = getUserPlatform(profile);
  const base = platform === 'max' ? 'MAX' : 'Telegram';
  if (profile.linked_telegram_id && profile.linked_max_user_id) {
    return `📱 Аккаунт: ${base} (связан с Telegram и MAX)`;
  }
  return `📱 Аккаунт: ${base}`;
}

export async function findUserByPhone(phone: string): Promise<{ userId: string; profile: UserProfile } | null> {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  const users = await storage.getUsers();
  for (const [userId, profile] of Object.entries(users)) {
    if (normalizePhone(profile.phone) === normalized) {
      return { userId, profile };
    }
  }
  return null;
}

export async function findUserByPlatformId(opts: {
  telegramId?: number;
  maxUserId?: number;
}): Promise<{ userId: string; profile: UserProfile } | null> {
  const users = await storage.getUsers();
  for (const [userId, profile] of Object.entries(users)) {
    if (opts.telegramId !== undefined) {
      if (profile.telegram_id === opts.telegramId || profile.linked_telegram_id === opts.telegramId) {
        return { userId, profile };
      }
    }
    if (opts.maxUserId !== undefined) {
      if (profile.max_user_id === opts.maxUserId || profile.linked_max_user_id === opts.maxUserId) {
        return { userId, profile };
      }
    }
  }
  return null;
}

function pickStats(primary: UserProfile, secondary: UserProfile): Partial<UserProfile> {
  const primaryPlayed = primary.games_played ?? 0;
  const secondaryPlayed = secondary.games_played ?? 0;
  const source = primaryPlayed >= secondaryPlayed ? primary : secondary;
  return {
    games_played: source.games_played,
    games_wins: source.games_wins,
    rating_points: source.rating_points,
    player_level: source.player_level,
    subscription: source.subscription ?? primary.subscription,
    referrals_invited: Math.max(primary.referrals_invited ?? 0, secondary.referrals_invited ?? 0),
  };
}

export async function linkAccounts(
  currentProfile: UserProfile,
  otherUserId: string,
  otherProfile: UserProfile,
): Promise<UserProfile> {
  const stats = pickStats(currentProfile, otherProfile);
  const currentPlatform = getUserPlatform(currentProfile);
  const updatedCurrent: UserProfile = { ...currentProfile, ...stats };
  const updatedOther: UserProfile = { ...otherProfile, ...stats };

  if (currentPlatform === 'telegram') {
    updatedCurrent.linked_max_user_id = otherProfile.max_user_id;
    updatedOther.linked_telegram_id = currentProfile.telegram_id;
  } else {
    updatedCurrent.linked_telegram_id = otherProfile.telegram_id;
    updatedOther.linked_max_user_id = currentProfile.max_user_id;
  }

  const users = await storage.getUsers();
  users[String(currentProfile.max_user_id)] = updatedCurrent;
  users[otherUserId] = updatedOther;
  await storage.saveUsers(users);
  return updatedCurrent;
}

export async function tryLinkByPhone(profile: UserProfile): Promise<UserProfile> {
  const found = await findUserByPhone(profile.phone);
  if (!found) return profile;
  if (found.userId === String(profile.max_user_id)) return profile;
  if (getUserPlatform(profile) === getUserPlatform(found.profile)) return profile;
  return linkAccounts(profile, found.userId, found.profile);
}
