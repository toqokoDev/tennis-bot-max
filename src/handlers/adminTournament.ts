import { Keyboard } from '@maxhub/max-bot-api';
import type { AttachmentRequest } from '@maxhub/max-bot-api/types';
import { TXT, fmt } from '../texts.js';
import type { AppContext } from '../context.js';
import { getCtxUserId, getMessageText } from '../context.js';
import { isAdmin } from '../config/env.js';
import { COUNTRIES } from '../config/profile.js';
import {
  CATEGORY_LEVELS,
  DISTRICTS_MOSCOW,
  TOURNAMENT_AGE_GROUPS,
  TOURNAMENT_CATEGORIES,
  TOURNAMENT_DURATIONS,
  TOURNAMENT_GENDER_BUTTONS,
  TOURNAMENT_SPORTS,
  TOURNAMENT_TYPES,
} from '../config/tournament.js';
import { storage } from '../storage/jsonStorage.js';
import { clearState, getState, getStateData, setState } from '../middleware/session.js';
import { EditTournamentStates } from '../types/states.js';
import type { CompletedGame, SportType, Tournament, UserProfile } from '../types/models.js';
import {
  askText,
  chunkButtons,
  showCurrentMessage,
} from '../utils/bot.js';
import { getCallbackPayload } from '../utils/callback.js';
import {
  addParticipant,
  applyTournamentMatchResult,
  canStartTournament,
  ensureSeeding,
  formatFirstRoundPairs,
  listPendingMatches,
  moveSeeding,
  removeParticipant,
  shuffleSeeding,
  startTournament,
} from '../utils/tournamentLifecycle.js';
import { applyRatingUpdate } from '../utils/rating.js';
import { calculateLevelFromPoints } from '../config/profile.js';
import { uploadBracketImage } from '../services/bracketImage.js';
import { sendTournamentStartedToChannel } from '../services/channels.js';

type AteData = {
  editing_tournament_id?: string;
  editing_field?: string;
  pending_matches?: Array<{ id: string; player1: number; player2: number; label: string }>;
  match_id?: string;
  match_winner_id?: number;
  match_player1?: number;
  match_player2?: number;
  games_page?: number;
  search_query?: string;
};

const TOURN_PAGE = 5;
const GAMES_PAGE = 8;

function btn(text: string, payload: string) {
  return Keyboard.button.callback(text, payload);
}

async function requireAdmin(ctx: AppContext): Promise<boolean> {
  if (isAdmin(getCtxUserId(ctx))) return true;
  await ctx.reply(TXT.admin.no_rights);
  return false;
}

export function tournamentLocation(t: Tournament): string {
  if (t.city === 'Москва' && t.district) return `${t.city} (${t.district})`;
  return [t.city, t.country].filter(Boolean).join(', ') || '—';
}

function participantsLabel(t: Tournament): string {
  return `${Object.keys(t.participants ?? {}).length}/${t.participants_count}`;
}

function sortTournaments(items: [string, Tournament][]): [string, Tournament][] {
  return [...items].sort((a, b) => {
    const full = (t: Tournament) => Object.keys(t.participants).length >= t.participants_count ? 0 : 1;
    const statusRank = (s: string) => (s === 'active' ? 0 : s === 'started' ? 1 : 2);
    const fa = full(a[1]);
    const fb = full(b[1]);
    if (fa !== fb) return fa - fb;
    const sa = statusRank(a[1].status);
    const sb = statusRank(b[1].status);
    if (sa !== sb) return sa - sb;
    const ca = Object.keys(a[1].participants).length;
    const cb = Object.keys(b[1].participants).length;
    if (cb !== ca) return cb - ca;
    return a[0].localeCompare(b[0]);
  });
}

function tournamentButtonLabel(t: Tournament): string {
  const num = /№(\d+)/.exec(t.name)?.[1] ?? '?';
  const label = `№${num} | ${t.level || '?'} | ${tournamentLocation(t)} | ${participantsLabel(t)}`;
  return label.length > 60 ? `${label.slice(0, 57)}…` : label;
}

function backToEdit(id: string): ReturnType<typeof Keyboard.button.callback>[] {
  return [btn(TXT.admin.back_to_tournament, `edit_tournament:${id}`)];
}

async function loadTourn(id: string): Promise<Tournament | undefined> {
  return storage.getTournament(id);
}

async function saveTourn(t: Tournament): Promise<void> {
  await storage.saveTournament(t);
}

export async function showEditTournamentsPage(ctx: AppContext, page = 0): Promise<void> {
  const all = await storage.getTournaments();
  const items = sortTournaments(Object.entries(all));
  if (!items.length) {
    await showCurrentMessage(ctx, TXT.admin.tournaments_empty, {
      attachments: [Keyboard.inlineKeyboard([
        [btn(TXT.admin.create_tournament, 'admin_create_tournament')],
        [btn(TXT.admin.back_to_main, 'admin_back_to_main')],
      ])],
    });
    return;
  }
  const totalPages = Math.max(1, Math.ceil(items.length / TOURN_PAGE));
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const slice = items.slice(safePage * TOURN_PAGE, (safePage + 1) * TOURN_PAGE);
  const buttons = slice.map(([id, t]) => [btn(tournamentButtonLabel(t), `edit_tournament:${id}`)]);
  const nav: ReturnType<typeof Keyboard.button.callback>[] = [];
  if (safePage > 0) nav.push(btn('⬅️', `admin_tournaments_page:${safePage - 1}`));
  if (safePage < totalPages - 1) nav.push(btn('➡️', `admin_tournaments_page:${safePage + 1}`));
  if (nav.length) buttons.push(nav);
  buttons.push([btn(TXT.admin.back_to_main, 'admin_back_to_main')]);
  await showCurrentMessage(ctx, fmt(TXT.admin.tournaments_pick, {
    page: safePage + 1,
    pages: totalPages,
    total: items.length,
  }), { attachments: [Keyboard.inlineKeyboard(buttons)] });
}

export async function showTournamentEdit(ctx: AppContext, tournamentId: string): Promise<void> {
  const t = await loadTourn(tournamentId);
  if (!t) {
    await showCurrentMessage(ctx, TXT.admin.tournament_not_found, {
      attachments: [Keyboard.inlineKeyboard([[btn(TXT.admin.back_to_main, 'admin_back_to_main')]])],
    });
    return;
  }
  await setState(ctx, '', { editing_tournament_id: tournamentId });
  ctx.session.data.editing_tournament_id = tournamentId;

  const ready = canStartTournament(t) ? TXT.admin.tournament_ready : '';
  const text = fmt(TXT.admin.tournament_view, {
    name: t.name,
    sport: t.sport,
    location: tournamentLocation(t),
    type: t.type,
    participants: Object.keys(t.participants).length,
    max: t.participants_count,
    status: t.status,
    id: tournamentId,
    ready,
  });

  const rows: ReturnType<typeof Keyboard.button.callback>[][] = [
    [btn(TXT.admin.edit_sport, 'edit_field:sport'), btn(TXT.admin.edit_city, 'edit_field:city')],
    [btn(TXT.admin.edit_type, 'edit_field:type'), btn(TXT.admin.edit_gender, 'edit_field:gender')],
    [btn(TXT.admin.edit_category, 'edit_field:category'), btn(TXT.admin.edit_age, 'edit_field:age_group')],
    [btn(TXT.admin.edit_count, 'edit_field:participants_count'), btn(TXT.admin.edit_comment, 'edit_field:comment')],
    [btn(TXT.admin.edit_more, 'edit_tournament_more')],
    [btn(TXT.admin.manage_participants, `manage_participants:${tournamentId}`)],
  ];

  if (t.status !== 'started' && t.status !== 'finished') {
    rows.push([btn(TXT.admin.seeding, `tournament_seeding_menu:${tournamentId}`)]);
  }
  if (t.status === 'started') {
    rows.push([btn(TXT.admin.enter_match_score, `admin_enter_match_score:${tournamentId}`)]);
  }
  rows.push([btn(TXT.admin.manage_games, `admin_tournament_games:${tournamentId}`)]);
  if (canStartTournament(t)) {
    rows.push([btn(TXT.admin.start_tournament, 'tournament_start_now')]);
  }
  rows.push([btn(TXT.admin.delete_tournament, `admin_delete_tournament:${tournamentId}`)]);
  rows.push([btn(TXT.admin.back, 'admin_edit_tournaments')]);

  const attachments: AttachmentRequest[] = [Keyboard.inlineKeyboard(rows)];
  if (!t.hide_bracket && (t.bracket || t.round_robin)) {
    try {
      const img = await uploadBracketImage(ctx.api, t);
      if (img) attachments.unshift(img);
    } catch {
      /* ignore */
    }
  }

  await showCurrentMessage(ctx, text, { attachments });
}

async function showFieldPicker(
  ctx: AppContext,
  field: string,
  label: string,
  current: string,
  options: string[],
): Promise<void> {
  const data = getStateData<AteData>(ctx);
  await setState(ctx, '', { ...data, editing_field: field });
  const rows = chunkButtons(
    options,
    (o) => btn(`${o === current ? '✅ ' : ''}${o}`, `update_field:${encodeURIComponent(o)}`),
    2,
  );
  const tid = String(data.editing_tournament_id ?? '');
  rows.push(backToEdit(tid));
  await showCurrentMessage(ctx, fmt(TXT.admin.field_current, { label, current: current || '—' }), {
    attachments: [Keyboard.inlineKeyboard(rows)],
  });
}

function paymentStatus(t: Tournament, userId: string): string {
  if (!t.entry_fee) return TXT.admin.participant_free;
  const pay = t.payments[userId];
  if (pay?.status === 'succeeded' || t.participants[userId]?.paid) return TXT.admin.participant_paid;
  return TXT.admin.participant_unpaid;
}

async function showParticipants(ctx: AppContext, tournamentId: string): Promise<void> {
  const t = await loadTourn(tournamentId);
  if (!t) return;
  const lines = Object.entries(t.participants).map(([id, p]) => (
    `• ${p.name} (ID ${id}) — ${paymentStatus(t, id)}`
  ));
  const rows: ReturnType<typeof Keyboard.button.callback>[][] = [
    [btn(TXT.admin.add_participant, `add_tournament_participant:${tournamentId}`)],
    [btn(TXT.admin.remove_participant, `remove_participant:${tournamentId}`)],
  ];
  if (canStartTournament(t)) {
    rows.push([btn(TXT.admin.start_tournament, 'tournament_start_now')]);
  }
  rows.push(backToEdit(tournamentId));
  await showCurrentMessage(ctx, fmt(TXT.admin.participants_title, {
    current: Object.keys(t.participants).length,
    max: t.participants_count,
    list: lines.join('\n') || '—',
  }), { attachments: [Keyboard.inlineKeyboard(rows)] });
}

async function showSeeding(ctx: AppContext, tournamentId: string): Promise<void> {
  const t = await loadTourn(tournamentId);
  if (!t) return;
  const seeding = ensureSeeding(t);
  if (JSON.stringify(seeding) !== JSON.stringify(t.seeding ?? [])) {
    t.seeding = seeding;
    await saveTourn(t);
  }
  const list = seeding.map((id, i) => `${i + 1}. ${t.participants[id]?.name ?? id}`).join('\n');
  const rows: ReturnType<typeof Keyboard.button.callback>[][] = [];
  seeding.forEach((_, i) => {
    rows.push([
      btn(`⬆️ ${i + 1}`, `seeding_move:${i}:up`),
      btn(`⬇️`, `seeding_move:${i}:down`),
    ]);
  });
  rows.push([btn(TXT.admin.seeding_shuffle, 'seeding_shuffle')]);
  if (canStartTournament(t)) {
    rows.push([btn(TXT.admin.start_tournament, 'tournament_start_now')]);
  }
  rows.push(backToEdit(tournamentId));
  await showCurrentMessage(ctx, fmt(TXT.admin.seeding_title, {
    name: t.name,
    list,
    pairs: formatFirstRoundPairs(t),
  }), { attachments: [Keyboard.inlineKeyboard(rows)] });
}

function parseSets(text: string): string[] | null {
  const parts = text.split(/[,;]+/).map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return null;
  for (const p of parts) {
    if (!/^\d{1,2}:\d{1,2}$/.test(p) && !/^\d{1,2}-\d{1,2}$/.test(p)) return null;
  }
  return parts.map((p) => p.replace('-', ':'));
}

async function createTournamentGame(
  ctx: AppContext,
  t: Tournament,
  winnerId: number,
  loserId: number,
  sets: string[],
): Promise<void> {
  const users = await storage.getUsers();
  const winner = users[String(winnerId)];
  const loser = users[String(loserId)];
  if (!winner || !loser) return;

  const oldW = winner.rating_points;
  const oldL = loser.rating_points;
  const { winnerPoints, loserPoints, winnerLevel, loserLevel } = applyRatingUpdate(oldW, oldL);
  winner.rating_points = winnerPoints;
  winner.player_level = winnerLevel;
  winner.games_played += 1;
  winner.games_wins += 1;
  loser.rating_points = loserPoints;
  loser.player_level = loserLevel;
  loser.games_played += 1;
  await storage.saveUser(winner);
  await storage.saveUser(loser);

  const game: CompletedGame = {
    id: await storage.nextCompletedGameId(),
    sport: t.sport,
    game_type: 'tournament',
    players: [winnerId, loserId],
    sets,
    winner_ids: [winnerId],
    tournament_id: t.id,
    rating_updates: {
      [String(winnerId)]: { before: oldW, after: winnerPoints },
      [String(loserId)]: { before: oldL, after: loserPoints },
    },
    created_at: new Date().toISOString(),
    created_by: getCtxUserId(ctx),
  };
  const games = await storage.getGames();
  games.push(game);
  await storage.saveGames(games);
}

async function showGamesPage(ctx: AppContext, tournamentId: string, page = 0): Promise<void> {
  const games = (await storage.getGames()).filter((g) => g.tournament_id === tournamentId);
  if (!games.length) {
    await showCurrentMessage(ctx, TXT.admin.games_empty, {
      attachments: [Keyboard.inlineKeyboard([backToEdit(tournamentId)])],
    });
    return;
  }
  const totalPages = Math.max(1, Math.ceil(games.length / GAMES_PAGE));
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  await setState(ctx, '', { ...getStateData<AteData>(ctx), editing_tournament_id: tournamentId, games_page: safePage });
  const slice = games.slice(safePage * GAMES_PAGE, (safePage + 1) * GAMES_PAGE);
  const users = await storage.getUsers();
  const rows = slice.map((g) => {
    const names = g.players.map((id) => users[String(id)]?.first_name ?? String(id)).join(' / ');
    return [btn(`${g.sets.join(', ')} · ${names}`, `admin_view_game:${g.id}`)];
  });
  const nav: ReturnType<typeof Keyboard.button.callback>[] = [];
  if (safePage > 0) nav.push(btn('⬅️', `admin_tournament_games_page:${tournamentId}:${safePage - 1}`));
  if (safePage < totalPages - 1) nav.push(btn('➡️', `admin_tournament_games_page:${tournamentId}:${safePage + 1}`));
  if (nav.length) rows.push(nav);
  rows.push(backToEdit(tournamentId));
  await showCurrentMessage(ctx, fmt(TXT.admin.games_title, { page: safePage + 1, pages: totalPages }), {
    attachments: [Keyboard.inlineKeyboard(rows)],
  });
}

function searchUsers(users: Record<string, UserProfile>, query: string): UserProfile[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  return Object.values(users)
    .filter((u) => {
      const full = `${u.first_name} ${u.last_name}`.toLowerCase();
      return full.includes(q)
        || u.first_name.toLowerCase().includes(q)
        || u.last_name.toLowerCase().includes(q)
        || String(u.max_user_id) === q
        || (u.phone || '').includes(q);
    })
    .slice(0, 15);
}

export function registerAdminTournamentHandlers(bot: import('@maxhub/max-bot-api').Bot<AppContext>): void {
  bot.action('admin_edit_tournaments', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    if (!(await requireAdmin(ctx))) return;
    await clearState(ctx);
    await showEditTournamentsPage(ctx, 0);
  });

  bot.action(/^admin_tournaments_page:/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    if (!(await requireAdmin(ctx))) return;
    const page = Number(getCallbackPayload(ctx).replace('admin_tournaments_page:', '')) || 0;
    await showEditTournamentsPage(ctx, page);
  });

  bot.action(/^edit_tournament:/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    if (!(await requireAdmin(ctx))) return;
    const id = getCallbackPayload(ctx).replace('edit_tournament:', '');
    await showTournamentEdit(ctx, id);
  });

  bot.action('edit_tournaments_back', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    if (!(await requireAdmin(ctx))) return;
    await showEditTournamentsPage(ctx, 0);
  });

  bot.action('edit_tournament_back', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    if (!(await requireAdmin(ctx))) return;
    const tid = String(getStateData<AteData>(ctx).editing_tournament_id ?? '');
    if (tid) await showTournamentEdit(ctx, tid);
    else await showEditTournamentsPage(ctx, 0);
  });

  bot.action('edit_tournament_more', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    if (!(await requireAdmin(ctx))) return;
    const tid = String(getStateData<AteData>(ctx).editing_tournament_id ?? '');
    await showCurrentMessage(ctx, TXT.admin.edit_more_title, {
      attachments: [Keyboard.inlineKeyboard([
        [btn(TXT.admin.edit_country, 'edit_field:country')],
        [btn(TXT.admin.edit_district, 'edit_field:district')],
        [btn(TXT.admin.edit_duration, 'edit_field:duration')],
        [btn(TXT.admin.edit_show_in_list, 'edit_field:show_in_list')],
        [btn(TXT.admin.edit_hide_bracket, 'edit_field:hide_bracket')],
        backToEdit(tid),
      ])],
    });
  });

  bot.action(/^edit_field:/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    if (!(await requireAdmin(ctx))) return;
    const field = getCallbackPayload(ctx).replace('edit_field:', '');
    const tid = String(getStateData<AteData>(ctx).editing_tournament_id ?? '');
    const t = await loadTourn(tid);
    if (!t) return;

    if (field === 'participants_count') {
      await setState(ctx, EditTournamentStates.EDIT_PARTICIPANTS_COUNT, { editing_tournament_id: tid, editing_field: field });
      await askText(ctx, TXT.admin.enter_participants_count);
      return;
    }
    if (field === 'comment') {
      await setState(ctx, EditTournamentStates.EDIT_COMMENT, { editing_tournament_id: tid, editing_field: field });
      await askText(ctx, TXT.admin.enter_comment);
      return;
    }
    if (field === 'sport') {
      await showFieldPicker(ctx, field, TXT.admin.edit_sport, t.sport, [...TOURNAMENT_SPORTS]);
      return;
    }
    if (field === 'country') {
      await showFieldPicker(ctx, field, TXT.admin.edit_country, t.country, Object.keys(COUNTRIES));
      return;
    }
    if (field === 'city') {
      const cities = COUNTRIES[t.country] ?? [];
      await showFieldPicker(ctx, field, TXT.admin.edit_city, t.city, cities.length ? cities : [t.city]);
      return;
    }
    if (field === 'district') {
      await showFieldPicker(ctx, field, TXT.admin.edit_district, t.district || '', [...DISTRICTS_MOSCOW]);
      return;
    }
    if (field === 'type') {
      await showFieldPicker(ctx, field, TXT.admin.edit_type, t.type, [...TOURNAMENT_TYPES]);
      return;
    }
    if (field === 'gender') {
      await showFieldPicker(ctx, field, TXT.admin.edit_gender, t.gender || '', TOURNAMENT_GENDER_BUTTONS.map((g) => g.value));
      return;
    }
    if (field === 'category') {
      await showFieldPicker(ctx, field, TXT.admin.edit_category, t.category, [...TOURNAMENT_CATEGORIES]);
      return;
    }
    if (field === 'age_group') {
      await showFieldPicker(ctx, field, TXT.admin.edit_age, t.age_group, [...TOURNAMENT_AGE_GROUPS]);
      return;
    }
    if (field === 'duration') {
      await showFieldPicker(ctx, field, TXT.admin.edit_duration, t.duration, [...TOURNAMENT_DURATIONS]);
      return;
    }
    if (field === 'show_in_list') {
      await showFieldPicker(ctx, field, TXT.admin.edit_show_in_list, t.show_in_list ? TXT.admin.yes_label : TXT.admin.no_label, [TXT.admin.yes_label, TXT.admin.no_label]);
      return;
    }
    if (field === 'hide_bracket') {
      await showFieldPicker(ctx, field, TXT.admin.edit_hide_bracket, t.hide_bracket ? TXT.admin.yes_label : TXT.admin.no_label, [TXT.admin.yes_label, TXT.admin.no_label]);
    }
  });

  bot.action(/^update_field:/, async (ctx) => {
    await ctx.answerOnCallback({ notification: TXT.admin.field_saved });
    if (!(await requireAdmin(ctx))) return;
    const value = decodeURIComponent(getCallbackPayload(ctx).replace('update_field:', ''));
    const data = getStateData<AteData>(ctx);
    const tid = String(data.editing_tournament_id ?? '');
    const field = data.editing_field;
    const t = await loadTourn(tid);
    if (!t || !field) return;

    if (field === 'sport') t.sport = value as SportType;
    else if (field === 'country') t.country = value;
    else if (field === 'city') {
      t.city = value;
      if (value !== 'Москва') delete t.district;
    } else if (field === 'district') t.district = value;
    else if (field === 'type') t.type = value as Tournament['type'];
    else if (field === 'gender') t.gender = value;
    else if (field === 'category') {
      t.category = value;
      t.level = CATEGORY_LEVELS[value] ?? t.level;
    } else if (field === 'age_group') t.age_group = value as Tournament['age_group'];
    else if (field === 'duration') t.duration = value;
    else if (field === 'show_in_list') t.show_in_list = value === TXT.admin.yes_label;
    else if (field === 'hide_bracket') t.hide_bracket = value === TXT.admin.yes_label;

    await saveTourn(t);
    await showTournamentEdit(ctx, tid);
  });

  bot.action(/^manage_participants/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    if (!(await requireAdmin(ctx))) return;
    const payload = getCallbackPayload(ctx);
    const tid = payload.includes(':')
      ? payload.split(':')[1]!
      : String(getStateData<AteData>(ctx).editing_tournament_id ?? '');
    ctx.session.data.editing_tournament_id = tid;
    await showParticipants(ctx, tid);
  });

  bot.action(/^add_tournament_participant:/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    if (!(await requireAdmin(ctx))) return;
    const tid = getCallbackPayload(ctx).replace('add_tournament_participant:', '');
    await setState(ctx, EditTournamentStates.SEARCH_PARTICIPANT, { editing_tournament_id: tid });
    await askText(ctx, TXT.admin.search_participant);
  });

  bot.action(/^select_participant:/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    if (!(await requireAdmin(ctx))) return;
    const userId = Number(getCallbackPayload(ctx).replace('select_participant:', ''));
    const tid = String(getStateData<AteData>(ctx).editing_tournament_id ?? '');
    const t = await loadTourn(tid);
    const user = await storage.getUser(userId);
    if (!t || !user) return;
    if (t.participants[String(userId)]) {
      await ctx.answerOnCallback({ notification: TXT.admin.participant_exists });
      return;
    }
    if (Object.keys(t.participants).length >= t.participants_count) {
      await ctx.answerOnCallback({ notification: TXT.admin.participant_full });
      return;
    }
    const updated = addParticipant(t, userId, `${user.first_name} ${user.last_name}`.trim());
    await saveTourn(updated);
    await clearState(ctx);
    ctx.session.data.editing_tournament_id = tid;
    await showCurrentMessage(ctx, fmt(TXT.admin.participant_added, { name: updated.participants[String(userId)]!.name }), {
      attachments: [Keyboard.inlineKeyboard([
        [btn(TXT.admin.manage_participants, `manage_participants:${tid}`)],
        backToEdit(tid),
      ])],
    }, 'new');
  });

  bot.action(/^remove_participant:/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    if (!(await requireAdmin(ctx))) return;
    const tid = getCallbackPayload(ctx).replace('remove_participant:', '');
    const t = await loadTourn(tid);
    if (!t) return;
    const rows = Object.entries(t.participants).map(([id, p]) => [
      btn(`➖ ${p.name}`, `confirm_remove_participant:${id}`),
    ]);
    rows.push([btn(TXT.admin.manage_participants, `manage_participants:${tid}`)]);
    await showCurrentMessage(ctx, TXT.admin.remove_participant_pick, {
      attachments: [Keyboard.inlineKeyboard(rows)],
    });
  });

  bot.action(/^confirm_remove_participant:/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    if (!(await requireAdmin(ctx))) return;
    const userId = Number(getCallbackPayload(ctx).replace('confirm_remove_participant:', ''));
    const tid = String(getStateData<AteData>(ctx).editing_tournament_id ?? '');
    const t = await loadTourn(tid);
    if (!t) return;
    const name = t.participants[String(userId)]?.name ?? String(userId);
    const updated = removeParticipant(t, userId);
    await saveTourn(updated);
    await showCurrentMessage(ctx, fmt(TXT.admin.participant_removed, { name }), {
      attachments: [Keyboard.inlineKeyboard([
        [btn(TXT.admin.manage_participants, `manage_participants:${tid}`)],
        backToEdit(tid),
      ])],
    });
  });

  bot.action(/^tournament_seeding_menu/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    if (!(await requireAdmin(ctx))) return;
    const payload = getCallbackPayload(ctx);
    const tid = payload.includes(':')
      ? payload.split(':')[1]!
      : String(getStateData<AteData>(ctx).editing_tournament_id ?? '');
    ctx.session.data.editing_tournament_id = tid;
    await showSeeding(ctx, tid);
  });

  bot.action(/^seeding_move:/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    if (!(await requireAdmin(ctx))) return;
    const [, idxStr, dir] = getCallbackPayload(ctx).split(':');
    const tid = String(getStateData<AteData>(ctx).editing_tournament_id ?? '');
    const t = await loadTourn(tid);
    if (!t) return;
    const updated = moveSeeding(t, Number(idxStr), dir === 'up' ? 'up' : 'down');
    await saveTourn(updated);
    await showSeeding(ctx, tid);
  });

  bot.action('seeding_shuffle', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    if (!(await requireAdmin(ctx))) return;
    const tid = String(getStateData<AteData>(ctx).editing_tournament_id ?? '');
    const t = await loadTourn(tid);
    if (!t) return;
    await saveTourn(shuffleSeeding(t));
    await showSeeding(ctx, tid);
  });

  bot.action('tournament_start_now', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    if (!(await requireAdmin(ctx))) return;
    const tid = String(getStateData<AteData>(ctx).editing_tournament_id ?? '');
    const t = await loadTourn(tid);
    if (!t) return;
    if (!canStartTournament(t)) {
      await showCurrentMessage(ctx, TXT.admin.start_not_ready, {
        attachments: [Keyboard.inlineKeyboard([backToEdit(tid)])],
      });
      return;
    }
    const started = startTournament(t);
    await saveTourn(started);
    try {
      await sendTournamentStartedToChannel(ctx.api, started);
    } catch {
      /* ignore */
    }
    await showCurrentMessage(ctx, TXT.admin.start_ok, {
      attachments: [Keyboard.inlineKeyboard([backToEdit(tid)])],
    });
  });

  bot.action(/^admin_enter_match_score:/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    if (!(await requireAdmin(ctx))) return;
    const tid = getCallbackPayload(ctx).replace('admin_enter_match_score:', '');
    const t = await loadTourn(tid);
    if (!t) return;
    const pending = listPendingMatches(t);
    if (!pending.length) {
      await showCurrentMessage(ctx, TXT.admin.no_pending_matches, {
        attachments: [Keyboard.inlineKeyboard([backToEdit(tid)])],
      });
      return;
    }
    await setState(ctx, '', {
      editing_tournament_id: tid,
      pending_matches: pending.map((p) => ({
        id: p.id, player1: p.player1, player2: p.player2, label: p.label,
      })),
    });
    const rows = pending.map((p, i) => [btn(p.label, `admin_match:${i}`)]);
    rows.push(backToEdit(tid));
    await showCurrentMessage(ctx, TXT.admin.enter_score_title, {
      attachments: [Keyboard.inlineKeyboard(rows)],
    });
  });

  bot.action(/^admin_match:/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    if (!(await requireAdmin(ctx))) return;
    const idx = Number(getCallbackPayload(ctx).replace('admin_match:', ''));
    const data = getStateData<AteData>(ctx);
    const match = data.pending_matches?.[idx];
    const tid = String(data.editing_tournament_id ?? '');
    if (!match) return;
    await setState(ctx, '', {
      ...data,
      match_id: match.id,
      match_player1: match.player1,
      match_player2: match.player2,
    });
    const t = await loadTourn(tid);
    const n1 = t?.participants[String(match.player1)]?.name ?? String(match.player1);
    const n2 = t?.participants[String(match.player2)]?.name ?? String(match.player2);
    await showCurrentMessage(ctx, fmt(TXT.admin.who_won, { match: match.label }), {
      attachments: [Keyboard.inlineKeyboard([
        [btn(`🥇 ${n1}`, 'admin_winner:1')],
        [btn(`🥇 ${n2}`, 'admin_winner:2')],
        backToEdit(tid),
      ])],
    });
  });

  bot.action(/^admin_winner:/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    if (!(await requireAdmin(ctx))) return;
    const side = getCallbackPayload(ctx).replace('admin_winner:', '');
    const data = getStateData<AteData>(ctx);
    const winnerId = side === '1' ? data.match_player1 : data.match_player2;
    if (!winnerId) return;
    await setState(ctx, EditTournamentStates.ENTER_MATCH_SCORE, {
      ...data,
      match_winner_id: winnerId,
    });
    await askText(ctx, TXT.admin.enter_score_prompt);
  });

  bot.action(/^admin_tournament_games:/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    if (!(await requireAdmin(ctx))) return;
    const tid = getCallbackPayload(ctx).replace('admin_tournament_games:', '');
    ctx.session.data.editing_tournament_id = tid;
    await showGamesPage(ctx, tid, 0);
  });

  bot.action(/^admin_tournament_games_page:/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    if (!(await requireAdmin(ctx))) return;
    const parts = getCallbackPayload(ctx).replace('admin_tournament_games_page:', '').split(':');
    await showGamesPage(ctx, parts[0]!, Number(parts[1]) || 0);
  });

  bot.action(/^admin_view_game:/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    if (!(await requireAdmin(ctx))) return;
    const gameId = getCallbackPayload(ctx).replace('admin_view_game:', '');
    const games = await storage.getGames();
    const game = games.find((g) => g.id === gameId);
    const tid = String(getStateData<AteData>(ctx).editing_tournament_id ?? game?.tournament_id ?? '');
    if (!game) return;
    const users = await storage.getUsers();
    const players = game.players.map((id) => {
      const u = users[String(id)];
      return u ? `${u.first_name} ${u.last_name}` : String(id);
    }).join(' vs ');
    const winner = game.winner_ids.map((id) => {
      const u = users[String(id)];
      return u ? `${u.first_name} ${u.last_name}` : String(id);
    }).join(', ');
    await showCurrentMessage(ctx, fmt(TXT.admin.game_view, {
      id: game.id,
      date: game.created_at.slice(0, 10),
      players,
      winner,
      score: game.sets.join(', '),
    }), {
      attachments: [Keyboard.inlineKeyboard([
        [btn(TXT.admin.game_delete, `admin_delete_game:${game.id}`)],
        [btn(TXT.admin.back_to_games, `admin_tournament_games:${tid}`)],
        backToEdit(tid),
      ])],
    });
  });

  bot.action(/^admin_delete_game:/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    if (!(await requireAdmin(ctx))) return;
    const gameId = getCallbackPayload(ctx).replace('admin_delete_game:', '');
    await showCurrentMessage(ctx, `⚠️ Удалить игру ${gameId}?`, {
      attachments: [Keyboard.inlineKeyboard([
        [btn(TXT.common.yes, `admin_confirm_delete_game:${gameId}`), btn(TXT.common.no, 'admin_back_to_games')],
      ])],
    });
  });

  bot.action(/^admin_confirm_delete_game:/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    if (!(await requireAdmin(ctx))) return;
    const gameId = getCallbackPayload(ctx).replace('admin_confirm_delete_game:', '');
    const games = await storage.getGames();
    const game = games.find((g) => g.id === gameId);
    const tid = String(getStateData<AteData>(ctx).editing_tournament_id ?? game?.tournament_id ?? '');
    if (game?.rating_updates) {
      const users = await storage.getUsers();
      for (const [pid, upd] of Object.entries(game.rating_updates)) {
        const u = users[pid];
        if (!u) continue;
        u.rating_points = upd.before;
        u.player_level = calculateLevelFromPoints(upd.before, u.sport);
        u.games_played = Math.max(0, u.games_played - 1);
        if (game.winner_ids.includes(Number(pid))) {
          u.games_wins = Math.max(0, u.games_wins - 1);
        }
        await storage.saveUser(u);
      }
    }
    await storage.saveGames(games.filter((g) => g.id !== gameId));
    await showCurrentMessage(ctx, TXT.admin.game_deleted, {
      attachments: [Keyboard.inlineKeyboard([
        [btn(TXT.admin.back_to_games, `admin_tournament_games:${tid}`)],
        backToEdit(tid),
      ])],
    });
  });

  bot.action('admin_back_to_games', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    if (!(await requireAdmin(ctx))) return;
    const tid = String(getStateData<AteData>(ctx).editing_tournament_id ?? '');
    if (tid) await showGamesPage(ctx, tid, getStateData<AteData>(ctx).games_page ?? 0);
  });

  bot.action(/^admin_delete_tournament:/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    if (!(await requireAdmin(ctx))) return;
    const id = getCallbackPayload(ctx).replace('admin_delete_tournament:', '');
    const t = await loadTourn(id);
    if (!t) {
      await showCurrentMessage(ctx, TXT.admin.tournament_not_found, {
        attachments: [Keyboard.inlineKeyboard([[btn(TXT.admin.back_to_main, 'admin_back_to_main')]])],
      });
      return;
    }
    await showCurrentMessage(ctx, fmt(TXT.admin.tournament_delete_confirm, {
      name: t.name,
      location: tournamentLocation(t),
      participants: participantsLabel(t),
    }), {
      attachments: [Keyboard.inlineKeyboard([
        [btn(TXT.common.yes, `admin_confirm_delete_tournament:${id}`), btn(TXT.common.no, `edit_tournament:${id}`)],
      ])],
    });
  });

  bot.action(/^admin_confirm_delete_tournament:/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    if (!(await requireAdmin(ctx))) return;
    const id = getCallbackPayload(ctx).replace('admin_confirm_delete_tournament:', '');
    const all = await storage.getTournaments();
    const t = all[id];
    if (!t) {
      await showCurrentMessage(ctx, TXT.admin.tournament_not_found, {
        attachments: [Keyboard.inlineKeyboard([[btn(TXT.admin.back_to_main, 'admin_back_to_main')]])],
      });
      return;
    }
    delete all[id];
    await storage.saveTournaments(all);
    const apps = await storage.getApplications();
    await storage.saveApplications(apps.filter((a) => a.tournament_id !== id));
    await showCurrentMessage(ctx, fmt(TXT.admin.tournament_deleted, { name: t.name }), {
      attachments: [Keyboard.inlineKeyboard([
        [btn(TXT.admin.back, 'admin_edit_tournaments')],
        [btn(TXT.admin.back_to_main, 'admin_back_to_main')],
      ])],
    });
  });
}

export async function handleAdminTournamentMessage(ctx: AppContext): Promise<boolean> {
  if (!isAdmin(getCtxUserId(ctx))) return false;
  const state = getState(ctx);
  const text = getMessageText(ctx);
  if (!text) return false;

  if (state === EditTournamentStates.EDIT_PARTICIPANTS_COUNT) {
    const n = Number(text.trim());
    const tid = String(getStateData<AteData>(ctx).editing_tournament_id ?? '');
    if (!Number.isInteger(n) || n < 2) {
      await askText(ctx, TXT.admin.count_invalid);
      return true;
    }
    const t = await loadTourn(tid);
    if (!t) return true;
    t.participants_count = n;
    await saveTourn(t);
    await clearState(ctx);
    ctx.session.data.editing_tournament_id = tid;
    await showTournamentEdit(ctx, tid);
    return true;
  }

  if (state === EditTournamentStates.EDIT_COMMENT) {
    const tid = String(getStateData<AteData>(ctx).editing_tournament_id ?? '');
    const t = await loadTourn(tid);
    if (!t) return true;
    t.comment = text.trim() === '-' ? undefined : text.trim();
    await saveTourn(t);
    await clearState(ctx);
    ctx.session.data.editing_tournament_id = tid;
    await showTournamentEdit(ctx, tid);
    return true;
  }

  if (state === EditTournamentStates.SEARCH_PARTICIPANT) {
    const tid = String(getStateData<AteData>(ctx).editing_tournament_id ?? '');
    if (text.trim().length < 2) {
      await askText(ctx, TXT.admin.search_participant);
      return true;
    }
    const users = await storage.getUsers();
    const found = searchUsers(users, text);
    if (!found.length) {
      await showCurrentMessage(ctx, TXT.admin.participant_search_empty, {
        attachments: [Keyboard.inlineKeyboard([
          [btn(TXT.admin.manage_participants, `manage_participants:${tid}`)],
        ])],
      }, 'new');
      return true;
    }
    const rows = found.map((u) => [
      btn(`${u.first_name} ${u.last_name}`.trim(), `select_participant:${u.max_user_id}`),
    ]);
    rows.push([btn(TXT.admin.manage_participants, `manage_participants:${tid}`)]);
    await showCurrentMessage(ctx, fmt(TXT.admin.participant_search_results, { count: found.length }), {
      attachments: [Keyboard.inlineKeyboard(rows)],
    }, 'new');
    return true;
  }

  if (state === EditTournamentStates.ENTER_MATCH_SCORE) {
    const sets = parseSets(text);
    if (!sets) {
      await askText(ctx, TXT.admin.score_invalid);
      return true;
    }
    const data = getStateData<AteData>(ctx);
    const tid = String(data.editing_tournament_id ?? '');
    const t = await loadTourn(tid);
    if (!t || !data.match_id || !data.match_winner_id || !data.match_player1 || !data.match_player2) {
      return true;
    }
    const loserId = data.match_winner_id === data.match_player1 ? data.match_player2 : data.match_player1;
    const updated = applyTournamentMatchResult(t, data.match_id, data.match_winner_id, sets);
    await saveTourn(updated);
    await createTournamentGame(ctx, updated, data.match_winner_id, loserId, sets);
    await clearState(ctx);
    ctx.session.data.editing_tournament_id = tid;
    await showCurrentMessage(ctx, TXT.admin.score_saved, {
      attachments: [Keyboard.inlineKeyboard([
        [btn(TXT.admin.enter_match_score, `admin_enter_match_score:${tid}`)],
        backToEdit(tid),
      ])],
    }, 'new');
    return true;
  }

  return false;
}
