import { TXT, MENU_LABELS } from '../texts.js';
import { Keyboard } from '@maxhub/max-bot-api';
import type { AppContext } from '../context.js';
import { beginCommandResponse, showCurrentMessage } from '../utils/bot.js';
import { isAdmin } from '../config/env.js';
import { hasProSubscription } from '../utils/validation.js';
import { requireRegistered } from './registration.js';
import { showToursMenu } from './tours.js';
import { startFindCoach } from './findCoach.js';
import { startAllPlayers } from './allPlayers.js';
import { getCtxUserId } from '../context.js';

function moreBackKeyboard(): ReturnType<typeof Keyboard.inlineKeyboard> {
  return Keyboard.inlineKeyboard([
    [Keyboard.button.callback(TXT.common.back, 'menu:more')],
    [Keyboard.button.callback(TXT.common.main_menu, 'main_menu')],
  ]);
}

export async function showMoreMenu(ctx: AppContext): Promise<void> {
  await showCurrentMessage(ctx, TXT.more.title, {
    attachments: [Keyboard.inlineKeyboard([
      [Keyboard.button.callback(TXT.more.tours, 'more_tours')],
      [
        Keyboard.button.callback(TXT.more.all_players, 'all_players'),
        Keyboard.button.callback(TXT.more.find_coach, 'find_coach'),
      ],
      [
        Keyboard.button.callback(TXT.more.about, 'about'),
        Keyboard.button.callback(TXT.more.contacts, 'contacts'),
      ],
      [
        Keyboard.button.callback(TXT.more.profile, 'profile'),
      ],
      [Keyboard.button.link(TXT.more.multi_day_tournaments, 'https://tennis-play.com/tournaments/')],
      [Keyboard.button.link(TXT.more.weekend_tournaments, 'https://tennis-play.com/tournaments/weekend/')],
      [Keyboard.button.link(TXT.more.website, 'https://tennis-play.com/')],
      [Keyboard.button.callback(TXT.common.main_menu, 'main_menu')],
    ])],
  });
}

export function registerMoreHandlers(bot: import('@maxhub/max-bot-api').Bot<AppContext>): void {
  bot.action('more_tours', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    await showToursMenu(ctx);
  });

  bot.action('all_players', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const user = await requireRegistered(ctx);
    if (!user) return;
    if (!hasProSubscription(user) && !isAdmin(getCtxUserId(ctx))) {
      await showCurrentMessage(ctx, TXT.more.pro_required, { attachments: [moreBackKeyboard()] });
      return;
    }
    await startAllPlayers(ctx);
  });

  bot.action('find_coach', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const user = await requireRegistered(ctx);
    if (!user) return;
    // Reference: coach search is free; only "all players" is PRO-gated
    await startFindCoach(ctx);
  });

  bot.action('about', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    await showCurrentMessage(ctx, `
Tennis-Play - это платформа для организации теннисных турниров и матчей.

Мы предлагаем:
- Удобную систему записи на турниры
- Рейтинговую систему
- Организацию матчей с игроками своего уровня
- Статистику и историю встреч

Подробнее на нашем сайте: https://tennis-play.com/contacts/  
    `.trim(), { attachments: [moreBackKeyboard()] });
  });

  bot.action('contacts', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    await showCurrentMessage(ctx, TXT.more.contacts_text, {
      attachments: [moreBackKeyboard()],
    });
  });
}

export function registerMenuHears(bot: import('@maxhub/max-bot-api').Bot<AppContext>): void {
  const triggers = [...MENU_LABELS];
  bot.hears(triggers, async (ctx) => {
    beginCommandResponse(ctx);
    const text = ctx.message?.body.text ?? '';
    const map: Record<string, () => Promise<void>> = {
      [triggers[0]]: () => import('./searchPartner.js').then((m) => m.startSearch(ctx)),
      [triggers[1]]: () => import('./gameOffersMenu.js').then((m) => m.startBrowseOffers(ctx)),
      [triggers[2]]: () => import('./tournament.js').then((m) => m.showTournamentMenu(ctx)),
      [triggers[3]]: () => import('./enterScore.js').then((m) => m.startEnterScore(ctx)),
      [triggers[4]]: () => import('./invite.js').then((m) => m.showInvite(ctx)),
      [triggers[5]]: () => import('./payments.js').then((m) => m.showPaymentsMenu(ctx)),
      [triggers[6]]: () => showMoreMenu(ctx),
    };
    const fn = map[text];
    if (fn) await fn();
  });
}
