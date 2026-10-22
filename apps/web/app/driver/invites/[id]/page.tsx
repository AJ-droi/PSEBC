'use client';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import useSWR from 'swr';
import { RoleGate } from '@/components/shells';
import { BackBar, ErrorBox, KV, Loading, Tags } from '@/components/ui';
import { fetcher, post } from '@/lib/api';
import { useSubmit } from '@/lib/form';
import { time, when } from '@/lib/format';
import type { InviteView, RideView } from '@/lib/types';

/** F06 Ride invite (story 3.2): date, time, pickup area, destination and needs summary only. */
export default function Invite() {
  return (
    <div className="mobile">
      <RoleGate roles={['driver']}>{() => <Inner />}</RoleGate>
    </div>
  );
}

function Inner() {
  const { id } = useParams<{ id: string }>();
  const { data, error: loadError, mutate } = useSWR<RideView>(`/rides/${id}`, fetcher);
  const { busy, error, run } = useSubmit();
  const router = useRouter();
  if (loadError) return <ErrorBox error={loadError} />;
  if (!data) return <Loading />;
  if (data.view === 'driver_trip') {
    router.replace(`/driver/trips/${id}`);
    return <Loading />;
  }
  if (data.view !== 'invite') return <ErrorBox error="This request is no longer available." />;
  const v = data as InviteView;
  const r = v.ride;

  async function accept() {
    const ok = await run(() => post(`/rides/${id}/accept`));
    await mutate();
    if (ok) router.replace(`/driver/trips/${id}`);
  }

  return (
    <>
      <BackBar href="/driver" crumb="Volunteer driver" />
      <main className="screen" id="main">
        <div>
          <h1 className="title">New lift request</h1>
          <p className="lede">Sent to {v.invitedCount} driver{v.invitedCount === 1 ? '' : 's'} · first to accept gets the lift</p>
        </div>
        <ErrorBox error={error ?? (v.open ? null : v.closedReason)} />
        <div className="panel">
          <KV
            items={[
              ['When', when(r.pickupAt)],
              ['Pickup area', r.pickupArea],
              ['Going to', r.destination],
              ['Lift home', r.returnAt ? time(r.returnAt) : 'Not needed'],
            ]}
          />
        </div>
        <div className="stack-sm">
          <h2 className="h3">What they need</h2>
          <Tags items={v.needs} />
        </div>
        <p className="muted small">You’ll see their name, address and any health notes once you accept.</p>
      </main>
      {v.open ? (
        <div className="m-foot" style={{ flexDirection: 'row' }}>
          <Link className="btn btn-secondary" style={{ flex: 1 }} href={`/driver/invites/${id}/decline`}>
            Decline
          </Link>
          <button className="btn btn-primary" style={{ flex: 1 }} type="button" onClick={accept} disabled={busy}>
            {busy ? 'Accepting…' : 'Accept'}
          </button>
        </div>
      ) : null}
    </>
  );
}
