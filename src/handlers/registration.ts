import { TXT, fmt } from '../texts.js';
import { Keyboard } from '@maxhub/max-bot-api';
import type { AppContext } from '../context.js';
import { getCtxUserId, getMessageText } from '../context.js';
import {
  COUNTRIES,
  DATING_ADDITIONAL_FIELDS,
  DATING_GOALS,
  DATING_INTERESTS,
  GENDERS,
  MOSCOW_DISTRICTS,
  PAYMENT_TYPES,
  ROLES,
  SPORTS,
  getLevelsForSport,
  getSportFieldConfig,
  hasVacation,
} from '../config/profile.js';
import { storage } from '../storage/jsonStorage.js';
import {
  clearState,
  getState,
  getStateData,
  setState,
} from '../middleware/session.js';
import { RegistrationStates } from '../types/states.js';
import type { Gender, SportType, UserProfile, UserRole } from '../types/models.js';
import {
  chunkButtons,
  editButtons,
  editText,
  formatProfileText,
  profileKeyboard,
} from '../utils/bot.js';
import {
  isValidDate,
  isValidPhone,
  normalizePhone,
} from '../utils/validation.js';
import { sendRegistrationNotification } from '../services/channels.js';
import { getCallbackPayload } from '../utils/callback.js';
import { processReferralOnRegistration } from '../utils/referral.js';
import { tryLinkByPhone, findUserByPlatformId, linkAccounts } from '../utils/platformLink.js';

type RegData = Partial<UserProfile> & { dating_interests_keys?: string[]; level_page?: number };

const REG_COUNTRY_BUTTONS = [...Object.keys(COUNTRIES).slice(0, 5), TXT.registration.other_country];

function sportKeyboard() {
  return Keyboard.inlineKeyboard(
    chunkButtons(SPORTS, (s) => Keyboard.button.callback(s, `regsport_${encodeURIComponent(s)}`), 2),
  );
}

function sportNameForLevel(sport: SportType): string {
  return sport.replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F\u200D\s]+/u, '').toLowerCase();
}

export async function startRegistration(ctx: AppContext): Promise<void> {
  await setState(ctx, RegistrationStates.PHONE, {});
  await editText(ctx, TXT.registration.welcome);
  await editText(ctx, TXT.registration.phone, {
    attachments: [Keyboard.inlineKeyboard([[Keyboard.button.requestContact(TXT.registration.send_phone)]])],
  });
}

async function showLevelsPage(ctx: AppContext, data: RegData, page: number): Promise<void> {
  const sport = data.sport!;
  const config = getSportFieldConfig(sport);

  if (config.levelType === 'table_tennis_rating') {
    await setState(ctx, RegistrationStates.TABLE_TENNIS_RATING, data);
    await editText(ctx, TXT.registration.table_tennis_rating);
    return;
  }

  const levelsDict = getLevelsForSport(sport);
  const levelsList = Object.keys(levelsDict);
  const itemsPerPage = 3;
  const totalPages = Math.max(1, Math.ceil(levelsList.length / itemsPerPage));
  const safePage = Math.min(Math.max(page, 0), totalPages - 1);
  const currentLevels = levelsList.slice(safePage * itemsPerPage, safePage * itemsPerPage + itemsPerPage);

  let text = `🏆 ${fmt(TXT.registration.level_system, { sport: sportNameForLevel(sport) })}:\n\n`;
  for (const level of currentLevels) {
    text += `${level} — ${levelsDict[level].desc}\n\n`;
  }
  text += fmt(TXT.registration.page, { page: safePage + 1, total: totalPages });
  text += `\n\n👇 ${TXT.registration.select_level}`;

  const buttons: ReturnType<typeof Keyboard.button.callback>[][] = currentLevels.map((level) => [
    Keyboard.button.callback(`🎾 ${level}`, `reglevel_${level}`),
  ]);

  const nav: ReturnType<typeof Keyboard.button.callback>[] = [];
  if (safePage > 0) {
    nav.push(Keyboard.button.callback(TXT.common.prev, `reglevelpage_${safePage - 1}`));
  }
  if (safePage < totalPages - 1) {
    nav.push(Keyboard.button.callback(TXT.common.next, `reglevelpage_${safePage + 1}`));
  }
  if (nav.length) buttons.push(nav);

  data.level_page = safePage;
  await setState(ctx, RegistrationStates.PLAYER_LEVEL, data);
  await editButtons(ctx, text, [Keyboard.inlineKeyboard(buttons)]);
}

async function showPaymentTypes(ctx: AppContext): Promise<void> {
  await editButtons(ctx, TXT.registration.default_payment, [
    Keyboard.inlineKeyboard(
      chunkButtons(PAYMENT_TYPES, (p) => Keyboard.button.callback(p, `regpay_${encodeURIComponent(p)}`), 1),
    ),
  ]);
}

async function showGender(ctx: AppContext, data: RegData): Promise<void> {
  await setState(ctx, RegistrationStates.GENDER, data);
  await editButtons(ctx, TXT.registration.gender, [
    Keyboard.inlineKeyboard(
      GENDERS.map((g) => [Keyboard.button.callback(g, `reggender_${encodeURIComponent(g)}`)]),
    ),
  ]);
}

async function showDatingGoals(ctx: AppContext, data: RegData): Promise<void> {
  await setState(ctx, RegistrationStates.DATING_GOAL, data);
  await editButtons(ctx, TXT.registration.dating_goal, [
    Keyboard.inlineKeyboard(
      chunkButtons(DATING_GOALS, (g) => Keyboard.button.callback(g.ru, `regdatinggoal_${g.key}`), 1),
    ),
  ]);
}

async function showDatingInterests(ctx: AppContext, data: RegData): Promise<void> {
  const selectedKeys = data.dating_interests_keys ?? [];
  const selectedLines = selectedKeys
    .map((k) => {
      const item = DATING_INTERESTS.find((i) => i.key === k);
      return item ? `• ${item.ru}` : '';
    })
    .filter(Boolean);

  let text: string = TXT.registration.dating_interests;
  if (selectedLines.length) {
    text = `${TXT.registration.dating_interests_selected}\n${selectedLines.join('\n')}\n\n${TXT.registration.dating_interests_hint}`;
  }

  await editButtons(ctx, text, [
    Keyboard.inlineKeyboard([
      ...DATING_INTERESTS.map((i) => {
        const mark = selectedKeys.includes(i.key) ? '✅' : '⬜';
        return [Keyboard.button.callback(`${mark} ${i.ru}`, `reginterest_${i.key}`)];
      }),
      [Keyboard.button.callback(TXT.registration.dating_interests_done, 'reginterests_done')],
    ]),
  ]);
}

async function askProfileComment(ctx: AppContext, data: RegData): Promise<void> {
  const config = getSportFieldConfig(data.sport!);
  await setState(ctx, RegistrationStates.PROFILE_COMMENT, data);
  await editText(ctx, config.aboutMeText ?? TXT.registration.profile_comment);
}

async function askMeetingTime(ctx: AppContext, data: RegData): Promise<void> {
  const config = getSportFieldConfig(data.sport!);
  await setState(ctx, RegistrationStates.MEETING_TIME, data);
  await editText(ctx, config.meetingTimeText ?? TXT.registration.meeting_time);
}

async function askPhoto(ctx: AppContext, data: RegData): Promise<void> {
  await setState(ctx, RegistrationStates.PHOTO, data);
  await editButtons(ctx, TXT.registration.photo, [
    Keyboard.inlineKeyboard([
      [Keyboard.button.callback(TXT.registration.photo_upload, 'reg_photo_upload')],
      [Keyboard.button.callback(TXT.registration.no_photo, 'reg_no_photo')],
      [Keyboard.button.callback(TXT.registration.photo_from_profile, 'reg_photo_profile')],
    ]),
  ]);
}

async function askDatingAdditional(ctx: AppContext, data: RegData): Promise<void> {
  const fields = DATING_ADDITIONAL_FIELDS.map((f) => `• ${f}`).join('\n');
  await setState(ctx, RegistrationStates.DATING_ADDITIONAL, data);
  await editText(ctx, fmt(TXT.registration.dating_additional, { fields }));
}

async function askLevelOrGender(ctx: AppContext, data: RegData): Promise<void> {
  const config = getSportFieldConfig(data.sport!);
  if (config.hasLevel) {
    await showLevelsPage(ctx, data, data.level_page ?? 0);
    return;
  }
  await showGender(ctx, data);
}

async function askAfterGender(ctx: AppContext, data: RegData): Promise<void> {
  const config = getSportFieldConfig(data.sport!);
  if (config.hasDatingGoals) {
    await showDatingGoals(ctx, data);
    return;
  }
  if (config.hasAboutMe) {
    await askProfileComment(ctx, data);
    return;
  }
  if (config.hasMeetingTime) {
    await askMeetingTime(ctx, data);
    return;
  }
  await askPhoto(ctx, data);
}

async function askAfterProfileComment(ctx: AppContext, data: RegData): Promise<void> {
  const config = getSportFieldConfig(data.sport!);
  if (config.hasMeetingTime) {
    await askMeetingTime(ctx, data);
    return;
  }
  await askPhoto(ctx, data);
}

async function askVacationOrFinish(ctx: AppContext, data: RegData, userId: number): Promise<void> {
  if (data.sport && hasVacation(data.sport)) {
    await setState(ctx, RegistrationStates.VACATION_TENNIS, data);
    await editButtons(ctx, TXT.registration.vacation_tennis, [
      Keyboard.inlineKeyboard([
        [Keyboard.button.callback(TXT.common.yes, 'regvac_yes'), Keyboard.button.callback(TXT.common.no, 'regvac_no')],
      ]),
    ]);
    return;
  }
  await finishRegistration(ctx, data, userId);
}

async function askAfterPhoto(ctx: AppContext, data: RegData, userId: number): Promise<void> {
  const config = getSportFieldConfig(data.sport!);
  if (config.hasPayment) {
    await setState(ctx, RegistrationStates.DEFAULT_PAYMENT, data);
    await showPaymentTypes(ctx);
    return;
  }
  await askVacationOrFinish(ctx, data, userId);
}

async function showRole(ctx: AppContext, data: RegData): Promise<void> {
  await setState(ctx, RegistrationStates.ROLE, data);
  await editButtons(ctx, TXT.registration.role, [
    Keyboard.inlineKeyboard(
      ROLES.map((r) => [Keyboard.button.callback(r, `regrole_${encodeURIComponent(r)}`)]),
    ),
  ]);
}

async function showMoscowDistricts(ctx: AppContext, data: RegData): Promise<void> {
  await setState(ctx, RegistrationStates.CITY, data);
  await editButtons(ctx, TXT.registration.district, [
    Keyboard.inlineKeyboard(
      chunkButtons(MOSCOW_DISTRICTS, (d) => Keyboard.button.callback(d, `regdistrict_${d}`), 2),
    ),
  ]);
}

async function afterCity(ctx: AppContext, data: RegData): Promise<void> {
  if (data.city === 'Москва' && !data.district) {
    await showMoscowDistricts(ctx, data);
    return;
  }

  const config = getSportFieldConfig(data.sport!);
  if (config.hasRole) {
    await showRole(ctx, data);
    return;
  }

  await askLevelOrGender(ctx, data);
}

async function afterRole(ctx: AppContext, data: RegData, role: UserRole): Promise<void> {
  data.role = role;
  if (role === '👨‍🏫 Тренер') {
    await setState(ctx, RegistrationStates.TRAINER_PRICE, data);
    await editText(ctx, TXT.registration.trainer_price);
    return;
  }
  await askLevelOrGender(ctx, data);
}

async function finishRegistration(ctx: AppContext, data: RegData, userId: number): Promise<void> {
  const profile: UserProfile = {
    max_user_id: userId,
    platform: 'max',
    username: ctx.user?.username ?? ctx.profile?.username ?? undefined,
    first_name: data.first_name!,
    last_name: data.last_name!,
    phone: data.phone!,
    birth_date: data.birth_date!,
    country: data.country!,
    city: data.city!,
    district: data.district,
    role: (data.role ?? '🎯 Игрок') as UserRole,
    sport: data.sport!,
    gender: (data.gender ?? 'Мужской') as Gender,
    player_level: data.player_level ?? '3.0',
    rating_points: data.rating_points ?? 1200,
    price: data.price,
    photo_path: data.photo_path,
    games_played: 0,
    games_wins: 0,
    default_payment: data.default_payment,
    show_in_search: true,
    profile_comment: data.profile_comment,
    referrals_invited: 0,
    free_offers_used: 0,
    games: [],
    created_at: new Date().toISOString(),
    vacation_tennis: data.vacation_tennis,
    vacation_start: data.vacation_start,
    vacation_end: data.vacation_end,
    vacation_country: data.vacation_country,
    vacation_city: data.vacation_city,
    vacation_comment: data.vacation_comment,
    dating_goal: data.dating_goal,
    dating_goal_key: data.dating_goal_key,
    dating_interests: data.dating_interests,
    dating_interests_keys: data.dating_interests_keys,
    dating_additional: data.dating_additional,
    meeting_time: data.meeting_time,
  };

  await storage.saveUser(profile);
  let linkedProfile = await tryLinkByPhone(profile);

  const linkTelegramId = getStateData<{ link_telegram_id?: number }>(ctx).link_telegram_id;
  if (linkTelegramId) {
    const tgUser = await findUserByPlatformId({ telegramId: linkTelegramId });
    if (tgUser) {
      linkedProfile = await linkAccounts(linkedProfile, tgUser.userId, tgUser.profile);
    }
  }

  await processReferralOnRegistration(ctx);
  await sendRegistrationNotification(ctx.api, linkedProfile);
  await clearState(ctx);
  ctx.profile = linkedProfile;

  const profileText = formatProfileText(linkedProfile);
  const text = `${TXT.registration.complete}\n\n${profileText}`;
  const attachments = profileKeyboard(linkedProfile, { isOwn: true, viewerId: userId });
  if (linkedProfile.photo_path) {
    attachments.unshift({
      type: 'image',
      payload: { url: linkedProfile.photo_path },
    });
  }
  await editButtons(ctx, text, attachments);
}

export async function handleRegistrationMessage(ctx: AppContext): Promise<boolean> {
  const state = getState(ctx);
  if (!state || !Object.values(RegistrationStates).includes(state as RegistrationStates)) {
    return false;
  }

  const text = getMessageText(ctx);
  const data = getStateData<RegData>(ctx);
  const userId = getCtxUserId(ctx);

  if (state === RegistrationStates.PHONE) {
    const phone = ctx.contactInfo?.tel ?? text;
    if (!phone || !isValidPhone(phone)) {
      await editText(ctx, TXT.registration.phone, {
        attachments: [Keyboard.inlineKeyboard([[Keyboard.button.requestContact(TXT.registration.send_phone)]])],
      });
      return true;
    }
    data.phone = normalizePhone(phone);
    await setState(ctx, RegistrationStates.SPORT, data);
    await editButtons(ctx, TXT.registration.sport, [sportKeyboard()]);
    return true;
  }

  if (state === RegistrationStates.FIRST_NAME && text) {
    data.first_name = text;
    await setState(ctx, RegistrationStates.LAST_NAME, data);
    await editText(ctx, TXT.registration.last_name);
    return true;
  }

  if (state === RegistrationStates.LAST_NAME && text) {
    data.last_name = text;
    await setState(ctx, RegistrationStates.BIRTH_DATE, data);
    await editText(ctx, TXT.registration.birth_date);
    return true;
  }

  if (state === RegistrationStates.BIRTH_DATE && text) {
    if (!isValidDate(text)) {
      await editText(ctx, TXT.registration.birth_date_invalid);
      return true;
    }
    data.birth_date = text;
    await setState(ctx, RegistrationStates.COUNTRY, data);
    await editButtons(ctx, TXT.registration.country, [
      Keyboard.inlineKeyboard(
        chunkButtons(REG_COUNTRY_BUTTONS, (c) => Keyboard.button.callback(c, `regcountry_${encodeURIComponent(c)}`), 2),
      ),
    ]);
    return true;
  }

  if (state === RegistrationStates.COUNTRY_INPUT && text) {
    data.country = text;
    await setState(ctx, RegistrationStates.CITY_INPUT, data);
    await editText(ctx, TXT.registration.enter_city);
    return true;
  }

  if (state === RegistrationStates.CITY_INPUT && text) {
    data.city = text;
    await afterCity(ctx, data);
    return true;
  }

  if (state === RegistrationStates.TRAINER_PRICE && text) {
    data.price = Number(text);
    await askLevelOrGender(ctx, data);
    return true;
  }

  if (state === RegistrationStates.TABLE_TENNIS_RATING && text) {
    data.player_level = text;
    const numeric = Number(text);
    data.rating_points = Number.isFinite(numeric) ? numeric : 1000;
    await showGender(ctx, data);
    return true;
  }

  if (state === RegistrationStates.PROFILE_COMMENT) {
    if (text !== '/skip') data.profile_comment = text;
    await askAfterProfileComment(ctx, data);
    return true;
  }

  if (state === RegistrationStates.MEETING_TIME && text) {
    data.meeting_time = text;
    await askPhoto(ctx, data);
    return true;
  }

  if (state === RegistrationStates.PHOTO && ctx.message?.body.attachments?.some((a) => a.type === 'image')) {
    const image = ctx.message.body.attachments.find((a) => a.type === 'image');
    const url = image && 'payload' in image ? (image.payload as { url?: string }).url : undefined;
    if (url) {
      data.photo_path = url;
      await askAfterPhoto(ctx, data, userId);
    }
    return true;
  }

  if (state === RegistrationStates.VACATION_START && text) {
    if (!isValidDate(text)) {
      await editText(ctx, TXT.registration.birth_date_invalid);
      return true;
    }
    data.vacation_start = text;
    await setState(ctx, RegistrationStates.VACATION_END, data);
    await editText(ctx, TXT.registration.vacation_end);
    return true;
  }

  if (state === RegistrationStates.VACATION_END && text) {
    if (!isValidDate(text)) {
      await editText(ctx, TXT.registration.birth_date_invalid);
      return true;
    }
    data.vacation_end = text;
    await setState(ctx, RegistrationStates.VACATION_COMMENT, data);
    await editText(ctx, TXT.registration.vacation_comment);
    return true;
  }

  if (state === RegistrationStates.VACATION_COMMENT) {
    data.vacation_comment = text ?? '';
    await finishRegistration(ctx, data, userId);
    return true;
  }

  if (state === RegistrationStates.DATING_ADDITIONAL) {
    if (text !== '/skip') data.dating_additional = text;
    await askPhoto(ctx, data);
    return true;
  }

  if (state === RegistrationStates.VACATION_COUNTRY_INPUT && text) {
    data.vacation_country = text;
    await setState(ctx, RegistrationStates.VACATION_CITY, data);
    await editText(ctx, TXT.registration.vacation_city);
    return true;
  }

  if (state === RegistrationStates.VACATION_CITY_INPUT && text) {
    data.vacation_city = text;
    await setState(ctx, RegistrationStates.VACATION_START, data);
    await editText(ctx, TXT.registration.vacation_start);
    return true;
  }

  return false;
}

export function registerRegistrationHandlers(bot: import('@maxhub/max-bot-api').Bot<AppContext>): void {
  bot.action(/^regsport_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const sport = decodeURIComponent(getCallbackPayload(ctx).replace('regsport_', '')) as SportType;
    const data = getStateData<RegData>(ctx);
    data.sport = sport;
    await setState(ctx, RegistrationStates.FIRST_NAME, data);
    await editText(ctx, TXT.registration.first_name);
  });

  bot.action(/^regcountry_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const country = decodeURIComponent(getCallbackPayload(ctx).replace('regcountry_', ''));
    const data = getStateData<RegData>(ctx);
    if (country === TXT.registration.other_country) {
      await setState(ctx, RegistrationStates.COUNTRY_INPUT, data);
      await editText(ctx, TXT.registration.enter_country);
      return;
    }
    data.country = country;
    await setState(ctx, RegistrationStates.CITY, data);
    const cities = [...(COUNTRIES[country] ?? []), TXT.registration.other_city];
    await editButtons(ctx, TXT.registration.city, [
      Keyboard.inlineKeyboard(
        chunkButtons(cities, (c) => Keyboard.button.callback(c, `regcity_${encodeURIComponent(c)}`), 2),
      ),
    ]);
  });

  bot.action(/^regcity_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const city = decodeURIComponent(getCallbackPayload(ctx).replace('regcity_', ''));
    const data = getStateData<RegData>(ctx);
    if (city === TXT.registration.other_city) {
      await setState(ctx, RegistrationStates.CITY_INPUT, data);
      await editText(ctx, TXT.registration.enter_city);
      return;
    }
    data.city = city;
    await afterCity(ctx, data);
  });

  bot.action(/^regdistrict_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<RegData>(ctx);
    data.district = getCallbackPayload(ctx).replace('regdistrict_', '');
    data.city = 'Москва';
    await afterCity(ctx, data);
  });

  bot.action(/^regrole_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<RegData>(ctx);
    const role = decodeURIComponent(getCallbackPayload(ctx).replace('regrole_', '')) as UserRole;
    await afterRole(ctx, data, role);
  });

  bot.action(/^reglevelpage_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const page = Number(getCallbackPayload(ctx).replace('reglevelpage_', ''));
    const data = getStateData<RegData>(ctx);
    await showLevelsPage(ctx, data, page);
  });

  bot.action(/^reglevel_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<RegData>(ctx);
    const level = getCallbackPayload(ctx).replace('reglevel_', '');
    const levelsDict = getLevelsForSport(data.sport!);
    data.player_level = level;
    data.rating_points = levelsDict[level]?.points ?? 1200;
    await showGender(ctx, data);
  });

  bot.action(/^regpay_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<RegData>(ctx);
    data.default_payment = decodeURIComponent(getCallbackPayload(ctx).replace('regpay_', ''));
    await askVacationOrFinish(ctx, data, getCtxUserId(ctx));
  });

  bot.action(/^reggender_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<RegData>(ctx);
    data.gender = decodeURIComponent(getCallbackPayload(ctx).replace('reggender_', '')) as Gender;
    await askAfterGender(ctx, data);
  });

  bot.action('reg_photo_upload', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<RegData>(ctx);
    await setState(ctx, RegistrationStates.PHOTO, data);
    await editText(ctx, TXT.registration.photo_send);
  });

  bot.action('reg_photo_profile', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<RegData>(ctx);

    let avatarUrl: string | undefined;
    try {
      if (ctx.chatId) {
        const membership = await ctx.getChatMembership();
        avatarUrl = membership.full_avatar_url ?? membership.avatar_url;
      }
    } catch {
      /* ignore */
    }

    if (!avatarUrl) {
      await editText(ctx, TXT.profile.photo_no_profile);
      await askPhoto(ctx, data);
      return;
    }
    data.photo_path = avatarUrl;
    await askAfterPhoto(ctx, data, getCtxUserId(ctx));
  });

  bot.action('reg_no_photo', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<RegData>(ctx);
    await askAfterPhoto(ctx, data, getCtxUserId(ctx));
  });

  bot.action('regvac_yes', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<RegData>(ctx);
    data.vacation_tennis = true;
    await setState(ctx, RegistrationStates.VACATION_COUNTRY_INPUT, data);
    await editText(ctx, TXT.registration.vacation_country);
  });

  bot.action('regvac_no', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<RegData>(ctx);
    data.vacation_tennis = false;
    await finishRegistration(ctx, data, getCtxUserId(ctx));
  });

  bot.action(/^regdatinggoal_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const key = getCallbackPayload(ctx).replace('regdatinggoal_', '');
    const goal = DATING_GOALS.find((g) => g.key === key);
    const data = getStateData<RegData>(ctx);
    data.dating_goal_key = key;
    data.dating_goal = goal?.ru;
    data.dating_interests_keys = [];
    await setState(ctx, RegistrationStates.DATING_INTERESTS, data);
    await showDatingInterests(ctx, data);
  });

  bot.action(/^reginterest_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const key = getCallbackPayload(ctx).replace('reginterest_', '');
    const data = getStateData<RegData>(ctx);
    data.dating_interests_keys = data.dating_interests_keys ?? [];
    const idx = data.dating_interests_keys.indexOf(key);
    if (idx >= 0) {
      data.dating_interests_keys.splice(idx, 1);
    } else {
      data.dating_interests_keys.push(key);
    }
    data.dating_interests = data.dating_interests_keys.map((k) => {
      const item = DATING_INTERESTS.find((i) => i.key === k);
      return item?.ru ?? k;
    });
    await setState(ctx, RegistrationStates.DATING_INTERESTS, data);
    await showDatingInterests(ctx, data);
  });

  bot.action('reginterests_done', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<RegData>(ctx);
    await askDatingAdditional(ctx, data);
  });
}

export async function requireRegistered(ctx: AppContext): Promise<import('../types/models.js').UserProfile | null> {
  const userId = getCtxUserId(ctx);
  const user = await storage.getUser(userId);
  if (!user) {
    await ctx.reply(TXT.common.not_registered);
    return null;
  }
  ctx.profile = user;
  return user;
}
