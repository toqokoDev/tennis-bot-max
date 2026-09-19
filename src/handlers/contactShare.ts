import { Keyboard, type Api } from '@maxhub/max-bot-api';
import type { AppContext } from '../context.js';
import { getMessageText } from '../context.js';
import { TXT, fmt } from '../texts.js';
import { storage } from '../storage/jsonStorage.js';
import { clearState, getState, getStateData, setState } from '../middleware/session.js';
import { ContactShareStates } from '../types/states.js';
import type { UserProfile } from '../types/models.js';
import { showCurrentMessage } from '../utils/bot.js';
import { getCallbackPayload } from '../utils/callback.js';
import { notifyUser, escapeHtml } from '../services/channels.js';
import { fullName } from '../utils/gameResult.js';
import { logger } from '../logger.js';
import { requireRegistered } from './registration.js';

type ContactShareData = {
  contactRequest?: { fromUserId: number; contactText?: string };
};

/** Отправляет владельцу анкеты запрос поделиться контактами. Возвращает false, если доставить сообщение не удалось. */
export async function sendContactRequest(
  api: Api,
  targetUserId: number,
  requester: UserProfile,
): Promise<boolean> {
  try {
    await api.sendMessageToUser(
      targetUserId,
      fmt(TXT.contact_share.request_message, { name: fullName(requester) }),
      {
        format: 'html',
        attachments: [Keyboard.inlineKeyboard([
          [Keyboard.button.callback(TXT.contact_share.share_button, `contact_share:${requester.max_user_id}`)],
        ])],
      },
    );
    return true;
  } catch (err) {
    logger.warn('Contact request send failed', { targetUserId, err });
    return false;
  }
}

function declineKeyboard() {
  return Keyboard.inlineKeyboard([
    [Keyboard.button.callback(TXT.contact_share.confirm_decline, 'contact_confirm_decline')],
  ]);
}

function confirmKeyboard() {
  return Keyboard.inlineKeyboard([
    [Keyboard.button.callback(TXT.contact_share.confirm_yes, 'contact_confirm_yes')],
    [Keyboard.button.callback(TXT.contact_share.confirm_retry, 'contact_confirm_retry')],
    [Keyboard.button.callback(TXT.contact_share.confirm_decline, 'contact_confirm_decline')],
  ]);
}

async function promptInput(ctx: AppContext, data: ContactShareData): Promise<void> {
  await setState(ctx, ContactShareStates.INPUT, data);
  await showCurrentMessage(ctx, TXT.contact_share.ask_input, { attachments: [declineKeyboard()] });
}

async function showConfirm(ctx: AppContext, contactText: string): Promise<void> {
  await showCurrentMessage(ctx, fmt(TXT.contact_share.confirm_prompt, { contact: escapeHtml(contactText) }), {
    attachments: [confirmKeyboard()],
  });
}

export function registerContactShareHandlers(bot: import('@maxhub/max-bot-api').Bot<AppContext>): void {
  bot.action(/^contact_share:/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const target = await requireRegistered(ctx);
    if (!target) return;
    const fromUserId = Number(getCallbackPayload(ctx).replace('contact_share:', ''));
    if (!fromUserId) return;

    const data = getStateData<ContactShareData>(ctx);
    data.contactRequest = { fromUserId };

    if (target.shared_contact) {
      await setState(ctx, ContactShareStates.CHOOSE, data);
      await showCurrentMessage(ctx, fmt(TXT.contact_share.saved_prompt, { contact: escapeHtml(target.shared_contact) }), {
        attachments: [Keyboard.inlineKeyboard([
          [Keyboard.button.callback(TXT.contact_share.use_saved, 'contact_use_saved')],
          [Keyboard.button.callback(TXT.contact_share.enter_new, 'contact_enter_new')],
          [Keyboard.button.callback(TXT.contact_share.confirm_decline, 'contact_confirm_decline')],
        ])],
      });
      return;
    }

    await promptInput(ctx, data);
  });

  bot.action('contact_use_saved', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const target = await requireRegistered(ctx);
    if (!target) return;
    const data = getStateData<ContactShareData>(ctx);
    if (!data.contactRequest || !target.shared_contact) return;
    data.contactRequest.contactText = target.shared_contact;
    await setState(ctx, ContactShareStates.CONFIRM, data);
    await showConfirm(ctx, target.shared_contact);
  });

  bot.action('contact_enter_new', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<ContactShareData>(ctx);
    if (!data.contactRequest) return;
    await promptInput(ctx, data);
  });

  bot.action('contact_confirm_retry', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<ContactShareData>(ctx);
    if (!data.contactRequest) return;
    await promptInput(ctx, data);
  });

  bot.action('contact_confirm_yes', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const target = await requireRegistered(ctx);
    if (!target) return;
    const data = getStateData<ContactShareData>(ctx);
    const request = data.contactRequest;
    if (!request?.contactText) {
      await clearState(ctx);
      return;
    }

    target.shared_contact = request.contactText;
    await storage.saveUser(target);

    await notifyUser(
      ctx.api,
      request.fromUserId,
      fmt(TXT.contact_share.sent_to_requester, {
        name: fullName(target),
        contact: escapeHtml(request.contactText),
      }),
    );

    await clearState(ctx);
    await showCurrentMessage(ctx, TXT.contact_share.shared_success, {
      attachments: [Keyboard.inlineKeyboard([[Keyboard.button.callback(TXT.common.main_menu, 'main_menu')]])],
    });
  });

  bot.action('contact_confirm_decline', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const target = await requireRegistered(ctx);
    const data = getStateData<ContactShareData>(ctx);
    const fromUserId = data.contactRequest?.fromUserId;

    await clearState(ctx);
    if (fromUserId && target) {
      await notifyUser(ctx.api, fromUserId, fmt(TXT.contact_share.declined_notify, { name: fullName(target) }));
    }

    await showCurrentMessage(ctx, TXT.contact_share.declined, {
      attachments: [Keyboard.inlineKeyboard([[Keyboard.button.callback(TXT.common.main_menu, 'main_menu')]])],
    });
  });
}

export async function handleContactShareMessage(ctx: AppContext): Promise<boolean> {
  const state = getState(ctx);
  if (state !== ContactShareStates.INPUT) return false;

  const data = getStateData<ContactShareData>(ctx);
  if (!data.contactRequest) return false;

  const text = getMessageText(ctx);
  if (!text) return false;

  data.contactRequest.contactText = text;
  await setState(ctx, ContactShareStates.CONFIRM, data);
  await showConfirm(ctx, text);
  return true;
}
