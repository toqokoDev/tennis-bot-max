import crypto from 'crypto';
import fs from 'fs';
import https from 'https';
import path from 'path';
import tls from 'tls';
import { fileURLToPath } from 'url';
import axios from 'axios';
import { env } from '../config/env.js';
import { logger } from '../logger.js';

export interface PaymentResult {
  paymentId: string;
  paymentUrl: string;
  provider: 'tinkoff' | 'yookassa';
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CERTS_DIR = path.resolve(__dirname, '../../certs');
const RUSSIAN_TRUSTED_CAS = [
  path.join(CERTS_DIR, 'russian_trusted_root_ca.pem'),
  path.join(CERTS_DIR, 'russian_trusted_sub_ca.pem'),
];

function tinkoffHttpsAgent(): https.Agent | undefined {
  try {
    const extra = RUSSIAN_TRUSTED_CAS
      .filter((p) => fs.existsSync(p))
      .map((p) => fs.readFileSync(p, 'utf8'));
    if (!extra.length) return undefined;
    // Добавляем сертификаты НУЦ к системным (как в TennisBot), не заменяем их
    const ca = [...tls.rootCertificates, ...extra];
    return new https.Agent({ ca, keepAlive: true });
  } catch (err) {
    logger.warn('Failed to load Tinkoff CA certs', err);
    return undefined;
  }
}

const tinkoffAgent = tinkoffHttpsAgent();

function logPaymentError(label: string, err: unknown): void {
  if (axios.isAxiosError(err)) {
    logger.error(label, {
      message: err.message,
      code: err.code,
      status: err.response?.status,
      data: err.response?.data,
    });
    return;
  }
  logger.error(label, {
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
}

/**
 * Tinkoff token: только скалярные поля. DATA и Receipt исключаются
 * (как в TennisBot / официальной документации).
 */
function tinkoffToken(payload: Record<string, unknown>): string {
  const dataForToken: Record<string, string> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (k === 'DATA' || k === 'Receipt' || k === 'Token') continue;
    if (v === undefined || v === null || v === '') continue;
    if (typeof v === 'object') continue;
    dataForToken[k] = String(v);
  }
  dataForToken.Password = env.TINKOFF_PASSWORD;
  const concat = Object.keys(dataForToken).sort().map((k) => dataForToken[k]).join('');
  return crypto.createHash('sha256').update(concat).digest('hex');
}

export async function generateTinkoffPaymentLink(params: {
  amount: number;
  orderId: string;
  description: string;
  email: string;
  userId?: number;
}): Promise<PaymentResult | null> {
  if (!env.TINKOFF_TERMINAL_KEY || !env.TINKOFF_PASSWORD) {
    logger.warn('Tinkoff credentials not configured');
    return null;
  }
  const amountKopecks = Math.round(params.amount * 100);
  const body: Record<string, unknown> = {
    TerminalKey: env.TINKOFF_TERMINAL_KEY,
    Amount: amountKopecks,
    OrderId: params.orderId,
    Description: params.description,
    DATA: {
      user_id: String(params.userId ?? ''),
    },
    Receipt: {
      Email: params.email,
      Taxation: 'usn_income',
      Items: [{
        Name: params.description.slice(0, 128),
        Price: amountKopecks,
        Quantity: 1.0,
        Amount: amountKopecks,
        Tax: 'none',
      }],
    },
  };
  body.Token = tinkoffToken(body);
  try {
    const res = await axios.post('https://securepay.tinkoff.ru/v2/Init', body, {
      httpsAgent: tinkoffAgent,
      timeout: 20000,
    });
    if (res.data.Success) {
      return {
        paymentId: String(res.data.PaymentId),
        paymentUrl: res.data.PaymentURL,
        provider: 'tinkoff',
      };
    }
    logger.warn('Tinkoff init failed', {
      errorCode: res.data.ErrorCode,
      tinkoffMessage: res.data.Message,
      details: res.data.Details,
    });
  } catch (err) {
    logPaymentError('Tinkoff Init error', err);
  }
  return null;
}

export async function checkTinkoffPaymentStatus(paymentId: string): Promise<'pending' | 'succeeded' | 'failed'> {
  if (!env.TINKOFF_TERMINAL_KEY || !env.TINKOFF_PASSWORD) return 'failed';
  const body: Record<string, string> = {
    TerminalKey: env.TINKOFF_TERMINAL_KEY,
    PaymentId: String(paymentId),
  };
  body.Token = tinkoffToken(body);
  try {
    const res = await axios.post('https://securepay.tinkoff.ru/v2/GetState', body, {
      httpsAgent: tinkoffAgent,
      timeout: 15000,
    });
    if (!res.data.Success) {
      logger.warn('Tinkoff GetState failed', {
        errorCode: res.data.ErrorCode,
        tinkoffMessage: res.data.Message,
        paymentId,
      });
      return 'failed';
    }
    if (res.data.Status === 'CONFIRMED') return 'succeeded';
    if (['REJECTED', 'CANCELED', 'DEADLINE_EXPIRED'].includes(res.data.Status)) return 'failed';
    return 'pending';
  } catch (err) {
    logPaymentError('Tinkoff GetState error', err);
    return 'failed';
  }
}

export async function generateYooKassaPaymentLink(params: {
  amount: number;
  orderId: string;
  description: string;
  email: string;
}): Promise<PaymentResult | null> {
  if (!env.SHOP_ID || !env.SECRET_KEY) return null;
  try {
    const auth = Buffer.from(`${env.SHOP_ID}:${env.SECRET_KEY}`).toString('base64');
    const res = await axios.post(
      'https://api.yookassa.ru/v3/payments',
      {
        amount: { value: params.amount.toFixed(2), currency: 'RUB' },
        capture: true,
        confirmation: { type: 'redirect', return_url: 'https://tennis-play.com' },
        description: params.description,
        metadata: { order_id: params.orderId },
        receipt: {
          customer: { email: params.email },
          items: [{
            description: params.description,
            quantity: 1,
            amount: { value: params.amount.toFixed(2), currency: 'RUB' },
            vat_code: 1,
            payment_mode: 'full_payment',
            payment_subject: 'service',
          }],
        },
      },
      {
        headers: {
          Authorization: `Basic ${auth}`,
          'Idempotence-Key': params.orderId,
          'Content-Type': 'application/json',
        },
      },
    );
    return {
      paymentId: String(res.data.id),
      paymentUrl: res.data.confirmation.confirmation_url,
      provider: 'yookassa',
    };
  } catch (err) {
    logPaymentError('YooKassa error', err);
    return null;
  }
}

export async function checkYooKassaPaymentStatus(paymentId: string): Promise<'pending' | 'succeeded' | 'failed'> {
  if (!env.SHOP_ID || !env.SECRET_KEY) return 'failed';
  try {
    const auth = Buffer.from(`${env.SHOP_ID}:${env.SECRET_KEY}`).toString('base64');
    const res = await axios.get(`https://api.yookassa.ru/v3/payments/${paymentId}`, {
      headers: { Authorization: `Basic ${auth}` },
      timeout: 15000,
    });
    const status = res.data?.status as string | undefined;
    if (status === 'succeeded') return 'succeeded';
    if (status === 'canceled') return 'failed';
    return 'pending';
  } catch (err) {
    logPaymentError('YooKassa status error', err);
    return 'failed';
  }
}

export async function checkPaymentStatus(
  paymentId: string,
  provider: 'tinkoff' | 'yookassa' = 'tinkoff',
): Promise<'pending' | 'succeeded' | 'failed'> {
  if (provider === 'yookassa') return checkYooKassaPaymentStatus(paymentId);
  return checkTinkoffPaymentStatus(paymentId);
}

export async function createSubscriptionPayment(params: {
  userId: number;
  email: string;
}): Promise<PaymentResult | null> {
  const orderId = `sub_${params.userId}_${Date.now()}`;
  const base = {
    amount: env.SUBSCRIPTION_PRICE,
    orderId,
    description: 'Оплата подписки для расширенного функционала',
    email: params.email,
    userId: params.userId,
  };
  // Как в TennisBot: основной провайдер — Tinkoff
  return (await generateTinkoffPaymentLink(base)) ?? generateYooKassaPaymentLink(base);
}

export async function createTournamentPayment(params: {
  userId: number;
  tournamentId: string;
  amount: number;
  email: string;
}): Promise<PaymentResult | null> {
  const orderId = `tour_${params.tournamentId}_${params.userId}_${Date.now()}`;
  const base = {
    amount: params.amount,
    orderId,
    description: `Взнос турнира ${params.tournamentId}`,
    email: params.email,
    userId: params.userId,
  };
  return (await generateTinkoffPaymentLink(base)) ?? generateYooKassaPaymentLink(base);
}
