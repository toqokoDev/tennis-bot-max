import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { env } from '../config/env.js';
import { NTRP_RATING_POINTS } from '../config/profile.js';
import { logger } from '../logger.js';
import type { GameOffer, SportType, UserProfile } from '../types/models.js';
import { storage } from '../storage/jsonStorage.js';

const DOMAIN_SPORT_MAP: Record<string, SportType> = {
  'tennis-play.com': '🎾Большой теннис',
  'tennis-play.by': '🎾Большой теннис',
  'tennis-play.kz': '🎾Большой теннис',
  padeltennis: '🎾Падл-теннис',
  tabletennis: '🏓Настольный теннис',
  tournaments: '🎾Большой теннис',
};

interface WebUserResponse {
  success?: boolean;
  user?: {
    name?: string;
    birthdate?: string;
    sex?: string;
    game_type?: string;
    role?: string;
    court?: string;
    game_level?: string;
    country_name?: string;
    city_name?: string;
    district_name?: string;
    photo_url_large?: string;
    phone?: string;
    public_offer?: Record<string, unknown>;
  };
}

export async function fetchWebUser(domain: string, webUserId: string): Promise<WebUserResponse | null> {
  try {
    const base = domain.startsWith('http') ? domain : `https://${domain}`;
    const url = `${base}/profile/api.php`;
    const res = await axios.get<WebUserResponse>(url, {
      params: {
        action: 'get_user',
        user_id: webUserId,
        token: env.TENNIS_API_TOKEN,
      },
      timeout: 15000,
    });
    return res.data;
  } catch (err) {
    logger.error('Web API fetch failed', { domain, webUserId, err });
    return null;
  }
}

async function downloadPhoto(url: string, userId: number): Promise<string | undefined> {
  try {
    const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 20000 });
    const dir = path.join(env.DATA_DIR, 'photos');
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `${userId}.jpg`);
    await fs.writeFile(filePath, Buffer.from(res.data));
    return url;
  } catch {
    return url;
  }
}

function mapSport(domain: string, gameType?: string): SportType {
  for (const [key, sport] of Object.entries(DOMAIN_SPORT_MAP)) {
    if (domain.includes(key)) return sport;
  }
  void gameType;
  return '🎾Большой теннис';
}

export async function createProfileFromWeb(
  maxUserId: number,
  domain: string,
  webUserId: string,
  username?: string,
): Promise<UserProfile | null> {
  const data = await fetchWebUser(domain, webUserId);
  if (!data?.user) return null;
  const u = data.user;
  const [firstName = '', ...rest] = (u.name ?? '').split(' ');
  const lastName = rest.join(' ') || '—';
  const level = u.game_level ?? '3.0';
  const sport = mapSport(domain, u.game_type);
  const photo = u.photo_url_large ? await downloadPhoto(u.photo_url_large, maxUserId) : undefined;

  const profile: UserProfile = {
    max_user_id: maxUserId,
    platform: 'max',
    username,
    first_name: firstName,
    last_name: lastName,
    phone: u.phone ?? '',
    birth_date: u.birthdate ?? '01.01.1990',
    country: u.country_name ?? '🇷🇺 Россия',
    city: u.city_name ?? 'Москва',
    district: u.district_name,
    role: u.role?.includes('трен') ? '👨‍🏫 Тренер' : '🎯 Игрок',
    sport,
    gender: u.sex?.toLowerCase().includes('ж') ? 'Женский' : 'Мужской',
    player_level: level,
    rating_points: NTRP_RATING_POINTS[level] ?? 1200,
    default_payment: u.court,
    show_in_search: true,
    games_played: 0,
    games_wins: 0,
    referrals_invited: 0,
    free_offers_used: 0,
    games: [],
    created_at: new Date().toISOString(),
    web_user_id: webUserId,
    web_domain: domain,
    photo_path: photo,
  };

  if (u.public_offer) {
    const offerId = await storage.nextOfferId();
    const offer = u.public_offer as Partial<GameOffer>;
    profile.games.push({
      id: offerId,
      sport,
      country: profile.country,
      city: profile.city,
      district: profile.district,
      date: String(offer.date ?? ''),
      time: String(offer.time ?? '10:00'),
      game_type: offer.game_type,
      payment_type: offer.payment_type,
      active: true,
      created_at: new Date().toISOString(),
    });
  }

  return profile;
}
