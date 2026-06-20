import { TXT, fmt } from '../texts.js';
import { Keyboard } from '@maxhub/max-bot-api';
import type { AppContext } from '../context.js';
import { getMessageText } from '../context.js';
import { env, getDeepLink } from '../config/env.js';
import { storage } from '../storage/jsonStorage.js';
import { clearState, getState, getStateData, setState } from '../middleware/session.js';
import { PaymentStates } from '../types/states.js';
import { showCurrentMessage, editText, backButton } from '../utils/bot.js';
import { isValidEmail, formatDateISO, addDays, isSubscriptionActive } from '../utils/validation.js';
import { createSubscriptionPayment, checkTinkoffPaymentStatus } from '../services/payments.js';
import { notifySubscriptionPurchase } from '../services/email.js';
import { requireRegistered } from './registration.js';
import { getCtxUserId } from '../context.js';

type PayData = { email?: string; payment_id?: string };

function paymentKeyboard(
  ...rows: Array<Array<ReturnType<typeof Keyboard.button.callback> | ReturnType<typeof Keyboard.button.link>>>
): ReturnType<typeof Keyboard.inlineKeyboard> {
  return Keyboard.inlineKeyboard([
    ...rows,
    [Keyboard.button.callback(TXT.common.main_menu, 'main_menu')],
  ]);
}

export async function showPaymentsMenu(ctx: AppContext): Promise<void> {
  const user = await requireRegistered(ctx);
  if (!user) return;

  let statusText: string = TXT.payments.expired;
  if (user.subscription?.active && isSubscriptionActive(user.subscription.until)) {
    statusText = fmt(TXT.payments.active_until, { until: user.subscription.until });
  }

  const message = [
    statusText,
    '',
    TXT.payments.benefits_title,
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
  const data = getStateData<PayData>(ctx);
  data.email = text;
  const userId = getCtxUserId(ctx);
  const payment = await createSubscriptionPayment({ userId, email: text });
  if (!payment) {
    await ctx.reply(TXT.common.error, { attachments: [backButton()] });
    return true;
  }
  data.payment_id = payment.paymentId;
  await setState(ctx, PaymentStates.CONFIRM_PAYMENT, data);
  await ctx.reply(TXT.payments.pay_link, {
    attachments: [paymentKeyboard(
      [Keyboard.button.link(TXT.payments.continue_pay, payment.paymentUrl)],
      [Keyboard.button.callback(TXT.payments.confirm_pay, 'confirm_payment')],
    )],
  });
  return true;
}

export function registerPaymentHandlers(bot: import('@maxhub/max-bot-api').Bot<AppContext>): void {
  bot.action('buy_subscription', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    await setState(ctx, PaymentStates.WAITING_EMAIL, {});
    await editText(ctx, TXT.payments.email, { attachments: [backButton()] });
  });

  bot.action('confirm_payment', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<PayData>(ctx);
    if (!data.payment_id) return;
    const status = await checkTinkoffPaymentStatus(data.payment_id);
    if (status !== 'succeeded') {
      await ctx.reply(TXT.payments.not_confirmed, { attachments: [backButton()] });
      return;
    }
    const user = await requireRegistered(ctx);
    if (!user) return;
    const until = formatDateISO(addDays(new Date(), 30));
    user.subscription = { active: true, until };
    await storage.saveUser(user);
    await notifySubscriptionPurchase(user.max_user_id, until);
    await clearState(ctx);
    await ctx.reply(fmt(TXT.payments.success, { until }), { attachments: [backButton()] });
  });
}
