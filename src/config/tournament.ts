import type { SportType } from '../types/models.js';
import { SPORTS } from './profile.js';

export const TOURNAMENT_TYPES = ['Олимпийская система', 'Круговая'] as const;

export const TOURNAMENT_GENDERS = [
  'Мужчины',
  'Женщины',
  'Мужская пара',
  'Женская пара',
  'Микст',
] as const;

/** Кнопки формата с эмодзи, как в TennisBot */
export const TOURNAMENT_GENDER_BUTTONS: Array<{ label: string; value: string }> = [
  { label: '👤 Мужчины', value: 'Мужчины' },
  { label: '👤 Женщины', value: 'Женщины' },
  { label: '👥 Мужская пара', value: 'Мужская пара' },
  { label: '👥 Женская пара', value: 'Женская пара' },
  { label: '👥 Микст', value: 'Микст' },
];

export const TOURNAMENT_CATEGORIES = [
  '1 категория',
  '2 категория',
  '3 категория',
  'Мастерс',
  'Профи',
  'Без категории',
] as const;

export const CATEGORY_LEVELS: Record<string, string> = {
  '3 категория': '1.5-2.5',
  '2 категория': '2.5-3.5',
  '1 категория': '3.5-4.5',
  'Мастерс': '4.5-5.5',
  'Профи': '5.5-7.0',
  'Без категории': 'Без уровня',
};

export const TOURNAMENT_AGE_GROUPS = ['Взрослые', 'Дети'] as const;

export const TOURNAMENT_DURATIONS = ['Многодневные', 'Однодневные', 'Выездной'] as const;

export const TOURNAMENT_LEVELS = [
  '1.0-2.5',
  '2.5-3.5',
  '3.5-4.5',
  '4.5-5.5',
  '5.5+',
];

/** Районы Москвы для турниров (как в TennisBot — без «Центр») */
export const DISTRICTS_MOSCOW = ['Север', 'Юг', 'Запад', 'Восток'] as const;

export const MIN_PARTICIPANTS: Record<string, number> = {
  'Олимпийская система': 4,
  'Круговая': 4,
};

const EXCLUDED_TOURNAMENT_SPORTS = new Set<string>([
  '🍻По пиву',
  '🍒Знакомства',
  '☕️Бизнес-завтрак',
]);

/** Виды спорта, доступные для турниров */
export const TOURNAMENT_SPORTS: SportType[] = SPORTS.filter(
  (s) => !EXCLUDED_TOURNAMENT_SPORTS.has(s),
);

/** Раскладка кнопок спорта как в TennisBot create_sport_keyboard */
export const TOURNAMENT_SPORT_ROWS: SportType[][] = [
  ['🎾Большой теннис', '🏓Настольный теннис'],
  ['🏸Бадминтон', '🏖️Пляжный теннис'],
  ['🎾Падл-теннис', '🥎Сквош'],
  ['🏆Пиклбол', '⛳Гольф', '🏃‍♂️‍➡️Бег'],
  ['🏋️‍♀️Фитнес', '🚴Вело'],
].map((row) => row.filter((s) => !EXCLUDED_TOURNAMENT_SPORTS.has(s)) as SportType[]);

export const PAYMENT_WINDOW_HOURS = 24;

function removeCountryFlag(country: string): string {
  return country.replace(/^[^\p{L}\p{N}]+/u, '').trim() || country;
}

function genderNameSuffix(gender?: string): string {
  switch (gender) {
    case 'Мужчины':
      return 'Муж';
    case 'Женщины':
      return 'Жен';
    case 'Мужская пара':
      return 'Муж Пара';
    case 'Женская пара':
      return 'Пара';
    case 'Микст':
      return 'Микст';
    default:
      return '';
  }
}

export function generateTournamentName(params: {
  sport?: string;
  city: string;
  country: string;
  district?: string;
  level?: string;
  gender?: string;
  number: number;
}): string {
  const level = params.level || 'Не указан';
  const location =
    params.city === 'Москва' && params.district
      ? params.district
      : `${params.city}, ${removeCountryFlag(params.country)}`;
  const base = `Турнир уровень ${level} ${location} №${params.number}`;
  const tail = genderNameSuffix(params.gender);
  return tail ? `${base} ${tail}` : base;
}

export function categoryFromLevel(levelText?: string): string | null {
  try {
    if (!levelText) return null;
    const t = String(levelText).replace(',', '.').trim();
    const userLevel = t.includes('-')
      ? (() => {
        const [a, b] = t.split('-', 2);
        return (Number(a) + Number(b)) / 2;
      })()
      : Number(t);
    if (Number.isNaN(userLevel)) return null;
    for (const [cat, rng] of Object.entries(CATEGORY_LEVELS)) {
      if (!rng.includes('-')) continue;
      const [low, high] = rng.split('-', 2).map((x) => Number(x.trim()));
      if (low <= userLevel && userLevel <= high) return cat;
    }
    return null;
  } catch {
    return null;
  }
}

export function isLevelMatch(userLevel?: string | null, tournamentLevel?: string | null): boolean {
  try {
    if (!userLevel || !tournamentLevel) return true;
    const userVal = Number(String(userLevel).replace(',', '.'));
    if (Number.isNaN(userVal)) return true;
    if (tournamentLevel.includes('-')) {
      const [low, high] = tournamentLevel.replace(',', '.').split('-').map((x) => Number(x.trim()));
      return low <= userVal && userVal <= high;
    }
    return Math.abs(Number(tournamentLevel.replace(',', '.')) - userVal) < 1e-6;
  } catch {
    return true;
  }
}

export function autoCategoryAndAge(profile: {
  player_level?: string;
  rating_points?: number;
  birth_date?: string;
}): { category: string; ageGroup: 'Взрослые' | 'Дети'; playerLevel: string; levelRange: string | null } {
  const playerLevel = String(profile.player_level || '');
  let ratingPoints = profile.rating_points;
  if (ratingPoints == null) {
    const map: Record<string, number> = {
      '0.0': 0, '0.5': 300, '1.0': 500, '1.5': 700,
      '2.0': 900, '2.5': 1100, '3.0': 1200, '3.5': 1400,
      '4.0': 1600, '4.5': 1800, '5.0': 2000, '5.5': 2200,
      '6.0': 2400, '6.5': 2600, '7.0': 2800,
    };
    ratingPoints = map[playerLevel] ?? 0;
  }

  let levelRange: string | null = null;
  try {
    const playerLevelVal = Number(String(playerLevel).replace(',', '.'));
    if (!Number.isNaN(playerLevelVal)) {
      for (const rng of Object.values(CATEGORY_LEVELS)) {
        if (!rng.includes('-')) continue;
        const [low, high] = rng.split('-', 2).map((x) => Number(x.trim()));
        if (low <= playerLevelVal && playerLevelVal <= high) {
          levelRange = `${low}-${high}`;
          break;
        }
      }
    }
  } catch {
    levelRange = null;
  }

  let category = categoryFromLevel(playerLevel);
  if (!category) {
    if (ratingPoints >= 2600) category = 'Профи';
    else if (ratingPoints >= 2400) category = 'Мастерс';
    else if (ratingPoints >= 1600) category = '1 категория';
    else if (ratingPoints >= 1100) category = '2 категория';
    else category = '3 категория';
  }

  let ageGroup: 'Взрослые' | 'Дети' = 'Взрослые';
  try {
    const birth = profile.birth_date;
    if (birth) {
      const parts = birth.split('.');
      if (parts.length >= 2) {
        const day = Number(parts[0]);
        const month = Number(parts[1]);
        const year = parts.length >= 3 ? Number(parts[2]) : new Date().getFullYear() - 18;
        const today = new Date();
        let age = today.getFullYear() - year;
        if (today.getMonth() + 1 < month || (today.getMonth() + 1 === month && today.getDate() < day)) {
          age -= 1;
        }
        ageGroup = age < 18 ? 'Дети' : 'Взрослые';
      }
    }
  } catch {
    ageGroup = 'Взрослые';
  }

  return { category, ageGroup, playerLevel, levelRange };
}
