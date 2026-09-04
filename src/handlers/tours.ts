import { TXT, fmt } from '../texts.js';
import { Keyboard } from '@maxhub/max-bot-api';
import type { AppContext } from '../context.js';
import { getMessageText } from '../context.js';
import { COUNTRIES, SPORTS } from '../config/profile.js';
import { storage } from '../storage/jsonStorage.js';
import { clearState, getState, getStateData, setState } from '../middleware/session.js';
import { BrowseToursStates, CreateTourStates } from '../types/states.js';
import type { SportType, UserProfile } from '../types/models.js';
import { chunkButtons, showCurrentMessage, askText } from '../utils/bot.js';
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
type TourCreateData = { country?: string; city?: string; start?: string; end?: string; comment?: string };

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
        chunkButtons(SPORTS, (s) => Keyboard.button.callback(s, `toursport_${encodeURIComponent(s)}`), 2),
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
    await startCreateTour(ctx);
  });

  // Alias for legacy callback used in some older messages
  bot.action(/^createTour/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'OK' });
    await startCreateTour(ctx);
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
    await setState(ctx, CreateTourStates.START_DATE, data);
    await askText(ctx, TXT.registration.vacation_start);
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
    await setState(ctx, CreateTourStates.COMMENT, data);
    await askText(ctx, TXT.registration.vacation_comment);
    return true;
  }
  if (state === CreateTourStates.COMMENT) {
    if (!text) {
      await askText(ctx, TXT.registration.vacation_comment);
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
    await ctx.reply(TXT.tours.published);
    return true;
  }
  return false;
}
