'use client';
import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';
import type { RideStatus } from '@psebc/shared';
import { MobileShell } from '@/components/shells';
import { ErrorBox, Loading } from '@/components/ui';
import { Shield } from '@/components/icons';
import { fetcher, post } from '@/lib/api';
import { date, dayShort, time, when } from '@/lib/format';
import { signOut } from '@/lib/session';

interface Home {
  driver: { firstName: string; status: string; validTo: string | null; loneWorkingAcknowledged: boolean };
  invites: { id: string; pickupAt: string; pickupArea: string; destination: string; returnAt: string | null }[];
  trips: { id: string; status: RideStatus; pickupAt: string; memberName: string; town: string; needsLog: boolean }[];
}

export default function DriverHome() {
  return <MobileShell roles={['driver']} label="Volunteer driver">{() => <Inner />}</MobileShell>;
}

function Inner() {
  const { data, error, mutate } = useSWR<Home>('/drivers/me/home', fetcher, { refreshInterval: 30_000 });
  const [ack, setAck] = useState(false);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const d = data.driver;
  const approved = d.status === 'approved';
  return (
    <main className="screen" id="main">
      <div>
        <h1 className="title">Hello, {d.firstName}</h1>
        {approved ? (
          <div className="chip chip-approved" style={{ marginTop: 10, gap: 8, padding: '7px 12px', fontSize: '0.9375rem' }}>
            <Shield /> Approved{d.validTo ? ` · checks valid to ${date(d.validTo)}` : ''}
          </div>
        ) : (
          <div className="alert" style={{ marginTop: 12 }}>
            <strong>{d.status === 'pending' ? 'Waiting for safeguarding approval' : d.status === 'expired' ? 'Your checks have expired' : 'Not approved to drive'}</strong>
            <p>You won’t get lift requests until the safeguarding lead approves you. Please contact the church office if you have questions.</p>
          </div>
        )}
      </div>

      {!d.loneWorkingAcknowledged ? (
        <div className="notice">
          <div className="h3">Before your first trip</div>
          <p>Please read the church’s lone-working and conduct guidance. You’ll need to confirm before you can accept a lift.</p>
          <a href="/guidance/lone-working" style={{ fontWeight: 600, color: 'var(--amber-ink)' }}>
            Read the guidance
          </a>
          <label className="check">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I’ve read and will follow it
          </label>
          <button
            type="button"
            className="btn btn-primary sm"
            disabled={!ack}
            onClick={async () => {
              await post('/drivers/me/lone-working');
              mutate();
            }}
          >
            Confirm
          </button>
        </div>
      ) : null}

      <section className="stack" aria-labelledby="new">
        <h2 className="h2" id="new">
          New requests {data.invites.length ? <span className="badge">{data.invites.length}</span> : null}
        </h2>
        {data.invites.length === 0 ? <p className="muted">No new requests right now.</p> : null}
        {data.invites.map((i) => (
          <Link key={i.id} className="card highlight" href={`/driver/invites/${i.id}`}>
            <div className="between">
              <strong style={{ fontSize: '1.125rem' }}>{when(i.pickupAt)}</strong>
              <span className="muted small">{i.pickupArea}</span>
            </div>
            <span className="muted">
              To {i.destination.replace('Princes Street Church: ', 'Princes Street Church · ')}
              {i.returnAt ? ` · lift home ${time(i.returnAt)}` : ''}
            </span>
            <span style={{ fontWeight: 600, color: 'var(--pine)' }}>View and reply</span>
          </Link>
        ))}
      </section>

      <section className="stack" aria-labelledby="trips">
        <h2 className="h2" id="trips">
          Your trips
        </h2>
        {data.trips.length === 0 ? <p className="muted">No trips yet.</p> : null}
        {data.trips.map((t) => (
          <Link key={t.id} className="card" href={t.needsLog ? `/driver/trips/${t.id}/log` : `/driver/trips/${t.id}`}>
            <div className="between">
              <strong style={{ fontSize: '1.125rem' }}>
                {dayShort(t.pickupAt)} · {t.memberName}
              </strong>
              {t.needsLog ? <span className="chip chip-invites_sent">Log needed</span> : t.status === 'driver_found' ? <span className="chip chip-driver_found">Booked</span> : <span className="chip chip-logged">Logged</span>}
            </div>
            <span className="muted">{t.needsLog ? 'Tell us how the trip went' : `Pick up ${time(t.pickupAt)} · ${t.town}`}</span>
          </Link>
        ))}
      </section>
      <button type="button" className="link-btn" onClick={signOut}>
        Sign out
      </button>
    </main>
  );
}
