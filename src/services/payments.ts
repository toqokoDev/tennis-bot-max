import crypto from 'crypto';
import axios from 'axios';
import { env } from '../config/env.js';
import { logger } from '../logger.js';

export interface PaymentResult {
  paymentId: string;
  paymentUrl: string;
}

function tinkoffToken(params: Record<string, unknown>): string {
  const flat: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '' && (typeof v === 'string' || typeof v === 'number')) {
      flat[k] = v;
    }
  }
  flat.Password = env.TINKOFF_PASSWORD;
  const concat = Object.keys(flat).sort().map((k) => flat[k]).join('');
  return crypto.createHash('sha256').update(concat).digest('hex');
}

export async function generateTinkoffPaymentLink(params: {
  amount: number;
  orderId: string;
  description: string;
  email: string;
}): Promise<PaymentResult | null> {
  if (!env.TINKOFF_TERMINAL_KEY || !env.TINKOFF_PASSWORD) {
    logger.warn('Tinkoff credentials not configured');
    return null;
  }
  const amountKopecks = params.amount * 100;
  const body: Record<string, unknown> = {
    TerminalKey: env.TINKOFF_TERMINAL_KEY,
    Amount: amountKopecks,
    OrderId: params.orderId,
    Description: params.description,
    Receipt: {
      Email: params.email,
      Taxation: 'usn_income',
      Items: [{
        Name: params.description.slice(0, 128),
        Price: amountKopecks,
        Quantity: 1,
        Amount: amountKopecks,
        Tax: 'none',
        PaymentMethod: 'full_payment',
        PaymentObject: 'service',
      }],
    },
  };
  body.Token = tinkoffToken(body);
  try {
    const res = await axios.post('https://securepay.tinkoff.ru/v2/Init', body);
    if (res.data.Success) {
      return { paymentId: res.data.PaymentId, paymentUrl: res.data.PaymentURL };
    }
    logger.warn('Tinkoff init failed', {
      errorCode: res.data.ErrorCode,
      tinkoffMessage: res.data.Message,
      details: res.data.Details,
    });
  } catch (err) {
    logger.error('Tinkoff error', err);
  }
  return null;
}

export async function checkTinkoffPaymentStatus(paymentId: string): Promise<'pending' | 'succeeded' | 'failed'> {
  if (!env.TINKOFF_TERMINAL_KEY) return 'failed';
  const body: Record<string, string | number> = {
    TerminalKey: env.TINKOFF_TERMINAL_KEY,
    PaymentId: paymentId,
  };
  body.Token = tinkoffToken(body);
  try {
    const res = await axios.post('https://securepay.tinkoff.ru/v2/GetState', body);
    if (res.data.Status === 'CONFIRMED') return 'succeeded';
    if (['REJECTED', 'CANCELED', 'DEADLINE_EXPIRED'].includes(res.data.Status)) return 'failed';
    return 'pending';
  } catch {
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
      paymentId: res.data.id,
      paymentUrl: res.data.confirmation.confirmation_url,
    };
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.data) {
      logger.error('YooKassa error', err.response.data);
    } else {
      logger.error('YooKassa error', err);
    }
    return null;
  }
}

export async function createSubscriptionPayment(params: {
  userId: number;
  email: string;
}): Promise<PaymentResult | null> {
  const orderId = `sub_${params.userId}_${Date.now()}`;
  const base = {
    amount: env.SUBSCRIPTION_PRICE,
    orderId,
    description: 'PRO подписка Tennis-Play 1 месяц',
    email: params.email,
  };
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
  };
  return (await generateTinkoffPaymentLink(base)) ?? generateYooKassaPaymentLink(base);
}
