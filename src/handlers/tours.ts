import { TXT, fmt } from '../texts.js';
import { Keyboard } from '@maxhub/max-bot-api';
import type { AppContext } from '../context.js';
import { getMessageText } from '../context.js';
import { COUNTRIES } from '../config/profile.js';
import { storage } from '../storage/jsonStorage.js';
import { clearState, getState, getStateData, setState } from '../middleware/session.js';
import { BrowseToursStates, CreateTourStates } from '../types/states.js';
import type { SportType, UserProfile } from '../types/models.js';
import { chunkButtons, showCurrentMessage, askText, editText, editButtons, replyButtons, sportButtonRows, stripLeadingEmoji } from '../utils/bot.js';
import {
  isValidDate,
  isFutureOrTodayDate,
  isDateRangeValid,
  parseRuDate,
} from '../utils/validation.js';
import { sendTourToChannel } from '../services/channels.js';
import { getCallbackPayload } from '../utils/callback.js';
import { requireRegistered } from './registration.js';

type TourBrowseData = {
  sport?: SportType;
  country?: string;
  city?: string;
  results?: UserProfile[];
};
type TourCreateData = {
  country?: string;
  city?: string;
  start?: string;
  end?: string;
  comment?: string;
  /** Точечное редактирование одного блока существующего тура вместо создания с нуля */
  editOnly?: 'location' | 'dates' | 'comment';
};

function formatTourCard(user: UserProfile): string {
  return fmt(TXT.tours.current, {
    country: stripLeadingEmoji(user.vacation_country ?? ''),
    city: user.vacation_city ?? '',
    start: user.vacation_start ?? '',
    end: user.vacation_end ?? '',
    comment: user.vacation_comment ? `\n💬 ${user.vacation_comment}` : '',
  });
}

function tourCardButtons() {
  return [Keyboard.inlineKeyboard([
    [Keyboard.button.callback(TXT.tours.edit, 'tour_edit_menu')],
    [Keyboard.button.callback(TXT.tours.recreate, 'tour_recreate')],
    [Keyboard.button.callback(TXT.tours.delete, 'tour_delete')],
    [Keyboard.button.callback(TXT.common.back, 'profile')],
  ])];
}

async function showTourCard(ctx: AppContext, user: UserProfile): Promise<void> {
  await clearState(ctx);
  await showCurrentMessage(ctx, formatTourCard(user), { attachments: tourCardButtons() });
}

async function openTourEntry(ctx: AppContext): Promise<void> {
  const user = await requireRegistered(ctx);
  if (!user) return;
  if (user.vacation_tennis && user.vacation_city) {
    await showTourCard(ctx, user);
    return;
  }
  await startCreateTour(ctx);
}

export async function showToursMenu(ctx: AppContext): Promise<void> {
  await showCurrentMessage(ctx, TXT.tours.menu, {
    attachments: [Keyboard.inlineKeyboard([
      [Keyboard.button.callback(TXT.tours.browse, 'tours_browse')],
      [Keyboard.button.callback(TXT.tours.create, 'create_tour')],
      [Keyboard.button.callback(TXT.common.main_menu, 'main_menu')],
    ])],
  });
}

async function startCreateTour(ctx: AppContext): Promise<void> {
  const user = await requireRegistered(ctx);
  if (!user) return;
  await setState(ctx, CreateTourStates.COUNTRY, {});
  await showCurrentMessage(ctx, TXT.registration.vacation_country, {
    attachments: [Keyboard.inlineKeyboard(
      chunkButtons(Object.keys(COUNTRIES), (c) => Keyboard.button.callback(c, `ctcountry_${encodeURIComponent(c)}`), 2),
    )],
  });
}

function filterTourPlayers(all: Record<string, UserProfile>, data: TourBrowseData): UserProfile[] {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Object.values(all).filter((u) => {
    if (!u.vacation_tennis) return false;
    if (data.sport && u.sport !== data.sport) return false;
    if (data.country && u.vacation_country !== data.country) return false;
    if (data.city && u.vacation_city !== data.city) return false;
    if (u.vacation_end) {
      const end = parseRuDate(u.vacation_end);
      if (end && end < now) return false;
    }
    return true;
  });
}

export async function showTourBrowseResults(ctx: AppContext): Promise<void> {
  const data = getStateData<TourBrowseData>(ctx);
  if (!data.results) {
    const all = await storage.getUsers();
    data.results = filterTourPlayers(all, data);
  }

  if (!data.results.length) {
    await showCurrentMessage(ctx, fmt(TXT.tours.no_results, {
      city: data.city ?? '',
      country: data.country ?? '',
    }), {
      attachments: [Keyboard.inlineKeyboard([
        [Keyboard.button.callback(TXT.common.main_menu, 'main_menu')],
      ])],
    });
    return;
  }

  const buttons = data.results.map((u) => [
    Keyboard.button.callback(
      `${u.first_name} ${u.vacation_start}-${u.vacation_end}`,
      `tour_show_profile_${u.max_user_id}`,
    ),
  ]);
  buttons.push([Keyboard.button.callback(TXT.common.main_menu, 'main_menu')]);

  await setState(ctx, BrowseToursStates.LIST, data);
  await showCurrentMessage(ctx, fmt(TXT.tours.results, {
    count: data.results.length,
    city: data.city ?? '',
    country: data.country ?? '',
  }), {
    attachments: [Keyboard.inlineKeyboard(buttons)],
  });
}

export function registerToursHandlers(bot: import('@maxhub/max-bot-api').Bot<AppContext>): void {
  bot.action('tours_browse', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    await setState(ctx, BrowseToursStates.SELECT_SPORT, {});
    await showCurrentMessage(ctx, TXT.tours.choose_sport, {
      attachments: [Keyboard.inlineKeyboard(
        sportButtonRows((s) => Keyboard.button.callback(s, `toursport_${encodeURIComponent(s)}`)),
      )],
    });
  });

  bot.action(/^toursport_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<TourBrowseData>(ctx);
    data.sport = decodeURIComponent(getCallbackPayload(ctx).replace('toursport_', '')) as SportType;
    await setState(ctx, BrowseToursStates.SELECT_COUNTRY, data);
    await showCurrentMessage(ctx, TXT.tours.choose_country, {
      attachments: [Keyboard.inlineKeyboard(
        chunkButtons(Object.keys(COUNTRIES), (c) => Keyboard.button.callback(c, `tourcountry_${encodeURIComponent(c)}`), 2),
      )],
    });
  });

  bot.action(/^tourcountry_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<TourBrowseData>(ctx);
    data.country = decodeURIComponent(getCallbackPayload(ctx).replace('tourcountry_', ''));
    const cities = COUNTRIES[data.country!] ?? [];
    await setState(ctx, BrowseToursStates.SELECT_CITY, data);
    await showCurrentMessage(ctx, fmt(TXT.tours.choose_city, { country: data.country! }), {
      attachments: [Keyboard.inlineKeyboard(
        chunkButtons(cities, (c) => Keyboard.button.callback(c, `tourcity_${encodeURIComponent(c)}`), 2),
      )],
    });
  });

  bot.action(/^tourcity_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<TourBrowseData>(ctx);
    data.city = decodeURIComponent(getCallbackPayload(ctx).replace('tourcity_', ''));
    const all = await storage.getUsers();
    data.results = filterTourPlayers(all, data);
    await showTourBrowseResults(ctx);
  });

  bot.action('create_tour', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    await openTourEntry(ctx);
  });

  // Alias for legacy callback used in some older messages
  bot.action(/^createTour/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    await openTourEntry(ctx);
  });

  bot.action('tour_card_back', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const user = await requireRegistered(ctx);
    if (!user) return;
    await showTourCard(ctx, user);
  });

  bot.action('tour_recreate', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    await startCreateTour(ctx);
  });

  bot.action('tour_delete', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    await editButtons(ctx, TXT.tours.delete_confirm, [
      Keyboard.inlineKeyboard([[
        Keyboard.button.callback(TXT.common.yes, 'tour_delete_confirm'),
        Keyboard.button.callback(TXT.common.no, 'tour_card_back'),
      ]]),
    ]);
  });

  bot.action('tour_delete_confirm', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const user = await requireRegistered(ctx);
    if (!user) return;
    user.vacation_tennis = false;
    delete user.vacation_start;
    delete user.vacation_end;
    delete user.vacation_comment;
    delete user.vacation_country;
    delete user.vacation_city;
    delete user.vacation_district;
    await storage.saveUser(user);
    await editButtons(ctx, TXT.tours.deleted, [
      Keyboard.inlineKeyboard([
        [Keyboard.button.callback(TXT.profile.vacation_partner, 'create_tour')],
        [Keyboard.button.callback(TXT.common.main_menu, 'main_menu')],
      ]),
    ]);
  });

  bot.action('tour_edit_menu', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    await editButtons(ctx, TXT.tours.edit_menu, [
      Keyboard.inlineKeyboard([
        [Keyboard.button.callback(TXT.tours.edit_location, 'tour_edit_location')],
        [Keyboard.button.callback(TXT.tours.edit_dates, 'tour_edit_dates')],
        [Keyboard.button.callback(TXT.tours.edit_comment, 'tour_edit_comment')],
        [Keyboard.button.callback(TXT.common.back, 'tour_card_back')],
      ]),
    ]);
  });

  bot.action('tour_edit_location', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const user = await requireRegistered(ctx);
    if (!user) return;
    await setState(ctx, CreateTourStates.COUNTRY, { editOnly: 'location' } as TourCreateData);
    await editButtons(ctx, TXT.registration.vacation_country, [Keyboard.inlineKeyboard(
      chunkButtons(Object.keys(COUNTRIES), (c) => Keyboard.button.callback(c, `ctcountry_${encodeURIComponent(c)}`), 2),
    )]);
  });

  bot.action('tour_edit_dates', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const user = await requireRegistered(ctx);
    if (!user) return;
    await setState(ctx, CreateTourStates.START_DATE, { editOnly: 'dates' } as TourCreateData);
    await editText(ctx, TXT.registration.vacation_start);
  });

  bot.action('tour_edit_comment', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const user = await requireRegistered(ctx);
    if (!user) return;
    await setState(ctx, CreateTourStates.COMMENT, { editOnly: 'comment' } as TourCreateData);
    await editText(ctx, TXT.registration.vacation_comment);
  });

  bot.action(/^ctcountry_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<TourCreateData>(ctx);
    data.country = decodeURIComponent(getCallbackPayload(ctx).replace('ctcountry_', ''));
    await setState(ctx, CreateTourStates.CITY, data);
    const cities = COUNTRIES[data.country!] ?? [];
    await showCurrentMessage(ctx, TXT.registration.vacation_city, {
      attachments: [Keyboard.inlineKeyboard(
        chunkButtons(cities, (c) => Keyboard.button.callback(c, `ctcity_${encodeURIComponent(c)}`), 2),
      )],
    });
  });

  bot.action(/^ctcity_/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    const data = getStateData<TourCreateData>(ctx);
    data.city = decodeURIComponent(getCallbackPayload(ctx).replace('ctcity_', ''));

    if (data.editOnly === 'location') {
      const user = await requireRegistered(ctx);
      if (!user) return;
      user.vacation_country = data.country;
      user.vacation_city = data.city;
      await storage.saveUser(user);
      await clearState(ctx);
      await editButtons(ctx, `${TXT.tours.updated}\n\n${formatTourCard(user)}`, tourCardButtons());
      return;
    }

    await setState(ctx, CreateTourStates.START_DATE, data);
    await editText(ctx, TXT.registration.vacation_start);
  });
}

export async function handleTourMessage(ctx: AppContext): Promise<boolean> {
  const state = getState(ctx);
  if (!state || !Object.values(CreateTourStates).includes(state as CreateTourStates)) return false;
  const text = getMessageText(ctx);
  const data = getStateData<TourCreateData>(ctx);
  const user = await requireRegistered(ctx);
  if (!user) return false;

  if (state === CreateTourStates.START_DATE) {
    if (!text || !isValidDate(text) || !isFutureOrTodayDate(text)) {
      await askText(ctx, TXT.registration.vacation_date_invalid);
      return true;
    }
    data.start = text;
    await setState(ctx, CreateTourStates.END_DATE, data);
    await askText(ctx, TXT.registration.vacation_end);
    return true;
  }
  if (state === CreateTourStates.END_DATE) {
    if (!text || !isValidDate(text) || !data.start || !isDateRangeValid(data.start, text)) {
      await askText(ctx, TXT.registration.vacation_range_invalid);
      return true;
    }
    data.end = text;

    if (data.editOnly === 'dates') {
      user.vacation_start = data.start;
      user.vacation_end = data.end;
      await storage.saveUser(user);
      await clearState(ctx);
      await replyButtons(ctx, `${TXT.tours.updated}\n\n${formatTourCard(user)}`, tourCardButtons());
      return true;
    }

    await setState(ctx, CreateTourStates.COMMENT, data);
    await askText(ctx, TXT.registration.vacation_comment);
    return true;
  }
  if (state === CreateTourStates.COMMENT) {
    if (!text) {
      await askText(ctx, TXT.registration.vacation_comment);
      return true;
    }

    if (data.editOnly === 'comment') {
      user.vacation_comment = text === '/skip' ? '' : text;
      await storage.saveUser(user);
      await clearState(ctx);
      await replyButtons(ctx, `${TXT.tours.updated}\n\n${formatTourCard(user)}`, tourCardButtons());
      return true;
    }

    user.vacation_tennis = true;
    user.vacation_country = data.country;
    user.vacation_city = data.city;
    user.vacation_start = data.start;
    user.vacation_end = data.end;
    user.vacation_comment = text === '/skip' ? '' : text;
    await storage.saveUser(user);
    await sendTourToChannel(ctx.api, user);
    await clearState(ctx);
    await replyButtons(ctx, `${TXT.tours.published}\n\n${formatTourCard(user)}`, tourCardButtons());
    return true;
  }
  return false;
}
