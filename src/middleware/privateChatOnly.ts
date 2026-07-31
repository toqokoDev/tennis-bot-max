import { TXT } from '../texts.js';
import type { MiddlewareFn } from '@maxhub/max-bot-api';
import type { AppContext } from '../context.js';
import { getMessageText, isPrivateChat } from '../context.js';

function isBotCommand(ctx: AppContext): boolean {
  if (ctx.updateType !== 'message_created') return false;
  const text = getMessageText(ctx);
  if (!text?.startsWith('/')) return false;
  const cmd = text.split(/\s+/)[0] ?? '';
  return /^\/[a-zA-Z0-9_]+(@[\w]+)?$/.test(cmd);
}

export function privateChatOnlyMiddleware(): MiddlewareFn<AppContext> {
  return async (ctx, next) => {
    if (ctx.updateType === 'bot_started') {
      await next();
      return;
    }
    if (!isPrivateChat(ctx)) {
      if (isBotCommand(ctx)) {
        await ctx.reply(TXT.common.private_only);
      }
      return;
    }
    await next();
  };
}
