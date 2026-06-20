import { TXT } from '../texts.js';
import type { MiddlewareFn } from '@maxhub/max-bot-api';
import type { AppContext } from '../context.js';
import { isPrivateChat } from '../context.js';

export function privateChatOnlyMiddleware(): MiddlewareFn<AppContext> {
  return async (ctx, next) => {
    if (ctx.updateType === 'bot_started') {
      await next();
      return;
    }
    if (!isPrivateChat(ctx)) {
      if (ctx.chatId) {
        await ctx.reply(TXT.common.private_only);
      }
      return;
    }
    await next();
  };
}
