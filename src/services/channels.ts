import { Keyboard, type Api } from '@maxhub/max-bot-api';
import type { AttachmentRequest } from '@maxhub/max-bot-api/types';
import { env, getDeepLink } from '../config/env.js';
import { SPORT_CHANNEL_IDS, calculateAge, getSportCategory } from '../config/profile.js';
import { TXT, fmt } from '../texts.js';
import { logger } from '../logger.js';
import { storage } from '../storage/jsonStorage.js';
import type {
  CompletedGame,
  GameOffer,
  SportType,
  Tournament,
  UserProfile,
} from '../types/models.js';

type ChannelExtra = {
  attachments?: AttachmentRequest[];
  disable_link_preview?: boolean;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function removeCountryFlag(country: string): string {
  return country.replace(/[\u{1F1E6}-\u{1F1FF}]/gu, '').trim();
}

function formatRating(rating: number): string {
  if (Number.isInteger(rating)) return String(rating);
  return rating.toFixed(1).replace(/\.0$/, '').replace(/(\.\d*?)0+$/, '$1');
}

function formatCity(city: string, district?: string): string {
  if (district) return `${city} - ${district}`;
  return city || '—';
}

function formatLocation(city: string, country?: string, district?: string): string {
  const cityPart = formatCity(city, district);
  if (!country) return cityPart;
  return `${cityPart}, ${removeCountryFlag(country)}`;
}

function createUserProfileLink(profile: Pick<UserProfile, 'first_name' | 'last_name' | 'max_user_id'>): string {
  const name = escapeHtml(`${profile.first_name} ${profile.last_name}`.trim());
  return `<a href="${getDeepLink(`profile_${profile.max_user_id}`)}">${name}</a>`;
}

function isTrainer(profile: UserProfile): boolean {
  return profile.role.includes('Тренер');
}

function linkButton(text: string, url: string): AttachmentRequest {
  return Keyboard.inlineKeyboard([[Keyboard.button.link(text, url)]]);
}

function photoAttachment(photoPath?: string): AttachmentRequest | undefined {
  if (!photoPath) return undefined;
  return { type: 'image', payload: { url: photoPath } };
}

async function sendToChannel(
  api: Api,
  channelId: string,
  text: string,
  extra: ChannelExtra = {},
): Promise<void> {
  if (!channelId) return;
  try {
    const chatId = Number(channelId);
    await api.sendMessageToChat(chatId, text, {
      format: 'html',
      disable_link_preview: extra.disable_link_preview ?? true,
      attachments: extra.attachments,
    });
  } catch (err) {
    logger.warn('Channel send failed', { channelId, err });
  }
}

function resolveChannelIds(sport: SportType, city?: string): string[] {
  const mapped = SPORT_CHANNEL_IDS[sport];
  if (mapped?.length) {
    if (mapped.length > 1 && city === 'Санкт-Петербург') return [mapped[1]];
    return [mapped[0]];
  }
  if (env.CHANNEL_ID) return [env.CHANNEL_ID];
  return [];
}

function yearsOld(profile: UserProfile): string {
  if (!profile.birth_date) return '';
  const age = calculateAge(profile.birth_date);
  if (!age || age <= 0) return '';
  return fmt(TXT.channels.years_old, { age });
}

export async function sendRegistrationNotification(
  api: Api,
  profile: UserProfile,
): Promise<void> {
  const city = formatCity(profile.city, profile.district);
  const country = escapeHtml(removeCountryFlag(profile.country || ''));
  const ageText = yearsOld(profile);
  const gender = profile.gender || '';
  const genderEmoji = gender === 'Мужской' ? '👨' : gender === 'Женский' ? '👩' : '👤';
  const category = getSportCategory(profile.sport);
  const sportEscaped = escapeHtml(profile.sport);
  let text: string;

  if (isTrainer(profile)) {
    text = `${TXT.channels.new_trainer}\n\n`;
    text += `🏆 ${TXT.channels.trainer} ${createUserProfileLink(profile)}\n`;
    text += `📍 ${TXT.channels.city} ${escapeHtml(city)} (${country})\n`;
    if (ageText && gender) {
      text += `${genderEmoji} ${TXT.channels.age} ${escapeHtml(ageText)}\n`;
    } else if (ageText) {
      text += `${genderEmoji} ${TXT.channels.age} ${escapeHtml(ageText)}\n`;
    } else if (gender) {
      text += `${genderEmoji} ${TXT.channels.gender} ${escapeHtml(gender)}\n`;
    }
    text += `🎯 ${TXT.channels.sport} ${sportEscaped}\n`;
    text += `💰 ${TXT.channels.price} ${escapeHtml(String(profile.price ?? 0))} руб./тренировка\n`;
  } else {
    text = `${TXT.channels.new_player}\n\n`;
    text += `👤 ${TXT.channels.player} ${createUserProfileLink(profile)}\n`;
    text += `📍 ${TXT.channels.city} ${escapeHtml(city)} (${country})\n`;
    if (ageText && gender) {
      text += `${genderEmoji} ${TXT.channels.age} ${escapeHtml(ageText)}\n`;
    } else if (ageText) {
      text += `${genderEmoji} ${TXT.channels.age} ${escapeHtml(ageText)}\n`;
    }
    text += `🎯 ${TXT.channels.sport} ${sportEscaped}\n`;
    if (profile.player_level) {
      text += `💪 ${TXT.channels.level} ${escapeHtml(profile.player_level)}\n`;
    }
    if (profile.rating_points > 0) {
      text += `⭐ ${TXT.channels.rating} ${formatRating(profile.rating_points)}\n`;
    }
  }

  if (category === 'dating') {
    if (profile.dating_goal) {
      text += `💕 ${TXT.channels.dating_goal} ${escapeHtml(profile.dating_goal)}\n`;
    }
    if (profile.dating_interests?.length) {
      text += `🎯 ${TXT.channels.interests} ${escapeHtml(profile.dating_interests.join(', '))}\n`;
    }
    if (profile.dating_additional) {
      text += `📝 ${TXT.channels.about} ${escapeHtml(profile.dating_additional)}`;
    }
  } else if (category === 'meeting') {
    if (profile.meeting_time) {
      const emoji = profile.sport === '☕️Бизнес-завтрак' ? '☕️' : '🍻';
      text += `${emoji} ${TXT.channels.meeting_time} ${escapeHtml(profile.meeting_time)}`;
    }
  } else if (category === 'outdoor_sport') {
    if (profile.profile_comment) {
      text += `💬 ${TXT.channels.about} ${escapeHtml(profile.profile_comment)}`;
    }
  } else {
    if (profile.default_payment) {
      text += `\n💳 ${TXT.channels.court_payment} ${escapeHtml(profile.default_payment)}\n`;
    }
    if (profile.profile_comment) {
      text += `💬 ${TXT.channels.about} ${escapeHtml(profile.profile_comment)}`;
    }
  }

  const attachments: AttachmentRequest[] = [];
  const photo = photoAttachment(profile.photo_path);
  if (photo) attachments.push(photo);

  for (const ch of resolveChannelIds(profile.sport, profile.city)) {
    await sendToChannel(api, ch, text, { attachments: attachments.length ? attachments : undefined });
  }
}

export async function sendGameOfferToChannel(
  api: Api,
  profile: UserProfile,
  offer: GameOffer,
): Promise<void> {
  let profileLink = createUserProfileLink(profile);
  const age = calculateAge(profile.birth_date);
  if (age > 0) {
    profileLink += `\n${TXT.channels.age} ${age}`;
  }

  const category = getSportCategory(offer.sport);
  const location = escapeHtml(formatLocation(offer.city, offer.country, offer.district));
  const date = escapeHtml(offer.date || '—');
  const time = escapeHtml(offer.time || '—');
  let text: string;

  if (category === 'dating') {
    text = `${TXT.channels.dating_profile}\n\n`;
    text += `👤 ${profileLink}\n`;
    text += `📍 ${TXT.channels.city} ${location}\n`;
    text += `📅 ${TXT.channels.date_time} ${date} в ${time}\n`;
    if (offer.dating_goal) {
      text += `💕 ${TXT.channels.dating_goal} ${escapeHtml(offer.dating_goal)}\n`;
    }
    if (offer.dating_interests?.length) {
      text += `🎯 ${TXT.channels.interests} ${escapeHtml(offer.dating_interests.join(', '))}\n`;
    }
    if (offer.dating_additional) {
      text += `📝 ${TXT.channels.about} ${escapeHtml(offer.dating_additional)}\n`;
    }
  } else if (category === 'meeting') {
    const title = offer.sport === '☕️Бизнес-завтрак'
      ? TXT.channels.business_breakfast_offer
      : TXT.channels.beer_meeting_offer;
    text = `${title}\n\n`;
    text += `👤 ${profileLink}\n`;
    text += `📍 ${TXT.channels.city} ${location}\n`;
    text += `📅 ${TXT.channels.date_time} ${date} в ${time}\n`;
  } else if (category === 'outdoor_sport') {
    text = `${TXT.channels.activity_offer}\n\n`;
    text += `👤 ${profileLink}\n`;
    text += `📍 ${TXT.channels.city} ${location}\n`;
    text += `📅 ${TXT.channels.date_time} ${date} в ${time}\n`;
    text += `🎯 ${TXT.channels.sport} ${escapeHtml(offer.sport)}\n`;
  } else {
    const levelText = offer.sport === '🏓Настольный теннис'
      ? fmt(TXT.channels.table_tennis_rating, { rating: profile.player_level ?? '—' })
      : `🏆 ${TXT.channels.level} ${escapeHtml(profile.player_level ?? '—')} ${fmt(TXT.channels.rating_points, { points: profile.rating_points ?? 0 })}`;

    text = `${TXT.channels.game_offer}\n\n`;
    text += `👤 ${profileLink}\n`;
    text += `${levelText}\n`;
    text += `📍 ${TXT.channels.city} ${location}\n`;
    text += `📅 ${TXT.channels.date_time} ${date} в ${time}\n`;
    text += `🎯 ${TXT.channels.sport} ${escapeHtml(offer.sport)}\n`;
    text += `🔍 ${TXT.channels.game_type} ${escapeHtml(offer.game_type || '—')}\n`;
    text += `💳 ${TXT.channels.payment} ${escapeHtml(offer.payment_type || '—')}`;
    if (offer.competitive) {
      text += `\n${TXT.channels.competitive_game}`;
    }
  }

  if (offer.comment) {
    text += `\n💬 ${TXT.channels.comment} ${escapeHtml(offer.comment)}`;
  }

  const attachments: AttachmentRequest[] = [];
  const photo = photoAttachment(profile.photo_path);
  if (photo) attachments.push(photo);

  for (const ch of resolveChannelIds(offer.sport, offer.city)) {
    await sendToChannel(api, ch, text, { attachments: attachments.length ? attachments : undefined });
  }
}

function ratingLine(
  name: string,
  before: number,
  after: number,
): string {
  const change = after - before;
  const changeStr = change > 0 ? `+${formatRating(change)}` : formatRating(change);
  return `• ${escapeHtml(name)}: ${formatRating(before)} → ${formatRating(after)} (${changeStr})`;
}

export async function sendGameNotificationToChannel(
  api: Api,
  game: CompletedGame,
  profiles: Map<number, UserProfile> | Record<number, UserProfile>,
): Promise<void> {
  const getProfile = (id: number): UserProfile => {
    if (profiles instanceof Map) return profiles.get(id) ?? { first_name: '?', last_name: '', max_user_id: id } as UserProfile;
    return profiles[id] ?? { first_name: '?', last_name: '', max_user_id: id } as UserProfile;
  };

  const score = escapeHtml(game.sets.join(', '));
  let text = '';
  const attachments: AttachmentRequest[] = [];

  if (game.media_path) {
    const media = photoAttachment(game.media_path);
    if (media) attachments.push(media);
  }

  if (game.game_type === 'tournament') {
    const p1 = getProfile(game.players[0]);
    const p2 = getProfile(game.players[1]);
    const winnerId = game.winner_ids[0];
    const winner = winnerId === p1.max_user_id ? p1 : p2;
    const loser = winnerId === p1.max_user_id ? p2 : p1;
    let tournamentName: string = TXT.channels.unknown_tournament;
    if (game.tournament_id) {
      const tourn = await storage.getTournament(game.tournament_id);
      tournamentName = tourn?.name ?? tournamentName;
    }
    text = `${TXT.channels.tournament_game_completed}\n\n`;
    text += `🏆 ${TXT.channels.tournament} ${escapeHtml(tournamentName)}\n\n`;
    text += `🥇 ${fmt(TXT.channels.winner_beats, {
      winner: createUserProfileLink(winner),
      loser: createUserProfileLink(loser),
    })}\n\n`;
    text += `📊 ${TXT.channels.score} ${score}`;
  } else if (game.game_type === 'single') {
    const p1 = getProfile(game.players[0]);
    const p2 = getProfile(game.players[1]);
    const winnerId = game.winner_ids[0];
    const winner = winnerId === p1.max_user_id ? p1 : p2;
    const loser = winnerId === p1.max_user_id ? p2 : p1;
    const updates = game.rating_updates ?? {};
    const wUpd = updates[String(winner.max_user_id)];
    const lUpd = updates[String(loser.max_user_id)];

    text = `${TXT.channels.single_game_completed}\n\n`;
    text += `🥇 ${TXT.channels.winner} ${createUserProfileLink(winner)}\n`;
    text += `🥈 ${TXT.channels.loser} ${createUserProfileLink(loser)}\n\n`;
    text += `📊 ${TXT.channels.score} ${score}\n\n`;
    text += `📈 ${TXT.channels.rating_change}\n`;
    if (wUpd) text += `${ratingLine(winner.first_name, wUpd.before, wUpd.after)}\n`;
    if (lUpd) text += `${ratingLine(loser.first_name, lUpd.before, lUpd.after)}`;
  } else {
    const [t1p1, t1p2, t2p1, t2p2] = game.players.map(getProfile);
    const team1Won = game.winner_ids.includes(t1p1.max_user_id);
    const winners = team1Won ? [t1p1, t1p2] : [t2p1, t2p2];
    const losers = team1Won ? [t2p1, t2p2] : [t1p1, t1p2];
    const updates = game.rating_updates ?? {};

    text = `${TXT.channels.double_game_completed}\n\n`;
    text += `🥇 ${TXT.channels.winning_team} ${createUserProfileLink(winners[0])} и ${createUserProfileLink(winners[1])}\n`;
    text += `🥈 ${TXT.channels.losing_team} ${createUserProfileLink(losers[0])} и ${createUserProfileLink(losers[1])}\n\n`;
    text += `📊 ${TXT.channels.score} ${score}\n\n`;
    text += `📈 ${TXT.channels.rating_change}\n`;
    for (const p of [...winners, ...losers]) {
      const upd = updates[String(p.max_user_id)];
      if (upd) text += `${ratingLine(p.first_name, upd.before, upd.after)}\n`;
    }
  }

  if (!attachments.length) {
    for (const id of game.players) {
      const photo = photoAttachment(getProfile(id).photo_path);
      if (photo) attachments.push(photo);
    }
  }

  const buttons: AttachmentRequest[] = [];
  if (game.game_type === 'tournament' && game.tournament_id) {
    buttons.push(linkButton(
      TXT.channels.view_tournament,
      getDeepLink(`view_tournament_${game.tournament_id}`),
    ));
  }

  for (const ch of resolveChannelIds(game.sport)) {
    await sendToChannel(api, ch, text, {
      attachments: [...attachments, ...buttons].length ? [...attachments, ...buttons] : undefined,
    });
  }
}

export async function sendTourToChannel(
  api: Api,
  profile: UserProfile,
): Promise<void> {
  const city = formatCity(profile.vacation_city ?? profile.city, profile.vacation_district);
  const country = removeCountryFlag(profile.vacation_country ?? profile.country ?? '—');
  let text = `${fmt(TXT.channels.tour_title, { sport: escapeHtml(profile.sport) })}\n\n`;
  text += `👤 ${createUserProfileLink(profile)}\n`;
  text += `🌍 ${TXT.channels.destination} ${escapeHtml(city)}, ${escapeHtml(country)}\n`;
  text += `📅 ${TXT.channels.dates} ${escapeHtml(profile.vacation_start ?? '')} - ${escapeHtml(profile.vacation_end ?? '')}`;
  if (profile.vacation_comment) {
    text += `\n💬 ${TXT.channels.comment} ${escapeHtml(profile.vacation_comment)}`;
  }

  const attachments: AttachmentRequest[] = [];
  const photo = photoAttachment(profile.photo_path);
  if (photo) attachments.push(photo);

  await sendToChannel(api, env.TOUR_CHANNEL_ID || env.CHANNEL_ID, text, {
    attachments: attachments.length ? attachments : undefined,
  });
}

function tournamentLocation(tournament: Tournament): string {
  return escapeHtml(formatLocation(tournament.city, tournament.country, tournament.district));
}

function tournamentGenderLabel(tournament: Tournament): string {
  const gender = tournament.gender || 'Не указан';
  return gender === 'Женская пара' ? 'Пара' : gender;
}

export async function sendTournamentCreatedToChannel(
  api: Api,
  tournament: Tournament,
): Promise<void> {
  let text = `🏆 ${fmt(TXT.channels.tournament_name, { name: escapeHtml(tournament.name) })}\n\n`;
  text += `🌍 ${TXT.channels.city} ${tournamentLocation(tournament)}\n`;
  text += `🎯 ${TXT.channels.tournament_type} ${escapeHtml(tournament.type)} • ${escapeHtml(tournamentGenderLabel(tournament))}\n`;
  text += `🏅 ${TXT.channels.category} ${escapeHtml(tournament.category)}\n`;
  text += `🧩 ${TXT.channels.tournament_level} ${escapeHtml(tournament.level || 'Не указан')}\n`;
  text += `👶 ${TXT.channels.age_group} ${escapeHtml(tournament.age_group)}\n`;
  text += `⏱ ${TXT.channels.duration} ${escapeHtml(tournament.duration)}\n`;
  text += `👥 ${TXT.channels.participants} ${tournament.participants_count}\n`;
  if (tournament.comment) {
    text += `\n💬 ${TXT.channels.description} ${escapeHtml(tournament.comment)}`;
  }

  const keyboard = linkButton(
    TXT.channels.join,
    getDeepLink(`join_tournament_${tournament.id}`),
  );

  for (const ch of resolveChannelIds(tournament.sport, tournament.city)) {
    await sendToChannel(api, ch, text, { attachments: [keyboard] });
  }
}

export async function sendTournamentStartedToChannel(
  api: Api,
  tournament: Tournament,
  bracketText?: string,
): Promise<void> {
  let text = `${TXT.channels.tournament_started}\n\n`;
  text += `🏆 ${fmt(TXT.channels.tournament_name, { name: escapeHtml(tournament.name) })}\n\n`;
  text += `🌍 ${TXT.channels.city} ${tournamentLocation(tournament)}\n`;
  text += `🎯 ${TXT.channels.tournament_type} ${escapeHtml(tournament.type)} • ${escapeHtml(tournamentGenderLabel(tournament))}\n`;
  text += `🏅 ${TXT.channels.category} ${escapeHtml(tournament.category)}\n`;
  text += `🧩 ${TXT.channels.tournament_level} ${escapeHtml(tournament.level || 'Не указан')}\n`;
  text += `👥 ${TXT.channels.participants} ${Object.keys(tournament.participants).length}\n\n`;
  text += TXT.channels.tournament_follow;
  if (bracketText) {
    text += `\n\n${escapeHtml(bracketText)}`;
  }

  const keyboard = linkButton(
    TXT.channels.view_tournament,
    getDeepLink(`view_tournament_${tournament.id}`),
  );

  for (const ch of resolveChannelIds(tournament.sport, tournament.city)) {
    await sendToChannel(api, ch, text, { attachments: [keyboard] });
  }
}

export async function sendTournamentApplicationToChannel(
  api: Api,
  tournament: Tournament,
  profile: UserProfile,
): Promise<void> {
  const current = Object.keys(tournament.participants).length;
  let text = `${TXT.channels.new_participant}\n\n`;
  text += `🏆 ${TXT.channels.tournament} ${escapeHtml(tournament.name)}\n`;
  text += `👤 ${TXT.channels.player} ${createUserProfileLink(profile)}\n`;
  text += `👥 ${TXT.channels.participants} ${current}/${tournament.participants_count}\n\n`;
  text += TXT.channels.join_and_participate;

  const attachments: AttachmentRequest[] = [];
  const photo = photoAttachment(profile.photo_path);
  if (photo) attachments.push(photo);
  attachments.push(linkButton(
    TXT.channels.join,
    getDeepLink(`join_tournament_${tournament.id}`),
  ));

  for (const ch of resolveChannelIds(tournament.sport, tournament.city)) {
    await sendToChannel(api, ch, text, { attachments });
  }
}

export async function notifyUser(api: Api, userId: number, text: string): Promise<void> {
  try {
    await api.sendMessageToUser(userId, text, { format: 'html' });
  } catch (err) {
    logger.warn('User notify failed', { userId, err });
  }
}
