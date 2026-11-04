'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { RULES, addIsoDays, ukDate } from '@psebc/shared';
import { DayCalendar } from '@/components/day-calendar';
import { RoleGate } from '@/components/shells';
import { BackBar, ErrorBox, Loading } from '@/components/ui';
import { fetcher, put } from '@/lib/api';
import { useSubmit } from '@/lib/form';
import { date } from '@/lib/format';

interface Calendar {
  from: string;
  to: string;
  daysOff: string[];
  booked: string[];
}

/** Story 3.4 (PSEBC-20): a driver books out the days they can't drive. */
export default function DriverCalendarPage() {
  return (
    <div className="mobile">
      <RoleGate roles={['driver']}>{() => <DriverCalendar />}</RoleGate>
    </div>
  );
}

function DriverCalendar() {
  const from = useMemo(() => ukDate(new Date()), []);
  const to = addIsoDays(from, RULES.bookingHorizonDays - 1);
  const key = `/drivers/me/calendar?from=${from}&to=${to}`;
  const { data, error: loadError, mutate } = useSWR<Calendar>(key, fetcher, { revalidateOnFocus: false });
  const [off, setOff] = useState<Set<string> | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const { busy, error, run } = useSubmit();

  useEffect(() => {
    if (data && off === null) setOff(new Set(data.daysOff));
  }, [data, off]);

  if (loadError) return <ErrorBox error={loadError} />;
  if (!data || !off) return <Loading />;

  const booked = new Set(data.booked);
  const changed = off.size !== data.daysOff.length || data.daysOff.some((d) => !off.has(d));
  const offList = [...off].sort();

  function toggle(day: string) {
    setSaved(null);
    setOff((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  }

  async function save() {
    const res = await run(() => put<Calendar & { withdrawnInvites: number }>('/drivers/me/calendar', { from, to, daysOff: offList }));
    if (!res) return;
    await mutate(res, { revalidate: false });
    setOff(new Set(res.daysOff));
    setSaved(
      res.withdrawnInvites > 0
        ? `Saved. ${res.withdrawnInvites === 1 ? 'One lift request' : `${res.withdrawnInvites} lift requests`} on your days off ${res.withdrawnInvites === 1 ? 'was' : 'were'} passed to other drivers.`
        : 'Saved. You won’t get lift requests on your days off.',
    );
  }

  return (
    <>
      <BackBar href="/driver" label="Back to home" crumb="Your calendar" />
      <main className="screen" id="main">
        <div>
          <h1 className="title">When can’t you drive?</h1>
          <p className="lede">Tap the days you’re not available. You won’t be asked to drive on those days, and members can see how many drivers are free before they book.</p>
        </div>
        <ErrorBox error={error} />
        {saved ? (
          <p className="success" role="status">
            {saved}
          </p>
        ) : null}
        <div className="cal-key" aria-hidden="true">
          <span>
            <i /> Free to drive
          </span>
          <span>
            <i className="on" /> Day off
          </span>
          <span>
            <i className="locked" /> You have a lift
          </span>
        </div>
        <DayCalendar
          from={from}
          to={to}
          legend="Next 8 weeks"
          cell={(d) =>
            booked.has(d)
              ? { selected: false, locked: 'you have a lift booked', note: 'Lift' }
              : { selected: off.has(d), note: off.has(d) ? 'Off' : undefined }
          }
          onToggle={toggle}
        />
        {data.booked.length ? (
          <p className="small muted">
            Days with a lift can’t be marked off here. If you can no longer make one, open it from{' '}
            <Link href="/driver">Your trips</Link> and hand it back, or call the church office.
          </p>
        ) : null}
        <div className="panel">
          <div className="h3">Your days off</div>
          <p>{offList.length ? offList.map((d) => date(d)).join(', ') : 'None. You can be asked on any day.'}</p>
        </div>
      </main>
      <div className="m-foot">
        <button type="button" className="btn btn-primary block" onClick={save} disabled={!changed || busy}>
          {busy ? 'Saving…' : changed ? 'Save my calendar' : 'No changes to save'}
        </button>
      </div>
    </>
  );
}
