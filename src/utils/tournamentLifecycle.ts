import type { CompletedGame, Tournament } from '../types/models.js';
import { PAYMENT_WINDOW_HOURS } from '../config/tournament.js';
import {
  advanceWinner,
  generateOlympicBracket,
  generateRoundRobin,
  type BracketMatch,
  type BracketTree,
} from './bracket/index.js';
import { addDays, formatDateISO } from './validation.js';

export function shouldOpenPaymentWindow(t: Tournament): boolean {
  const count = Object.keys(t.participants).length;
  return t.status === 'active' && t.entry_fee > 0 && count >= t.participants_count && !t.payment_window?.active;
}

export function openPaymentWindow(t: Tournament): Tournament {
  const deadline = addDays(new Date(), PAYMENT_WINDOW_HOURS / 24);
  return {
    ...t,
    payment_window: {
      active: true,
      deadline_at: deadline.toISOString(),
      created_at: new Date().toISOString(),
    },
  };
}

export function removeUnpaidParticipants(t: Tournament): Tournament {
  if (!t.payment_window?.active) return t;
  const now = new Date();
  if (new Date(t.payment_window.deadline_at) > now) return t;

  const participants = { ...t.participants };
  const payments = { ...t.payments };
  for (const [uid] of Object.entries(participants)) {
    const pay = payments[uid];
    if (!pay || pay.status !== 'succeeded') {
      delete participants[uid];
      delete payments[uid];
    }
  }

  return {
    ...t,
    participants,
    payments,
    payment_window: { ...t.payment_window, active: false },
  };
}

export function canStartTournament(t: Tournament): boolean {
  const count = Object.keys(t.participants).length;
  if (count < 4 && t.type === 'Олимпийская система') return false;
  if (t.entry_fee > 0 && t.payment_window?.active) return false;
  return t.status === 'active' && count >= Math.min(4, t.participants_count);
}

function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

/** Собирает посев: сохранённый порядок + недостающие участники (в случайном порядке). */
export function ensureSeeding(t: Tournament): string[] {
  const participantIds = Object.keys(t.participants);
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const id of t.seeding ?? []) {
    if (t.participants[id] && !seen.has(id)) {
      ordered.push(id);
      seen.add(id);
    }
  }
  const remaining = participantIds.filter((id) => !seen.has(id));
  shuffleInPlace(remaining);
  return [...ordered, ...remaining];
}

export function shuffleSeeding(t: Tournament): Tournament {
  const ids = Object.keys(t.participants);
  return { ...t, seeding: shuffleInPlace([...ids]) };
}

export function moveSeeding(t: Tournament, index: number, direction: 'up' | 'down'): Tournament {
  const seeding = ensureSeeding(t);
  const swapWith = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || index >= seeding.length || swapWith < 0 || swapWith >= seeding.length) {
    return { ...t, seeding };
  }
  [seeding[index], seeding[swapWith]] = [seeding[swapWith]!, seeding[index]!];
  return { ...t, seeding };
}

/**
 * Авто-продвижение BYE (матч с одним игроком). Свободные слоты — то есть
 * настоящий, структурный BYE — бывают только в 1-м круге (сразу после
 * посева). В следующих кругах пустой слот означает лишь то, что матч-«сосед»
 * по сетке ещё не сыгран, и его нельзя путать с BYE — иначе туда без игры
 * «прошёл» бы обладатель уже засчитанного BYE, а реальный второй финалист
 * потерял бы свой законный матч.
 */
function autoAdvanceRound1Byes(bracket: BracketTree): BracketTree {
  let result = bracket;
  for (const m of result.rounds[0] ?? []) {
    const onlyP1 = m.player1 != null && m.player2 == null;
    const onlyP2 = m.player2 != null && m.player1 == null;
    if (!m.winner && (onlyP1 || onlyP2)) {
      const winnerId = (onlyP1 ? m.player1 : m.player2)!;
      result = advanceWinner(result, m.id, winnerId, []);
    }
  }
  return result;
}

export function startTournament(t: Tournament): Tournament {
  const seeding = ensureSeeding(t);
  const ids = seeding.map(Number);
  let bracket = t.type === 'Олимпийская система'
    ? generateOlympicBracket(ids)
    : undefined;
  const round_robin = t.type === 'Круговая' ? generateRoundRobin(ids) : undefined;

  if (bracket) {
    bracket = autoAdvanceRound1Byes(bracket);
  }

  return {
    ...t,
    seeding,
    status: 'started',
    started_at: new Date().toISOString(),
    bracket: bracket as Record<string, unknown> | undefined,
    round_robin: round_robin as Record<string, unknown> | undefined,
  };
}

export function isPaymentWindowExpired(t: Tournament): boolean {
  if (!t.payment_window?.active) return false;
  return new Date(t.payment_window.deadline_at) <= new Date();
}

export function addParticipant(t: Tournament, userId: number, name: string): Tournament {
  if (t.participants[String(userId)]) return t;
  if (Object.keys(t.participants).length >= t.participants_count) return t;
  const key = String(userId);
  const participants = {
    ...t.participants,
    [key]: { user_id: userId, name, joined_at: new Date().toISOString() },
  };
  const seeding = ensureSeeding({ ...t, participants });
  return { ...t, participants, seeding };
}

export function isParticipant(t: Tournament, userId: number): boolean {
  return Boolean(t.participants[String(userId)]);
}

export function isTournamentFull(t: Tournament): boolean {
  return Object.keys(t.participants).length >= t.participants_count;
}

export function removeParticipant(t: Tournament, userId: number): Tournament {
  const key = String(userId);
  const participants = { ...t.participants };
  delete participants[key];
  const payments = { ...t.payments };
  delete payments[key];
  const seeding = (t.seeding ?? []).filter((id) => id !== key);
  return {
    ...t,
    participants,
    payments,
    seeding,
    payment_window: t.payment_window?.active
      ? { ...t.payment_window, active: false }
      : t.payment_window,
  };
}

export function grantSubscriptionMonth(): string {
  return formatDateISO(addDays(new Date(), 30));
}

export interface PendingTournamentMatch {
  id: string;
  round: number;
  player1: number;
  player2: number;
  label: string;
}

function findPlayedGame(
  games: CompletedGame[],
  tournamentId: string,
  a: number,
  b: number,
): CompletedGame | undefined {
  return games.find((g) => (
    g.tournament_id === tournamentId
    && ((g.players[0] === a && g.players[1] === b) || (g.players[0] === b && g.players[1] === a))
  ));
}

/** Проигравший в реальном (не BYE) и уже сыгранном матче, иначе undefined. */
function matchLoser(m: BracketMatch): number | undefined {
  if (m.player1 == null || m.player2 == null || m.winner == null) return undefined;
  return m.winner === m.player1 ? m.player2 : m.player1;
}

export interface PlacementEntry {
  id: string;
  place: '3rd' | '5-8' | '5th' | '7th';
  /** Раунд внутри под-турнира за места (для группировки на картинке сетки: 0 — полуфиналы/утешительные, 1 — финал за 5-е место). */
  round: number;
  matchNumber: number;
  player1: number;
  player2: number;
  winner?: number;
  score?: string[];
}

/**
 * Матч за 3-е место и матчи за 5-8 места не хранятся в дереве сетки — они
 * вычисляются из проигравших полуфинала/четвертьфинала основной сетки и списка
 * уже сыгранных игр. Возвращает ВСЕ такие матчи (и сыгранные, и ещё нет), чтобы
 * этим единым источником данных могли пользоваться и выбор «что предложить
 * доиграть» (derivePlacementMatches), и рендер картинки сетки (bracketImage.ts).
 */
function computePlacementEntries(t: Tournament, games: CompletedGame[]): PlacementEntry[] {
  if (t.type !== 'Олимпийская система' || !t.bracket) return [];
  const tree = t.bracket as unknown as BracketTree;
  const rounds = tree.rounds ?? [];
  const result: PlacementEntry[] = [];

  if (rounds.length >= 2) {
    const sf = rounds[rounds.length - 2]!;
    if (sf.length === 2) {
      const l0 = matchLoser(sf[0]!);
      const l1 = matchLoser(sf[1]!);
      if (l0 != null && l1 != null) {
        const played = findPlayedGame(games, t.id, l0, l1);
        result.push({
          id: 'third_place',
          place: '3rd',
          round: 0,
          matchNumber: 0,
          player1: l0,
          player2: l1,
          winner: played?.winner_ids[0],
          score: played?.sets,
        });
      }
    }
  }

  if (rounds.length >= 3) {
    const qf = rounds[rounds.length - 3]!;
    // Реальные проигравшие четвертьфинала (те, у кого действительно был соперник —
    // игрок, прошедший по BYE, «проигравшим» здесь не становится). При нечётном
    // числе участников таких игроков может быть 2 или 3, а не только 4, поэтому
    // вместо жёсткой пары семифиналов строим для них отдельную под-сетку того же
    // вида, что и основная (со своим BYE при нечётном количестве).
    const losers = qf.map((m) => matchLoser(m)).filter((id): id is number => id != null);

    if (losers.length >= 2) {
      const sub = buildResolvedSubBracket(losers, 'p58_', t, games);

      if (sub.rounds.length >= 2) {
        sub.rounds[0]!.forEach((m, i) => {
          if (m.player1 != null && m.player2 != null) {
            result.push({
              id: m.id,
              place: '5-8',
              round: 0,
              matchNumber: i,
              player1: m.player1,
              player2: m.player2,
              winner: m.winner,
              score: m.score,
            });
          }
        });

        const semi = sub.rounds[sub.rounds.length - 2]!;
        if (semi.length === 2) {
          const l0 = matchLoser(semi[0]!);
          const l1 = matchLoser(semi[1]!);
          if (l0 != null && l1 != null) {
            const played = findPlayedGame(games, t.id, l0, l1);
            result.push({
              id: 'p58_seventh',
              place: '7th',
              round: 0,
              matchNumber: 0,
              player1: l0,
              player2: l1,
              winner: played?.winner_ids[0],
              score: played?.sets,
            });
          }
        }
      }

      const finalMatch = sub.rounds[sub.rounds.length - 1]![0];
      if (finalMatch && finalMatch.player1 != null && finalMatch.player2 != null) {
        result.push({
          id: finalMatch.id,
          place: '5th',
          // Если в под-сетке всего 1 круг (ровно 2 реальных проигравших
          // четвертьфинала — своей пары за 5-8 место нет), этот же матч —
          // одновременно и «полуфинал», и «финал»: он должен попасть в тот же
          // относительный круг 0, что и пары за 5-8 место, иначе на картинке
          // сетки для него не найдётся места и раздел «за 5-е место» пропадёт.
          round: sub.rounds.length - 1,
          matchNumber: 0,
          player1: finalMatch.player1,
          player2: finalMatch.player2,
          winner: finalMatch.winner,
          score: finalMatch.score,
        });
      }
    }
  }

  return result;
}

/** Все матчи за места (сыгранные и нет) — используется рендером картинки сетки. */
export function listPlacementMatchesForImage(t: Tournament, games: CompletedGame[]): PlacementEntry[] {
  return computePlacementEntries(t, games);
}

function derivePlacementMatches(t: Tournament, games: CompletedGame[]): PendingTournamentMatch[] {
  const nameOf = (id: number) => t.participants[String(id)]?.name ?? String(id);
  const labels: Record<PlacementEntry['place'], string> = {
    '3rd': '🥉 За 3-е место',
    '5-8': '5-8 место',
    '5th': 'За 5-е место',
    '7th': 'За 7-е место',
  };
  return computePlacementEntries(t, games)
    .filter((e) => e.winner == null)
    .map((e) => ({
      id: e.id,
      round: e.round,
      player1: e.player1,
      player2: e.player2,
      label: e.place === '5-8'
        ? `5-8 место (пара ${e.matchNumber + 1}): ${nameOf(e.player1)} — ${nameOf(e.player2)}`
        : `${labels[e.place]}: ${nameOf(e.player1)} — ${nameOf(e.player2)}`,
    }));
}

/**
 * Строит вспомогательную под-сетку олимпийской системы для списка игроков
 * (например, проигравших четвертьфинала — для определения 5–8 мест) и
 * «доигрывает» в ней всё, что уже сыграно по данным `games`. Использует те же
 * генератор сетки и BYE-логику, что и основной турнир, поэтому корректно
 * работает при любом (в т.ч. нечётном) числе игроков в под-сетке.
 */
function buildResolvedSubBracket(
  players: number[],
  idPrefix: string,
  t: Tournament,
  games: CompletedGame[],
): BracketTree {
  const raw = generateOlympicBracket(players);
  let tree: BracketTree = {
    rounds: raw.rounds.map((round) => round.map((m) => ({
      ...m,
      id: `${idPrefix}${m.id}`,
      next_match_id: m.next_match_id ? `${idPrefix}${m.next_match_id}` : undefined,
    }))),
  };
  tree = autoAdvanceRound1Byes(tree);

  let changed = true;
  while (changed) {
    changed = false;
    for (const round of tree.rounds) {
      for (const m of round) {
        if (m.winner != null || m.player1 == null || m.player2 == null) continue;
        const played = findPlayedGame(games, t.id, m.player1, m.player2);
        if (played) {
          const winnerId = played.winner_ids[0] ?? m.player1;
          tree = advanceWinner(tree, m.id, winnerId, played.sets);
          changed = true;
        }
      }
    }
  }
  return tree;
}

export function listPendingMatches(t: Tournament, games: CompletedGame[] = []): PendingTournamentMatch[] {
  const pending: PendingTournamentMatch[] = [];
  if (t.type === 'Олимпийская система' && t.bracket) {
    const tree = t.bracket as unknown as BracketTree;
    for (const round of tree.rounds ?? []) {
      for (const m of round) {
        if (m.winner) continue;
        if (m.player1 == null || m.player2 == null) continue;
        const n1 = t.participants[String(m.player1)]?.name ?? String(m.player1);
        const n2 = t.participants[String(m.player2)]?.name ?? String(m.player2);
        pending.push({
          id: m.id,
          round: m.round,
          player1: m.player1,
          player2: m.player2,
          label: `R${m.round}: ${n1} vs ${n2}`,
        });
      }
    }
    pending.push(...derivePlacementMatches(t, games));
  } else if (t.type === 'Круговая' && t.round_robin) {
    const rr = t.round_robin as {
      matches?: Array<{ p1: number; p2: number; played?: boolean; id?: string }>;
    };
    (rr.matches ?? []).forEach((m, idx) => {
      if (m.played) return;
      const n1 = t.participants[String(m.p1)]?.name ?? String(m.p1);
      const n2 = t.participants[String(m.p2)]?.name ?? String(m.p2);
      pending.push({
        id: m.id ?? `rr_${idx}`,
        round: 1,
        player1: m.p1,
        player2: m.p2,
        label: `${n1} vs ${n2}`,
      });
    });
  }
  return pending;
}

export function applyTournamentMatchResult(
  t: Tournament,
  matchId: string,
  winnerId: number,
  score: string[],
): Tournament {
  if (t.type === 'Олимпийская система' && t.bracket) {
    const tree = advanceWinner(t.bracket as unknown as BracketTree, matchId, winnerId, score);
    const flat = tree.rounds.flat();
    const allDone = flat.every((m) => m.winner != null || m.player1 == null || m.player2 == null);
    return {
      ...t,
      bracket: tree as unknown as Record<string, unknown>,
      status: allDone ? 'finished' : t.status,
    };
  }

  if (t.type === 'Круговая' && t.round_robin) {
    const rr = JSON.parse(JSON.stringify(t.round_robin)) as {
      table: Record<string, { played: number; wins: number; points: number }>;
      matches: Array<{ p1: number; p2: number; played?: boolean; winner?: number; score?: string[]; id?: string }>;
    };
    let target = rr.matches.find((m, idx) => (m.id ?? `rr_${idx}`) === matchId);
    if (!target && matchId.startsWith('rr_')) {
      const idx = Number(matchId.replace('rr_', ''));
      target = rr.matches[idx];
    }
    if (target && !target.played) {
      target.played = true;
      target.winner = winnerId;
      target.score = score;
      const loserId = target.p1 === winnerId ? target.p2 : target.p1;
      const wKey = String(winnerId);
      const lKey = String(loserId);
      if (!rr.table[wKey]) rr.table[wKey] = { played: 0, wins: 0, points: 0 };
      if (!rr.table[lKey]) rr.table[lKey] = { played: 0, wins: 0, points: 0 };
      rr.table[wKey]!.played += 1;
      rr.table[wKey]!.wins += 1;
      rr.table[wKey]!.points += 2;
      rr.table[lKey]!.played += 1;
      rr.table[lKey]!.points += 1;
    }
    const allDone = rr.matches.every((m) => m.played);
    return {
      ...t,
      round_robin: rr as unknown as Record<string, unknown>,
      status: allDone ? 'finished' : t.status,
    };
  }

  return t;
}

export function formatFirstRoundPairs(t: Tournament): string {
  const seeding = ensureSeeding(t);
  if (t.type !== 'Олимпийская система') return '📋 Круговая система';
  const lines: string[] = [];
  for (let i = 0; i < seeding.length; i += 2) {
    const a = t.participants[seeding[i]!]?.name ?? seeding[i] ?? 'BYE';
    const b = seeding[i + 1] ? (t.participants[seeding[i + 1]!]?.name ?? seeding[i + 1]) : 'BYE';
    lines.push(`${a} — ${b}`);
  }
  return `Пары 1-го круга:\n${lines.join('\n')}`;
}
