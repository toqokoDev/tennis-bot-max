import type { Tournament } from '../types/models.js';
import { PAYMENT_WINDOW_HOURS } from '../config/tournament.js';
import { generateOlympicBracket, generateRoundRobin } from './bracket/index.js';
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
  for (const [uid, p] of Object.entries(participants)) {
    const pay = t.payments[uid];
    if (!pay || pay.status !== 'succeeded') {
      delete participants[uid];
      delete t.payments[uid];
    }
  }

  return {
    ...t,
    participants,
    payment_window: { ...t.payment_window, active: false },
  };
}

export function canStartTournament(t: Tournament): boolean {
  const count = Object.keys(t.participants).length;
  if (count < 4 && t.type === 'Олимпийская система') return false;
  if (t.entry_fee > 0 && t.payment_window?.active) return false;
  return t.status === 'active' && count >= Math.min(4, t.participants_count);
}

export function startTournament(t: Tournament): Tournament {
  const ids = Object.values(t.participants).map((p) => p.user_id);
  const bracket = t.type === 'Олимпийская система'
    ? generateOlympicBracket(ids)
    : undefined;
  const round_robin = t.type === 'Круговая' ? generateRoundRobin(ids) : undefined;
  return {
    ...t,
    status: 'started',
    bracket: bracket as Record<string, unknown> | undefined,
    round_robin: round_robin as Record<string, unknown> | undefined,
  };
}

export function isPaymentWindowExpired(t: Tournament): boolean {
  if (!t.payment_window?.active) return false;
  return new Date(t.payment_window.deadline_at) <= new Date();
}

export function addParticipant(t: Tournament, userId: number, name: string): Tournament {
  if (Object.keys(t.participants).length >= t.participants_count) return t;
  return {
    ...t,
    participants: {
      ...t.participants,
      [String(userId)]: { user_id: userId, name, joined_at: new Date().toISOString() },
    },
  };
}

export function removeParticipant(t: Tournament, userId: number): Tournament {
  const participants = { ...t.participants };
  delete participants[String(userId)];
  const payments = { ...t.payments };
  delete payments[String(userId)];
  return { ...t, participants, payments };
}

export function grantSubscriptionMonth(): string {
  return formatDateISO(addDays(new Date(), 30));
}
