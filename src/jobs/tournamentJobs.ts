import cron, { type ScheduledTask } from 'node-cron';
import type { Bot } from '@maxhub/max-bot-api';
import type { AppContext } from '../context.js';
import { checkSubscriptions, tournamentScheduledLoop } from './subscriptionCheck.js';

let subscriptionTask: ScheduledTask | null = null;
let tournamentTask: ScheduledTask | null = null;

export function startBackgroundJobs(bot: Bot<AppContext>): void {
  subscriptionTask = cron.schedule('0 3 * * *', () => {
    void checkSubscriptions(bot.api);
  });
  tournamentTask = cron.schedule('*/15 * * * *', () => {
    void tournamentScheduledLoop(bot.api);
  });
}

export function stopBackgroundJobs(): void {
  subscriptionTask?.stop();
  tournamentTask?.stop();
  subscriptionTask = null;
  tournamentTask = null;
}
