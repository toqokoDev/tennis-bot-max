import { TXT } from '../texts.js';
import { Keyboard } from '@maxhub/max-bot-api';
import type { AppContext } from '../context.js';
import { getCtxUserId } from '../context.js';
import { storage } from '../storage/jsonStorage.js';
import { editButtons, showProfile } from '../utils/bot.js';
import { getCallbackPayload } from '../utils/callback.js';
import { requireRegistered } from './registration.js';
import { hasProSubscription } from '../utils/validation.js';
import { registerProfileEditHandlers, showOwnProfile } from './profileEdit.js';
import { registerGameHistoryHandlers } from './gameHistory.js';

export function registerProfileHandlers(bot: import('@maxhub/max-bot-api').Bot<AppContext>): void {
  registerProfileEditHandlers(bot);
  registerGameHistoryHandlers(bot);

  bot.action('profile', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const user = await requireRegistered(ctx);
    if (user) await showOwnProfile(ctx, user);
  });

  bot.action('1delete_profile', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    await editButtons(ctx, TXT.profile.confirm_delete, [
      Keyboard.inlineKeyboard([
        [Keyboard.button.callback(TXT.common.yes, 'confirm_delete_profile'), Keyboard.button.callback(TXT.common.no, 'back_to_profile')],
      ]),
    ]);
  });

  bot.action('confirm_delete_profile', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    await storage.deleteUser(getCtxUserId(ctx));
    await editButtons(ctx, TXT.profile.deleted, [
      Keyboard.inlineKeyboard([[Keyboard.button.callback(TXT.common.main_menu, 'main_menu')]]),
    ]);
  });

  bot.action(/^profile_contact:/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const viewer = await requireRegistered(ctx);
    if (!viewer) return;
    const targetId = Number(getCallbackPayload(ctx).replace('profile_contact:', ''));
    const backPayload = `partner_show_profile_${targetId}`;
    if (!hasProSubscription(viewer)) {
      await editButtons(ctx, TXT.profile.contact_pro, [
        Keyboard.inlineKeyboard([
          [Keyboard.button.callback(TXT.common.back, backPayload)],
        ]),
      ]);
      return;
    }
    const target = await storage.getUser(targetId);
    if (!target) {
      await editButtons(ctx, TXT.profile.not_found, [
        Keyboard.inlineKeyboard([[Keyboard.button.callback(TXT.common.main_menu, 'main_menu')]]),
      ]);
      return;
    }
    await editButtons(ctx, `📞 ${target.first_name}: ${target.phone}`, [
      Keyboard.inlineKeyboard([
        [Keyboard.button.callback(TXT.common.back, backPayload)],
      ]),
    ]);
  });

  bot.action(/^partner_show_profile_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const targetId = Number(getCallbackPayload(ctx).replace('partner_show_profile_', ''));
    const profile = await storage.getUser(targetId);
    if (profile) await showProfile(ctx, profile, { listBackPayload: 'partner_back_to_results' });
  });

  bot.action(/^coach_show_profile_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const targetId = Number(getCallbackPayload(ctx).replace('coach_show_profile_', ''));
    const profile = await storage.getUser(targetId);
    if (profile) await showProfile(ctx, profile, { listBackPayload: 'coach_back_to_results' });
  });

  bot.action(/^players_show_profile_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const targetId = Number(getCallbackPayload(ctx).replace('players_show_profile_', ''));
    const profile = await storage.getUser(targetId);
    if (profile) await showProfile(ctx, profile, { listBackPayload: 'players_back_to_results' });
  });

  bot.action('partner_back_to_results', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    await import('./searchPartner.js').then((m) => m.showSearchResults(ctx));
  });

  bot.action('coach_back_to_results', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    await import('./findCoach.js').then((m) => m.showCoachResults(ctx));
  });

  bot.action('players_back_to_results', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    await import('./allPlayers.js').then((m) => m.showPlayersResults(ctx));
  });
}
