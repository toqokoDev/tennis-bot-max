import { TXT, fmt } from '../texts.js';
import { Keyboard } from '@maxhub/max-bot-api';
import type { AttachmentRequest } from '@maxhub/max-bot-api/types';
import type { AppContext } from '../context.js';
import { getCtxUserId } from '../context.js';
import { isAdmin } from '../config/env.js';
import { storage } from '../storage/jsonStorage.js';
import { editButtons, showProfile } from '../utils/bot.js';
import {
  formatGameHistoryCard,
  getGamesForUser,
  getProfileViewContext,
} from '../utils/gameHistory.js';
import { getCallbackPayload } from '../utils/callback.js';
import { requireRegistered } from './registration.js';
import { hasProSubscription } from '../utils/validation.js';
import { formatProLockedMessage } from '../utils/subscription.js';
import type { UserProfile } from '../types/models.js';

async function loadUsersMap(ids: number[]): Promise<Map<number, UserProfile>> {
  const map = new Map<number, UserProfile>();
  for (const id of ids) {
    const user = await storage.getUser(id);
    if (user) map.set(id, user);
  }
  return map;
}

function historyKeyboard(targetUserId: number, index: number, total: number) {
  const buttons: ReturnType<typeof Keyboard.button.callback>[][] = [];
  const nav: ReturnType<typeof Keyboard.button.callback>[] = [];
  if (index > 0) {
    nav.push(Keyboard.button.callback(TXT.common.prev, `history_nav:${targetUserId}:${index - 1}`));
  }
  if (index < total - 1) {
    nav.push(Keyboard.button.callback(TXT.common.next, `history_nav:${targetUserId}:${index + 1}`));
  }
  if (nav.length) buttons.push(nav);
  buttons.push([Keyboard.button.callback(TXT.profile.history_to_profile, 'history_back_profile')]);
  return Keyboard.inlineKeyboard(buttons);
}

function historyAttachments(
  game: { media_path?: string },
  keyboard: AttachmentRequest,
): AttachmentRequest[] {
  const attachments: AttachmentRequest[] = [];
  if (game.media_path) {
    attachments.push({ type: 'image', payload: { url: game.media_path } });
  }
  attachments.push(keyboard);
  return attachments;
}

export async function showGameHistory(
  ctx: AppContext,
  targetUserId: number,
  gameIndex = 0,
): Promise<void> {
  const viewer = await requireRegistered(ctx);
  if (!viewer) return;

  const viewerId = getCtxUserId(ctx);
  const isOwnProfile = targetUserId === viewerId;

  if (!isOwnProfile && !hasProSubscription(viewer) && !isAdmin(viewerId)) {
    await editButtons(ctx, formatProLockedMessage('game_history', viewerId), [
      Keyboard.inlineKeyboard([
        [Keyboard.button.callback(TXT.common.back, 'history_back_profile')],
      ]),
    ]);
    return;
  }

  const targetUser = await storage.getUser(targetUserId);
  if (!targetUser) {
    await ctx.answerOnCallback({ notification: TXT.profile.history_user_not_found });
    return;
  }

  const games = getGamesForUser(await storage.getGames(), targetUserId);

  if (!games.length) {
    const name = `${targetUser.first_name} ${targetUser.last_name}`.trim();
    await editButtons(ctx, isOwnProfile
      ? TXT.profile.history_empty
      : fmt(TXT.profile.history_empty_user, { name }), [
      Keyboard.inlineKeyboard([
        [Keyboard.button.callback(TXT.profile.history_to_profile, 'history_back_profile')],
      ]),
    ]);
    return;
  }

  const index = Math.min(Math.max(0, gameIndex), games.length - 1);
  const game = games[index];

  const allPlayerIds = [...new Set(games.flatMap((g) => g.players))];
  const users = await loadUsersMap(allPlayerIds);

  let tournamentName: string | undefined;
  if (game.tournament_id) {
    const tourn = await storage.getTournament(game.tournament_id);
    tournamentName = tourn?.name;
  }

  const text = formatGameHistoryCard(
    game,
    targetUserId,
    users,
    index,
    games.length,
    {
      isAdmin: isAdmin(viewerId),
      tournamentName,
    },
  );

  await editButtons(ctx, text, historyAttachments(game, historyKeyboard(targetUserId, index, games.length)));
}

export function registerGameHistoryHandlers(bot: import('@maxhub/max-bot-api').Bot<AppContext>): void {
  bot.action(/^game_history:/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const payload = getCallbackPayload(ctx).replace('game_history:', '');
    const userId = Number(payload.split(':')[0]);
    await showGameHistory(ctx, userId, 0);
  });

  bot.action(/^history_nav:/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const parts = getCallbackPayload(ctx).replace('history_nav:', '').split(':');
    const userId = Number(parts[0]);
    const index = Number(parts[1]);
    await showGameHistory(ctx, userId, index);
  });

  bot.action('history_back_profile', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const context = getProfileViewContext(ctx);
    if (!context) {
      const user = await requireRegistered(ctx);
      if (user) {
        await import('./profileEdit.js').then((m) => m.showOwnProfile(ctx, user));
      }
      return;
    }
    const profile = await storage.getUser(context.userId);
    if (profile) {
      await showProfile(ctx, profile, {
        isOwn: context.isOwn,
        listBackPayload: context.listBackPayload,
        reopenPayload: context.reopenPayload,
      });
    }
  });
}
