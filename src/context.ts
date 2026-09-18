import { Context } from '@maxhub/max-bot-api';
import type { UserProfile, UserSession } from './types/models.js';

export class AppContext extends Context {
  profile?: UserProfile;
  session: UserSession = { data: {} };

  /**
   * Любое новое сообщение (после ввода пользователя, ошибки валидации и т.д.) сначала
   * убирает inline-кнопки с предыдущего "якорного" сообщения бота в этом чате и только
   * потом отправляет новое — иначе кнопки прошлого шага анкеты/оффера остаются кликабельными.
   * Правка в одном месте (а не в каждом хендлере) гарантирует, что это работает для всех
   * ctx.reply(...) по всему проекту, включая прямые вызовы в обход utils/bot.ts.
   */
  async reply(...args: Parameters<Context['reply']>): ReturnType<Context['reply']> {
    await clearAnchorButtons(this);
    const msg = await super.reply(...args);
    this.session.prev_msg_id = msg.body.mid;
    return msg;
  }
}

async function clearAnchorButtons(ctx: AppContext): Promise<void> {
  const targetId = ctx.session.prev_msg_id;
  if (!targetId) return;
  try {
    const msg = await ctx.getMessage(targetId);
    await ctx.api.editMessage(targetId, { text: msg.body.text ?? '', format: 'html', attachments: [] });
  } catch {
    /* сообщение могло быть уже удалено или недоступно для редактирования — игнорируем */
  }
}

export function getUserId(ctx: AppContext): number | undefined {
  return ctx.profile?.max_user_id ?? ctx.user?.user_id ?? ctx.message?.sender?.user_id;
}

export function getCtxUserId(ctx: AppContext): number {
  const id = ctx.profile?.max_user_id ?? ctx.user?.user_id ?? ctx.message?.sender?.user_id;
  if (!id) throw new Error('No user id in context');
  return id;
}

export function getMessageText(ctx: AppContext): string | undefined {
  return ctx.message?.body.text?.trim() ?? undefined;
}

export function isPrivateChat(ctx: AppContext): boolean {
  const type = ctx.message?.recipient?.chat_type ?? ctx.chat?.type;
  return type === 'dialog';
}
