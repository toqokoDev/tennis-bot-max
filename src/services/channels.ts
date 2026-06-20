import type { Api } from '@maxhub/max-bot-api';
import { env } from '../config/env.js';
import { SPORT_CHANNEL_IDS } from '../config/profile.js';
import { TXT, fmt } from '../texts.js';
import { logger } from '../logger.js';
import type { GameOffer, Tournament, UserProfile } from '../types/models.js';

async function sendToChannel(
  api: Api,
  channelId: string,
  text: string,
): Promise<void> {
  if (!channelId) return;
  try {
    const chatId = Number(channelId);
    await api.sendMessageToChat(chatId, text, { format: 'html' });
  } catch (err) {
    logger.warn('Channel send failed', { channelId, err });
  }
}

function resolveChannelIds(sport: UserProfile['sport']): string[] {
  const mapped = SPORT_CHANNEL_IDS[sport];
  if (mapped?.length) return mapped;
  if (env.CHANNEL_ID) return [env.CHANNEL_ID];
  return [];
}

export async function sendRegistrationNotification(
  api: Api,
  profile: UserProfile,
): Promise<void> {
  const text = fmt(TXT.channels.new_player, {
    name: `${profile.first_name} ${profile.last_name}`,
    sport: profile.sport,
    city: profile.city,
  });
  for (const ch of resolveChannelIds(profile.sport)) {
    await sendToChannel(api, ch, text);
  }
}

export async function sendGameOfferToChannel(
  api: Api,
  profile: UserProfile,
  offer: GameOffer,
): Promise<void> {
  const text = fmt(TXT.channels.new_offer, {
    sport: offer.sport,
    city: offer.city,
    date: offer.date,
    time: offer.time,
  }) + (offer.comment ? `\n${offer.comment}` : '');
  for (const ch of resolveChannelIds(offer.sport)) {
    await sendToChannel(api, ch, text);
  }
}

export async function sendGameNotificationToChannel(
  api: Api,
  sport: UserProfile['sport'],
  scoreText: string,
): Promise<void> {
  const text = fmt(TXT.channels.game_result, { score: scoreText });
  for (const ch of resolveChannelIds(sport)) {
    await sendToChannel(api, ch, text);
  }
}

export async function sendTourToChannel(
  api: Api,
  profile: UserProfile,
): Promise<void> {
  const text = fmt(TXT.channels.new_tour, {
    city: profile.vacation_city ?? profile.city,
    dates: `${profile.vacation_start}-${profile.vacation_end}`,
  });
  await sendToChannel(api, env.TOUR_CHANNEL_ID, text);
}

export async function sendTournamentCreatedToChannel(
  api: Api,
  tournament: Tournament,
): Promise<void> {
  const text = fmt(TXT.channels.new_tournament, { name: tournament.name });
  for (const ch of resolveChannelIds(tournament.sport)) {
    await sendToChannel(api, ch, text);
  }
}

export async function sendTournamentStartedToChannel(
  api: Api,
  tournament: Tournament,
  bracketText: string,
): Promise<void> {
  const text = `🏆 ${tournament.name}\n${bracketText}`;
  for (const ch of resolveChannelIds(tournament.sport)) {
    await sendToChannel(api, ch, text);
  }
}

export async function sendTournamentApplicationToChannel(
  api: Api,
  tournament: Tournament,
  userName: string,
): Promise<void> {
  const text = `📝 Заявка: ${userName} → ${tournament.name}`;
  for (const ch of resolveChannelIds(tournament.sport)) {
    await sendToChannel(api, ch, text);
  }
}

export async function notifyUser(api: Api, userId: number, text: string): Promise<void> {
  try {
    await api.sendMessageToUser(userId, text, { format: 'html' });
  } catch (err) {
    logger.warn('User notify failed', { userId, err });
  }
}
