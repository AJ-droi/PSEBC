'use client';
import { addIsoDays, isoDayRange } from '@psebc/shared';
import { Fragment } from 'react';

/**
 * Month-by-month day grid used by the driver calendar (story 3.4) and repeat bookings (story 2.6).
 *
 * Each day is a real button with aria-pressed, so screen readers hear "Sunday 8 November, 2 drivers free, selected".
 * The chosen state is shown by fill, a tick and the note text — never by colour alone (PRD §10).
 */
export interface DayCell {
  /** Chosen (a day off, or a day to book). */
  selected: boolean;
  /** Can't be changed here (e.g. a day the driver already has a lift); the reason is read out. */
  locked?: string;
  /** Short note under the date: "Off", "2 free", "Lift". */
  note?: string;
  /** Picks a warning tone for the note (e.g. no drivers free). */
  tone?: 'warn';
}

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...opts });
const longDay = fmt({ weekday: 'long', day: 'numeric', month: 'long' });
const monthName = fmt({ month: 'long', year: 'numeric' });
const asUtcNoon = (day: string) => new Date(`${day}T12:00:00Z`);
/** 0 = Monday … 6 = Sunday (UK calendars start on Monday). */
const weekdayIndex = (day: string) => (asUtcNoon(day).getUTCDay() + 6) % 7;

export function DayCalendar({
  from,
  to,
  legend,
  hint,
  cell,
  onToggle,
  maxReached,
}: {
  from: string;
  to: string;
  legend: string;
  hint?: string;
  cell: (day: string) => DayCell;
  onToggle: (day: string) => void;
  /** When true, unselected days can't be added (a limit has been reached). */
  maxReached?: boolean;
}) {
  const days = isoDayRange(from, to);
  const months: { key: string; days: string[] }[] = [];
  for (const d of days) {
    const key = d.slice(0, 7);
    const last = months[months.length - 1];
    if (last?.key === key) last.days.push(d);
    else months.push({ key, days: [d] });
  }

  return (
    <fieldset className="q cal">
      <legend>
        {legend}
        {hint ? <span className="hint">{hint}</span> : null}
      </legend>
      {months.map((m) => (
        <Fragment key={m.key}>
          <h3 className="cal-month">{monthName.format(asUtcNoon(m.days[0]!))}</h3>
          <div className="cal-grid" role="group" aria-label={monthName.format(asUtcNoon(m.days[0]!))}>
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((w) => (
              <span key={w} className="cal-dow" aria-hidden="true">
                {w}
              </span>
            ))}
            {Array.from({ length: weekdayIndex(m.days[0]!) }, (_, i) => (
              <span key={`pad-${i}`} aria-hidden="true" />
            ))}
            {m.days.map((d) => {
              const c = cell(d);
              const blocked = !!c.locked || (!c.selected && !!maxReached);
              const label = [longDay.format(asUtcNoon(d)), c.note, c.locked].filter(Boolean).join(', ');
              return (
                <button
                  key={d}
                  type="button"
                  className={`cal-day${c.selected ? ' on' : ''}${c.locked ? ' locked' : ''}${c.tone === 'warn' ? ' warn' : ''}`}
                  aria-pressed={c.selected}
                  aria-disabled={blocked || undefined}
                  aria-label={label}
                  onClick={() => {
                    if (!blocked) onToggle(d);
                  }}
                >
                  <span className="cal-num">{Number(d.slice(8))}</span>
                  <span className="cal-note">{c.selected ? '✓ ' : ''}{c.note ?? ''}</span>
                </button>
              );
            })}
          </div>
        </Fragment>
      ))}
    </fieldset>
  );
}

/** Every 7 days from `start` up to `to`, at most `limit` days. */
export function weeklyFrom(start: string, to: string, limit: number): string[] {
  const out: string[] = [];
  for (let d = start; d <= to && out.length < limit; d = addIsoDays(d, 7)) out.push(d);
  return out;
}
