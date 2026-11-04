/**
 * Calendar-day helpers. The church works in UK time, so "which day is this lift on?"
 * is always answered in Europe/London (a 00:30 BST pickup is on the UK date, not the UTC one).
 */

const UK_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' });

export const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** UK calendar date of a moment, as YYYY-MM-DD. */
export function ukDate(d: Date): string {
  return UK_DAY.format(d);
}

/** YYYY-MM-DD plus n days (calendar arithmetic, no time zone involved). */
export function addIsoDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Whole days from a to b (b − a) for YYYY-MM-DD strings. */
export function isoDaysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}

/** Every YYYY-MM-DD from `from` to `to`, inclusive. */
export function isoDayRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addIsoDays(d, 1)) out.push(d);
  return out;
}
