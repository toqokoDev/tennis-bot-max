import { TXT, fmt, MENU_LABELS } from '../texts.js';
import { Keyboard } from '@maxhub/max-bot-api';
import type { AppContext } from '../context.js';
import { getCtxUserId } from '../context.js';
import { isAdmin } from '../config/env.js';
import { storage } from '../storage/jsonStorage.js';
import { beginCommandResponse, showCurrentMessage } from '../utils/bot.js';
import { getCallbackPayload } from '../utils/callback.js';

export function registerAdminHandlers(bot: import('@maxhub/max-bot-api').Bot<AppContext>): void {
  bot.command('admin', async (ctx) => {
    if (!isAdmin(getCtxUserId(ctx))) return;
    beginCommandResponse(ctx);
    await showAdminMenu(ctx);
  });

  bot.command('banned_users', async (ctx) => {
    if (!isAdmin(getCtxUserId(ctx))) return;
    beginCommandResponse(ctx);
    const banned = await storage.getBanned();
    const text = Object.entries(banned).map(([id, b]) => `${id}: ${b.reason}`).join('\n') || '—';
    await ctx.reply(text);
  });

  bot.command(/^unban_user\s+(\d+)/, async (ctx) => {
    if (!isAdmin(getCtxUserId(ctx))) return;
    beginCommandResponse(ctx);
    const id = Number(ctx.match?.[1]);
    await storage.unbanUser(id);
    await ctx.reply(`Unbanned ${id}`);
  });

  bot.action('admin_stats', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    if (!isAdmin(getCtxUserId(ctx))) return;
    const users = await storage.getUsers();
    await ctx.reply(fmt(TXT.admin.users_count, { count: Object.keys(users).length }));
  });

  bot.action(/^admin_ban_user:/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    if (!isAdmin(getCtxUserId(ctx))) return;
    const id = Number(getCallbackPayload(ctx).replace('admin_ban_user:', ''));
    await storage.banUser(id, 'Admin ban');
    await ctx.reply(`Banned ${id}`);
  });

  bot.action(/^admin_delete_user:/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    if (!isAdmin(getCtxUserId(ctx))) return;
    const id = Number(getCallbackPayload(ctx).replace('admin_delete_user:', ''));
    await storage.deleteUser(id);
    await ctx.reply(`Deleted ${id}`);
  });
}

async function showAdminMenu(ctx: AppContext): Promise<void> {
  await showCurrentMessage(ctx, TXT.admin.menu, {
    attachments: [Keyboard.inlineKeyboard([
      [Keyboard.button.callback(TXT.admin.stats, 'admin_stats')],
      [Keyboard.button.callback(TXT.admin.broadcast, 'admin_broadcast')],
      [Keyboard.button.callback(TXT.common.main_menu, 'main_menu')],
    ])],
  });
}

export async function handleAdminBroadcast(ctx: AppContext, text: string): Promise<boolean> {
  if (!isAdmin(getCtxUserId(ctx))) return false;
  if (text !== '/broadcast_confirm') return false;
  beginCommandResponse(ctx);
  const ids = await storage.listAllUserIds();
  for (const id of ids) {
    try {
      await ctx.api.sendMessageToUser(id, 'Admin broadcast');
    } catch {
      /* skip */
    }
  }
  await ctx.reply('Done');
  return true;
}
