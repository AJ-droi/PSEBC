'use client';
import Link from 'next/link';
import useSWR from 'swr';
import { MobileShell } from '@/components/shells';
import { ErrorBox, Loading, RideChip } from '@/components/ui';
import { Phone, Plus } from '@/components/icons';
import { fetcher } from '@/lib/api';
import { dayLong, dayShort, firstName, time } from '@/lib/format';
import { useOfficePhone } from '@/lib/useSettings';
import type { RideCore } from '@/lib/types';

type Item = RideCore & { driverFirstName: string | null; needsLog: boolean };

export default function MemberHome() {
  return <MobileShell roles={['member']}>{(me) => <Home name={firstName(me.user.fullName)} />}</MobileShell>;
}

function Home({ name }: { name: string }) {
  const { data, error } = useSWR<{ upcoming: Item[]; toLog: Item[]; past: Item[] }>('/rides', fetcher, { refreshInterval: 60_000 });
  const phone = useOfficePhone();
  return (
    <main className="screen" id="main">
      <h1 className="title">Hello, {name}</h1>
      <div className="hero">
        <div className="eyebrow">Lifts from church volunteers</div>
        <div className="big">Need a lift to church?</div>
        <Link className="btn btn-mint block" href="/member/book">
          <Plus /> Book a lift
        </Link>
      </div>

      <ErrorBox error={error} />
      {!data && !error ? <Loading /> : null}

      {data?.toLog.map((r) => (
        <Link key={r.id} href={`/member/rides/${r.id}/log`} className="notice" style={{ textDecoration: 'none' }}>
          <span className="h3">How was your trip on {dayShort(r.pickupAt)}?</span>
          <span>{r.driverFirstName ? `With ${r.driverFirstName} · ` : ''}it takes about 1 minute</span>
        </Link>
      ))}

      {data ? (
        <section className="stack" aria-labelledby="lifts">
          <h2 className="h2" id="lifts">
            Your lifts
          </h2>
          {data.upcoming.length === 0 ? <p className="muted">You have no lifts booked.</p> : null}
          {data.upcoming.map((r) => (
            <Link key={r.id} className={`card${r.status === 'driver_found' ? ' highlight' : ''}`} href={`/member/rides/${r.id}`}>
              <div className="between">
                <strong style={{ fontSize: '1.125rem' }}>{dayLong(r.pickupAt)}</strong>
                <RideChip status={r.status} />
              </div>
              <span className="muted">
                Pick up {time(r.pickupAt)} · {r.destination.replace('Princes Street Church: ', '')}
              </span>
              {r.driverFirstName ? <span style={{ fontWeight: 600, color: 'var(--pine)' }}>{r.driverFirstName} is collecting you</span> : null}
            </Link>
          ))}
        </section>
      ) : null}

      {phone ? (
        <a className="btn btn-secondary block" href={`tel:${phone.replace(/\s/g, '')}`}>
          <Phone /> Call the church office
        </a>
      ) : null}
    </main>
  );
}
