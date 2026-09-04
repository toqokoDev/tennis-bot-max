import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

function requireEnv(name: string, fallback = ''): string {
  return process.env[name]?.trim() || fallback;
}

function parseIntEnv(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isNaN(n) ? fallback : n;
}

export const env = {
  BOT_TOKEN: requireEnv('BOT_TOKEN'),
  ADMIN_ID: parseIntEnv('ADMIN_ID', 0),
  BOT_USERNAME: requireEnv('BOT_USERNAME'),
  SUBSCRIPTION_PRICE: parseIntEnv('SUBSCRIPTION_PRICE', 300),
  TOURNAMENT_ENTRY_FEE: parseIntEnv('TOURNAMENT_ENTRY_FEE', 500),
  CHANNEL_ID: requireEnv('CHANNEL_ID'),
  TOUR_CHANNEL_ID: requireEnv('TOUR_CHANNEL_ID', requireEnv('CHANNEL_ID')),
  SHOP_ID: requireEnv('SHOP_ID'),
  SECRET_KEY: requireEnv('SECRET_KEY'),
  TINKOFF_TERMINAL_KEY: requireEnv('TINKOFF_TERMINAL_KEY'),
  TINKOFF_PASSWORD: requireEnv('TINKOFF_PASSWORD'),
  TENNIS_API_URL: requireEnv('TENNIS_API_URL', 'https://tennis-play.by/profile/api.php'),
  TENNIS_API_TOKEN: requireEnv('TENNIS_API_TOKEN'),
  EMAIL_SMTP_USERNAME: requireEnv('EMAIL_SMTP_USERNAME'),
  EMAIL_SMTP_PASSWORD: requireEnv('EMAIL_SMTP_PASSWORD'),
  EMAIL_ADMIN: requireEnv('EMAIL_ADMIN'),
  WEBHOOK_URL: requireEnv('WEBHOOK_URL'),
  PORT: parseIntEnv('PORT', 3000),
  DATA_DIR: path.resolve(requireEnv('DATA_DIR', './data')),
  LOG_LEVEL: requireEnv('LOG_LEVEL', 'info'),
};

export function isAdmin(userId: number): boolean {
  if (!env.ADMIN_ID) return false;
  return Number(userId) === Number(env.ADMIN_ID);
}

export function getDeepLink(payload: string): string {
  const username = env.BOT_USERNAME.replace(/^@/, '');
  return `https://max.ru/${username}?start=${payload}`;
}
