import { Keyboard } from '@maxhub/max-bot-api';
import { TXT, fmt } from '../texts.js';
import type { AppContext } from '../context.js';
import { getCtxUserId, getMessageText } from '../context.js';
import { isAdmin } from '../config/env.js';
import {
  COUNTRIES,
  DATING_GOALS,
  DATING_INTERESTS,
  MOSCOW_DISTRICTS,
  PAYMENT_TYPES,
  ROLES,
  SPORTS,
  calculateLevelFromPoints,
  getSportFieldConfig,
  migrateProfileData,
} from '../config/profile.js';
import { storage } from '../storage/jsonStorage.js';
import {
  clearState,
  getState,
  getStateData,
  setState,
} from '../middleware/session.js';
import { EditProfileStates } from '../types/states.js';
import type { SportType, UserProfile, UserRole } from '../types/models.js';
import {
  askText,
  chunkButtons,
  editButtons,
  editText,
  formatProfileText,
  showProfile,
} from '../utils/bot.js';
import { getCallbackPayload } from '../utils/callback.js';
import { requireRegistered } from './registration.js';

type EditData = Record<string, unknown> & {
  dating_interests_keys?: string[];
  admin_edit_user_id?: number;
  country?: string;
  city?: string;
};

function getAdminEditTargetId(ctx: AppContext): number | undefined {
  const id = getStateData<EditData>(ctx).admin_edit_user_id;
  return typeof id === 'number' ? id : undefined;
}

async function resolveEditUser(ctx: AppContext): Promise<UserProfile | undefined> {
  const adminTarget = getAdminEditTargetId(ctx);
  if (adminTarget !== undefined) {
    if (!isAdmin(getCtxUserId(ctx))) return undefined;
    return storage.getUser(adminTarget);
  }
  return (await requireRegistered(ctx)) ?? undefined;
}

async function saveProfile(ctx: AppContext, profile: UserProfile): Promise<void> {
  await storage.saveUser(profile);
  if (profile.max_user_id === getCtxUserId(ctx)) {
    ctx.profile = profile;
  }
}

async function showAfterEdit(
  ctx: AppContext,
  profile: UserProfile,
  mode: 'edit' | 'new' = 'edit',
): Promise<void> {
  const adminTarget = getAdminEditTargetId(ctx);
  if (adminTarget !== undefined) {
    await clearState(ctx);
    await showProfile(ctx, profile, { isOwn: false, mode });
    return;
  }
  await showOwnProfile(ctx, profile, mode);
}

function preserveAdminEditData(ctx: AppContext): number | undefined {
  return getAdminEditTargetId(ctx);
}

function withAdminEditData(data: EditData, adminId?: number): EditData {
  if (adminId !== undefined) return { ...data, admin_edit_user_id: adminId };
  return data;
}

function getMessageImageUrl(ctx: AppContext): string | undefined {
  const attachments = ctx.message?.body.attachments;
  if (!attachments) return undefined;
  const image = attachments.find((a) => a.type === 'image');
  if (!image || image.type !== 'image') return undefined;
  return image.payload.url;
}

function editBackButton(): ReturnType<typeof Keyboard.button.callback> {
  return Keyboard.button.callback(TXT.common.back, 'edit_profile');
}

function profileBackButton(): ReturnType<typeof Keyboard.button.callback> {
  return Keyboard.button.callback(TXT.common.back, 'back_to_profile');
}

export function buildEditProfileKeyboard(profile: UserProfile): ReturnType<typeof Keyboard.inlineKeyboard> {
  const config = getSportFieldConfig(profile.sport);
  const buttons: ReturnType<typeof Keyboard.button.callback>[][] = [];

  buttons.push([
    Keyboard.button.callback(TXT.profile.edit_photo, '1edit_photo'),
    Keyboard.button.callback(TXT.profile.edit_location, '1edit_location'),
  ]);

  if (config.hasAboutMe) {
    buttons.push([Keyboard.button.callback(TXT.profile.edit_about, '1edit_comment')]);
  }

  if (config.hasPayment) {
    buttons.push([Keyboard.button.callback(TXT.profile.edit_payment, '1edit_payment')]);
  }

  if (config.hasRole) {
    buttons.push([Keyboard.button.callback(TXT.profile.edit_role, '1edit_role')]);
  }

  if (config.hasLevel) {
    if (!profile.rating_edited) {
      buttons.push([Keyboard.button.callback(TXT.profile.edit_level, '1edit_level')]);
    } else {
      buttons.push([Keyboard.button.callback(TXT.profile.edit_level_done, '1edit_level_disabled')]);
    }
  }

  if (config.hasDatingGoals) {
    buttons.push([Keyboard.button.callback(TXT.profile.edit_dating_goal, '1edit_dating_goal')]);
  }
  if (config.hasDatingInterests) {
    buttons.push([Keyboard.button.callback(TXT.profile.edit_dating_interests, '1edit_dating_interests')]);
  }
  if (config.hasDatingAdditional) {
    buttons.push([Keyboard.button.callback(TXT.profile.edit_dating_additional, '1edit_dating_additional')]);
  }
  if (config.hasMeetingTime) {
    buttons.push([Keyboard.button.callback(TXT.profile.edit_meeting_time, '1edit_meeting_time')]);
  }

  buttons.push([Keyboard.button.callback(TXT.profile.edit_sport, '1edit_sport')]);
  buttons.push([profileBackButton()]);

  return Keyboard.inlineKeyboard(buttons);
}

export async function showEditProfileMenu(ctx: AppContext, profile: UserProfile): Promise<void> {
  const adminId = preserveAdminEditData(ctx);
  await clearState(ctx);
  if (adminId !== undefined) {
    ctx.session.data = { admin_edit_user_id: adminId };
  }
  const attachments: Parameters<typeof editButtons>[2] = [buildEditProfileKeyboard(profile)];
  if (profile.photo_path) {
    attachments.unshift({ type: 'image', payload: { url: profile.photo_path } });
  }
  await editButtons(ctx, `${formatProfileText(profile)}\n\n${TXT.profile.edit_menu}`, attachments);
}

export async function showOwnProfile(
  ctx: AppContext,
  profile: UserProfile,
  mode: 'edit' | 'new' = 'edit',
): Promise<void> {
  await clearState(ctx);
  await showProfile(ctx, profile, { isOwn: true, mode });
}

async function askForCity(
  ctx: AppContext,
  country: string,
  currentCity?: string,
): Promise<void> {
  const cities = [...(COUNTRIES[country] ?? []), TXT.registration.other_city];
  const countryLabel = country.replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F\u200D\s]+/u, '').trim();
  await editButtons(ctx, fmt(TXT.profile.select_city, { country: countryLabel }), [
    Keyboard.inlineKeyboard([
      ...chunkButtons(cities, (c) => Keyboard.button.callback(c, `edit_city_${encodeURIComponent(c)}`), 2),
      [editBackButton()],
    ]),
  ]);
  void currentCity;
}

async function showDatingInterestsEdit(ctx: AppContext, keys: string[]): Promise<void> {
  const selected = keys.length ? `\n\nВыбрано: ${keys.length}` : '';
  await editButtons(ctx, TXT.profile.select_dating_interests + selected, [
    Keyboard.inlineKeyboard([
      ...chunkButtons(DATING_INTERESTS, (i) => {
        const mark = keys.includes(i.key) ? '✅ ' : '';
        return Keyboard.button.callback(`${mark}${i.ru}`, `dint_${i.key}`);
      }, 2),
      [
        Keyboard.button.callback(TXT.registration.dating_interests_done, 'dint_done'),
        editBackButton(),
      ],
    ]),
  ]);
}

async function saveLocationAndShowProfile(
  ctx: AppContext,
  country: string,
  city: string,
  district?: string,
  mode: 'edit' | 'new' = 'edit',
): Promise<void> {
  const user = await resolveEditUser(ctx);
  if (!user) return;
  const adminId = preserveAdminEditData(ctx);
  user.country = country;
  user.city = city;
  user.district = district || undefined;
  await saveProfile(ctx, user);
  if (adminId !== undefined) ctx.session.data.admin_edit_user_id = adminId;
  await showAfterEdit(ctx, user, mode);
}

export async function handleProfileEditMessage(ctx: AppContext): Promise<boolean> {
  const state = getState(ctx);
  if (!state || !Object.values(EditProfileStates).includes(state as EditProfileStates)) {
    return false;
  }

  const user = await resolveEditUser(ctx);
  if (!user) {
    await clearState(ctx);
    return true;
  }
  const adminId = preserveAdminEditData(ctx);

  const text = getMessageText(ctx);

  if (state === EditProfileStates.COMMENT && text) {
    user.profile_comment = text;
    await saveProfile(ctx, user);
    if (adminId !== undefined) ctx.session.data.admin_edit_user_id = adminId;
    await showAfterEdit(ctx, user, 'new');
    return true;
  }

  if (state === EditProfileStates.COUNTRY_INPUT && text) {
    const data = getStateData<EditData>(ctx);
    data.country = text;
    await setState(ctx, EditProfileStates.CITY_INPUT, withAdminEditData(data, adminId));
    await askText(ctx, TXT.registration.enter_city);
    return true;
  }

  if (state === EditProfileStates.CITY_INPUT && text) {
    const data = getStateData<EditData>(ctx);
    await saveLocationAndShowProfile(ctx, String(data.country), text, undefined, 'new');
    return true;
  }

  if (state === EditProfileStates.PRICE && text) {
    const price = Number(text);
    if (!Number.isInteger(price) || price < 0) {
      await askText(ctx, TXT.profile.price_invalid);
      return true;
    }
    user.price = price;
    await saveProfile(ctx, user);
    if (adminId !== undefined) ctx.session.data.admin_edit_user_id = adminId;
    await showAfterEdit(ctx, user, 'new');
    return true;
  }

  if (state === EditProfileStates.LEVEL && text) {
    const rating = Number(text.trim());
    if (!Number.isFinite(rating) || rating < 0 || rating > 2800) {
      await askText(ctx, TXT.profile.rating_invalid);
      return true;
    }
    const config = getSportFieldConfig(user.sport);
    if (config.levelType === 'table_tennis_rating') {
      user.player_level = String(rating);
      user.rating_points = rating;
    } else {
      user.player_level = calculateLevelFromPoints(rating, user.sport);
      user.rating_points = rating;
    }
    user.rating_edited = true;
    await saveProfile(ctx, user);
    if (adminId !== undefined) ctx.session.data.admin_edit_user_id = adminId;
    await showAfterEdit(ctx, user, 'new');
    return true;
  }

  if (state === EditProfileStates.DATING_ADDITIONAL) {
    if (!text) {
      await askText(ctx, TXT.profile.enter_dating_additional);
      return true;
    }
    user.dating_additional = text === '/skip' ? '' : text;
    await saveProfile(ctx, user);
    if (adminId !== undefined) ctx.session.data.admin_edit_user_id = adminId;
    await showAfterEdit(ctx, user, 'new');
    return true;
  }

  if (state === EditProfileStates.MEETING_TIME && text) {
    user.meeting_time = text;
    await saveProfile(ctx, user);
    if (adminId !== undefined) ctx.session.data.admin_edit_user_id = adminId;
    await showAfterEdit(ctx, user, 'new');
    return true;
  }

  if (state === EditProfileStates.PHOTO_UPLOAD) {
    const url = getMessageImageUrl(ctx);
    if (!url) {
      await askText(ctx, TXT.profile.photo_send);
      return true;
    }
    user.photo_path = url;
    await saveProfile(ctx, user);
    if (adminId !== undefined) ctx.session.data.admin_edit_user_id = adminId;
    await showAfterEdit(ctx, user, 'new');
    return true;
  }

  return false;
}

export function registerProfileEditHandlers(bot: import('@maxhub/max-bot-api').Bot<AppContext>): void {
  bot.action('edit_profile', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const adminId = getAdminEditTargetId(ctx);
    if (adminId !== undefined && isAdmin(getCtxUserId(ctx))) {
      const target = await storage.getUser(adminId);
      if (!target) return;
      await showEditProfileMenu(ctx, target);
      return;
    }
    const user = await requireRegistered(ctx);
    if (!user) return;
    delete ctx.session.data.admin_edit_user_id;
    await showEditProfileMenu(ctx, user);
  });

  bot.action('back_to_profile', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const user = await resolveEditUser(ctx);
    if (!user) return;
    await showAfterEdit(ctx, user);
  });

  bot.action('1edit_level_disabled', async (ctx) => {
    await ctx.answerOnCallback({ notification: TXT.profile.rating_already_edited });
  });

  bot.action(/^1edit_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const user = await resolveEditUser(ctx);
    if (!user) return;

    const field = getCallbackPayload(ctx).replace('1edit_', '');

    if (field === 'comment') {
      await setState(ctx, EditProfileStates.COMMENT, {});
      await editText(ctx, TXT.profile.enter_comment, {
        attachments: [Keyboard.inlineKeyboard([[editBackButton()]])],
      });
      return;
    }

    if (field === 'payment') {
      await setState(ctx, EditProfileStates.PAYMENT, {});
      await editButtons(ctx, TXT.profile.select_payment, [
        Keyboard.inlineKeyboard([
          ...chunkButtons(PAYMENT_TYPES, (p) => Keyboard.button.callback(p, `edit_payment_${encodeURIComponent(p)}`), 1),
          [editBackButton()],
        ]),
      ]);
      return;
    }

    if (field === 'photo') {
      await editButtons(ctx, TXT.profile.select_photo, [
        Keyboard.inlineKeyboard([
          [Keyboard.button.callback(TXT.profile.photo_upload, 'edit_photo_upload')],
          [Keyboard.button.callback(TXT.profile.photo_none, 'edit_photo_none')],
          [Keyboard.button.callback(TXT.profile.photo_from_profile, 'edit_photo_profile')],
          [editBackButton()],
        ]),
      ]);
      return;
    }

    if (field === 'location') {
      await setState(ctx, EditProfileStates.COUNTRY, {});
      const countries = [...Object.keys(COUNTRIES), TXT.registration.other_country];
      await editButtons(ctx, TXT.profile.select_country, [
        Keyboard.inlineKeyboard([
          ...chunkButtons(countries, (c) => Keyboard.button.callback(c, `edit_country_${encodeURIComponent(c)}`), 2),
          [editBackButton()],
        ]),
      ]);
      return;
    }

    if (field === 'sport') {
      await setState(ctx, EditProfileStates.SPORT, {});
      await editButtons(ctx, TXT.profile.select_sport, [
        Keyboard.inlineKeyboard([
          ...chunkButtons(SPORTS, (s) => Keyboard.button.callback(s, `edit_sport_${encodeURIComponent(s)}`), 2),
          [editBackButton()],
        ]),
      ]);
      return;
    }

    if (field === 'role') {
      await setState(ctx, EditProfileStates.ROLE, {});
      await editButtons(ctx, TXT.profile.select_role, [
        Keyboard.inlineKeyboard([
          ...ROLES.map((r) => [Keyboard.button.callback(r, `edit_role_${encodeURIComponent(r)}`)]),
          [editBackButton()],
        ]),
      ]);
      return;
    }

    if (field === 'level') {
      if (user.rating_edited) {
        await editText(ctx, TXT.profile.rating_already_edited, {
          attachments: [Keyboard.inlineKeyboard([[profileBackButton()]])],
        });
        return;
      }
      const config = getSportFieldConfig(user.sport);
      await setState(ctx, EditProfileStates.LEVEL, {});
      await editText(ctx, config.levelType === 'table_tennis_rating'
        ? TXT.profile.enter_table_tennis_rating
        : TXT.profile.enter_level, {
        attachments: [Keyboard.inlineKeyboard([[editBackButton()]])],
      });
      return;
    }

    if (field === 'dating_goal') {
      await setState(ctx, EditProfileStates.DATING_GOAL, {});
      await editButtons(ctx, TXT.profile.select_dating_goal, [
        Keyboard.inlineKeyboard([
          ...chunkButtons(DATING_GOALS, (g) => Keyboard.button.callback(g.ru, `dgoal_${g.key}`), 1),
          [editBackButton()],
        ]),
      ]);
      return;
    }

    if (field === 'dating_interests') {
      await setState(ctx, EditProfileStates.DATING_INTERESTS, { dating_interests_keys: user.dating_interests_keys ?? [] });
      await showDatingInterestsEdit(ctx, user.dating_interests_keys ?? []);
      return;
    }

    if (field === 'dating_additional') {
      await setState(ctx, EditProfileStates.DATING_ADDITIONAL, {});
      await editText(ctx, TXT.profile.enter_dating_additional, {
        attachments: [Keyboard.inlineKeyboard([[editBackButton()]])],
      });
      return;
    }

    if (field === 'meeting_time') {
      await setState(ctx, EditProfileStates.MEETING_TIME, {});
      await editText(ctx, TXT.profile.enter_meeting_time, {
        attachments: [Keyboard.inlineKeyboard([[editBackButton()]])],
      });
    }
  });

  bot.action('edit_photo_upload', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    await resolveEditUser(ctx);
    await setState(ctx, EditProfileStates.PHOTO_UPLOAD, {});
    await editText(ctx, TXT.profile.photo_send, {
      attachments: [Keyboard.inlineKeyboard([[editBackButton()]])],
    });
  });

  bot.action('edit_photo_none', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const user = await resolveEditUser(ctx);
    if (!user) return;
    user.photo_path = undefined;
    await saveProfile(ctx, user);
    await showAfterEdit(ctx, user);
  });

  bot.action('edit_photo_profile', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const user = await resolveEditUser(ctx);
    if (!user) return;

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
      await editText(ctx, TXT.profile.photo_no_profile, {
        attachments: [Keyboard.inlineKeyboard([[editBackButton()]])],
      });
      return;
    }

    user.photo_path = avatarUrl;
    await saveProfile(ctx, user);
    await showAfterEdit(ctx, user);
  });

  bot.action(/^edit_country_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const country = decodeURIComponent(getCallbackPayload(ctx).replace('edit_country_', ''));
    const user = await resolveEditUser(ctx);
    if (!user) return;

    if (country === TXT.registration.other_country) {
      await setState(ctx, EditProfileStates.COUNTRY_INPUT, {});
      await editText(ctx, TXT.registration.enter_country, {
        attachments: [Keyboard.inlineKeyboard([[editBackButton()]])],
      });
      return;
    }

    await setState(ctx, EditProfileStates.CITY, { country });
    await askForCity(ctx, country, user.city);
  });

  bot.action(/^edit_city_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const city = decodeURIComponent(getCallbackPayload(ctx).replace('edit_city_', ''));
    const data = getStateData<EditData>(ctx);

    if (city === TXT.registration.other_city) {
      await setState(ctx, EditProfileStates.CITY_INPUT, data);
      await editText(ctx, TXT.registration.enter_city, {
        attachments: [Keyboard.inlineKeyboard([[editBackButton()]])],
      });
      return;
    }

    if (city === 'Москва') {
      await setState(ctx, EditProfileStates.CITY, { ...data, city });
      await editButtons(ctx, TXT.profile.select_district, [
        Keyboard.inlineKeyboard([
          ...chunkButtons(MOSCOW_DISTRICTS, (d) => Keyboard.button.callback(d, `edit_district_${d}`), 2),
          [editBackButton()],
        ]),
      ]);
      return;
    }

    await saveLocationAndShowProfile(ctx, String(data.country), city);
  });

  bot.action(/^edit_district_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const district = getCallbackPayload(ctx).replace('edit_district_', '');
    const data = getStateData<EditData>(ctx);
    await saveLocationAndShowProfile(ctx, String(data.country), String(data.city ?? 'Москва'), district);
  });

  bot.action(/^edit_payment_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const payment = decodeURIComponent(getCallbackPayload(ctx).replace('edit_payment_', ''));
    const user = await resolveEditUser(ctx);
    if (!user) return;
    user.default_payment = payment;
    await saveProfile(ctx, user);
    await clearState(ctx);
    await showAfterEdit(ctx, user);
  });

  bot.action(/^edit_role_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const role = decodeURIComponent(getCallbackPayload(ctx).replace('edit_role_', '')) as UserRole;
    const user = await resolveEditUser(ctx);
    if (!user) return;
    user.role = role;

    if (role === '🎯 Игрок') {
      delete user.price;
      await saveProfile(ctx, user);
      await clearState(ctx);
      await showAfterEdit(ctx, user);
      return;
    }

    await saveProfile(ctx, user);
    await setState(ctx, EditProfileStates.PRICE, {});
    await editText(ctx, TXT.profile.enter_price, {
      attachments: [Keyboard.inlineKeyboard([[editBackButton()]])],
    });
  });

  bot.action(/^edit_sport_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const newSport = decodeURIComponent(getCallbackPayload(ctx).replace('edit_sport_', '')) as SportType;
    const user = await resolveEditUser(ctx);
    if (!user) return;

    if (user.sport === newSport) {
      await clearState(ctx);
      await showAfterEdit(ctx, user);
      return;
    }

    const migrated = migrateProfileData(user.sport, newSport, user);
    await saveProfile(ctx, migrated);
    await clearState(ctx);
    await showAfterEdit(ctx, migrated);
  });

  bot.action(/^dgoal_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const key = getCallbackPayload(ctx).replace('dgoal_', '');
    const goal = DATING_GOALS.find((g) => g.key === key);
    const user = await resolveEditUser(ctx);
    if (!user) return;
    user.dating_goal_key = key;
    user.dating_goal = goal?.ru;
    await saveProfile(ctx, user);
    await clearState(ctx);
    await showAfterEdit(ctx, user);
  });

  bot.action(/^dint_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const payload = getCallbackPayload(ctx);

    if (payload === 'dint_done') {
      const data = getStateData<EditData>(ctx);
      const keys = data.dating_interests_keys ?? [];
      const user = await resolveEditUser(ctx);
      if (!user) return;
      user.dating_interests_keys = keys;
      user.dating_interests = keys.map((k) => DATING_INTERESTS.find((i) => i.key === k)?.ru ?? k);
      await saveProfile(ctx, user);
      await clearState(ctx);
      await showAfterEdit(ctx, user);
      return;
    }

    const key = payload.replace('dint_', '');
    const data = getStateData<EditData>(ctx);
    const keys = data.dating_interests_keys ?? [];
    const idx = keys.indexOf(key);
    if (idx >= 0) keys.splice(idx, 1);
    else keys.push(key);
    await setState(ctx, EditProfileStates.DATING_INTERESTS, { dating_interests_keys: keys });
    await showDatingInterestsEdit(ctx, keys);
  });
}
