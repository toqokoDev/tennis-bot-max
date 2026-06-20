export const TOURNAMENT_TYPES = ['Олимпийская система', 'Круговая'] as const;

export const TOURNAMENT_GENDERS = [
  'Мужчины',
  'Женщины',
  'Мужская пара',
  'Женская пара',
  'Микст',
];

export const TOURNAMENT_CATEGORIES = [
  '1 категория',
  '2 категория',
  '3 категория',
  'Мастерс',
  'Профи',
];

export const TOURNAMENT_AGE_GROUPS = ['Взрослые', 'Дети'] as const;

export const TOURNAMENT_LEVELS = [
  '1.0-2.5',
  '2.5-3.5',
  '3.5-4.5',
  '4.5-5.5',
  '5.5+',
];

export const PAYMENT_WINDOW_HOURS = 24;

export function generateTournamentName(params: {
  sport: string;
  city: string;
  level: string;
  gender?: string;
  date: string;
}): string {
  const genderSuffix = params.gender ? ` ${params.gender}` : '';
  return `${params.sport} ${params.city} ${params.level}${genderSuffix} ${params.date}`;
}
