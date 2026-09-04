import type { Bot } from '@maxhub/max-bot-api';
import type { AppContext } from '../context.js';
import { getMessageText } from '../context.js';
import { beginCommandResponse, showMainMenu, showProfile, showStartWelcome } from '../utils/bot.js';
import { storage } from '../storage/jsonStorage.js';
import { clearState, setReferral } from '../middleware/session.js';
import { createProfileFromWeb } from '../services/webApi.js';
import { sendRegistrationNotification } from '../services/channels.js';
import { startRegistration } from './registration.js';
import { getCtxUserId } from '../context.js';

export async function handleStartPayload(ctx: AppContext, payload?: string | null): Promise<void> {
  const userId = getCtxUserId(ctx);
  const existing = await storage.getUser(userId);
  
  if (payload?.startsWith('ref_')) {
    const refId = Number(payload.replace('ref_', ''));
    if (!Number.isNaN(refId) && refId !== userId) {
      await setReferral(ctx, refId);
    }
  }

  if (payload?.startsWith('profile_')) {
    const targetId = Number(payload.replace('profile_', ''));
    const profile = await storage.getUser(targetId);
    if (profile) {
      // По ссылке — без «Назад» (нет списка, откуда возвращаться)
      await showProfile(ctx, profile, {
        isOwn: targetId === userId,
        mode: 'new',
        reopenPayload: `deeplink_profile_${targetId}`,
      });
      return;
    }
  }

  if (payload?.startsWith('web_')) {
    const parts = payload.replace('web_', '').split('_');
    const webUserId = parts.pop()!;
    const domain = parts.join('_');
    const profile = await createProfileFromWeb(userId, domain, webUserId, ctx.user?.username ?? undefined);
    if (profile) {
      await storage.saveUser(profile);
      await sendRegistrationNotification(ctx.api, profile);
      await clearState(ctx);
      await showProfile(ctx, profile, { isOwn: true });
      return;
    }
  }

  if (payload?.startsWith('join_tournament_')) {
    if (existing) {
      const { handleJoinTournament } = await import('./tournament.js');
      await handleJoinTournament(ctx, payload.replace('join_tournament_', ''), {
        fromDeepLink: true,
      });
      return;
    }
  }

  if (payload?.startsWith('view_tournament_')) {
    const { handleViewTournament } = await import('./tournament.js');
    await handleViewTournament(ctx, payload.replace('view_tournament_', ''));
    return;
  }

  if (payload?.startsWith('pay_tournament_')) {
    if (existing) {
      const { handlePayTournament } = await import('./tournament.js');
      await handlePayTournament(ctx, payload.replace('pay_tournament_', ''));
      return;
    }
  }

  if (existing) {
    await clearState(ctx);
    ctx.profile = existing;
    await showStartWelcome(ctx, existing);
    return;
  }

  await startRegistration(ctx);
}

export function registerStartHandlers(bot: Bot<AppContext>): void {
  const start = async (ctx: AppContext) => {
    beginCommandResponse(ctx);
    const text = getMessageText(ctx);
    const payload = ctx.startPayload ?? text?.split(/\s+/)[1] ?? null;
    await handleStartPayload(ctx, payload);
  };

  bot.on('bot_started', start);
  bot.command('start', start);

  bot.action('main_menu', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    await clearState(ctx);
    await showMainMenu(ctx);
  });

  bot.action(/^menu:/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const action = ctx.callback?.payload?.replace('menu:', '');
    switch (action) {
      case 'search':
        await import('./searchPartner.js').then((m) => m.startSearch(ctx));
        break;
      case 'offers':
        await import('./gameOffersMenu.js').then((m) => m.startBrowseOffers(ctx));
        break;
      case 'tournaments':
        await import('./tournament.js').then((m) => m.showTournamentMenu(ctx));
        break;
      case 'score':
        await import('./enterScore.js').then((m) => m.startEnterScore(ctx));
        break;
      case 'invite':
        await import('./invite.js').then((m) => m.showInvite(ctx));
        break;
      case 'payments':
        await import('./payments.js').then((m) => m.showPaymentsMenu(ctx));
        break;
      case 'more':
        await import('./more.js').then((m) => m.showMoreMenu(ctx));
        break;
      default:
        await showMainMenu(ctx);
    }
  });
}
