import type { Tournament } from '../types/models.js';
import { PAYMENT_WINDOW_HOURS } from '../config/tournament.js';
import {
  advanceWinner,
  generateOlympicBracket,
  generateRoundRobin,
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

export function startTournament(t: Tournament): Tournament {
  const seeding = ensureSeeding(t);
  const ids = seeding.map(Number);
  let bracket = t.type === 'Олимпийская система'
    ? generateOlympicBracket(ids)
    : undefined;
  const round_robin = t.type === 'Круговая' ? generateRoundRobin(ids) : undefined;

  // Авто-продвижение BYE (матч с одним игроком)
  if (bracket) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const round of bracket.rounds) {
        for (const m of round) {
          if (m.winner) continue;
          const onlyP1 = m.player1 != null && m.player2 == null;
          const onlyP2 = m.player2 != null && m.player1 == null;
          if (onlyP1 || onlyP2) {
            const winnerId = (onlyP1 ? m.player1 : m.player2)!;
            bracket = advanceWinner(bracket, m.id, winnerId, []);
            changed = true;
          }
        }
      }
    }
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

export function listPendingMatches(t: Tournament): PendingTournamentMatch[] {
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
