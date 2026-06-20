import type { Api } from '@maxhub/max-bot-api';
import { logger } from '../logger.js';
import { storage } from '../storage/jsonStorage.js';
import { parseOfferDateTime } from '../utils/validation.js';
import {
  isPaymentWindowExpired,
  removeUnpaidParticipants,
  shouldOpenPaymentWindow,
  openPaymentWindow,
  canStartTournament,
  startTournament,
} from '../utils/tournamentLifecycle.js';
import { bracketToText } from '../utils/bracket/index.js';
import { sendTournamentStartedToChannel } from '../services/channels.js';
import { formatDateISO, addDays, isSubscriptionActive } from '../utils/validation.js';
import { notifyUser } from '../services/channels.js';

export async function checkSubscriptions(api: Api): Promise<void> {
  logger.info('Running subscription check job');
  const users = await storage.getUsers();
  const today = formatDateISO(new Date());
  const in3 = formatDateISO(addDays(new Date(), 3));
  const in1 = formatDateISO(addDays(new Date(), 1));

  for (const user of Object.values(users)) {
    if (!user.subscription?.until) continue;
    const until = user.subscription.until;

    if (!isSubscriptionActive(until) && user.subscription.active) {
      user.subscription.active = false;
      user.subscription.expired = true;
      await storage.saveUser(user);
      await notifyUser(api, user.max_user_id, 'PRO подписка истекла');
      continue;
    }

    if (until === in3 || until === in1) {
      await notifyUser(api, user.max_user_id, `PRO истекает ${until}`);
    }

    user.games = user.games.filter((g) => {
      if (!g.active) return false;
      const dt = parseOfferDateTime(g.date, g.time);
      return dt ? dt > new Date() : true;
    });
    await storage.saveUser(user);
  }
}

export async function tournamentScheduledLoop(api: Api): Promise<void> {
  logger.info('Running tournament job');
  const all = await storage.getTournaments();
  for (const tourn of Object.values(all)) {
    let t = tourn;
    if (shouldOpenPaymentWindow(t)) {
      t = openPaymentWindow(t);
    }
    if (isPaymentWindowExpired(t)) {
      t = removeUnpaidParticipants(t);
    }
    if (canStartTournament(t) && t.status === 'active') {
      t = startTournament(t);
      const bracketText = t.bracket ? bracketToText(t.bracket as unknown as import('../utils/bracket/index.js').BracketTree) : '';
      await sendTournamentStartedToChannel(api, t, bracketText);
    }
    if (JSON.stringify(t) !== JSON.stringify(tourn)) {
      await storage.saveTournament(t);
    }
  }
}
