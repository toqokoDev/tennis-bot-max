import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { logger } from '../logger.js';

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

export async function notifySubscriptionPurchase(userId: number, until: string): Promise<void> {
  await sendAdminEmail(
    'Новая PRO подписка',
    `Пользователь ${userId} оплатил PRO до ${until}`,
  );
}
