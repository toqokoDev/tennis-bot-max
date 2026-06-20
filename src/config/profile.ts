import type { SportCategory, SportType } from '../types/models.js';

export const SPORTS: SportType[] = [
  '🎾Большой теннис',
  '🏓Настольный теннис',
  '🏸Бадминтон',
  '🏖️Пляжный теннис',
  '🎾Падл-теннис',
  '🥎Сквош',
  '🏆Пиклбол',
  '⛳Гольф',
  '🏃‍♂️‍➡️Бег',
  '🏋️‍♀️Фитнес',
  '🚴Вело',
  '☕️Бизнес-завтрак',
  '🍻По пиву',
  '🍒Знакомства',
];

export const SPORT_CATEGORIES: Record<SportType, SportCategory> = {
  '🎾Большой теннис': 'court_sport',
  '🏓Настольный теннис': 'court_sport',
  '🏸Бадминтон': 'court_sport',
  '🏖️Пляжный теннис': 'court_sport',
  '🎾Падл-теннис': 'court_sport',
  '🥎Сквош': 'court_sport',
  '🏆Пиклбол': 'court_sport',
  '⛳Гольф': 'outdoor_sport',
  '🏃‍♂️‍➡️Бег': 'outdoor_sport',
  '🏋️‍♀️Фитнес': 'outdoor_sport',
  '🚴Вело': 'outdoor_sport',
  '☕️Бизнес-завтрак': 'meeting',
  '🍻По пиву': 'meeting',
  '🍒Знакомства': 'dating',
};

export const NTRP_LEVELS = [
  '1.0', '1.5', '2.0', '2.5', '3.0', '3.5', '4.0', '4.5', '5.0', '5.5', '6.0', '6.5', '7.0',
];

export const NTRP_RATING_POINTS: Record<string, number> = {
  '1.0': 500,
  '1.5': 700,
  '2.0': 900,
  '2.5': 1100,
  '3.0': 1200,
  '3.5': 1400,
  '4.0': 1600,
  '4.5': 1800,
  '5.0': 2000,
  '5.5': 2200,
  '6.0': 2400,
  '6.5': 2600,
  '7.0': 2800,
};

export interface LevelInfo {
  desc: string;
  points: number;
}

const TENNIS_LEVEL_DESCRIPTIONS: Record<string, string> = {
  '1.0': 'Теннисист делает первые шаги',
  '1.5': 'Игрок обладает небольшим опытом, совершенствует стабильность ударов в игре',
  '2.0':
    'У игрока заметны недостатки при выполнении основных ударов. Имеет укороченный замах, не может выбирать направление удара. Часто теннисист такого уровня практически не применяет бэкхенд, неправильно держит в руке ракетку. Как правило, у сетки играет крайне неохотно',
  '2.5':
    'Игрок пытается предвидеть направление полета мяча, но чувство корта еще развито плохо. Кроме того, имеются некоторые проблемы с хватом ракетки, подходом к мячу, предпочитает забегать под форхенд. По-прежнему испытывает трудности при игре у сетки. Может поддерживать игру в низком темпе с партнерами своего уровня',
  '3.0':
    'Теннисист уже хорошо отбивает средние по темпу мячи, но не всегда может контролировать силу, направление и глубину своих ударов. Лучше всего удаются форхенды. Пытается усиливать подачу, что приводит к ошибкам при ее выполнении. Вторая подача, как правило, значительно слабее первой. У сетки испытывает трудности с низкими обводящими ударами. Умеет неплохо исполнять простые и средней сложности свечи',
  '3.5':
    'Теннисист может контролировать направление ударов средней сложности, хотя ему немного недостает контроля глубины и разнообразия, улучшается видение и чувство корта. Игрок умеет выполнять несильные направленные удары слева, но мощные удары и высокие отскоки еще требуют доработки. При подаче наблюдается достаточная сила и контроль. Играет более активно у сетки, достает некоторые обводящие удары. Стабильно выполняет смэш на легких мячах',
  '4.0':
    'Игрок может выполнять разнообразные удары, умеет контролировать глубину и направление удара, как справа, так и слева. Имеет в своем арсенале свечу, смэш, удары с лета и мощные выбивающие удары. Первую подачу выполняет сильно, иногда в ущерб точности. Имеет опыт использования командной тактики при игре в паре',
  '4.5':
    'Очень разнообразные удары по мячу, эффективно использует силу и вращение мяча. Мощно атакует слева, при этом ошибается только под прессингом. Игрок грамотно использует силу и подкрутку при ударах, умеет управлять темпом игры, хорошо работает ногами, контролирует глубину своих ударов и способен менять тактику в игре в зависимости от соперника. Теннисист обладает сильной и точной первой подачей, стабильно выполняет вторую, способен атаковать возле сетки',
  '5.0':
    "Игрок прекрасно чувствует мяч и часто может выполнять особенные удары, на которых строится игра. Спортсмен способен выигрывать очки, 'убивать' мячи с лета, укороченными мячами может вынудить противника совершать ошибки, успешно применяет свечи, смэши, удары с полулета, а вторую подачу выполняет глубоко и с сильным верхним вращением",
  '5.5':
    'Главным оружием теннисиста в игре являются мощные удары и стабильность. В зависимости от ситуации спортсмен способен изменить стратегию и технику игры, может выполнять надежные удары в сложных моментах',
  '6.0':
    'Теннисист такого уровня обладает хорошей квалификацией и не нуждается в классификации NTRP. Обычно спортсмены с рейтингом 6.0 участвуют в национальных соревнованиях среди юниоров и имеют национальный рейтинг',
  '6.5':
    'Теннисист уровня 6.5 по мастерству игры близок к 7.0 и обладает опытом участия в играх-сателлитах',
  '7.0':
    'Спортсмен мирового класса, принимающий участие в различных турнирах по теннису международного уровня. Основным источником доходов для игрока высшего уровня служат денежные призы, разыгрываемые на соревнованиях',
};

export function getTennisLevels(): Record<string, LevelInfo> {
  const result: Record<string, LevelInfo> = {};
  for (const level of NTRP_LEVELS) {
    result[level] = {
      desc: TENNIS_LEVEL_DESCRIPTIONS[level] ?? '',
      points: NTRP_RATING_POINTS[level] ?? 1200,
    };
  }
  return result;
}

export const DATING_ADDITIONAL_FIELDS = [
  'Работа / Профессия',
  'Образование: Вуз или уровень образования',
  'Рост',
  'Зодиак, Знак зодиака',
  'Вредные привычки: Отношение к курению, алкоголю',
];

export const COUNTRIES: Record<string, string[]> = {
  '🇷🇺 Россия': ['Москва', 'Санкт-Петербург', 'Новосибирск', 'Краснодар', 'Екатеринбург'],
  '🇧🇾 Беларусь': ['Минск', 'Гомель', 'Брест'],
  '🇰🇿 Казахстан': ['Алматы', 'Астана', 'Шымкент'],
  '🇬🇪 Грузия': ['Тбилиси', 'Батуми'],
  '🇦🇲 Армения': ['Ереван'],
  '🇺🇿 Узбекистан': ['Ташкент', 'Самарканд'],
};

export const OTHER_COUNTRY = '__other__';
export const OTHER_CITY = '__other__';

export const MOSCOW_DISTRICTS = [
  'ВАО', 'ЗАО', 'ЗелАО', 'САО', 'СВАО', 'СЗАО', 'ЦАО', 'ЮАО', 'ЮВАО', 'ЮЗАО',
];

export const TOURNAMENT_MOSCOW_DISTRICTS = ['Север', 'Юг', 'Запад', 'Восток', 'Центр'];

export const GAME_TYPES = ['Одиночная', 'Парная', 'Микст', 'Тренировка'];

export const PAYMENT_TYPES = [
  '💰 Пополам',
  '💳 Я оплачиваю',
  '💵 Соперник оплачивает',
  '🎾 Проигравший оплачивает',
];

export const ROLES = ['🎯 Игрок', '👨‍🏫 Тренер'] as const;

export const COACH_PRICE_RANGES = [
  { min: 0, max: 1000, label: 'до 1000 ₽' },
  { min: 1000, max: 2000, label: '1000–2000 ₽' },
  { min: 2000, max: 3000, label: '2000–3000 ₽' },
  { min: 3000, max: 5000, label: '3000–5000 ₽' },
  { min: 5000, max: 10000, label: '5000–10000 ₽' },
  { min: 10000, max: 10000000, label: 'от 10000 ₽' },
] as const;
export const GENDERS = ['Мужской', 'Женский'] as const;

export const DATING_GOALS = [
  { key: 'serious', ru: '💍 Серьёзные отношения', en: '💍 Serious relationship' },
  { key: 'friendship', ru: '🤝 Дружба', en: '🤝 Friendship' },
  { key: 'sport', ru: '🎾 Спорт вместе', en: '🎾 Sport together' },
  { key: 'walk', ru: '🚶 Прогулки', en: '🚶 Walks' },
];

export const DATING_INTERESTS = [
  { key: 'tennis', ru: '🎾 Теннис', en: '🎾 Tennis' },
  { key: 'travel', ru: '✈️ Путешествия', en: '✈️ Travel' },
  { key: 'music', ru: '🎵 Музыка', en: '🎵 Music' },
  { key: 'cinema', ru: '🎬 Кино', en: '🎬 Cinema' },
  { key: 'food', ru: '🍽 Еда', en: '🍽 Food' },
];

export const MEETING_TIMES = ['Утро', 'Обед', 'Вечер', 'Выходные'];

export const SPORT_CHANNEL_IDS: Partial<Record<SportType, string[]>> = {};

export function getSportCategory(sport: SportType): SportCategory {
  return SPORT_CATEGORIES[sport];
}

export function hasVacation(sport: SportType): boolean {
  const cat = getSportCategory(sport);
  return cat === 'court_sport';
}

export function hasRole(sport: SportType): boolean {
  return getSportCategory(sport) === 'court_sport';
}

export function hasCourtPayment(sport: SportType): boolean {
  return getSportCategory(sport) === 'court_sport';
}

export interface SportFieldConfig {
  hasLevel: boolean;
  levelType: 'tennis' | 'table_tennis_rating';
  hasRole: boolean;
  hasPayment: boolean;
  hasAboutMe: boolean;
  hasMeetingTime: boolean;
  hasDatingGoals: boolean;
  hasDatingInterests: boolean;
  hasDatingAdditional: boolean;
  aboutMeText?: string;
  meetingTimeText?: string;
}

const COURT_ABOUT_ME =
  '💬 О себе: Укажите сколько лет вы уже играете и как часто в среднем в неделю. (или /skip для пропуска)';

const COURT_SPORT_CONFIG: SportFieldConfig = {
  hasLevel: true,
  levelType: 'tennis',
  hasRole: true,
  hasPayment: true,
  hasAboutMe: true,
  hasMeetingTime: false,
  hasDatingGoals: false,
  hasDatingInterests: false,
  hasDatingAdditional: false,
  aboutMeText: COURT_ABOUT_ME,
};

const SPORT_FIELD_CONFIG: Record<SportType, SportFieldConfig> = {
  '🎾Большой теннис': {
    ...COURT_SPORT_CONFIG,
    aboutMeText: '💬 О себе: (или /skip для пропуска)',
  },
  '🏓Настольный теннис': {
    ...COURT_SPORT_CONFIG,
    levelType: 'table_tennis_rating',
  },
  '🏸Бадминтон': { ...COURT_SPORT_CONFIG },
  '🏖️Пляжный теннис': { ...COURT_SPORT_CONFIG },
  '🎾Падл-теннис': { ...COURT_SPORT_CONFIG },
  '🥎Сквош': { ...COURT_SPORT_CONFIG },
  '🏆Пиклбол': { ...COURT_SPORT_CONFIG },
  '⛳Гольф': {
    hasLevel: false,
    levelType: 'tennis',
    hasRole: false,
    hasPayment: false,
    hasAboutMe: true,
    hasMeetingTime: false,
    hasDatingGoals: false,
    hasDatingInterests: false,
    hasDatingAdditional: false,
    aboutMeText:
      '💬 О себе: Укажите сколько лет вы уже играете в гольф и как часто в среднем в неделю. (или /skip для пропуска)',
  },
  '🏃‍♂️‍➡️Бег': {
    hasLevel: false,
    levelType: 'tennis',
    hasRole: false,
    hasPayment: false,
    hasAboutMe: true,
    hasMeetingTime: false,
    hasDatingGoals: false,
    hasDatingInterests: false,
    hasDatingAdditional: false,
    aboutMeText:
      '💬 О себе: Укажите сколько лет вы уже занимаетесь бегом и как часто в среднем в неделю. (или /skip для пропуска)',
  },
  '🏋️‍♀️Фитнес': {
    hasLevel: false,
    levelType: 'tennis',
    hasRole: false,
    hasPayment: false,
    hasAboutMe: true,
    hasMeetingTime: false,
    hasDatingGoals: false,
    hasDatingInterests: false,
    hasDatingAdditional: false,
    aboutMeText:
      '💬 О себе: Укажите сколько лет вы уже занимаетесь фитнесом и как часто в среднем в неделю. (или /skip для пропуска)',
  },
  '🚴Вело': {
    hasLevel: false,
    levelType: 'tennis',
    hasRole: false,
    hasPayment: false,
    hasAboutMe: true,
    hasMeetingTime: false,
    hasDatingGoals: false,
    hasDatingInterests: false,
    hasDatingAdditional: false,
    aboutMeText:
      '💬 О себе: Укажите сколько лет вы уже занимаетесь велоспортом или просто катаетесь на велосипеде и как часто в среднем в неделю. (или /skip для пропуска)',
  },
  '☕️Бизнес-завтрак': {
    hasLevel: false,
    levelType: 'tennis',
    hasRole: false,
    hasPayment: false,
    hasAboutMe: false,
    hasMeetingTime: true,
    hasDatingGoals: false,
    hasDatingInterests: false,
    hasDatingAdditional: false,
    meetingTimeText:
      'Напишите место, конкретный день и время или дни недели и временные промежутки, когда вам удобно встретиться.',
  },
  '🍻По пиву': {
    hasLevel: false,
    levelType: 'tennis',
    hasRole: false,
    hasPayment: false,
    hasAboutMe: false,
    hasMeetingTime: true,
    hasDatingGoals: false,
    hasDatingInterests: false,
    hasDatingAdditional: false,
    meetingTimeText:
      'Напишите место, конкретный день и время или дни недели и временные промежутки, когда вам удобно встретиться.',
  },
  '🍒Знакомства': {
    hasLevel: false,
    levelType: 'tennis',
    hasRole: false,
    hasPayment: false,
    hasAboutMe: true,
    hasMeetingTime: false,
    hasDatingGoals: true,
    hasDatingInterests: true,
    hasDatingAdditional: true,
    aboutMeText: '💬 О себе: (или /skip для пропуска)',
  },
};

export function getSportFieldConfig(sport: SportType): SportFieldConfig {
  return SPORT_FIELD_CONFIG[sport] ?? SPORT_FIELD_CONFIG['🎾Большой теннис'];
}

export function getLevelsForSport(sport: SportType): Record<string, LevelInfo> {
  const config = getSportFieldConfig(sport);
  if (config.levelType === 'table_tennis_rating') {
    return {};
  }
  return getTennisLevels();
}

export function hasAboutMe(sport: SportType): boolean {
  return getSportFieldConfig(sport).hasAboutMe;
}

export function migrateProfileData(
  oldSport: SportType,
  newSport: SportType,
  profile: import('../types/models.js').UserProfile,
): import('../types/models.js').UserProfile {
  const newConfig = getSportFieldConfig(newSport);
  const next = { ...profile, sport: newSport };

  if (newConfig.hasRole && !next.role) {
    next.role = '🎯 Игрок';
  }
  if (newConfig.hasLevel && !next.player_level) {
    next.player_level = newSport === '🏓Настольный теннис' ? '0.0' : '1.0';
    next.rating_points = 500;
  }
  if (newConfig.hasPayment && !next.default_payment) {
    next.default_payment = PAYMENT_TYPES[0];
  }
  if (newConfig.hasDatingGoals && !next.dating_goal_key && !next.dating_goal) {
    next.dating_goal = '';
  }
  if (newConfig.hasDatingInterests && !next.dating_interests_keys) {
    next.dating_interests_keys = [];
    next.dating_interests = [];
  }
  if (newConfig.hasDatingAdditional && !next.dating_additional) {
    next.dating_additional = '';
  }
  if (newConfig.hasMeetingTime && !next.meeting_time) {
    next.meeting_time = '';
  }

  void oldSport;
  return next;
}

export function calculateLevelFromPoints(ratingPoints: number, _sport: SportType): string {
  const sorted = Object.entries(NTRP_RATING_POINTS).sort((a, b) => a[1] - b[1]);
  for (let i = 0; i < sorted.length; i++) {
    if (ratingPoints < sorted[i][1]) {
      return i === 0 ? sorted[0][0] : sorted[i - 1][0];
    }
  }
  return sorted[sorted.length - 1][0];
}

export function ratingPointsToLevel(points: number): string {
  let best = '3.0';
  let bestDiff = Infinity;
  for (const [level, pts] of Object.entries(NTRP_RATING_POINTS)) {
    const diff = Math.abs(pts - points);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = level;
    }
  }
  return best;
}

export function calculateAge(birthDate: string): number {
  const [d, m, y] = birthDate.split('.').map(Number);
  const birth = new Date(y, m - 1, d);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const md = today.getMonth() - birth.getMonth();
  if (md < 0 || (md === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}
