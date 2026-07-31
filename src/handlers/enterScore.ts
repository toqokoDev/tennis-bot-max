import { TXT, fmt } from '../texts.js';
import { Keyboard } from '@maxhub/max-bot-api';
import type { AttachmentRequest } from '@maxhub/max-bot-api/types';
import type { AppContext } from '../context.js';
import { getMessageText } from '../context.js';
import { isAdmin } from '../config/env.js';
import { calculateAge, ratingPointsToLevel } from '../config/profile.js';
import { storage } from '../storage/jsonStorage.js';
import { clearState, getState, getStateData, setState } from '../middleware/session.js';
import { AddScoreState } from '../types/states.js';
import { paginate, showCurrentMessage, showMainMenu } from '../utils/bot.js';
import {
  buildGameTypeKeyboard,
  buildSetScoreKeyboard,
  buildSupertiebreakKeyboard,
  countSetWins,
  formatSetsText,
} from '../utils/game.js';
import {
  buildRatingUpdates,
  formatGameResultSummary,
  fullName,
} from '../utils/gameResult.js';
import { applyRatingUpdate, calculateNewRatings, clampRating } from '../utils/rating.js';
import { hasProSubscription } from '../utils/validation.js';
import { sendGameNotificationToChannel } from '../services/channels.js';
import { getCallbackPayload } from '../utils/callback.js';
import { requireRegistered } from './registration.js';
import { getCtxUserId } from '../context.js';
import type { CompletedGame, UserProfile } from '../types/models.js';

const USERS_PER_PAGE = 8;

type ScoreData = {
  game_type?: 'single' | 'double' | 'tournament';
  partner_id?: number;
  opponent_id?: number;
  opponent1_id?: number;
  opponent2_id?: number;
  tournament_id?: string;
  sets?: string[];
  search_page?: number;
  search_results?: number[];
  search_action?: 'select_partner' | 'select_opponent' | 'select_opponent1' | 'select_opponent2';
  winner_side?: 'team1' | 'team2';
  media_path?: string;
  media_token?: string;
  media_type?: 'image' | 'video';
  media_pending?: 'photo' | 'video';
  result_summary?: string;
};

type UserSelectAction = NonNullable<ScoreData['search_action']>;

function shortName(user: UserProfile): string {
  if (user.last_name) return `${user.first_name[0]}. ${user.last_name}`;
  return user.first_name;
}

function formatUserLabel(user: UserProfile): string {
  const genderIcon = user.gender === 'Мужской' ? '👨' : user.gender === 'Женский' ? '👩' : '👤';
  const age = calculateAge(user.birth_date);
  let label = `${genderIcon} ${shortName(user)} ${age} лет`;
  if (user.player_level && user.rating_points) {
    label += ` ${user.player_level} (${user.rating_points})`;
  }
  return label;
}

function backOnlyKeyboard() {
  return Keyboard.inlineKeyboard([[Keyboard.button.callback(TXT.common.back, 'score_back')]]);
}

function findUsersByQuery(
  all: Record<string, UserProfile>,
  query: string,
  excludeIds: number[],
): UserProfile[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  return Object.values(all).filter((u) => {
    if (excludeIds.includes(u.max_user_id)) return false;
    const first = u.first_name.toLowerCase();
    const last = u.last_name.toLowerCase();
    return first.includes(q) || last.includes(q) || `${first} ${last}`.includes(q);
  });
}

function getExcludeIds(data: ScoreData, selfId: number): number[] {
  const ids = [selfId];
  if (data.partner_id) ids.push(data.partner_id);
  if (data.opponent_id) ids.push(data.opponent_id);
  if (data.opponent1_id) ids.push(data.opponent1_id);
  if (data.opponent2_id) ids.push(data.opponent2_id);
  return ids;
}

async function loadUser(userId: number): Promise<UserProfile | null> {
  const user = await storage.getUser(userId);
  return user ?? null;
}

function checkSportMatch(current: UserProfile, other: UserProfile): string | null {
  if (current.sport !== other.sport) {
    return fmt(TXT.enter_score.sport_mismatch, { current: current.sport, other: other.sport });
  }
  return null;
}

async function showUserList(
  ctx: AppContext,
  data: ScoreData,
  action: UserSelectAction,
  title: string,
  state: AddScoreState,
  mode: 'new' | 'edit' = 'edit',
): Promise<void> {
  const all = await storage.getUsers();
  const ids = data.search_results ?? [];
  const users = ids.map((id) => all[String(id)]).filter(Boolean) as UserProfile[];
  const page = data.search_page ?? 1;
  const { items, page: p, totalPages } = paginate(users, page, USERS_PER_PAGE);

  data.search_action = action;
  data.search_page = p;
  await setState(ctx, state, data);

  const buttons = items.map((u) => [
    Keyboard.button.callback(formatUserLabel(u), `${action}:${u.max_user_id}`),
  ]);
  const nav: ReturnType<typeof Keyboard.button.callback>[] = [];
  if (p > 1) nav.push(Keyboard.button.callback('⬅️', `score_nav:${action}:${p - 1}`));
  if (p < totalPages) nav.push(Keyboard.button.callback('➡️', `score_nav:${action}:${p + 1}`));
  if (nav.length) buttons.push(nav);
  buttons.push([Keyboard.button.callback(TXT.common.back, 'score_back')]);

  await showCurrentMessage(ctx, title, {
    attachments: [Keyboard.inlineKeyboard(buttons)],
  }, mode);
}

async function runUserSearch(
  ctx: AppContext,
  query: string,
  action: UserSelectAction,
  listState: AddScoreState,
  title: string,
): Promise<void> {
  const data = getStateData<ScoreData>(ctx);
  const selfId = getCtxUserId(ctx);
  const all = await storage.getUsers();
  const results = findUsersByQuery(all, query, getExcludeIds(data, selfId));

  if (!results.length) {
    await showCurrentMessage(ctx, TXT.enter_score.users_not_found, {
      attachments: [backOnlyKeyboard()],
    }, 'new');
    return;
  }

  data.search_results = results.map((u) => u.max_user_id);
  data.search_page = 1;
  await showUserList(ctx, data, action, title, listState, 'new');
}

async function showSearchPrompt(
  ctx: AppContext,
  state: AddScoreState,
  text: string,
  data: ScoreData,
): Promise<void> {
  await setState(ctx, state, data);
  await showCurrentMessage(ctx, text, { attachments: [backOnlyKeyboard()] });
}

async function showTournamentList(ctx: AppContext, data: ScoreData): Promise<void> {
  const selfId = getCtxUserId(ctx);
  const all = await storage.getTournaments();
  const tournaments = Object.values(all).filter(
    (t) => t.status === 'started'
      && t.participants[String(selfId)]
      && Object.keys(t.participants).length >= 2,
  );

  await setState(ctx, AddScoreState.SELECTING_TOURNAMENT, data);

  if (!tournaments.length) {
    await showCurrentMessage(ctx, TXT.enter_score.no_tournaments, {
      attachments: [backOnlyKeyboard()],
    });
    return;
  }

  const buttons = tournaments.map((t) => [
    Keyboard.button.callback(`${t.name} (${t.city})`, `tournament_score:select:${t.id}`),
  ]);
  buttons.push([Keyboard.button.callback(TXT.common.back, 'score_back')]);

  await showCurrentMessage(ctx, TXT.enter_score.select_tournament, {
    attachments: [Keyboard.inlineKeyboard(buttons)],
  });
}

function alreadyPlayedInTournament(
  games: CompletedGame[],
  tournamentId: string,
  userA: number,
  userB: number,
): boolean {
  return games.some(
    (g) => g.tournament_id === tournamentId
      && g.players.includes(userA)
      && g.players.includes(userB),
  );
}

async function showTournamentOpponents(
  ctx: AppContext,
  tournamentId: string,
  data: ScoreData,
): Promise<void> {
  const selfId = getCtxUserId(ctx);
  const tourn = await storage.getTournament(tournamentId);
  if (!tourn || tourn.status !== 'started') {
    await showTournamentList(ctx, data);
    return;
  }

  const games = await storage.getGames();
  const all = await storage.getUsers();
  const opponents = Object.values(tourn.participants)
    .filter((p) => p.user_id !== selfId)
    .filter((p) => !alreadyPlayedInTournament(games, tournamentId, selfId, p.user_id))
    .map((p) => all[String(p.user_id)])
    .filter(Boolean) as UserProfile[];

  data.tournament_id = tournamentId;
  await setState(ctx, AddScoreState.SELECTING_TOURNAMENT_OPPONENT, data);

  if (!opponents.length) {
    await showCurrentMessage(ctx, TXT.enter_score.no_tournament_opponents, {
      attachments: [backOnlyKeyboard()],
    });
    return;
  }

  const buttons = opponents.map((u) => [
    Keyboard.button.callback(`👤 ${fullName(u)}`, `tournament_score:opponent:${tournamentId}:${u.max_user_id}`),
  ]);
  buttons.push([Keyboard.button.callback(TXT.common.back, 'score_back')]);

  await showCurrentMessage(ctx, TXT.enter_score.select_tournament_opponent, {
    attachments: [Keyboard.inlineKeyboard(buttons)],
  });
}

async function showSetScore(ctx: AppContext, setNumber: number): Promise<void> {
  const data = getStateData<ScoreData>(ctx);
  await setState(ctx, AddScoreState.SELECTING_SET_SCORE, data);
  await showCurrentMessage(ctx, fmt(TXT.enter_score.choose_set_score, { n: setNumber }), {
    attachments: [buildSetScoreKeyboard(setNumber)],
  });
}

async function showAfterOpponentSelected(ctx: AppContext, opponent: UserProfile): Promise<void> {
  const user = await requireRegistered(ctx);
  if (!user) return;
  const data = getStateData<ScoreData>(ctx);
  data.opponent_id = opponent.max_user_id;
  data.sets = [];
  await setState(ctx, AddScoreState.SELECTING_SET_SCORE, data);
  await showCurrentMessage(ctx, fmt(TXT.enter_score.opponent_selected, {
    name: fullName(opponent),
    rating: user.rating_points,
  }), {
    attachments: [buildSetScoreKeyboard(1)],
  });
}

async function showAfterDoubleFormed(ctx: AppContext): Promise<void> {
  const user = await requireRegistered(ctx);
  if (!user) return;
  const data = getStateData<ScoreData>(ctx);
  const partner = data.partner_id ? await loadUser(data.partner_id) : null;
  const opp1 = data.opponent1_id ? await loadUser(data.opponent1_id) : null;
  const opp2 = data.opponent2_id ? await loadUser(data.opponent2_id) : null;
  if (!partner || !opp1 || !opp2) return;

  data.sets = [];
  await setState(ctx, AddScoreState.SELECTING_SET_SCORE, data);
  const team1Avg = Math.round((user.rating_points + partner.rating_points) / 2);
  const team2Avg = Math.round((opp1.rating_points + opp2.rating_points) / 2);
  await showCurrentMessage(ctx, fmt(TXT.enter_score.pairs_formed, {
    team1_p1: fullName(user),
    team1_p2: fullName(partner),
    team1_avg: team1Avg,
    team2_p1: fullName(opp1),
    team2_p2: fullName(opp2),
    team2_avg: team2Avg,
  }), {
    attachments: [buildSetScoreKeyboard(1)],
  });
}

async function showAddAnotherSet(ctx: AppContext): Promise<void> {
  const data = getStateData<ScoreData>(ctx);
  await setState(ctx, AddScoreState.ADDING_ANOTHER_SET, data);
  await showCurrentMessage(ctx, fmt(TXT.enter_score.current_score, {
    score: formatSetsText(data.sets ?? []),
  }), {
    attachments: [Keyboard.inlineKeyboard([
      [Keyboard.button.callback(TXT.enter_score.add_set_yes, 'add_another_set:yes')],
      [Keyboard.button.callback(TXT.enter_score.add_set_no, 'add_another_set:no')],
      [Keyboard.button.callback(TXT.common.back, 'score_back')],
    ])],
  });
}

function getMessageMedia(ctx: AppContext): { type: 'image' | 'video'; url: string; token?: string } | null {
  const attachments = ctx.message?.body.attachments;
  if (!attachments) return null;
  const image = attachments.find((a) => a.type === 'image');
  if (image?.type === 'image') {
    return { type: 'image', url: image.payload.url, token: image.payload.token };
  }
  const video = attachments.find((a) => a.type === 'video');
  if (video?.type === 'video') {
    return { type: 'video', url: video.payload.url, token: video.payload.token };
  }
  return null;
}

function cloneProfile(profile: UserProfile): UserProfile {
  return { ...profile };
}

function profilesToMap(profiles: UserProfile[]): Map<number, UserProfile> {
  return new Map(profiles.map((p) => [p.max_user_id, p]));
}

type ScoreOutcome = {
  summary: string;
  profiles: UserProfile[];
  game: Omit<CompletedGame, 'id'>;
};

async function computeScoreOutcome(data: ScoreData, user: UserProfile): Promise<ScoreOutcome | null> {
  if (!data.sets?.length) return null;

  const winnerSide = data.winner_side ?? 'team1';
  const sets = data.sets;
  const gameType = data.game_type ?? 'single';

  if (gameType === 'double') {
    const partner = data.partner_id ? await loadUser(data.partner_id) : null;
    const opp1 = data.opponent1_id ? await loadUser(data.opponent1_id) : null;
    const opp2 = data.opponent2_id ? await loadUser(data.opponent2_id) : null;
    if (!partner || !opp1 || !opp2) return null;

    const profiles = [cloneProfile(user), cloneProfile(partner), cloneProfile(opp1), cloneProfile(opp2)];
    const oldRatings = profiles.map((p) => p.rating_points);
    const team1Avg = (user.rating_points + partner.rating_points) / 2;
    const team2Avg = (opp1.rating_points + opp2.rating_points) / 2;
    const winnerAvg = winnerSide === 'team1' ? team1Avg : team2Avg;
    const loserAvg = winnerSide === 'team1' ? team2Avg : team1Avg;
    const { winner, loser } = calculateNewRatings(winnerAvg, loserAvg);
    const deltaWinner = winner - winnerAvg;
    const deltaLoser = loser - loserAvg;

    const applyDelta = (profile: UserProfile, delta: number) => {
      profile.rating_points = clampRating(Math.round(profile.rating_points + delta));
      profile.player_level = ratingPointsToLevel(profile.rating_points);
      profile.games_played += 1;
    };

    if (winnerSide === 'team1') {
      applyDelta(profiles[0], deltaWinner);
      applyDelta(profiles[1], deltaWinner);
      applyDelta(profiles[2], deltaLoser);
      applyDelta(profiles[3], deltaLoser);
      profiles[0].games_wins += 1;
      profiles[1].games_wins += 1;
    } else {
      applyDelta(profiles[2], deltaWinner);
      applyDelta(profiles[3], deltaWinner);
      applyDelta(profiles[0], deltaLoser);
      applyDelta(profiles[1], deltaLoser);
      profiles[2].games_wins += 1;
      profiles[3].games_wins += 1;
    }

    const game: Omit<CompletedGame, 'id'> = {
      sport: user.sport,
      game_type: 'double',
      players: [user.max_user_id, partner.max_user_id, opp1.max_user_id, opp2.max_user_id],
      sets,
      winner_ids: winnerSide === 'team1'
        ? [user.max_user_id, partner.max_user_id]
        : [opp1.max_user_id, opp2.max_user_id],
      media_path: data.media_path,
      rating_updates: buildRatingUpdates(profiles, oldRatings),
      created_at: new Date().toISOString(),
      created_by: user.max_user_id,
    };

    return {
      summary: formatGameResultSummary({ ...game, id: 'preview' }, profilesToMap(profiles)),
      profiles,
      game,
    };
  }

  const opponent = data.opponent_id ? await loadUser(data.opponent_id) : null;
  if (!opponent) return null;

  const profiles = [cloneProfile(user), cloneProfile(opponent)];
  const oldRatings = [user.rating_points, opponent.rating_points];
  const winnerIsUser = winnerSide === 'team1';
  const { winnerPoints, loserPoints, winnerLevel, loserLevel } = applyRatingUpdate(
    winnerIsUser ? user.rating_points : opponent.rating_points,
    winnerIsUser ? opponent.rating_points : user.rating_points,
  );

  if (winnerIsUser) {
    profiles[0].rating_points = winnerPoints;
    profiles[0].player_level = winnerLevel;
    profiles[0].games_played += 1;
    profiles[0].games_wins += 1;
    profiles[1].rating_points = loserPoints;
    profiles[1].player_level = loserLevel;
    profiles[1].games_played += 1;
  } else {
    profiles[1].rating_points = winnerPoints;
    profiles[1].player_level = winnerLevel;
    profiles[1].games_played += 1;
    profiles[1].games_wins += 1;
    profiles[0].rating_points = loserPoints;
    profiles[0].player_level = loserLevel;
    profiles[0].games_played += 1;
  }

  let tournamentName: string | undefined;
  if (gameType === 'tournament' && data.tournament_id) {
    const tourn = await storage.getTournament(data.tournament_id);
    tournamentName = tourn?.name;
  }

  const game: Omit<CompletedGame, 'id'> = {
    sport: user.sport,
    game_type: gameType,
    players: [user.max_user_id, opponent.max_user_id],
    sets,
    winner_ids: [winnerIsUser ? user.max_user_id : opponent.max_user_id],
    tournament_id: data.tournament_id,
    media_path: data.media_path,
    rating_updates: buildRatingUpdates(profiles, oldRatings),
    created_at: new Date().toISOString(),
    created_by: user.max_user_id,
  };

  return {
    summary: formatGameResultSummary({ ...game, id: 'preview' }, profilesToMap(profiles), { tournamentName }),
    profiles,
    game,
  };
}

function mediaKeyboard() {
  return Keyboard.inlineKeyboard([
    [Keyboard.button.callback(TXT.enter_score.add_photo, 'score_media:photo')],
    [Keyboard.button.callback(TXT.enter_score.add_video, 'score_media:video')],
    [Keyboard.button.callback(TXT.common.skip, 'score_media:skip')],
    [Keyboard.button.callback(TXT.common.back, 'score_back')],
  ]);
}

function confirmKeyboard() {
  return Keyboard.inlineKeyboard([
    [Keyboard.button.callback(TXT.common.confirm, 'confirm_score:yes')],
    [Keyboard.button.callback(TXT.enter_score.edit_score, 'confirm_score:edit')],
    [Keyboard.button.callback(TXT.common.cancel, 'confirm_score:no')],
  ]);
}

function buildScoreAttachments(data: ScoreData, keyboard: AttachmentRequest): AttachmentRequest[] {
  const attachments: AttachmentRequest[] = [];
  if (data.media_type === 'video' && data.media_token) {
    attachments.push({ type: 'video', payload: { token: data.media_token } });
  } else if (data.media_path) {
    attachments.push({ type: 'image', payload: { url: data.media_path } });
  }
  attachments.push(keyboard);
  return attachments;
}

async function showMediaStep(ctx: AppContext): Promise<void> {
  const data = getStateData<ScoreData>(ctx);
  data.media_pending = undefined;
  await setState(ctx, AddScoreState.ADDING_MEDIA, data);
  await showCurrentMessage(ctx, TXT.enter_score.attach_media, {
    attachments: [mediaKeyboard()],
  });
}

async function showConfirmation(ctx: AppContext, mode: 'new' | 'edit' = 'edit'): Promise<boolean> {
  const data = getStateData<ScoreData>(ctx);
  const user = await requireRegistered(ctx);
  if (!user || !data.sets?.length) return false;

  const outcome = await computeScoreOutcome(data, user);
  if (!outcome) return false;

  data.result_summary = outcome.summary;
  await setState(ctx, AddScoreState.CONFIRMING_SCORE, data);

  await showCurrentMessage(ctx, fmt(TXT.enter_score.confirm, { summary: outcome.summary }), {
    attachments: buildScoreAttachments(data, confirmKeyboard()),
  }, mode);
  return true;
}

async function completeScoreEntry(ctx: AppContext): Promise<boolean> {
  const data = getStateData<ScoreData>(ctx);
  if (!data.sets?.length) return false;

  const wins = countSetWins(data.sets);
  data.winner_side = wins.team1 >= wins.team2 ? 'team1' : 'team2';
  await setState(ctx, AddScoreState.ADDING_ANOTHER_SET, data);
  await showMediaStep(ctx);
  return true;
}

async function showSavedResult(ctx: AppContext, summary: string, data: ScoreData): Promise<void> {
  const keyboard = Keyboard.inlineKeyboard([
    [Keyboard.button.callback(TXT.common.main_menu, 'main_menu')],
  ]);
  await showCurrentMessage(ctx, `${summary}\n\n${TXT.enter_score.saved}`, {
    attachments: buildScoreAttachments(data, keyboard),
  });
}

async function saveConfirmedScore(ctx: AppContext): Promise<void> {
  const data = getStateData<ScoreData>(ctx);
  const user = await requireRegistered(ctx);
  if (!user || !data.sets?.length) return;

  const outcome = await computeScoreOutcome(data, user);
  if (!outcome) return;

  const gameId = await storage.nextCompletedGameId();
  const game: CompletedGame = { ...outcome.game, id: gameId };
  const games = await storage.getGames();
  games.push(game);
  await storage.saveGames(games);

  for (const profile of outcome.profiles) {
    await storage.saveUser(profile);
  }

  await sendGameNotificationToChannel(ctx.api, game, profilesToMap(outcome.profiles));
  const summary = data.result_summary ?? outcome.summary;
  await clearState(ctx);
  await showSavedResult(ctx, summary, data);
}

async function handleScoreBack(ctx: AppContext): Promise<void> {
  const state = getState(ctx) as AddScoreState | undefined;
  const data = getStateData<ScoreData>(ctx);

  switch (state) {
    case AddScoreState.SELECTING_GAME_TYPE:
      await clearState(ctx);
      await showMainMenu(ctx);
      return;
    case AddScoreState.SELECTING_TOURNAMENT:
      await setState(ctx, AddScoreState.SELECTING_GAME_TYPE, data);
      await showCurrentMessage(ctx, TXT.enter_score.choose_type, {
        attachments: [buildGameTypeKeyboard()],
      });
      return;
    case AddScoreState.SELECTING_TOURNAMENT_OPPONENT:
      await showTournamentList(ctx, data);
      return;
    case AddScoreState.SEARCHING_OPPONENT:
      await setState(ctx, AddScoreState.SELECTING_GAME_TYPE, data);
      await showCurrentMessage(ctx, TXT.enter_score.choose_type, {
        attachments: [buildGameTypeKeyboard()],
      });
      return;
    case AddScoreState.SELECTING_OPPONENT:
      await showSearchPrompt(ctx, AddScoreState.SEARCHING_OPPONENT, TXT.enter_score.search_opponent_prompt, data);
      return;
    case AddScoreState.SELECTING_PARTNER:
      await setState(ctx, AddScoreState.SELECTING_GAME_TYPE, data);
      await showCurrentMessage(ctx, TXT.enter_score.choose_type, {
        attachments: [buildGameTypeKeyboard()],
      });
      return;
    case AddScoreState.SEARCHING_PARTNER:
      await showSearchPrompt(ctx, AddScoreState.SELECTING_PARTNER, TXT.enter_score.search_partner_prompt, data);
      return;
    case AddScoreState.SEARCHING_OPPONENT1:
      await showSearchPrompt(ctx, AddScoreState.SEARCHING_PARTNER, TXT.enter_score.search_partner_prompt, data);
      return;
    case AddScoreState.SELECTING_OPPONENT1:
      await showSearchPrompt(ctx, AddScoreState.SEARCHING_OPPONENT1, TXT.enter_score.search_opponent1_prompt, data);
      return;
    case AddScoreState.SEARCHING_OPPONENT2:
      await showSearchPrompt(ctx, AddScoreState.SELECTING_OPPONENT1, TXT.enter_score.search_opponent1_prompt, data);
      return;
    case AddScoreState.SELECTING_OPPONENT2:
      await showSearchPrompt(ctx, AddScoreState.SEARCHING_OPPONENT2, TXT.enter_score.search_opponent2_prompt, data);
      return;
    case AddScoreState.SELECTING_SET_SCORE:
    case AddScoreState.ADDING_ANOTHER_SET:
      if (data.game_type === 'tournament' && data.tournament_id) {
        await showTournamentOpponents(ctx, data.tournament_id, data);
      } else if (data.game_type === 'double') {
        if (data.search_results?.length) {
          data.search_page = 1;
          await showUserList(ctx, data, 'select_opponent2', TXT.enter_score.select_opponent2, AddScoreState.SELECTING_OPPONENT2);
        } else {
          await showSearchPrompt(ctx, AddScoreState.SEARCHING_OPPONENT2, TXT.enter_score.search_opponent2_prompt, data);
        }
      } else if (data.search_results?.length) {
        data.search_page = 1;
        await showUserList(ctx, data, 'select_opponent', TXT.enter_score.select_opponent, AddScoreState.SELECTING_OPPONENT);
      } else {
        await showSearchPrompt(ctx, AddScoreState.SEARCHING_OPPONENT, TXT.enter_score.search_opponent_prompt, data);
      }
      return;
    case AddScoreState.CONFIRMING_SCORE:
      await showMediaStep(ctx);
      return;
    case AddScoreState.ADDING_MEDIA:
      if (data.media_pending) {
        await showMediaStep(ctx);
      } else {
        await showAddAnotherSet(ctx);
      }
      return;
    default:
      await clearState(ctx);
      await showMainMenu(ctx);
  }
}

export async function startEnterScore(ctx: AppContext): Promise<void> {
  const user = await requireRegistered(ctx);
  if (!user) return;
  if (!hasProSubscription(user) && !isAdmin(user.max_user_id)) {
    await ctx.reply(TXT.enter_score.pro_required);
    return;
  }
  await setState(ctx, AddScoreState.SELECTING_GAME_TYPE, {});
  await showCurrentMessage(ctx, TXT.enter_score.choose_type, {
    attachments: [buildGameTypeKeyboard()],
  });
}

export async function handleScoreMessage(ctx: AppContext): Promise<boolean> {
  const state = getState(ctx);
  if (!state || !Object.values(AddScoreState).includes(state as AddScoreState)) return false;

  if (state === AddScoreState.ADDING_MEDIA) {
    const data = getStateData<ScoreData>(ctx);
    if (!data.media_pending) return false;

    const media = getMessageMedia(ctx);
    if (!media) {
      await ctx.reply(data.media_pending === 'photo'
        ? TXT.enter_score.send_photo
        : TXT.enter_score.send_video);
      return true;
    }

    data.media_path = media.url;
    data.media_token = media.token;
    data.media_type = media.type;
    data.media_pending = undefined;
    await setState(ctx, AddScoreState.ADDING_MEDIA, data);
    await showConfirmation(ctx, 'new');
    return true;
  }

  const text = getMessageText(ctx)?.trim();
  if (!text) return false;

  switch (state as AddScoreState) {
    case AddScoreState.SEARCHING_OPPONENT:
      await runUserSearch(ctx, text, 'select_opponent', AddScoreState.SELECTING_OPPONENT, TXT.enter_score.select_opponent);
      return true;
    case AddScoreState.SELECTING_PARTNER:
      await runUserSearch(ctx, text, 'select_partner', AddScoreState.SEARCHING_PARTNER, TXT.enter_score.select_partner);
      return true;
    case AddScoreState.SEARCHING_OPPONENT1:
      await runUserSearch(ctx, text, 'select_opponent1', AddScoreState.SELECTING_OPPONENT1, TXT.enter_score.select_opponent);
      return true;
    case AddScoreState.SEARCHING_OPPONENT2:
      await runUserSearch(ctx, text, 'select_opponent2', AddScoreState.SELECTING_OPPONENT2, TXT.enter_score.select_opponent2);
      return true;
    default:
      return false;
  }
}

async function handleUserPick(
  ctx: AppContext,
  userId: number,
  role: 'partner' | 'opponent' | 'opponent1' | 'opponent2',
): Promise<void> {
  const user = await requireRegistered(ctx);
  if (!user) return;
  const selected = await loadUser(userId);
  if (!selected) {
    await ctx.answerOnCallback({ notification: TXT.enter_score.user_not_found });
    return;
  }

  const mismatch = checkSportMatch(user, selected);
  if (mismatch) {
    await showCurrentMessage(ctx, mismatch, { attachments: [backOnlyKeyboard()] });
    await ctx.answerOnCallback({ notification: 'Виды спорта не совпадают' });
    return;
  }

  const data = getStateData<ScoreData>(ctx);
  if (role === 'partner') {
    data.partner_id = userId;
    await showSearchPrompt(ctx, AddScoreState.SEARCHING_OPPONENT1, TXT.enter_score.search_opponent1_prompt, data);
  } else if (role === 'opponent1') {
    data.opponent1_id = userId;
    await showSearchPrompt(ctx, AddScoreState.SEARCHING_OPPONENT2, TXT.enter_score.search_opponent2_prompt, data);
  } else if (role === 'opponent2') {
    data.opponent2_id = userId;
    await showAfterDoubleFormed(ctx);
  } else {
    await showAfterOpponentSelected(ctx, selected);
  }
  await ctx.answerOnCallback({ notification: 'OK' });
}

export function registerScoreHandlers(bot: import('@maxhub/max-bot-api').Bot<AppContext>): void {
  bot.action(/^game_type:/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const type = getCallbackPayload(ctx).replace('game_type:', '') as ScoreData['game_type'];
    const data: ScoreData = { game_type: type, sets: [] };

    if (type === 'tournament') {
      await showTournamentList(ctx, data);
      return;
    }
    if (type === 'double') {
      await showSearchPrompt(ctx, AddScoreState.SELECTING_PARTNER, TXT.enter_score.search_partner_prompt, data);
      return;
    }
    await showSearchPrompt(ctx, AddScoreState.SEARCHING_OPPONENT, TXT.enter_score.search_opponent_prompt, data);
  });

  bot.action(/^score_nav:/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const parts = getCallbackPayload(ctx).split(':');
    const action = parts[1] as UserSelectAction;
    const page = Number(parts[2]);
    const data = getStateData<ScoreData>(ctx);
    data.search_page = page;

    const stateMap: Record<UserSelectAction, { state: AddScoreState; title: string }> = {
      select_partner: { state: AddScoreState.SEARCHING_PARTNER, title: TXT.enter_score.select_partner },
      select_opponent: { state: AddScoreState.SELECTING_OPPONENT, title: TXT.enter_score.select_opponent },
      select_opponent1: { state: AddScoreState.SELECTING_OPPONENT1, title: TXT.enter_score.select_opponent },
      select_opponent2: { state: AddScoreState.SELECTING_OPPONENT2, title: TXT.enter_score.select_opponent2 },
    };
    const cfg = stateMap[action];
    await showUserList(ctx, data, action, cfg.title, cfg.state);
  });

  bot.action(/^select_partner:/, async (ctx) => {
    await handleUserPick(ctx, Number(getCallbackPayload(ctx).replace('select_partner:', '')), 'partner');
  });

  bot.action(/^select_opponent1:/, async (ctx) => {
    await handleUserPick(ctx, Number(getCallbackPayload(ctx).replace('select_opponent1:', '')), 'opponent1');
  });

  bot.action(/^select_opponent2:/, async (ctx) => {
    await handleUserPick(ctx, Number(getCallbackPayload(ctx).replace('select_opponent2:', '')), 'opponent2');
  });

  bot.action(/^select_opponent:/, async (ctx) => {
    await handleUserPick(ctx, Number(getCallbackPayload(ctx).replace('select_opponent:', '')), 'opponent');
  });

  bot.action(/^tournament_score:select:/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const tournamentId = getCallbackPayload(ctx).replace('tournament_score:select:', '');
    await showTournamentOpponents(ctx, tournamentId, getStateData<ScoreData>(ctx));
  });

  bot.action(/^tournament_score:opponent:/, async (ctx) => {
    const payload = getCallbackPayload(ctx).replace('tournament_score:opponent:', '');
    const [tournamentId, opponentIdStr] = payload.split(':');
    const opponentId = Number(opponentIdStr);
    const selfId = getCtxUserId(ctx);
    const data = getStateData<ScoreData>(ctx);
    data.game_type = 'tournament';
    data.tournament_id = tournamentId;

    const games = await storage.getGames();
    if (alreadyPlayedInTournament(games, tournamentId, selfId, opponentId)) {
      await ctx.answerOnCallback({ notification: TXT.enter_score.match_already_played });
      await showTournamentOpponents(ctx, tournamentId, data);
      return;
    }

    const opponent = await loadUser(opponentId);
    if (!opponent) {
      await ctx.answerOnCallback({ notification: TXT.enter_score.user_not_found });
      return;
    }
    await showAfterOpponentSelected(ctx, opponent);
    await ctx.answerOnCallback({ notification: 'OK' });
  });

  bot.action(/^set_score:/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const payload = getCallbackPayload(ctx).replace('set_score:', '');
    const underscore = payload.indexOf('_');
    const setNumber = Number(payload.slice(0, underscore));
    const score = payload.slice(underscore + 1);
    const data = getStateData<ScoreData>(ctx);
    const sets = [...(data.sets ?? [])];
    if (sets.length >= setNumber) {
      sets[setNumber - 1] = score;
    } else {
      sets.push(score);
    }
    data.sets = sets;

    const wins = countSetWins(sets);
    if (wins.team1 >= 2 || wins.team2 >= 2) {
      await completeScoreEntry(ctx);
      return;
    }
    await showAddAnotherSet(ctx);
  });

  bot.action(/^add_another_set:/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const action = getCallbackPayload(ctx).replace('add_another_set:', '');
    if (action === 'yes') {
      const data = getStateData<ScoreData>(ctx);
      await showSetScore(ctx, (data.sets?.length ?? 0) + 1);
      return;
    }
    const ok = await completeScoreEntry(ctx);
    if (!ok) {
      await showCurrentMessage(ctx, TXT.enter_score.score_not_entered, {
        attachments: [backOnlyKeyboard()],
      });
    }
  });

  bot.action(/^score_media:/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const action = getCallbackPayload(ctx).replace('score_media:', '');
    const data = getStateData<ScoreData>(ctx);

    if (action === 'skip') {
      data.media_path = undefined;
      data.media_token = undefined;
      data.media_type = undefined;
      data.media_pending = undefined;
      await showConfirmation(ctx);
      return;
    }

    data.media_pending = action === 'photo' ? 'photo' : 'video';
    await setState(ctx, AddScoreState.ADDING_MEDIA, data);
    await showCurrentMessage(
      ctx,
      action === 'photo' ? TXT.enter_score.send_photo : TXT.enter_score.send_video,
      { attachments: [backOnlyKeyboard()] },
    );
  });

  bot.action(/^prev_set:/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    await showSetScore(ctx, Number(getCallbackPayload(ctx).replace('prev_set:', '')));
  });

  bot.action(/^next_set:/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    await showSetScore(ctx, Number(getCallbackPayload(ctx).replace('next_set:', '')));
  });

  bot.action(/^supertiebreak:/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const setNumber = Number(getCallbackPayload(ctx).replace('supertiebreak:', ''));
    await showCurrentMessage(ctx, TXT.enter_score.super_tiebreak, {
      attachments: [buildSupertiebreakKeyboard(setNumber)],
    });
  });

  bot.action(/^back_to_normal_set:/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    await showSetScore(ctx, Number(getCallbackPayload(ctx).replace('back_to_normal_set:', '')));
  });

  bot.action('finish_score', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const ok = await completeScoreEntry(ctx);
    if (!ok) {
      await showCurrentMessage(ctx, TXT.enter_score.score_not_entered, {
        attachments: [buildSetScoreKeyboard((getStateData<ScoreData>(ctx).sets?.length ?? 0) || 1)],
      });
    }
  });

  bot.action(/^confirm_score:/, async (ctx) => {
    const action = getCallbackPayload(ctx).replace('confirm_score:', '');
    if (action === 'yes') {
      await saveConfirmedScore(ctx);
      await ctx.answerOnCallback({ notification: 'OK' });
      return;
    }
    if (action === 'edit') {
      const data = getStateData<ScoreData>(ctx);
      data.sets = [];
      data.media_path = undefined;
      data.media_token = undefined;
      data.media_type = undefined;
      data.media_pending = undefined;
      data.result_summary = undefined;
      await showSetScore(ctx, 1);
      await ctx.answerOnCallback({ notification: 'OK' });
      return;
    }
    await clearState(ctx);
    await showCurrentMessage(ctx, TXT.enter_score.cancelled, {
      attachments: [Keyboard.inlineKeyboard([
        [Keyboard.button.callback(TXT.common.main_menu, 'main_menu')],
      ])],
    });
    await ctx.answerOnCallback({ notification: 'OK' });
  });

  bot.action('score_back', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    await handleScoreBack(ctx);
  });
}
