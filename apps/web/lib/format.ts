const TZ = 'Europe/London';

const part = (d: Date, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, ...opts }).format(d);

const asDate = (v: string | Date) => (typeof v === 'string' ? new Date(v) : v);

/** "9:45 am" */
export function time(v: string | Date): string {
  return part(asDate(v), { hour: 'numeric', minute: '2-digit', hour12: true }).replace(/\s?(am|pm)/i, (m) => ' ' + m.trim().toLowerCase());
}
/** "Sunday 8 November" */
export function dayLong(v: string | Date): string {
  return part(asDate(v), { weekday: 'long', day: 'numeric', month: 'long' });
}
/** "Sun 8 Nov" */
export function dayShort(v: string | Date): string {
  return part(asDate(v), { weekday: 'short', day: 'numeric', month: 'short' });
}
/** "Sun 8 Nov, 9:45 am" */
export function when(v: string | Date): string {
  return `${dayShort(v)}, ${time(v)}`;
}
/** "8 Nov 2026" */
export function date(v: string | Date): string {
  return part(asDate(typeof v === 'string' && v.length === 10 ? `${v}T12:00:00Z` : v), { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Local UK date (YYYY-MM-DD) for a Date. */
export function isoLocalDate(d: Date): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  return p;
}

/**
 * Build an ISO timestamp from a UK local date + "HH:MM", handling BST/GMT.
 * Works by finding London's UTC offset at that moment.
 */
export function londonToIso(dateStr: string, hhmm: string): string {
  const [y, m, d] = dateStr.split('-').map(Number) as [number, number, number];
  const [h, min] = hhmm.split(':').map(Number) as [number, number];
  const guess = Date.UTC(y, m - 1, d, h, min);
  const offsetAt = (ms: number) => {
    const s = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, timeZoneName: 'shortOffset' }).formatToParts(new Date(ms)).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
    const match = /GMT([+-]\d+)?(?::(\d+))?/.exec(s);
    const hours = match?.[1] ? Number(match[1]) : 0;
    const mins = match?.[2] ? Number(match[2]) * Math.sign(hours || 1) : 0;
    return (hours * 60 + mins) * 60_000;
  };
  const first = guess - offsetAt(guess);
  return new Date(guess - offsetAt(first)).toISOString();
}

/** Upcoming dates for the booking date picker (next 8 weeks). */
export function upcomingDates(days = 56): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < days; i++) {
    const d = new Date(now.getTime() + i * 86_400_000);
    const label = i === 0 ? `Today, ${dayLong(d)}` : i === 1 ? `Tomorrow, ${dayLong(d)}` : dayLong(d);
    out.push({ value: isoLocalDate(d), label });
  }
  return out;
}

/** Quarter-hour times between two hours, as {value: "09:45", label: "9:45 am"}. */
export function timeOptions(fromHour = 7, toHour = 21): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  for (let h = fromHour; h <= toHour; h++) {
    for (const m of [0, 15, 30, 45]) {
      const v = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      const hh = h % 12 === 0 ? 12 : h % 12;
      out.push({ value: v, label: `${hh}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}` });
    }
  }
  return out;
}

/** Local "HH:MM" of a timestamp in London. */
export function londonHHMM(v: string | Date): string {
  return part(asDate(v), { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function firstName(name: string | null | undefined): string {
  return (name ?? '').trim().split(/\s+/)[0] ?? '';
}
