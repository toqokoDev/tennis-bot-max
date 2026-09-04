import { Keyboard } from '@maxhub/max-bot-api';
import type { AttachmentRequest } from '@maxhub/max-bot-api/types';
import { TXT, fmt } from '../texts.js';
import type { AppContext } from '../context.js';
import { getCtxUserId, getMessageText } from '../context.js';
import { isAdmin } from '../config/env.js';
import { calculateLevelFromPoints } from '../config/profile.js';
import { storage } from '../storage/jsonStorage.js';
import { clearState, getState, getStateData, setState } from '../middleware/session.js';
import { AdminBroadcastStates, AdminSubscriptionStates } from '../types/states.js';
import type { BannedUser, CompletedGame, SubscriptionInfo, Tournament, UserProfile } from '../types/models.js';
import {
  askText,
  beginCommandResponse,
  showCurrentMessage,
} from '../utils/bot.js';
import { getCallbackPayload } from '../utils/callback.js';
import { addDays, formatDateISO, isValidEmail } from '../utils/validation.js';
import { showEditProfileMenu } from './profileEdit.js';

type BroadcastData = {
  text?: string;
  media?: AttachmentRequest[];
  mode?: 'forward' | 'manual';
};

type SubData = {
  admin_sub_search_query?: string;
  admin_sub_search_page?: number;
  admin_sub_user_id?: number;
  admin_edit_user_id?: number;
};

const SUB_PAGE_SIZE = 15;
const TOURN_PAGE_SIZE = 5;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requireAdmin(ctx: AppContext): Promise<boolean> {
  if (isAdmin(getCtxUserId(ctx))) return true;
  await ctx.reply(TXT.admin.no_rights);
  return false;
}

function adminKeyboard(): AttachmentRequest {
  return Keyboard.inlineKeyboard([
    [Keyboard.button.callback(TXT.admin.banned_list, 'admin_banned_list')],
    [Keyboard.button.callback(TXT.admin.broadcast, 'admin_broadcast_menu')],
    [Keyboard.button.callback(TXT.admin.manage_subscriptions, 'admin_manage_subscription_menu')],
    [Keyboard.button.callback(TXT.admin.create_tournament, 'admin_create_tournament')],
    [Keyboard.button.callback(TXT.admin.edit_tournaments, 'admin_edit_tournaments')],
    [Keyboard.button.callback(TXT.common.main_menu, 'main_menu')],
  ]);
}

function backToAdminKeyboard(): AttachmentRequest {
  return Keyboard.inlineKeyboard([
    [Keyboard.button.callback(TXT.admin.back_to_main, 'admin_back_to_main')],
  ]);
}

function confirmKeyboard(action: string, targetId?: string | number): AttachmentRequest {
  const yes = targetId !== undefined ? `admin_confirm_${action}:${targetId}` : `admin_confirm_${action}`;
  return Keyboard.inlineKeyboard([
    [
      Keyboard.button.callback(TXT.common.yes, yes),
      Keyboard.button.callback(TXT.common.no, 'admin_cancel'),
    ],
  ]);
}

export async function showAdminMenu(ctx: AppContext, mode: 'new' | 'edit' = 'edit'): Promise<void> {
  await showCurrentMessage(ctx, TXT.admin.menu, { attachments: [adminKeyboard()] }, mode);
}

function tournamentLocation(t: Tournament): string {
  if (t.city === 'Москва' && t.district) return `${t.city} (${t.district})`;
  return [t.city, t.country].filter(Boolean).join(', ') || '—';
}

function participantsLabel(t: Tournament): string {
  return `${Object.keys(t.participants ?? {}).length}/${t.participants_count}`;
}

function sortTournaments(items: [string, Tournament][]): [string, Tournament][] {
  return [...items].sort((a, b) => {
    const sa = a[1].status === 'active' ? 0 : a[1].status === 'started' ? 1 : 2;
    const sb = b[1].status === 'active' ? 0 : b[1].status === 'started' ? 1 : 2;
    if (sa !== sb) return sa - sb;
    return (b[1].created_at || '').localeCompare(a[1].created_at || '');
  });
}

function tournamentButtonLabel(t: Tournament): string {
  const num = /№(\d+)/.exec(t.name)?.[1] ?? '?';
  const label = `№${num} | ${t.level || '?'} | ${tournamentLocation(t)} | ${participantsLabel(t)}`;
  return label.length > 60 ? `${label.slice(0, 57)}…` : label;
}

async function rollbackGamesForUser(
  users: Record<string, UserProfile>,
  games: CompletedGame[],
  userId: number,
): Promise<CompletedGame[]> {
  const remaining: CompletedGame[] = [];
  for (const game of games) {
    if (!game.players.includes(userId)) {
      remaining.push(game);
      continue;
    }
    const updates = game.rating_updates ?? {};
    for (const [pid, upd] of Object.entries(updates)) {
      const u = users[pid];
      if (!u) continue;
      u.rating_points = upd.before;
      u.player_level = calculateLevelFromPoints(upd.before, u.sport);
      u.games_played = Math.max(0, (u.games_played ?? 0) - 1);
      if (game.winner_ids.includes(Number(pid))) {
        u.games_wins = Math.max(0, (u.games_wins ?? 0) - 1);
      }
    }
  }
  return remaining;
}

async function removeUserCompletely(userId: number): Promise<UserProfile | undefined> {
  const users = await storage.getUsers();
  const key = String(userId);
  const user = users[key];
  if (!user) return undefined;

  const games = await storage.getGames();
  const remainingGames = await rollbackGamesForUser(users, games, userId);
  delete users[key];
  await storage.saveUsers(users);
  await storage.saveGames(remainingGames);
  return user;
}

function getMessageAttachments(ctx: AppContext): AttachmentRequest[] {
  const attachments = ctx.message?.body.attachments;
  if (!attachments?.length) return [];
  const out: AttachmentRequest[] = [];
  for (const a of attachments) {
    if (a.type === 'image' && a.payload?.url) {
      out.push({ type: 'image', payload: { url: a.payload.url } });
    } else if (a.type === 'video' && 'token' in (a.payload ?? {}) && (a.payload as { token?: string }).token) {
      out.push({ type: 'video', payload: { token: (a.payload as { token: string }).token } });
    }
  }
  return out;
}

function formatSubInfo(sub?: SubscriptionInfo): string {
  if (!sub) return TXT.admin.sub_none;
  return fmt(TXT.admin.sub_info, {
    status: sub.active ? TXT.admin.sub_active : TXT.admin.sub_inactive,
    until: sub.until || '—',
    activated: sub.activated || '—',
    email: sub.email || '—',
  });
}

function parseSubscriptionDate(value: string): string | null {
  const v = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const ru = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(v);
  if (ru) return `${ru[3]}-${ru[2]}-${ru[1]}`;
  const slash = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v);
  if (slash) return `${slash[3]}-${slash[2]}-${slash[1]}`;
  return null;
}

function parseSubscriptionDateTime(value: string): string | null {
  const v = value.trim();
  const withTime = /^(\d{4}-\d{2}-\d{2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(v)
    || /^(\d{2}\.\d{2}\.\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(v);
  if (withTime) {
    const date = parseSubscriptionDate(withTime[1]);
    if (!date) return null;
    const h = String(withTime[2]).padStart(2, '0');
    const m = String(withTime[3]).padStart(2, '0');
    const s = String(withTime[4] ?? '00').padStart(2, '0');
    return `${date} ${h}:${m}:${s}`;
  }
  const dateOnly = parseSubscriptionDate(v);
  return dateOnly ? `${dateOnly} 00:00:00` : null;
}

function searchUsersForSubscription(
  users: Record<string, UserProfile>,
  query: string,
): [string, UserProfile][] {
  const raw = query.trim();
  if (!raw) return [];
  const q = raw.toLowerCase();
  const usernameQ = q.replace(/^@/, '');
  const digits = raw.replace(/\D/g, '');
  const results: [string, UserProfile][] = [];
  for (const [id, u] of Object.entries(users)) {
    const first = (u.first_name || '').toLowerCase();
    const last = (u.last_name || '').toLowerCase();
    const full = `${first} ${last}`.trim();
    const username = (u.username || '').toLowerCase().replace(/^@/, '');
    const phoneDigits = String(u.phone || '').replace(/\D/g, '');
    const matched =
      q === id.toLowerCase()
      || first.includes(q)
      || last.includes(q)
      || full.includes(q)
      || (usernameQ && username.includes(usernameQ))
      || (digits && phoneDigits.includes(digits))
      || (digits && digits === id);
    if (matched) results.push([id, u]);
  }
  results.sort((a, b) => {
    const na = `${a[1].first_name} ${a[1].last_name}`.trim().toLowerCase();
    const nb = `${b[1].first_name} ${b[1].last_name}`.trim().toLowerCase();
    return na.localeCompare(nb) || a[0].localeCompare(b[0]);
  });
  return results;
}

function subUserButtonLabel(id: string, user: UserProfile): string {
  let name = `${user.first_name} ${user.last_name}`.trim() || id;
  if (name.length > 25) name = `${name.slice(0, 22)}…`;
  const sub = user.subscription;
  let suffix = '➖';
  if (sub?.active) suffix = `✅ ${sub.until || '?'}`;
  else if (sub) suffix = '❌';
  return `🔔 ${name} (${suffix})`;
}

async function showSubscriptionManagement(ctx: AppContext, userId: string): Promise<boolean> {
  const users = await storage.getUsers();
  const user = users[userId];
  if (!user) {
    await showCurrentMessage(ctx, TXT.admin.user_not_found, { attachments: [backToAdminKeyboard()] });
    return false;
  }
  const sub = user.subscription;
  const buttons: ReturnType<typeof Keyboard.button.callback>[][] = [];
  if (sub) {
    buttons.push([Keyboard.button.callback(TXT.admin.sub_edit_until, `admin_sub_edit_until:${userId}`)]);
    buttons.push([Keyboard.button.callback(TXT.admin.sub_edit_activated, `admin_sub_edit_activated:${userId}`)]);
    buttons.push([Keyboard.button.callback(TXT.admin.sub_edit_email, `admin_sub_edit_email:${userId}`)]);
    buttons.push([Keyboard.button.callback(
      sub.active ? TXT.admin.sub_deactivate : TXT.admin.sub_activate,
      `admin_sub_toggle_active:${userId}`,
    )]);
    buttons.push([Keyboard.button.callback(TXT.admin.sub_extend, `admin_sub_extend_30:${userId}`)]);
    buttons.push([Keyboard.button.callback(TXT.admin.sub_delete, `admin_sub_delete:${userId}`)]);
  } else {
    buttons.push([Keyboard.button.callback(TXT.admin.sub_create, `admin_sub_create:${userId}`)]);
  }
  buttons.push([Keyboard.button.callback(TXT.admin.back, 'admin_manage_subscription_menu')]);

  await showCurrentMessage(ctx, fmt(TXT.admin.sub_manage_title, {
    name: `${user.first_name} ${user.last_name}`.trim(),
    phone: user.phone || '—',
    id: userId,
    info: formatSubInfo(sub),
  }), { attachments: [Keyboard.inlineKeyboard(buttons)] });
  return true;
}

async function showSubscriptionSearchResults(ctx: AppContext, page = 0): Promise<void> {
  const data = getStateData<SubData>(ctx);
  const query = data.admin_sub_search_query || '';
  const users = await storage.getUsers();
  const matched = searchUsersForSubscription(users, query);
  const buttons: ReturnType<typeof Keyboard.button.callback>[][] = [
    [Keyboard.button.callback(TXT.admin.sub_new_search, 'admin_manage_subscription_menu')],
  ];

  if (!matched.length) {
    buttons.push([Keyboard.button.callback(TXT.admin.back_to_main, 'admin_back_to_main')]);
    await showCurrentMessage(ctx, fmt(TXT.admin.sub_not_found, { query }), {
      attachments: [Keyboard.inlineKeyboard(buttons)],
    }, 'new');
    return;
  }

  const totalPages = Math.max(1, Math.ceil(matched.length / SUB_PAGE_SIZE));
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  data.admin_sub_search_page = safePage;
  await setState(ctx, AdminSubscriptionStates.SEARCH_USER, data);

  const slice = matched.slice(safePage * SUB_PAGE_SIZE, (safePage + 1) * SUB_PAGE_SIZE);
  for (const [id, user] of slice) {
    buttons.push([Keyboard.button.callback(subUserButtonLabel(id, user), `admin_select_subscription:${id}`)]);
  }
  const nav: ReturnType<typeof Keyboard.button.callback>[] = [];
  if (safePage > 0) nav.push(Keyboard.button.callback('⬅️', `admin_sub_search_page:${safePage - 1}`));
  if (safePage < totalPages - 1) nav.push(Keyboard.button.callback('➡️', `admin_sub_search_page:${safePage + 1}`));
  if (nav.length) buttons.push(nav);
  buttons.push([Keyboard.button.callback(TXT.admin.back_to_main, 'admin_back_to_main')]);

  await showCurrentMessage(ctx, fmt(TXT.admin.sub_results, {
    query,
    total: matched.length,
    page: safePage + 1,
    pages: totalPages,
  }), { attachments: [Keyboard.inlineKeyboard(buttons)] }, 'new');
}

async function promptSubscriptionSearch(ctx: AppContext): Promise<void> {
  await setState(ctx, AdminSubscriptionStates.SEARCH_USER, {
    admin_sub_search_query: undefined,
    admin_sub_search_page: 0,
  });
  await showCurrentMessage(ctx, TXT.admin.sub_search_prompt, {
    attachments: [backToAdminKeyboard()],
  });
}

async function showBannedList(ctx: AppContext): Promise<void> {
  const banned = await storage.getBanned();
  if (!Object.keys(banned).length) {
    await showCurrentMessage(ctx, TXT.admin.banned_empty, {
      attachments: [Keyboard.inlineKeyboard([
        [Keyboard.button.callback(TXT.admin.back_to_main, 'admin_back_to_main')],
      ])],
    });
    return;
  }
  let text = TXT.admin.banned_title;
  for (const [id, ban] of Object.entries(banned)) {
    text += `👤 ${ban.first_name || ''} ${ban.last_name || ''}\n`;
    text += `📞 ${ban.phone || '—'}\n`;
    text += `🆔 ID: ${id}\n`;
    text += `⏰ Забанен: ${ban.banned_at || '—'}\n`;
    text += `${'─'.repeat(20)}\n`;
  }
  await showCurrentMessage(ctx, text, {
    attachments: [Keyboard.inlineKeyboard([
      [Keyboard.button.callback(TXT.admin.unban_user, 'admin_unban_menu')],
      [Keyboard.button.callback(TXT.admin.clear_all_bans, 'admin_clear_all_bans')],
      [Keyboard.button.callback(TXT.admin.back_to_main, 'admin_back_to_main')],
    ])],
  });
}

async function showUnbanMenu(ctx: AppContext): Promise<void> {
  const banned = await storage.getBanned();
  const entries = Object.entries(banned);
  if (!entries.length) {
    await showCurrentMessage(ctx, TXT.admin.banned_empty, { attachments: [backToAdminKeyboard()] });
    return;
  }
  const buttons = entries.slice(0, 15).map(([id, ban]) => {
    const name = `${ban.first_name || ''} ${ban.last_name || ''}`.trim() || id;
    return [Keyboard.button.callback(`🔓 ${name}`, `admin_unban_user:${id}`)];
  });
  buttons.push([Keyboard.button.callback(TXT.admin.back, 'admin_banned_list')]);
  const hint = entries.length > 15 ? ` (показаны первые 15 из ${entries.length})` : '';
  await showCurrentMessage(ctx, fmt(TXT.admin.unban_pick, { hint }), {
    attachments: [Keyboard.inlineKeyboard(buttons)],
  });
}

async function showEditTournamentsPage(ctx: AppContext, page = 0): Promise<void> {
  const all = await storage.getTournaments();
  const items = sortTournaments(Object.entries(all));
  if (!items.length) {
    await showCurrentMessage(ctx, TXT.admin.tournaments_empty, {
      attachments: [Keyboard.inlineKeyboard([
        [Keyboard.button.callback(TXT.admin.create_tournament, 'admin_create_tournament')],
        [Keyboard.button.callback(TXT.admin.back_to_main, 'admin_back_to_main')],
      ])],
    });
    return;
  }
  const totalPages = Math.max(1, Math.ceil(items.length / TOURN_PAGE_SIZE));
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const slice = items.slice(safePage * TOURN_PAGE_SIZE, (safePage + 1) * TOURN_PAGE_SIZE);
  const buttons = slice.map(([id, t]) => [
    Keyboard.button.callback(tournamentButtonLabel(t), `edit_tournament:${id}`),
  ]);
  const nav: ReturnType<typeof Keyboard.button.callback>[] = [];
  if (safePage > 0) nav.push(Keyboard.button.callback('⬅️', `admin_tournaments_page:${safePage - 1}`));
  if (safePage < totalPages - 1) nav.push(Keyboard.button.callback('➡️', `admin_tournaments_page:${safePage + 1}`));
  if (nav.length) buttons.push(nav);
  buttons.push([Keyboard.button.callback(TXT.admin.back_to_main, 'admin_back_to_main')]);
  await showCurrentMessage(ctx, fmt(TXT.admin.tournaments_pick, {
    page: safePage + 1,
    pages: totalPages,
    total: items.length,
  }), { attachments: [Keyboard.inlineKeyboard(buttons)] });
}

async function showTournamentAdminView(ctx: AppContext, tournamentId: string): Promise<void> {
  const t = await storage.getTournament(tournamentId);
  if (!t) {
    await showCurrentMessage(ctx, TXT.admin.tournament_not_found, { attachments: [backToAdminKeyboard()] });
    return;
  }
  await showCurrentMessage(ctx, fmt(TXT.admin.tournament_view, {
    name: t.name,
    sport: t.sport,
    location: tournamentLocation(t),
    type: t.type,
    participants: Object.keys(t.participants ?? {}).length,
    max: t.participants_count,
    status: t.status,
    id: tournamentId,
  }), {
    attachments: [Keyboard.inlineKeyboard([
      [Keyboard.button.callback(TXT.admin.delete_tournament, `admin_delete_tournament:${tournamentId}`)],
      [Keyboard.button.callback(TXT.admin.back, 'admin_edit_tournaments')],
      [Keyboard.button.callback(TXT.admin.back_to_main, 'admin_back_to_main')],
    ])],
  });
}

function broadcastPreview(data: BroadcastData): string {
  const parts: string[] = [];
  if (data.media?.length) parts.push(`🖼 Медиа: ${data.media.length}`);
  if (data.text) parts.push(data.text);
  return parts.join('\n\n') || '—';
}

async function showBroadcastConfirm(ctx: AppContext, data: BroadcastData): Promise<void> {
  await setState(ctx, AdminBroadcastStates.CONFIRM, data);
  await showCurrentMessage(ctx, fmt(TXT.admin.broadcast_confirm, { preview: broadcastPreview(data) }), {
    attachments: [Keyboard.inlineKeyboard([
      [Keyboard.button.callback(TXT.admin.send_broadcast, 'admin_broadcast_confirm')],
      [Keyboard.button.callback(TXT.admin.broadcast_cancel, 'admin_broadcast_cancel')],
    ])],
  }, 'new');
}

async function runBroadcast(ctx: AppContext, data: BroadcastData): Promise<void> {
  if (!data.text && !data.media?.length) {
    await showCurrentMessage(ctx, TXT.admin.broadcast_empty, { attachments: [backToAdminKeyboard()] });
    return;
  }
  const ids = (await storage.listAllUserIds()).filter((id) => !isAdmin(id));
  let sent = 0;
  const progressMsg = await ctx.reply(fmt(TXT.admin.broadcast_progress, { current: 0, total: ids.length }));
  for (let i = 0; i < ids.length; i++) {
    try {
      await ctx.api.sendMessageToUser(ids[i]!, data.text || ' ', {
        format: 'html',
        attachments: data.media?.length ? data.media : undefined,
      });
      sent += 1;
    } catch {
      /* skip unreachable */
    }
    if ((i + 1) % 10 === 0 || i === ids.length - 1) {
      try {
        if (progressMsg?.body?.mid) {
          await ctx.api.editMessage(progressMsg.body.mid, {
            text: fmt(TXT.admin.broadcast_progress, { current: i + 1, total: ids.length }),
          });
        }
      } catch {
        /* ignore */
      }
    }
    await sleep(50);
  }
  await clearState(ctx);
  await showCurrentMessage(ctx, fmt(TXT.admin.broadcast_done, { count: sent, total: ids.length }), {
    attachments: [backToAdminKeyboard()],
  }, 'new');
}

export function registerAdminHandlers(bot: import('@maxhub/max-bot-api').Bot<AppContext>): void {
  bot.command(/^admin(?:@[\w]+)?$/i, async (ctx) => {
    beginCommandResponse(ctx);
    if (!(await requireAdmin(ctx))) return;
    await clearState(ctx);
    await showAdminMenu(ctx, 'new');
  });

  bot.command(/^banned_users(?:@[\w]+)?$/i, async (ctx) => {
    beginCommandResponse(ctx);
    if (!(await requireAdmin(ctx))) return;
    await showBannedList(ctx);
  });

  bot.command(/^unban_user(?:@[\w]+)?$/i, async (ctx) => {
    beginCommandResponse(ctx);
    if (!(await requireAdmin(ctx))) return;
    await showUnbanMenu(ctx);
  });

  bot.action('admin_back_to_main', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    if (!(await requireAdmin(ctx))) return;
    await clearState(ctx);
    await showAdminMenu(ctx);
  });

  bot.action('admin_cancel', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    if (!(await requireAdmin(ctx))) return;
    await clearState(ctx);
    await showCurrentMessage(ctx, TXT.admin.action_cancelled, { attachments: [adminKeyboard()] });
  });

  bot.action('admin_banned_list', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    if (!(await requireAdmin(ctx))) return;
    await showBannedList(ctx);
  });

  bot.action('admin_unban_menu', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    if (!(await requireAdmin(ctx))) return;
    await showUnbanMenu(ctx);
  });

  bot.action(/^admin_unban_user:/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    if (!(await requireAdmin(ctx))) return;
    const id = getCallbackPayload(ctx).replace('admin_unban_user:', '');
    const banned = await storage.getBanned();
    const ban = banned[id];
    if (!ban) {
      await showCurrentMessage(ctx, TXT.admin.user_not_found, { attachments: [backToAdminKeyboard()] });
      return;
    }
    await showCurrentMessage(ctx, fmt(TXT.admin.unban_confirm, {
      name: `${ban.first_name || ''} ${ban.last_name || ''}`.trim() || id,
      phone: ban.phone || '—',
      id,
      at: ban.banned_at || '—',
    }), { attachments: [confirmKeyboard('unban_user', id)] });
  });

  bot.action(/^admin_confirm_unban_user:/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    if (!(await requireAdmin(ctx))) return;
    const id = getCallbackPayload(ctx).replace('admin_confirm_unban_user:', '');
    const banned = await storage.getBanned();
    const ban = banned[id];
    if (!ban) {
      await showCurrentMessage(ctx, TXT.admin.user_not_found, { attachments: [backToAdminKeyboard()] });
      return;
    }
    await storage.unbanUser(Number(id));
    await showCurrentMessage(ctx, fmt(TXT.admin.unban_done, {
      name: `${ban.first_name || ''} ${ban.last_name || ''}`.trim() || id,
      id,
    }), { attachments: [backToAdminKeyboard()] });
  });

  bot.action('admin_clear_all_bans', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    if (!(await requireAdmin(ctx))) return;
    const banned = await storage.getBanned();
    await showCurrentMessage(ctx, fmt(TXT.admin.clear_bans_confirm, { count: Object.keys(banned).length }), {
      attachments: [confirmKeyboard('clear_all_bans')],
    });
  });

  bot.action('admin_confirm_clear_all_bans', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    if (!(await requireAdmin(ctx))) return;
    await storage.clearAllBans();
    await showCurrentMessage(ctx, TXT.admin.clear_bans_done, { attachments: [backToAdminKeyboard()] });
  });

  bot.action('admin_broadcast_menu', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    if (!(await requireAdmin(ctx))) return;
    await clearState(ctx);
    await showCurrentMessage(ctx, TXT.admin.broadcast_menu, {
      attachments: [Keyboard.inlineKeyboard([
        [Keyboard.button.callback(TXT.admin.broadcast_forward, 'admin_broadcast_forward')],
        [Keyboard.button.callback(TXT.admin.broadcast_manual, 'admin_broadcast_manual')],
        [Keyboard.button.callback(TXT.admin.back_to_main, 'admin_back_to_main')],
      ])],
    });
  });

  bot.action('admin_broadcast_forward', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    if (!(await requireAdmin(ctx))) return;
    await setState(ctx, AdminBroadcastStates.WAIT_FORWARD, { mode: 'forward', media: [] });
    await showCurrentMessage(ctx, TXT.admin.broadcast_forward_prompt, {
      attachments: [Keyboard.inlineKeyboard([
        [Keyboard.button.callback(TXT.admin.broadcast_cancel, 'admin_broadcast_cancel')],
      ])],
    });
  });

  bot.action('admin_broadcast_manual', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    if (!(await requireAdmin(ctx))) return;
    await setState(ctx, AdminBroadcastStates.MANUAL_MEDIA, { mode: 'manual', media: [] });
    await showCurrentMessage(ctx, TXT.admin.broadcast_media_prompt, {
      attachments: [Keyboard.inlineKeyboard([
        [Keyboard.button.callback(TXT.admin.broadcast_media_done, 'admin_broadcast_media_done')],
        [Keyboard.button.callback(TXT.admin.broadcast_cancel, 'admin_broadcast_cancel')],
      ])],
    });
  });

  bot.action('admin_broadcast_media_done', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    if (!(await requireAdmin(ctx))) return;
    const data = getStateData<BroadcastData>(ctx);
    await setState(ctx, AdminBroadcastStates.MANUAL_TEXT, data);
    await showCurrentMessage(ctx, TXT.admin.broadcast_text_prompt, {
      attachments: [Keyboard.inlineKeyboard([
        [Keyboard.button.callback(TXT.admin.broadcast_skip_text, 'admin_broadcast_skip_text')],
        [Keyboard.button.callback(TXT.admin.broadcast_back_media, 'admin_broadcast_back_to_media')],
        [Keyboard.button.callback(TXT.admin.broadcast_cancel, 'admin_broadcast_cancel')],
      ])],
    });
  });

  bot.action('admin_broadcast_back_to_media', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    if (!(await requireAdmin(ctx))) return;
    const data = getStateData<BroadcastData>(ctx);
    await setState(ctx, AdminBroadcastStates.MANUAL_MEDIA, data);
    await showCurrentMessage(ctx, TXT.admin.broadcast_media_prompt, {
      attachments: [Keyboard.inlineKeyboard([
        [Keyboard.button.callback(TXT.admin.broadcast_media_done, 'admin_broadcast_media_done')],
        [Keyboard.button.callback(TXT.admin.broadcast_cancel, 'admin_broadcast_cancel')],
      ])],
    });
  });

  bot.action('admin_broadcast_skip_text', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    if (!(await requireAdmin(ctx))) return;
    const data = getStateData<BroadcastData>(ctx);
    data.text = '';
    await showBroadcastConfirm(ctx, data);
  });

  bot.action('admin_broadcast_confirm', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    if (!(await requireAdmin(ctx))) return;
    await runBroadcast(ctx, getStateData<BroadcastData>(ctx));
  });

  bot.action('admin_broadcast_cancel', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    if (!(await requireAdmin(ctx))) return;
    await clearState(ctx);
    await showAdminMenu(ctx);
  });

  bot.action('admin_manage_subscription_menu', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    if (!(await requireAdmin(ctx))) return;
    await promptSubscriptionSearch(ctx);
  });

  bot.action(/^admin_sub_search_page:/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    if (!(await requireAdmin(ctx))) return;
    const page = Number(getCallbackPayload(ctx).replace('admin_sub_search_page:', '')) || 0;
    await showSubscriptionSearchResults(ctx, page);
  });

  bot.action(/^admin_select_subscription:/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    if (!(await requireAdmin(ctx))) return;
    const userId = getCallbackPayload(ctx).replace('admin_select_subscription:', '');
    await showSubscriptionManagement(ctx, userId);
  });

  bot.action(/^admin_sub_edit_until:/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    if (!(await requireAdmin(ctx))) return;
    const userId = Number(getCallbackPayload(ctx).replace('admin_sub_edit_until:', ''));
    await setState(ctx, AdminSubscriptionStates.EDIT_UNTIL, { admin_sub_user_id: userId });
    await askText(ctx, TXT.admin.sub_enter_until);
  });

  bot.action(/^admin_sub_edit_activated:/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    if (!(await requireAdmin(ctx))) return;
    const userId = Number(getCallbackPayload(ctx).replace('admin_sub_edit_activated:', ''));
    await setState(ctx, AdminSubscriptionStates.EDIT_ACTIVATED, { admin_sub_user_id: userId });
    await askText(ctx, TXT.admin.sub_enter_activated);
  });

  bot.action(/^admin_sub_edit_email:/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    if (!(await requireAdmin(ctx))) return;
    const userId = Number(getCallbackPayload(ctx).replace('admin_sub_edit_email:', ''));
    await setState(ctx, AdminSubscriptionStates.EDIT_EMAIL, { admin_sub_user_id: userId });
    await askText(ctx, TXT.admin.sub_enter_email);
  });

  bot.action(/^admin_sub_toggle_active:/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    if (!(await requireAdmin(ctx))) return;
    const userId = getCallbackPayload(ctx).replace('admin_sub_toggle_active:', '');
    const user = await storage.getUser(Number(userId));
    if (!user?.subscription) {
      await showCurrentMessage(ctx, TXT.admin.user_not_found, { attachments: [backToAdminKeyboard()] });
      return;
    }
    user.subscription.active = !user.subscription.active;
    if (user.subscription.active) delete user.subscription.expired;
    await storage.saveUser(user);
    await showSubscriptionManagement(ctx, userId);
  });

  bot.action(/^admin_sub_extend_30:/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    if (!(await requireAdmin(ctx))) return;
    const userId = getCallbackPayload(ctx).replace('admin_sub_extend_30:', '');
    const user = await storage.getUser(Number(userId));
    if (!user?.subscription) {
      await showCurrentMessage(ctx, TXT.admin.user_not_found, { attachments: [backToAdminKeyboard()] });
      return;
    }
    const base = new Date(user.subscription.until || formatDateISO(new Date()));
    const from = Number.isNaN(base.getTime()) ? new Date() : base;
    user.subscription.until = formatDateISO(addDays(from, 30));
    user.subscription.active = true;
    delete user.subscription.expired;
    await storage.saveUser(user);
    await showSubscriptionManagement(ctx, userId);
  });

  bot.action(/^admin_sub_create:/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    if (!(await requireAdmin(ctx))) return;
    const userId = getCallbackPayload(ctx).replace('admin_sub_create:', '');
    const user = await storage.getUser(Number(userId));
    if (!user) {
      await showCurrentMessage(ctx, TXT.admin.user_not_found, { attachments: [backToAdminKeyboard()] });
      return;
    }
    const now = new Date();
    user.subscription = {
      active: true,
      until: formatDateISO(addDays(now, 30)),
      activated: formatDateISO(now),
    };
    await storage.saveUser(user);
    await showCurrentMessage(ctx, TXT.admin.sub_created, {
      attachments: [Keyboard.inlineKeyboard([
        [Keyboard.button.callback(TXT.admin.back, `admin_select_subscription:${userId}`)],
      ])],
    });
  });

  bot.action(/^admin_sub_delete:/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    if (!(await requireAdmin(ctx))) return;
    const userId = getCallbackPayload(ctx).replace('admin_sub_delete:', '');
    await showCurrentMessage(ctx, fmt(TXT.admin.sub_delete_confirm, { id: userId }), {
      attachments: [confirmKeyboard('delete_subscription', userId)],
    });
  });

  bot.action(/^admin_confirm_delete_subscription:/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    if (!(await requireAdmin(ctx))) return;
    const userId = getCallbackPayload(ctx).replace('admin_confirm_delete_subscription:', '');
    const user = await storage.getUser(Number(userId));
    if (!user) {
      await showCurrentMessage(ctx, TXT.admin.user_not_found, { attachments: [backToAdminKeyboard()] });
      return;
    }
    delete user.subscription;
    await storage.saveUser(user);
    await showCurrentMessage(ctx, TXT.admin.sub_deleted, {
      attachments: [Keyboard.inlineKeyboard([
        [Keyboard.button.callback(TXT.admin.back, `admin_select_subscription:${userId}`)],
      ])],
    });
  });

  bot.action('admin_edit_tournaments', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    if (!(await requireAdmin(ctx))) return;
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
    await showTournamentAdminView(ctx, id);
  });

  bot.action(/^admin_delete_tournament:/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    if (!(await requireAdmin(ctx))) return;
    const id = getCallbackPayload(ctx).replace('admin_delete_tournament:', '');
    const t = await storage.getTournament(id);
    if (!t) {
      await showCurrentMessage(ctx, TXT.admin.tournament_not_found, { attachments: [backToAdminKeyboard()] });
      return;
    }
    await showCurrentMessage(ctx, fmt(TXT.admin.tournament_delete_confirm, {
      name: t.name,
      location: tournamentLocation(t),
      participants: participantsLabel(t),
    }), { attachments: [confirmKeyboard('delete_tournament', id)] });
  });

  bot.action(/^admin_confirm_delete_tournament:/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    if (!(await requireAdmin(ctx))) return;
    const id = getCallbackPayload(ctx).replace('admin_confirm_delete_tournament:', '');
    const all = await storage.getTournaments();
    const t = all[id];
    if (!t) {
      await showCurrentMessage(ctx, TXT.admin.tournament_not_found, { attachments: [backToAdminKeyboard()] });
      return;
    }
    delete all[id];
    await storage.saveTournaments(all);
    const apps = await storage.getApplications();
    await storage.saveApplications(apps.filter((a) => a.tournament_id !== id));
    await showCurrentMessage(ctx, fmt(TXT.admin.tournament_deleted, { name: t.name }), {
      attachments: [Keyboard.inlineKeyboard([
        [Keyboard.button.callback(TXT.admin.back, 'admin_edit_tournaments')],
        [Keyboard.button.callback(TXT.admin.back_to_main, 'admin_back_to_main')],
      ])],
    });
  });

  bot.action(/^admin_select_user:/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    if (!(await requireAdmin(ctx))) return;
    const userId = getCallbackPayload(ctx).replace('admin_select_user:', '');
    const user = await storage.getUser(Number(userId));
    if (!user) {
      await showCurrentMessage(ctx, TXT.admin.user_not_found, { attachments: [backToAdminKeyboard()] });
      return;
    }
    await showCurrentMessage(ctx, fmt(TXT.admin.select_user_action, {
      name: `${user.first_name} ${user.last_name}`.trim(),
      phone: user.phone || '—',
      rating: user.rating_points ?? 0,
      played: user.games_played ?? 0,
      offers: (user.games ?? []).filter((g) => g.active).length,
    }), {
      attachments: [Keyboard.inlineKeyboard([
        [
          Keyboard.button.callback(TXT.admin.confirm_delete_user, `admin_confirm_delete_user:${userId}`),
          Keyboard.button.callback(TXT.admin.ban, `admin_ban_user:${userId}`),
        ],
        [Keyboard.button.callback(TXT.common.cancel, 'admin_cancel')],
      ])],
    });
  });

  bot.action(/^admin_confirm_delete_user:/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    if (!(await requireAdmin(ctx))) return;
    const userId = Number(getCallbackPayload(ctx).replace('admin_confirm_delete_user:', ''));
    const removed = await removeUserCompletely(userId);
    if (!removed) {
      await showCurrentMessage(ctx, TXT.admin.user_not_found, { attachments: [backToAdminKeyboard()] });
      return;
    }
    await showCurrentMessage(ctx, fmt(TXT.admin.user_deleted, { id: userId }), {
      attachments: [backToAdminKeyboard()],
    });
  });

  bot.action(/^admin_delete_user:/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    if (!(await requireAdmin(ctx))) return;
    const userId = getCallbackPayload(ctx).replace('admin_delete_user:', '');
    const user = await storage.getUser(Number(userId));
    if (!user) {
      await showCurrentMessage(ctx, TXT.admin.user_not_found, { attachments: [backToAdminKeyboard()] });
      return;
    }
    await showCurrentMessage(ctx, fmt(TXT.admin.select_user_action, {
      name: `${user.first_name} ${user.last_name}`.trim(),
      phone: user.phone || '—',
      rating: user.rating_points ?? 0,
      played: user.games_played ?? 0,
      offers: (user.games ?? []).filter((g) => g.active).length,
    }), {
      attachments: [Keyboard.inlineKeyboard([
        [
          Keyboard.button.callback(TXT.admin.confirm_delete_user, `admin_confirm_delete_user:${userId}`),
          Keyboard.button.callback(TXT.admin.ban, `admin_ban_user:${userId}`),
        ],
        [Keyboard.button.callback(TXT.common.cancel, 'admin_cancel')],
      ])],
    });
  });

  bot.action(/^admin_ban_user:/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    if (!(await requireAdmin(ctx))) return;
    const userId = Number(getCallbackPayload(ctx).replace('admin_ban_user:', ''));
    const user = await storage.getUser(userId);
    if (!user) {
      await showCurrentMessage(ctx, TXT.admin.user_not_found, { attachments: [backToAdminKeyboard()] });
      return;
    }
    const banExtra: Partial<BannedUser> = {
      first_name: user.first_name,
      last_name: user.last_name,
      username: user.username,
      phone: user.phone,
      banned_by: getCtxUserId(ctx),
    };
    await storage.banUser(userId, 'Admin ban', banExtra);
    await removeUserCompletely(userId);
    await showCurrentMessage(ctx, fmt(TXT.admin.user_banned, { id: userId }), {
      attachments: [backToAdminKeyboard()],
    });
  });

  bot.action(/^admin_confirm_delete_vacation:/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    if (!(await requireAdmin(ctx))) return;
    const userId = Number(getCallbackPayload(ctx).replace('admin_confirm_delete_vacation:', ''));
    const user = await storage.getUser(userId);
    if (!user) {
      await showCurrentMessage(ctx, TXT.admin.user_not_found, { attachments: [backToAdminKeyboard()] });
      return;
    }
    user.vacation_tennis = false;
    delete user.vacation_start;
    delete user.vacation_end;
    delete user.vacation_comment;
    delete user.vacation_country;
    delete user.vacation_city;
    delete user.vacation_district;
    await storage.saveUser(user);
    await showCurrentMessage(ctx, fmt(TXT.admin.vacation_deleted, { id: userId }), {
      attachments: [backToAdminKeyboard()],
    });
  });

  bot.action(/^admin_edit_profile:/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    if (!(await requireAdmin(ctx))) return;
    const userId = Number(getCallbackPayload(ctx).replace('admin_edit_profile:', ''));
    const user = await storage.getUser(userId);
    if (!user) {
      await showCurrentMessage(ctx, TXT.admin.user_not_found, { attachments: [backToAdminKeyboard()] });
      return;
    }
    await clearState(ctx);
    ctx.session.data = { admin_edit_user_id: userId };
    await showEditProfileMenu(ctx, user);
  });
}

export async function handleAdminMessage(ctx: AppContext, text: string): Promise<boolean> {
  if (!isAdmin(getCtxUserId(ctx))) return false;

  const state = getState(ctx);

  if (state === AdminBroadcastStates.WAIT_FORWARD) {
    const message = getMessageText(ctx) || text || '';
    const media = getMessageAttachments(ctx);
    if (!message && !media.length) {
      await askText(ctx, TXT.admin.broadcast_forward_prompt);
      return true;
    }
    await showBroadcastConfirm(ctx, { mode: 'forward', text: message, media });
    return true;
  }

  if (state === AdminBroadcastStates.MANUAL_MEDIA) {
    const media = getMessageAttachments(ctx);
    const data = getStateData<BroadcastData>(ctx);
    if (media.length) {
      data.media = [...(data.media ?? []), ...media];
      await setState(ctx, AdminBroadcastStates.MANUAL_MEDIA, data);
      await showCurrentMessage(ctx, `${TXT.admin.broadcast_media_prompt}\n\n🖼 Загружено: ${data.media.length}`, {
        attachments: [Keyboard.inlineKeyboard([
          [Keyboard.button.callback(TXT.admin.broadcast_media_done, 'admin_broadcast_media_done')],
          [Keyboard.button.callback(TXT.admin.broadcast_cancel, 'admin_broadcast_cancel')],
        ])],
      }, 'new');
      return true;
    }
    await showCurrentMessage(ctx, TXT.admin.broadcast_media_prompt, {
      attachments: [Keyboard.inlineKeyboard([
        [Keyboard.button.callback(TXT.admin.broadcast_media_done, 'admin_broadcast_media_done')],
        [Keyboard.button.callback(TXT.admin.broadcast_cancel, 'admin_broadcast_cancel')],
      ])],
    }, 'new');
    return true;
  }

  if (state === AdminBroadcastStates.MANUAL_TEXT) {
    const message = getMessageText(ctx) || text;
    if (!message) {
      await askText(ctx, TXT.admin.broadcast_text_prompt);
      return true;
    }
    const data = getStateData<BroadcastData>(ctx);
    data.text = message;
    await showBroadcastConfirm(ctx, data);
    return true;
  }

  if (state === AdminSubscriptionStates.SEARCH_USER && text) {
    const data = getStateData<SubData>(ctx);
    data.admin_sub_search_query = text.trim();
    data.admin_sub_search_page = 0;
    await setState(ctx, AdminSubscriptionStates.SEARCH_USER, data);
    await showSubscriptionSearchResults(ctx, 0);
    return true;
  }

  if (state === AdminSubscriptionStates.EDIT_UNTIL && text) {
    const data = getStateData<SubData>(ctx);
    const userId = data.admin_sub_user_id;
    const parsed = parseSubscriptionDate(text);
    if (!parsed || !userId) {
      await askText(ctx, TXT.admin.sub_date_invalid);
      return true;
    }
    const user = await storage.getUser(userId);
    if (!user?.subscription) {
      await clearState(ctx);
      await ctx.reply(TXT.admin.user_not_found);
      return true;
    }
    user.subscription.until = parsed;
    await storage.saveUser(user);
    await clearState(ctx);
    await ctx.reply(TXT.admin.sub_updated);
    await showSubscriptionManagement(ctx, String(userId));
    return true;
  }

  if (state === AdminSubscriptionStates.EDIT_ACTIVATED && text) {
    const data = getStateData<SubData>(ctx);
    const userId = data.admin_sub_user_id;
    const parsed = parseSubscriptionDateTime(text);
    if (!parsed || !userId) {
      await askText(ctx, TXT.admin.sub_date_invalid);
      return true;
    }
    const user = await storage.getUser(userId);
    if (!user?.subscription) {
      await clearState(ctx);
      await ctx.reply(TXT.admin.user_not_found);
      return true;
    }
    user.subscription.activated = parsed;
    await storage.saveUser(user);
    await clearState(ctx);
    await ctx.reply(TXT.admin.sub_updated);
    await showSubscriptionManagement(ctx, String(userId));
    return true;
  }

  if (state === AdminSubscriptionStates.EDIT_EMAIL && text) {
    const data = getStateData<SubData>(ctx);
    const userId = data.admin_sub_user_id;
    if (!userId || !isValidEmail(text.trim())) {
      await askText(ctx, TXT.admin.sub_email_invalid);
      return true;
    }
    const user = await storage.getUser(userId);
    if (!user?.subscription) {
      await clearState(ctx);
      await ctx.reply(TXT.admin.user_not_found);
      return true;
    }
    user.subscription.email = text.trim();
    await storage.saveUser(user);
    await clearState(ctx);
    await ctx.reply(TXT.admin.sub_updated);
    await showSubscriptionManagement(ctx, String(userId));
    return true;
  }

  return false;
}

/** @deprecated use handleAdminMessage */
export async function handleAdminBroadcast(ctx: AppContext, text: string): Promise<boolean> {
  return handleAdminMessage(ctx, text);
}
