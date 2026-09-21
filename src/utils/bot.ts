import { Keyboard } from '@maxhub/max-bot-api';
import type { AttachmentRequest } from '@maxhub/max-bot-api/types';
import type { AppContext } from '../context.js';
import { getPrevMessageId, setPrevMessageId, clearPrevMessageId } from '../middleware/session.js';
import { calculateAge, getSportCategory, hasCourtPayment, hasVacation, SPORT_ROWS } from '../config/profile.js';
import { saveProfileViewContext } from './gameHistory.js';
import { fullName } from './gameResult.js';
import { TXT, fmt, MENU_LABELS } from '../texts.js';
import type { SportType, UserProfile } from '../types/models.js';

type ReplyExtra = {
  format?: 'html' | 'markdown';
  attachments?: AttachmentRequest[];
};

/**
 * Перед ответом на команду (/start, меню и т.д.): убрать кнопки у прошлого якорного
 * сообщения (оно больше не актуально) и сбросить якорь, чтобы новый ответ не редактировал
 * чужое по смыслу сообщение, а начал новый.
 */
export async function beginCommandResponse(ctx: AppContext): Promise<void> {
  await clearPrevMessageButtons(ctx);
  clearPrevMessageId(ctx);
}

export function mainMenuKeyboard(): AttachmentRequest {
  const rows = [
    [Keyboard.button.callback(MENU_LABELS[0], 'menu:search'), Keyboard.button.callback(MENU_LABELS[1], 'menu:offers')],
    [Keyboard.button.callback(MENU_LABELS[2], 'menu:tournaments'), Keyboard.button.callback(MENU_LABELS[3], 'menu:score')],
    [Keyboard.button.callback(MENU_LABELS[4], 'menu:invite'), Keyboard.button.callback(MENU_LABELS[5], 'menu:payments')],
    [Keyboard.button.callback(MENU_LABELS[6], 'menu:more')],
  ];
  return Keyboard.inlineKeyboard(rows);
}

export function backButton(payload = 'main_menu'): AttachmentRequest {
  return Keyboard.inlineKeyboard([[Keyboard.button.callback(TXT.common.main_menu, payload)]]);
}

export function chunkButtons<T>(
  items: T[],
  mapFn: (item: T) => ReturnType<typeof Keyboard.button.callback>,
  perRow = 2,
): ReturnType<typeof Keyboard.button.callback>[][] {
  const rows: ReturnType<typeof Keyboard.button.callback>[][] = [];
  for (let i = 0; i < items.length; i += perRow) {
    rows.push(items.slice(i, i + perRow).map(mapFn));
  }
  return rows;
}

/**
 * Как chunkButtons, но добавляет trailing-пункт (например «Другая страна» / «Другой город»)
 * отдельной последней строкой, а не парой с последним обычным пунктом — так кнопка выглядит
 * по центру, а не прижатой к соседу.
 */
export function chunkButtonsTrailing<T>(
  items: T[],
  trailing: T,
  mapFn: (item: T) => ReturnType<typeof Keyboard.button.callback>,
  perRow = 2,
): ReturnType<typeof Keyboard.button.callback>[][] {
  const rows = chunkButtons(items, mapFn, perRow);
  rows.push([mapFn(trailing)]);
  return rows;
}

/**
 * Единая раскладка кнопок видов спорта (SPORT_ROWS из config/profile.ts) — используется
 * везде, где пользователь выбирает вид спорта, чтобы сетка кнопок была одинаковой на всех
 * экранах. Кнопки вроде «Все виды спорта» / «Назад» / «Главное меню» в неё не входят —
 * их добавляют отдельными рядами до/после.
 */
export function sportButtonRows(
  mapFn: (sport: SportType) => ReturnType<typeof Keyboard.button.callback>,
): ReturnType<typeof Keyboard.button.callback>[][] {
  return SPORT_ROWS.map((row) => row.map(mapFn));
}

/** Новое сообщение — запрос текстового ввода (вне регистрации и FSM) */
export async function askText(ctx: AppContext, text: string, extra?: ReplyExtra): Promise<void> {
  await ctx.reply(text, extra);
}

/** Убрать inline-кнопки у якорного сообщения (после текстового ввода пользователя) */
export async function clearPrevMessageButtons(ctx: AppContext): Promise<void> {
  const targetId = getPrevMessageId(ctx);
  if (!targetId) return;
  try {
    const msg = await ctx.getMessage(targetId);
    await ctx.api.editMessage(targetId, {
      text: msg.body.text ?? '',
      format: 'html',
      attachments: [],
    });
  } catch {
    /* ignore */
  }
}

/**
 * Новое сообщение после ввода пользователя.
 * Кнопки у предыдущего якорного сообщения убираются автоматически внутри AppContext.reply().
 */
export async function replyText(ctx: AppContext, text: string, extra?: ReplyExtra): Promise<string> {
  const msg = await ctx.reply(text, {
    format: extra?.format ?? 'html',
    ...extra,
  });
  return msg.body.mid;
}

/** Новое сообщение с кнопками после ввода пользователя (кнопки прошлого шага убираются в ctx.reply()) */
export async function replyButtons(
  ctx: AppContext,
  text: string,
  attachments: AttachmentRequest[],
  extra?: Omit<ReplyExtra, 'attachments'>,
): Promise<string> {
  return askButtons(ctx, text, attachments, extra);
}

/** Callback — редактировать; текстовый ввод — новое сообщение */
export async function promptText(ctx: AppContext, text: string, extra?: ReplyExtra): Promise<string> {
  if (ctx.callback) {
    return editText(ctx, text, extra);
  }
  return replyText(ctx, text, extra);
}

/** Callback — редактировать; текстовый ввод — новое сообщение */
export async function promptButtons(
  ctx: AppContext,
  text: string,
  attachments: AttachmentRequest[],
  extra?: Omit<ReplyExtra, 'attachments'>,
): Promise<string> {
  if (ctx.callback) {
    return editButtons(ctx, text, attachments, extra);
  }
  return replyButtons(ctx, text, attachments, extra);
}

/** Новое сообщение — шаг с inline-кнопками (после текстового ввода; кнопки прошлого шага убираются в ctx.reply()) */
export async function askButtons(
  ctx: AppContext,
  text: string,
  attachments: AttachmentRequest[],
  extra?: Omit<ReplyExtra, 'attachments'>,
): Promise<string> {
  const msg = await ctx.reply(text, {
    format: extra?.format ?? 'html',
    attachments,
  });
  return msg.body.mid;
}

function resolveEditMessageId(ctx: AppContext): string | undefined {
  if (ctx.callback && ctx.messageId) {
    return ctx.messageId;
  }
  return getPrevMessageId(ctx);
}

async function editPrompt(
  ctx: AppContext,
  text: string,
  attachments: AttachmentRequest[],
  extra?: Omit<ReplyExtra, 'attachments'>,
): Promise<string> {
  const body = { text, format: extra?.format ?? ('html' as const), attachments };
  const targetId = resolveEditMessageId(ctx);

  if (targetId) {
    try {
      await ctx.api.editMessage(targetId, body);
      await setPrevMessageId(ctx, targetId);
      return targetId;
    } catch {
      /* fall through to new message */
    }
  }

  return askButtons(ctx, text, attachments, extra);
}

/** Редактировать текущее сообщение — запрос текстового ввода */
export async function editText(
  ctx: AppContext,
  text: string,
  extra?: ReplyExtra,
): Promise<string> {
  return editPrompt(ctx, text, extra?.attachments ?? [], extra);
}

/** Редактировать сообщение с кнопками (выбор callback — то же сообщение) */
export async function editButtons(
  ctx: AppContext,
  text: string,
  attachments: AttachmentRequest[],
  extra?: Omit<ReplyExtra, 'attachments'>,
): Promise<string> {
  return editPrompt(ctx, text, attachments, extra);
}

export async function showCurrentMessage(
  ctx: AppContext,
  text: string,
  extra?: ReplyExtra,
  mode: 'new' | 'edit' = 'edit',
): Promise<string> {
  const attachments = extra?.attachments ?? [];
  if (mode === 'new') {
    return askButtons(ctx, text, attachments, extra);
  }
  return editButtons(ctx, text, attachments, extra);
}

export function formatAgeYears(age: number): string {
  const n = Math.abs(age) % 100;
  const n1 = n % 10;
  if (n > 10 && n < 20) return `${age} лет`;
  if (n1 === 1) return `${age} год`;
  if (n1 >= 2 && n1 <= 4) return `${age} года`;
  return `${age} лет`;
}

function stripLeadingEmoji(value: string): string {
  return value.replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F\u200D\s]+/u, '').trim() || value;
}

function formatPaymentLabel(payment: string): string {
  return stripLeadingEmoji(payment);
}

export function formatProfileText(
  profile: UserProfile,
  options: { includeStats?: boolean; includeSubscription?: boolean; includeIdentity?: boolean } = {},
): string {
  const { includeStats = true, includeSubscription = true, includeIdentity = true } = options;
  const lines: string[] = [];
  if (includeIdentity) {
    lines.push(`👤 ${fullName(profile)}`);
    if (profile.birth_date) {
      lines.push(`🎂 Возраст: ${formatAgeYears(calculateAge(profile.birth_date))}`);
    }
    lines.push('');
  }

  if (getSportCategory(profile.sport) === 'court_sport') {
    lines.push(`🔎 Роль: ${stripLeadingEmoji(profile.role)}`);
    if (profile.player_level) {
      lines.push(`🏆 Уровень: ${profile.player_level} (${profile.rating_points} очков)`);
    }
    if (profile.role === '👨‍🏫 Тренер' && profile.price) {
      lines.push(`💵 Стоимость тренировки: ${profile.price} руб`);
    }
    lines.push('');
  }

  lines.push(
    `🌍 Страна: ${stripLeadingEmoji(profile.country)}`,
    `🏙 Город: ${profile.city}${profile.district ? `, ${profile.district}` : ''}`,
    `🗂 Вид спорта: ${stripLeadingEmoji(profile.sport)}`,
    `👫 Пол: ${profile.gender}`,
  );

  if (includeStats && getSportCategory(profile.sport) === 'court_sport') {
    lines.push(
      '',
      '📊 Статистика игр:',
      `• Сыграно: ${profile.games_played}`,
      `• Побед: ${profile.games_wins}`,
    );
  } else {
    lines.push('');
  }

  if (profile.default_payment && hasCourtPayment(profile.sport)) {
    lines.push('', `💳 Оплата корта: ${formatPaymentLabel(profile.default_payment)}`);
  }

  if (profile.profile_comment) lines.push('', TXT.profile.about_label, profile.profile_comment);
  if (profile.vacation_tennis && profile.vacation_city) {
    lines.push(`✈️ ${stripLeadingEmoji(profile.vacation_country ?? '')} ${profile.vacation_city} ${profile.vacation_start}-${profile.vacation_end}`);
  }
  if (profile.dating_goal) lines.push(profile.dating_goal);
  if (profile.meeting_time) lines.push(`🕐 Время: ${profile.meeting_time}`);
  if (includeSubscription && profile.subscription?.active) {
    lines.push(TXT.profile.subscription_active);
  }
  return lines.join('\n');
}

export function profileKeyboard(
  profile: UserProfile,
  options: { isOwn?: boolean; listBackPayload?: string; reopenPayload?: string } = {},
): AttachmentRequest[] {
  const { isOwn = false, listBackPayload } = options;
  const buttons: ReturnType<typeof Keyboard.button.callback>[][] = [];

  if (isOwn) {
    buttons.push([Keyboard.button.callback(TXT.profile.edit, 'edit_profile')]);
    if (hasVacation(profile.sport)) {
      buttons.push([Keyboard.button.callback(TXT.profile.vacation_partner, 'create_tour')]);
    }
    buttons.push([
      Keyboard.button.callback(TXT.profile.my_offers, 'my_offers'),
      Keyboard.button.callback(TXT.profile.new_offer, 'new_offer'),
    ]);
    if (getSportCategory(profile.sport) === 'court_sport') {
      buttons.push([Keyboard.button.callback(TXT.profile.game_history, `game_history:${profile.max_user_id}`)]);
    }
    buttons.push([Keyboard.button.callback(TXT.profile.delete, '1delete_profile')]);
  } else {
    buttons.push([
      Keyboard.button.callback(TXT.profile.contact, `profile_contact:${profile.max_user_id}`),
    ]);
    if (getSportCategory(profile.sport) === 'court_sport') {
      buttons.push([
        Keyboard.button.callback(TXT.profile.game_history, `game_history:${profile.max_user_id}`),
      ]);
    }
  }

  if (listBackPayload) {
    buttons.push([Keyboard.button.callback(TXT.common.back, listBackPayload)]);
  }
  buttons.push([Keyboard.button.callback(TXT.common.main_menu, 'main_menu')]);
  return [Keyboard.inlineKeyboard(buttons)];
}

export async function showProfile(
  ctx: AppContext,
  profile: UserProfile,
  options: {
    isOwn?: boolean;
    listBackPayload?: string;
    reopenPayload?: string;
    mode?: 'new' | 'edit';
  } = {},
): Promise<void> {
  const { mode = 'edit', ...keyboardOptions } = options;
  saveProfileViewContext(ctx, profile, keyboardOptions);
  const text = formatProfileText(profile);
  const attachments = profileKeyboard(profile, keyboardOptions);

  if (profile.photo_path) {
    attachments.unshift({
      type: 'image',
      payload: { url: profile.photo_path },
    });
  }

  await showCurrentMessage(ctx, text, { attachments }, mode);
}

export async function showMainMenu(ctx: AppContext): Promise<void> {
  await showCurrentMessage(ctx, TXT.main_menu_title, { attachments: [mainMenuKeyboard()] });
}

export function formatStartWelcome(profile: UserProfile): string {
  return fmt(TXT.start.registered_welcome, {
    name: fullName(profile),
    rating: profile.rating_points,
    games: profile.games_played,
    wins: profile.games_wins,
  });
}

/** Приветствие зарегистрированного пользователя при /start */
export async function showStartWelcome(ctx: AppContext, profile: UserProfile): Promise<void> {
  await askButtons(ctx, formatStartWelcome(profile), [mainMenuKeyboard()]);
}

const AVATAR_FETCH_TIMEOUT_MS = 5000;

/**
 * Аватар пользователя из профиля MAX.
 * В личном диалоге бот+пользователь нужен GET /chats/{chatId} (ctx.getChat()) — поле chat.dialog_with_user
 * содержит UserWithPhoto собеседника. getChatMembership() (GET /chats/{chatId}/members/me) по документации MAX
 * отдаёт членство САМОГО БОТА в групповом чате/канале и для диалогов не предназначен — этим объясняется,
 * что он не возвращал фото пользователя. Таймаут оставлен на случай, если API не ответит вовсе.
 */
export async function getMaxProfileAvatarUrl(ctx: AppContext): Promise<string | undefined> {
  if (!ctx.chatId) return undefined;
  try {
    const chat = await Promise.race([
      ctx.getChat(),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('getChat timeout')), AVATAR_FETCH_TIMEOUT_MS);
      }),
    ]);
    const dialogUser = chat.dialog_with_user as { avatar_url?: string; full_avatar_url?: string } | null | undefined;
    return dialogUser?.full_avatar_url ?? dialogUser?.avatar_url;
  } catch {
    return undefined;
  }
}

export function paginate<T>(items: T[], page: number, pageSize: number): {
  items: T[];
  page: number;
  totalPages: number;
} {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const p = Math.min(Math.max(1, page), totalPages);
  const start = (p - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), page: p, totalPages };
}
