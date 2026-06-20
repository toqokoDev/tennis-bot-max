import { getSportCategory } from '../config/profile.js';
import type { SportType } from '../types/models.js';
import { GameOfferStates } from '../types/states.js';

export type GameStep =
  | 'sport'
  | 'country'
  | 'city'
  | 'district'
  | 'date'
  | 'time'
  | 'game_type'
  | 'payment_type'
  | 'competitive'
  | 'dating_goal'
  | 'dating_interests'
  | 'dating_additional'
  | 'comment'
  | 'publish';

const COURT_FLOW: GameStep[] = [
  'sport', 'country', 'city', 'district', 'date', 'time',
  'game_type', 'payment_type', 'competitive', 'comment', 'publish',
];

const OUTDOOR_FLOW: GameStep[] = ['sport', 'city', 'date', 'time', 'comment', 'publish'];
const MEETING_FLOW: GameStep[] = ['sport', 'city', 'date', 'time', 'comment', 'publish'];
const DATING_FLOW: GameStep[] = [
  'sport', 'city', 'date', 'time', 'dating_goal', 'dating_interests', 'dating_additional', 'comment', 'publish',
];

export function getGameOfferFlow(sport: SportType): GameStep[] {
  const cat = getSportCategory(sport);
  switch (cat) {
    case 'court_sport':
      return COURT_FLOW;
    case 'outdoor_sport':
      return OUTDOOR_FLOW;
    case 'meeting':
      return MEETING_FLOW;
    case 'dating':
      return DATING_FLOW;
    default:
      return OUTDOOR_FLOW;
  }
}

export function stepToState(step: GameStep): GameOfferStates {
  const map: Record<GameStep, GameOfferStates> = {
    sport: GameOfferStates.GAME_SPORT,
    country: GameOfferStates.GAME_COUNTRY,
    city: GameOfferStates.GAME_CITY,
    district: GameOfferStates.GAME_DISTRICT,
    date: GameOfferStates.GAME_DATE,
    time: GameOfferStates.GAME_TIME,
    game_type: GameOfferStates.GAME_TYPE,
    payment_type: GameOfferStates.PAYMENT_TYPE,
    competitive: GameOfferStates.GAME_COMPETITIVE,
    dating_goal: GameOfferStates.DATING_GOAL,
    dating_interests: GameOfferStates.DATING_INTERESTS,
    dating_additional: GameOfferStates.DATING_ADDITIONAL,
    comment: GameOfferStates.GAME_COMMENT,
    publish: GameOfferStates.GAME_COMMENT,
  };
  return map[step];
}

export function getNextGameStep(sport: SportType, current: GameStep, ctx: { city?: string }): GameStep | null {
  const flow = getGameOfferFlow(sport);
  const idx = flow.indexOf(current);
  if (idx < 0 || idx >= flow.length - 1) return null;
  let next = flow[idx + 1];
  if (next === 'district' && ctx.city !== 'Москва') {
    const dIdx = flow.indexOf('district');
    next = flow[dIdx + 1] ?? 'date';
  }
  return next;
}

export function getFirstGameStep(sport: SportType): GameStep {
  return getGameOfferFlow(sport)[0];
}

export function getStepAfterSport(sport: SportType): GameStep {
  const flow = getGameOfferFlow(sport);
  const idx = flow.indexOf('sport');
  return flow[idx + 1] ?? 'city';
}

export const OFFER_WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

export function buildOfferDateButtons(): { label: string; value: string }[] {
  const today = new Date();
  const items: { label: string; value: string }[] = [];
  for (let i = 0; i < 9; i += 1) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const value = `${day}.${month}`;
    const weekday = OFFER_WEEKDAYS[date.getDay() === 0 ? 6 : date.getDay() - 1];
    items.push({ label: `${weekday} (${value})`, value });
  }
  return items;
}

export function buildOfferTimeButtons(): string[] {
  const times: string[] = [];
  for (let hour = 7; hour <= 23; hour += 1) {
    times.push(`${String(hour).padStart(2, '0')}:00`);
  }
  times.push('00:00');
  return times;
}

export function getGameCommentPrompt(sport: SportType): string {
  const cat = getSportCategory(sport);
  if (cat === 'meeting') {
    if (sport === '☕️Бизнес-завтрак') return 'Опишите тему встречи и формат:';
    if (sport === '🍻По пиву') return 'Где планируете встретиться, что обсудить:';
    return 'Комментарий к встрече:';
  }
  if (cat === 'dating') return 'Что хотите добавить к анкете:';
  if (cat === 'outdoor_sport') return '💬 О себе и пожелания к тренировке:';
  return 'Комментарий к игре (или /skip):';
}

import { Keyboard } from '@maxhub/max-bot-api';
import type { AttachmentRequest } from '@maxhub/max-bot-api/types';
import { TXT } from '../texts.js';

export const SET_SCORES_LEFT = ['6:0', '6:1', '6:2', '6:3', '6:4', '7:5', '7:6'] as const;
export const SET_SCORES_RIGHT = ['0:6', '1:6', '2:6', '3:6', '4:6', '5:7', '6:7'] as const;

/** @deprecated use SET_SCORES_LEFT / SET_SCORES_RIGHT */
export const SET_SCORES = [...SET_SCORES_LEFT, ...SET_SCORES_RIGHT];

const SUPER_TIEBREAK_LEFT = ['10:0', '10:1', '10:2', '10:3', '10:4', '10:5', '10:6', '10:7', '10:8'];
const SUPER_TIEBREAK_RIGHT = ['0:10', '1:10', '2:10', '3:10', '4:10', '5:10', '6:10', '7:10', '8:10'];
const SUPER_TIEBREAK_EXTRA: [string, string][] = [
  ['11:9', '9:11'], ['12:10', '10:12'], ['13:11', '11:13'],
  ['14:12', '12:14'], ['15:13', '13:15'], ['16:14', '14:16'],
  ['17:15', '15:17'], ['18:16', '16:18'], ['19:17', '17:19'], ['20:18', '18:20'],
];

export function buildGameTypeKeyboard(): AttachmentRequest {
  return Keyboard.inlineKeyboard([
    [Keyboard.button.callback(TXT.enter_score.single, 'game_type:single')],
    [Keyboard.button.callback(TXT.enter_score.double, 'game_type:double')],
    [Keyboard.button.callback(TXT.enter_score.tournament, 'game_type:tournament')],
    [Keyboard.button.callback(TXT.common.back, 'score_back')],
  ]);
}

function buildPairedScoreRows(
  setNumber: number,
  pairs: [string, string][],
): ReturnType<typeof Keyboard.button.callback>[][] {
  return pairs.map(([left, right]) => [
    Keyboard.button.callback(left, `set_score:${setNumber}_${left}`),
    Keyboard.button.callback(right, `set_score:${setNumber}_${right}`),
  ]);
}

export function buildSetScoreKeyboard(setNumber: number): AttachmentRequest {
  const rows = buildPairedScoreRows(
    setNumber,
    SET_SCORES_LEFT.map((left, i) => [left, SET_SCORES_RIGHT[i]]),
  );

  if (setNumber === 3) {
    rows.push([Keyboard.button.callback(TXT.enter_score.super_tie, `supertiebreak:${setNumber}`)]);
  }

  if (setNumber > 1) {
    rows.push([
      Keyboard.button.callback(TXT.enter_score.prev_set, `prev_set:${setNumber - 1}`),
      Keyboard.button.callback(TXT.enter_score.next_set, `next_set:${setNumber + 1}`),
    ]);
  } else {
    rows.push([Keyboard.button.callback(TXT.enter_score.next_set, `next_set:${setNumber + 1}`)]);
  }

  rows.push([Keyboard.button.callback(TXT.enter_score.complete_entry, 'finish_score')]);
  rows.push([Keyboard.button.callback(TXT.common.back, 'score_back')]);
  return Keyboard.inlineKeyboard(rows);
}

export function buildSupertiebreakKeyboard(setNumber: number): AttachmentRequest {
  const rows = buildPairedScoreRows(
    setNumber,
    SUPER_TIEBREAK_LEFT.map((left, i) => [left, SUPER_TIEBREAK_RIGHT[i]]),
  );
  rows.push(...buildPairedScoreRows(setNumber, SUPER_TIEBREAK_EXTRA));
  rows.push([Keyboard.button.callback(TXT.enter_score.back_to_regular_set, `back_to_normal_set:${setNumber}`)]);
  rows.push([Keyboard.button.callback(TXT.common.back, 'score_back')]);
  return Keyboard.inlineKeyboard(rows);
}

export function countSetWins(sets: string[]): { team1: number; team2: number } {
  let team1 = 0;
  let team2 = 0;
  for (const s of sets) {
    const [a, b] = s.split(':').map(Number);
    if (a > b) team1 += 1;
    else if (b > a) team2 += 1;
  }
  return { team1, team2 };
}

export function formatSetsText(sets: string[]): string {
  return sets.map((s, i) => `Сет ${i + 1}: ${s}`).join('\n');
}
