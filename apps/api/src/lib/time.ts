export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

export const addHours = (d: Date, h: number) => new Date(d.getTime() + h * HOUR);
export const addDays = (d: Date, days: number) => new Date(d.getTime() + days * DAY);
export function addMonths(d: Date, months: number): Date {
  const r = new Date(d);
  r.setUTCMonth(r.getUTCMonth() + months);
  return r;
}

/** Plain-English UK date/time for messages, e.g. "Sun 8 Nov, 9:45 am". */
export function formatWhen(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  const day = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London' }).format(date);
  const time = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Europe/London' })
    .format(date)
    .replace(/\s?(am|pm)/i, (m) => ' ' + m.trim().toLowerCase());
  return `${day}, ${time}`;
}

export const toIsoDate = (d: Date) => d.toISOString().slice(0, 10);
