import { TXT, fmt, MENU_LABELS } from '../texts.js';
import { Keyboard } from '@maxhub/max-bot-api';
import type { AppContext } from '../context.js';
import { getDeepLink } from '../config/env.js';
import { showCurrentMessage } from '../utils/bot.js';
import { requireRegistered } from './registration.js';

export async function showInvite(ctx: AppContext): Promise<void> {
  const user = await requireRegistered(ctx);
  if (!user) return;
  const link = getDeepLink(`ref_${user.max_user_id}`);
  await showCurrentMessage(ctx, [
    TXT.invite.title,
    [TXT.invite.stats_title, fmt(TXT.invite.stats_count, { count: user.referrals_invited })].join('\n'),
    [TXT.invite.how_title, TXT.invite.how_items].join('\n'),
    [TXT.invite.link_title, link].join('\n'),
    [TXT.invite.share_title, TXT.invite.share_steps].join('\n'),
  ].join('\n\n'), {
    attachments: [Keyboard.inlineKeyboard([
      [Keyboard.button.link(TXT.invite.share, link)],
      [Keyboard.button.callback(TXT.common.main_menu, 'main_menu')],
    ])],
  });
}

export function registerInviteHandlers(bot: import('@maxhub/max-bot-api').Bot<AppContext>): void {
  bot.action('invite_friend', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    await showInvite(ctx);
  });
}
