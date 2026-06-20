import { TXT } from '../texts.js';
import type { MiddlewareFn } from '@maxhub/max-bot-api';
import { storage } from '../storage/jsonStorage.js';
import type { AppContext } from '../context.js';
import { getUserId } from '../context.js';

export function banCheckMiddleware(): MiddlewareFn<AppContext> {
  return async (ctx, next) => {
    const userId = getUserId(ctx);
    if (userId && (await storage.isBanned(userId))) {
      await ctx.reply(TXT.common.banned);
      return;
    }
    await next();
  };
}
