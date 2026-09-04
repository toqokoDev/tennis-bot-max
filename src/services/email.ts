import nodemailer from 'nodemailer';
import { env, getDeepLink } from '../config/env.js';
import { logger } from '../logger.js';
import type { Tournament, UserProfile } from '../types/models.js';
import { fullName } from '../utils/gameResult.js';

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  if (!env.EMAIL_SMTP_USERNAME || !env.EMAIL_SMTP_PASSWORD) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: 'smtp.yandex.ru',
      port: 465,
      secure: true,
      auth: {
        user: env.EMAIL_SMTP_USERNAME,
        pass: env.EMAIL_SMTP_PASSWORD,
      },
    });
  }
  return transporter;
}

export async function sendAdminEmail(subject: string, text: string): Promise<void> {
  const t = getTransporter();
  if (!t || !env.EMAIL_ADMIN) return;
  try {
    await t.sendMail({
      from: env.EMAIL_SMTP_USERNAME,
      to: env.EMAIL_ADMIN,
      subject,
      text,
    });
  } catch (err) {
    logger.warn('Email send failed', err);
  }
}

function profileInfoLines(profile: UserProfile, paymentEmail?: string): string[] {
  return [
    `ID: ${profile.max_user_id}`,
    `Имя: ${fullName(profile)}`,
    profile.username ? `Username: @${profile.username}` : null,
    `Телефон: ${profile.phone || '—'}`,
    paymentEmail ? `Email (чек): ${paymentEmail}` : null,
    `Страна: ${profile.country}`,
    `Город: ${profile.city}${profile.district ? `, ${profile.district}` : ''}`,
    `Спорт: ${profile.sport}`,
    `Роль: ${profile.role}`,
    profile.player_level
      ? `Уровень: ${profile.player_level} (${profile.rating_points} очков)`
      : `Рейтинг: ${profile.rating_points}`,
    `Пол: ${profile.gender}`,
  ].filter((line): line is string => line != null);
}

export async function notifySubscriptionPurchase(
  profile: UserProfile,
  until: string,
  paymentEmail?: string,
): Promise<void> {
  const lines = [
    'Новая PRO подписка',
    '',
    ...profileInfoLines(profile, paymentEmail),
    `Подписка до: ${until}`,
    `Цена: ${env.SUBSCRIPTION_PRICE} руб.`,
    '',
    `Анкета: ${getDeepLink(`profile_${profile.max_user_id}`)}`,
  ];

  await sendAdminEmail('Новая PRO подписка', lines.join('\n'));
}

export async function notifyTournamentPayment(
  profile: UserProfile,
  tournament: Tournament,
  paymentEmail?: string,
): Promise<void> {
  const lines = [
    'Оплата взноса за турнир',
    '',
    ...profileInfoLines(profile, paymentEmail),
    '',
    `Турнир: ${tournament.name}`,
    `ID турнира: ${tournament.id}`,
    `Спорт турнира: ${tournament.sport}`,
    `Место: ${tournament.city}${tournament.district ? `, ${tournament.district}` : ''} (${tournament.country})`,
    `Категория: ${tournament.category}`,
    `Уровень: ${tournament.level}`,
    `Взнос: ${tournament.entry_fee} руб.`,
    '',
    `Анкета: ${getDeepLink(`profile_${profile.max_user_id}`)}`,
    `Турнир: ${getDeepLink(`view_tournament_${tournament.id}`)}`,
  ];

  await sendAdminEmail(`Оплата турнира: ${tournament.name}`, lines.join('\n'));
}
