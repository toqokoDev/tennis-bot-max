import type { Bot } from '@maxhub/max-bot-api';
import type { AppContext } from '../context.js';
import { registerStartHandlers } from './start.js';
import { registerRegistrationHandlers } from './registration.js';
import { registerProfileHandlers } from './profile.js';
import { registerSearchHandlers } from './searchPartner.js';
import { registerGameOfferHandlers } from './gameOffers.js';
import { registerBrowseOffersHandlers } from './gameOffersMenu.js';
import { registerScoreHandlers } from './enterScore.js';
import { registerTournamentHandlers } from './tournament.js';
import { registerToursHandlers } from './tours.js';
import { registerPaymentHandlers } from './payments.js';
import { registerInviteHandlers } from './invite.js';
import { registerMoreHandlers, registerMenuHears } from './more.js';
import { registerFindCoachHandlers } from './findCoach.js';
import { registerAllPlayersHandlers } from './allPlayers.js';
import { registerAdminHandlers } from './admin.js';
import { registerAdminTournamentHandlers } from './adminTournament.js';

export function registerAllHandlers(bot: Bot<AppContext>): void {
  registerStartHandlers(bot);
  registerRegistrationHandlers(bot);
  registerProfileHandlers(bot);
  registerSearchHandlers(bot);
  registerGameOfferHandlers(bot);
  registerBrowseOffersHandlers(bot);
  registerScoreHandlers(bot);
  registerTournamentHandlers(bot);
  registerToursHandlers(bot);
  registerPaymentHandlers(bot);
  registerInviteHandlers(bot);
  registerMoreHandlers(bot);
  registerFindCoachHandlers(bot);
  registerAllPlayersHandlers(bot);
  registerAdminHandlers(bot);
  registerAdminTournamentHandlers(bot);
  registerMenuHears(bot);
}
