export function isValidDate(dateStr: string): boolean {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(dateStr);
  if (!match) return false;
  const [, d, m, y] = match.map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

export function isValidShortDate(dateStr: string): boolean {
  if (isValidDate(dateStr)) return true;
  const match = /^(\d{2})\.(\d{2})$/.exec(dateStr);
  if (!match) return false;
  const [, d, m] = match.map(Number);
  return d >= 1 && d <= 31 && m >= 1 && m <= 12;
}

export function isValidTime(timeStr: string): boolean {
  const match = /^(\d{1,2}):(\d{2})$/.exec(timeStr);
  if (!match) return false;
  const h = Number(match[1]);
  const min = Number(match[2]);
  return h >= 0 && h <= 23 && min >= 0 && min <= 59;
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function isValidPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15;
}

export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('8')) {
    return `+7${digits.slice(1)}`;
  }
  if (digits.length === 10) return `+7${digits}`;
  return phone.startsWith('+') ? phone : `+${digits}`;
}

export function parseOfferDateTime(date: string, time: string): Date | null {
  let day: number;
  let month: number;
  let year = new Date().getFullYear();
  const full = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(date);
  const short = /^(\d{2})\.(\d{2})$/.exec(date);
  if (full) {
    day = Number(full[1]);
    month = Number(full[2]);
    year = Number(full[3]);
  } else if (short) {
    day = Number(short[1]);
    month = Number(short[2]);
  } else {
    return null;
  }
  const tm = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!tm) return null;
  return new Date(year, month - 1, day, Number(tm[1]), Number(tm[2]));
}

export function formatDateISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(date: Date, days: number): Date {
  const r = new Date(date);
  r.setDate(r.getDate() + days);
  return r;
}

export function isSubscriptionActive(until?: string): boolean {
  if (!until) return false;
  return new Date(until) >= new Date(formatDateISO(new Date()));
}

export function hasProSubscription(user: { subscription?: { active: boolean; until: string }; gender?: string; sport?: string }): boolean {
  if (user.subscription?.active && isSubscriptionActive(user.subscription.until)) return true;
  return false;
}

export function parseRuDate(dateStr: string): Date | null {
  if (!isValidDate(dateStr)) return null;
  const [d, m, y] = dateStr.split('.').map(Number);
  return new Date(y, m - 1, d);
}

export function isFutureOrTodayDate(dateStr: string): boolean {
  const date = parseRuDate(dateStr);
  if (!date) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date >= today;
}

export function isDateRangeValid(startStr: string, endStr: string): boolean {
  const start = parseRuDate(startStr);
  const end = parseRuDate(endStr);
  if (!start || !end) return false;
  return end >= start;
}
