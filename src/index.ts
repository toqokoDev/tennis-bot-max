import { Bot } from '@maxhub/max-bot-api';
import { AppContext } from './context.js';
import { env } from './config/env.js';
import { logger } from './logger.js';
import { storage } from './storage/jsonStorage.js';
import { banCheckMiddleware } from './middleware/banCheck.js';
import { privateChatOnlyMiddleware } from './middleware/privateChatOnly.js';
import { sessionMiddleware } from './middleware/session.js';
import { registerAllHandlers } from './handlers/index.js';
import { handleProfileEditMessage } from './handlers/profileEdit.js';
import { handleRegistrationMessage } from './handlers/registration.js';
import { handleGameOfferMessage } from './handlers/gameOffers.js';
import { handleBrowseRespondMessage } from './handlers/gameOffersMenu.js';
import { handleScoreMessage } from './handlers/enterScore.js';
import { handleTourMessage } from './handlers/tours.js';
import { handlePaymentMessage } from './handlers/payments.js';
import { handleTournamentPaymentMessage, handleTournamentBrowseMessage } from './handlers/tournament.js';

import { handleAdminBroadcast } from './handlers/admin.js';
import { startBackgroundJobs, stopBackgroundJobs } from './jobs/tournamentJobs.js';
import { clearWebhookSubscriptions } from './utils/clearWebhooks.js';
import { beginCommandResponse, showMainMenu } from './utils/bot.js';
import { clearState } from './middleware/session.js';
import { getMessageText } from './context.js';
import { startRegistration } from './handlers/registration.js';

async function main(): Promise<void> {
  if (!env.BOT_TOKEN) {
    logger.error('BOT_TOKEN is required');
    process.exit(1);
  }

  await storage.init();

  logger.info('Clearing old webhook subscriptions...');
  await clearWebhookSubscriptions(env.BOT_TOKEN);

  const bot = new Bot<AppContext>(env.BOT_TOKEN, { contextType: AppContext });

  bot.use(sessionMiddleware());
  bot.use(banCheckMiddleware());
  bot.use(privateChatOnlyMiddleware());

  registerAllHandlers(bot);

  bot.on('message_created', async (ctx) => {
    if (await handleRegistrationMessage(ctx)) return;
    if (await handleProfileEditMessage(ctx)) return;
    if (await handleGameOfferMessage(ctx)) return;
    if (await handleBrowseRespondMessage(ctx)) return;
    if (await handleScoreMessage(ctx)) return;
    if (await handleTourMessage(ctx)) return;
    if (await handleTournamentBrowseMessage(ctx)) return;
    if (await handleTournamentPaymentMessage(ctx)) return;
    if (await handlePaymentMessage(ctx)) return;
    const text = getMessageText(ctx) ?? '';
    if (await handleAdminBroadcast(ctx, text)) return;

    // Любой текст вне FSM / команд меню → обычное главное меню
    if (!text) return;
    beginCommandResponse(ctx);
    await clearState(ctx);
    if (ctx.profile) {
      await showMainMenu(ctx);
    } else {
      await startRegistration(ctx);
    }
  });

  bot.catch((err, ctx) => {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    logger.error(`Bot error (${ctx.updateType}): ${message}`, {
      stack,
      ...(err instanceof Error ? {} : { err: String(err) }),
    });
  });

  startBackgroundJobs(bot);

  const shutdown = (): void => {
    logger.info('Shutting down...');
    stopBackgroundJobs();
    bot.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  logger.info('Starting Tennis-Play MAX bot (polling)...');
  await bot.start();
}

main().catch((err) => {
  logger.error('Fatal error', err);
  process.exit(1);
});
