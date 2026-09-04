import { TXT, fmt } from '../texts.js';
import { Keyboard } from '@maxhub/max-bot-api';
import type { AppContext } from '../context.js';
import { getMessageText, getCtxUserId } from '../context.js';
import { env } from '../config/env.js';
import { storage } from '../storage/jsonStorage.js';
import { clearState, getState, getStateData, setState } from '../middleware/session.js';
import { PaymentStates } from '../types/states.js';
import { showCurrentMessage, editText, backButton } from '../utils/bot.js';
import { isValidEmail, formatDateISO, addDays, isSubscriptionActive } from '../utils/validation.js';
import { createSubscriptionPayment, checkPaymentStatus } from '../services/payments.js';
import { notifySubscriptionPurchase } from '../services/email.js';
import { requireRegistered } from './registration.js';
import type { UserProfile } from '../types/models.js';
import { logger } from '../logger.js';

type PayData = {
  email?: string;
  payment_id?: string;
  payment_url?: string;
  provider?: 'tinkoff' | 'yookassa';
};

type PendingPayment = {
  payment_id: string;
  email: string;
  payment_link?: string;
  provider?: 'tinkoff' | 'yookassa';
  created_at: string;
};

function paymentKeyboard(
  ...rows: Array<Array<ReturnType<typeof Keyboard.button.callback> | ReturnType<typeof Keyboard.button.link>>>
): ReturnType<typeof Keyboard.inlineKeyboard> {
  return Keyboard.inlineKeyboard([
    ...rows,
    [Keyboard.button.callback(TXT.common.main_menu, 'main_menu')],
  ]);
}

async function savePendingPayment(
  user: UserProfile,
  pending: PendingPayment,
): Promise<void> {
  user.pending_payment = pending;
  await storage.saveUser(user);
}

async function clearPendingPayment(user: UserProfile): Promise<void> {
  if (!user.pending_payment) return;
  delete user.pending_payment;
  await storage.saveUser(user);
}

function getPendingFromUser(user: UserProfile | null | undefined): PendingPayment | undefined {
  const pending = user?.pending_payment;
  if (!pending?.payment_id) return undefined;
  return pending;
}

export async function showPaymentsMenu(ctx: AppContext): Promise<void> {
  const user = await requireRegistered(ctx);
  if (!user) return;

  if (user.subscription?.active && isSubscriptionActive(user.subscription.until)) {
    await showCurrentMessage(ctx, fmt(TXT.payments.already_active, { until: user.subscription.until }), {
      attachments: [backButton()],
    });
    return;
  }

  let statusText: string = TXT.payments.expired;
  if (user.subscription?.active && isSubscriptionActive(user.subscription.until)) {
    statusText = fmt(TXT.payments.active_until, { until: user.subscription.until });
  }

  const message = [
    statusText,
    '',
    TXT.payments.benefits_title,
    '',
    TXT.payments.benefits_items,
    '',
    fmt(TXT.payments.price, { price: env.SUBSCRIPTION_PRICE }),
    '',
    fmt(TXT.payments.referral, { invite_section: TXT.menu.invite }),
    '',
    TXT.payments.email_note,
  ].join('\n');

  await showCurrentMessage(ctx, message, {
    attachments: [paymentKeyboard(
      [Keyboard.button.callback(TXT.payments.buy, 'buy_subscription')],
      [Keyboard.button.callback(TXT.payments.check, 'check_payment')],
    )],
  });
}

export async function handlePaymentMessage(ctx: AppContext): Promise<boolean> {
  const state = getState(ctx);
  if (state !== PaymentStates.WAITING_EMAIL) return false;
  const text = getMessageText(ctx);
  if (!text || !isValidEmail(text)) {
    await editText(ctx, TXT.payments.email_invalid, { attachments: [backButton()] });
    return true;
  }

  const user = await requireRegistered(ctx);
  if (!user) return true;

  const email = text.trim();
  let payment;
  try {
    payment = await createSubscriptionPayment({ userId: user.max_user_id, email });
  } catch (err) {
    logger.error('createSubscriptionPayment failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    payment = null;
  }
  if (!payment) {
    await clearState(ctx);
    await ctx.reply(TXT.payments.create_error, { attachments: [backButton()] });
    return true;
  }

  const data: PayData = {
    email,
    payment_id: payment.paymentId,
    payment_url: payment.paymentUrl,
    provider: payment.provider,
  };
  await setState(ctx, PaymentStates.CONFIRM_PAYMENT, data);
  await savePendingPayment(user, {
    payment_id: payment.paymentId,
    email,
    payment_link: payment.paymentUrl,
    provider: payment.provider,
    created_at: new Date().toISOString(),
  });

  await ctx.reply(fmt(TXT.payments.pay_link, { link: payment.paymentUrl, email }), {
    format: 'html',
    attachments: [paymentKeyboard(
      [Keyboard.button.link(TXT.payments.continue_pay, payment.paymentUrl)],
      [Keyboard.button.callback(TXT.payments.confirm_pay, 'confirm_payment')],
      [Keyboard.button.callback(TXT.payments.check, 'check_payment')],
    )],
  });
  return true;
}

async function resolvePaymentAndActivate(ctx: AppContext): Promise<void> {
  const userId = getCtxUserId(ctx);
  const sessionData = getStateData<PayData>(ctx);
  const user = await storage.getUser(userId) ?? null;
  const pending = getPendingFromUser(user);

  const paymentId = sessionData.payment_id || pending?.payment_id;
  const email = sessionData.email || pending?.email || 'не указан';
  const provider = sessionData.provider || pending?.provider || 'tinkoff';

  if (!paymentId) {
    await ctx.reply(TXT.payments.no_pending, { attachments: [backButton()] });
    return;
  }

  if (user?.subscription?.active && isSubscriptionActive(user.subscription.until)) {
    if (user) await clearPendingPayment(user);
    await clearState(ctx);
    await ctx.reply(fmt(TXT.payments.already_active, { until: user!.subscription!.until }), {
      attachments: [backButton()],
    });
    return;
  }

  const status = await checkPaymentStatus(paymentId, provider);
  if (status !== 'succeeded') {
    const payUrl = pending?.payment_link || sessionData.payment_url;
    const rows: Array<Array<ReturnType<typeof Keyboard.button.callback> | ReturnType<typeof Keyboard.button.link>>> = [];
    if (payUrl) {
      rows.push([Keyboard.button.link(TXT.payments.continue_pay, payUrl)]);
    }
    rows.push([Keyboard.button.callback(TXT.payments.confirm_pay, 'confirm_payment')]);
    rows.push([Keyboard.button.callback(TXT.payments.check, 'check_payment')]);
    await ctx.reply(TXT.payments.not_confirmed, {
      attachments: [paymentKeyboard(...rows)],
    });
    return;
  }

  const profile = user ?? await requireRegistered(ctx);
  if (!profile) return;

  const until = formatDateISO(addDays(new Date(), 30));
  profile.subscription = {
    active: true,
    until,
    ...(profile.subscription?.expired !== undefined ? { expired: false } : {}),
  };
  delete profile.pending_payment;
  await storage.saveUser(profile);
  await notifySubscriptionPurchase(profile, until, email !== 'не указан' ? email : undefined);
  await clearState(ctx);
  await ctx.reply(fmt(TXT.payments.success, { until }), { attachments: [backButton()] });
}

export function registerPaymentHandlers(bot: import('@maxhub/max-bot-api').Bot<AppContext>): void {
  bot.action('buy_subscription', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const user = await requireRegistered(ctx);
    if (!user) return;
    if (user.subscription?.active && isSubscriptionActive(user.subscription.until)) {
      await editText(ctx, fmt(TXT.payments.already_active, { until: user.subscription.until }), {
        attachments: [backButton()],
      });
      return;
    }
    await setState(ctx, PaymentStates.WAITING_EMAIL, {});
    await editText(ctx, TXT.payments.email, { attachments: [backButton()] });
  });

  bot.action('confirm_payment', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    await resolvePaymentAndActivate(ctx);
  });

  bot.action('check_payment', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    await resolvePaymentAndActivate(ctx);
  });
}
