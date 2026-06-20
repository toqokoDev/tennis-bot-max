import { Context } from '@maxhub/max-bot-api';
import type { UserProfile, UserSession } from './types/models.js';

export class AppContext extends Context {
  profile?: UserProfile;
  session: UserSession = { data: {} };
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
