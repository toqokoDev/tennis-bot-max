import type { MiddlewareFn } from '@maxhub/max-bot-api';
import { storage } from '../storage/jsonStorage.js';
import type { AppContext } from '../context.js';
import { getCtxUserId } from '../context.js';

export function sessionMiddleware(): MiddlewareFn<AppContext> {
  return async (ctx, next) => {
    const userId = ctx.user?.user_id ?? ctx.message?.sender?.user_id;
    if (userId) {
      ctx.session = await storage.getSession(userId);
      ctx.profile = (await storage.getUser(userId)) ?? undefined;
    }
    await next();
    if (userId) {
      await storage.saveSession(userId, ctx.session);
    }
  };
}

export async function setState(ctx: AppContext, state: string, data: Record<string, unknown> = {}): Promise<void> {
  ctx.session.state = state;
  ctx.session.data = { ...ctx.session.data, ...data };
}

export async function clearState(ctx: AppContext): Promise<void> {
  ctx.session.state = undefined;
  ctx.session.data = {};
}

export function getState(ctx: AppContext): string | undefined {
  return ctx.session.state;
}

export function getStateData<T extends Record<string, unknown>>(ctx: AppContext): T {
  return ctx.session.data as T;
}

export async function setReferral(ctx: AppContext, referralId: number): Promise<void> {
  ctx.session.referral_id = referralId;
}

export async function setPrevMessageId(ctx: AppContext, messageId: string): Promise<void> {
  ctx.session.prev_msg_id = messageId;
}

export function getPrevMessageId(ctx: AppContext): string | undefined {
  return ctx.session.prev_msg_id;
}

export function clearPrevMessageId(ctx: AppContext): void {
  ctx.session.prev_msg_id = undefined;
}

export async function clearSession(ctx: AppContext): Promise<void> {
  const userId = getCtxUserId(ctx);
  await storage.clearSession(userId);
  ctx.session = { data: {} };
}
