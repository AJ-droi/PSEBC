'use client';
import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { DesktopShell } from '@/components/shells';
import { ErrorBox, Loading, SelectField } from '@/components/ui';
import { fetcher } from '@/lib/api';
import { dayShort } from '@/lib/format';

interface Report {
  month: string;
  summary: { tripsCompleted: number; tripsCompletedPreviousMonth: number; liftsRequested: number; cancelled: number; noDriverFound: number; concernsReported: number; concernsReviewed: number; averageRating: number | null; ratingsCount: number; membersUsed: number; expiringDrivers: number };
  successMeasures: { ridesWithApprovedDriverPct: number | null; tripsSignedOffWithin7DaysPct: number | null; incidentsReachingSafeguardingPct: number | null; requestsMatchedPct: number | null; memberSatisfaction: number | null };
  byWeek: { weekStarting: string; trips: number }[];
  noDriverReasons: { reason: string; count: number }[];
  driverWorkload: { name: string; trips: number; declined: number }[];
  memberUsage: { name: string; trips: number; usuallyGoingTo: string }[] | null;
  memberUsageCounts: number[];
}

/** 7.1 Monthly reports dashboard (CR-01). Admin and safeguarding only. Never shows health information. */
export default function Reports() {
  return <DesktopShell roles={['admin', 'safeguarding']}>{() => <Inner />}</DesktopShell>;
}

function months(n = 12) {
  const out: { value: string; label: string }[] = [];
  const d = new Date();
  d.setUTCDate(1);
  for (let i = 0; i < n; i++) {
    const v = d.toISOString().slice(0, 7);
    out.push({ value: v, label: new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(d) });
    d.setUTCMonth(d.getUTCMonth() - 1);
  }
  return out;
}

const pct = (v: number | null) => (v === null ? '—' : `${v}%`);

function Inner() {
  const opts = useMemo(() => months(), []);
  const [month, setMonth] = useState(opts[0]!.value);
  const { data, error } = useSWR<Report>(`/reports/monthly?month=${month}`, fetcher);
  const max = Math.max(1, ...(data?.byWeek.map((w) => w.trips) ?? [1]));
  const diff = data ? data.summary.tripsCompleted - data.summary.tripsCompletedPreviousMonth : 0;
  return (
    <>
      <div className="d-head">
        <h1 className="d-title">Monthly report</h1>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div style={{ minWidth: 220 }}>
            <SelectField label="Month" value={month} onChange={(e) => setMonth(e.target.value)} options={opts} />
          </div>
          <a className="btn btn-secondary" href={`/api/reports/monthly.csv?month=${month}`}>
            Download as spreadsheet
          </a>
        </div>
      </div>
      <ErrorBox error={error} />
      {!data ? <Loading /> : null}
      {data ? (
        <>
          <div className="cols-5">
            <Stat label="Trips completed" n={data.summary.tripsCompleted} sub={`${diff >= 0 ? 'Up' : 'Down'} ${Math.abs(diff)} on last month`} />
            <Stat label="Lifts requested" n={data.summary.liftsRequested} sub={`${data.summary.cancelled} cancelled`} />
            <Stat label="No driver found" n={data.summary.noDriverFound} sub="See reasons below" />
            <Stat label="Concerns reported" n={data.summary.concernsReported} sub={`${data.summary.concernsReviewed} reviewed by safeguarding`} />
            <Stat label="Average rating" n={data.summary.averageRating === null ? '—' : `${data.summary.averageRating} / 5`} sub={`From ${data.summary.ratingsCount} ratings`} />
          </div>
          <section className="section">
            <h2>Success measures (PRD §2)</h2>
            <div className="cols-5">
              <Stat label="Rides with an approved driver" n={pct(data.successMeasures.ridesWithApprovedDriverPct)} sub="Target 100%" />
              <Stat label="Trips signed off within 7 days" n={pct(data.successMeasures.tripsSignedOffWithin7DaysPct)} sub="Target 95% or more" />
              <Stat label="Concerns reaching safeguarding in 24h" n={pct(data.successMeasures.incidentsReachingSafeguardingPct)} sub="Target 100%" />
              <Stat label="Requests matched before pickup" n={pct(data.successMeasures.requestsMatchedPct)} sub="Target 90% or more" />
              <Stat label="Member satisfaction" n={data.successMeasures.memberSatisfaction ?? '—'} sub="Target 4 or above" />
            </div>
          </section>
          <div className="cols-2">
            <section className="section">
              <h2>Trips completed by week</h2>
              {data.byWeek.length === 0 ? (
                <p className="muted">No completed trips this month.</p>
              ) : (
                <div className="bars" role="img" aria-label={`Trips by week: ${data.byWeek.map((w) => `${dayShort(w.weekStarting)} ${w.trips}`).join(', ')}`}>
                  {data.byWeek.map((w) => (
                    <div className="bar" key={w.weekStarting}>
                      <strong>{w.trips}</strong>
                      <span className="fill" style={{ height: `${(w.trips / max) * 100}%` }} />
                      <span className="small muted">{dayShort(w.weekStarting).replace(/^\w+ /, '')}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
            <section className="section">
              <h2>Why no driver was found</h2>
              {data.noDriverReasons.length === 0 ? <p className="muted">Every request found a driver.</p> : null}
              {data.noDriverReasons.map((r) => (
                <div className="between" key={r.reason}>
                  <span>{r.reason}</span>
                  <strong>{r.count}</strong>
                </div>
              ))}
              <p className="small muted">Use this to target driver recruitment, for example drivers with wheelchair-accessible cars.</p>
              {data.summary.expiringDrivers ? <p className="notice">{data.summary.expiringDrivers} driver check(s) expire in the next 30 days.</p> : null}
            </section>
            <section className="section">
              <h2>Driver workload</h2>
              <p className="muted small">Trips driven this month. Check no one is doing too many.</p>
              <table className="data">
                <thead>
                  <tr>
                    <th>Driver</th>
                    <th>Trips</th>
                    <th>Declined</th>
                  </tr>
                </thead>
                <tbody>
                  {data.driverWorkload.map((d) => (
                    <tr key={d.name}>
                      <td>{d.name}</td>
                      <td>{d.trips}</td>
                      <td>{d.declined}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
            <section className="section">
              <h2>Members using the scheme</h2>
              <p className="muted small">{data.summary.membersUsed} members used the scheme this month.</p>
              {data.memberUsage ? (
                <table className="data">
                  <thead>
                    <tr>
                      <th>Member</th>
                      <th>Trips</th>
                      <th>Usually going to</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.memberUsage.map((m) => (
                      <tr key={m.name}>
                        <td>{m.name}</td>
                        <td>{m.trips}</td>
                        <td>{m.usuallyGoingTo.replace('Princes Street Church: ', '')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="small muted">Names are hidden until per-member figures are added to the DPIA (task 8.12). Top trip counts: {data.memberUsageCounts.join(', ') || '—'}.</p>
              )}
            </section>
          </div>
          <p className="small muted">Shows trip counts only, never health details. Visible to admin and safeguarding.</p>
        </>
      ) : null}
    </>
  );
}

function Stat({ label, n, sub }: { label: string; n: number | string; sub: string }) {
  return (
    <div className="stat">
      <span className="small muted">{label}</span>
      <span className="n">{n}</span>
      <span className="small muted">{sub}</span>
    </div>
  );
}
