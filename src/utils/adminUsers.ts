import { Keyboard } from '@maxhub/max-bot-api';
import { TXT, fmt } from '../texts.js';
import type { AppContext } from '../context.js';
import { storage } from '../storage/jsonStorage.js';
import type { SubscriptionInfo } from '../types/models.js';
import { showCurrentMessage } from './bot.js';

const DEFAULT_BACK_PAYLOAD = 'admin_manage_subscription_menu';

export function formatSubInfo(sub?: SubscriptionInfo): string {
  if (!sub) return TXT.admin.sub_none;
  return fmt(TXT.admin.sub_info, {
    status: sub.active ? TXT.admin.sub_active : TXT.admin.sub_inactive,
    until: sub.until || '—',
    activated: sub.activated || '—',
    email: sub.email || '—',
  });
}

/**
 * Карточка пользователя в админке: только поля, нужные админу для управления (не то,
 * что видят обычные пользователи в профиле) + все админские действия в одном месте —
 * подписка, редактирование, бан, удаление, удаление отпуска.
 *
 * backPayload запоминается в сессии при первом заходе (со списка или из поиска по подписке)
 * и переиспользуется при последующих обновлениях этой же карточки, чтобы кнопка «Назад»
 * возвращала туда, откуда админ действительно пришёл.
 */
export async function showUserAdminCard(
  ctx: AppContext,
  userId: string,
  backPayload?: string,
  mode: 'new' | 'edit' = 'edit',
): Promise<boolean> {
  if (backPayload) {
    ctx.session.data = { ...ctx.session.data, admin_user_back: backPayload };
  }
  const effectiveBack = (ctx.session.data.admin_user_back as string | undefined) ?? DEFAULT_BACK_PAYLOAD;

  const users = await storage.getUsers();
  const user = users[userId];
  if (!user) {
    await showCurrentMessage(ctx, TXT.admin.user_not_found, {
      attachments: [Keyboard.inlineKeyboard([[Keyboard.button.callback(TXT.admin.back_to_main, 'admin_back_to_main')]])],
    }, mode);
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
  buttons.push([
    Keyboard.button.callback(TXT.admin.delete_user, `admin_select_user:${userId}`),
    Keyboard.button.callback(TXT.admin.edit_other_profile, `admin_edit_profile:${userId}`),
  ]);
  if (user.vacation_tennis) {
    buttons.push([Keyboard.button.callback(TXT.admin.delete_vacation, `admin_confirm_delete_vacation:${userId}`)]);
  }
  buttons.push([Keyboard.button.callback(TXT.admin.back, effectiveBack)]);

  const location = [user.city, user.country].filter(Boolean).join(', ') || '—';
  await showCurrentMessage(ctx, fmt(TXT.admin.user_card, {
    name: `${user.first_name} ${user.last_name}`.trim() || '—',
    id: userId,
    phone: user.phone || '—',
    sport: user.sport || '—',
    location,
    rating: user.rating_points ?? 0,
    level: user.player_level || '—',
    played: user.games_played ?? 0,
    wins: user.games_wins ?? 0,
    offers: (user.games ?? []).filter((g) => g.active).length,
    sub_info: formatSubInfo(sub),
  }), { format: 'html', attachments: [Keyboard.inlineKeyboard(buttons)] }, mode);
  return true;
}
