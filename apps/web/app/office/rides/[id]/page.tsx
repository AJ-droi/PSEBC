'use client';
import Link from 'next/link';
import { Suspense, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import { CANCEL_REASONS, DECLINE_REASONS, ON_TIME, type CancelReason, type DeclineReason, type OnTime } from '@psebc/shared';
import { DesktopShell } from '@/components/shells';
import { ErrorBox, KV, Loading, RideChip, Tags } from '@/components/ui';
import { fetcher, post } from '@/lib/api';
import { time, when } from '@/lib/format';
import type { MemberRideView } from '@/lib/types';

const yn = (v: unknown) => (v === true ? 'Yes' : v === false ? 'No' : '—');

export default function OfficeRide() {
  return (
    <DesktopShell roles={['coordinator', 'admin']}>
      {() => (
        <Suspense>
          <Inner />
        </Suspense>
      )}
    </DesktopShell>
  );
}

function Inner() {
  const { id } = useParams<{ id: string }>();
  const booked = useSearchParams().get('booked');
  const { data, error, mutate } = useSWR<MemberRideView>(`/rides/${id}`, fetcher, { refreshInterval: 30_000 });
  const [msg, setMsg] = useState<string | null>(null);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const r = data.ride;
  const open = ['invites_sent', 'unmatched', 'requested'].includes(r.status);
  return (
    <>
      <div className="d-head">
        <div>
          <p className="muted">
            <Link href="/office">Lifts</Link> / {data.member.fullName}
          </p>
          <h1 className="d-title">
            {data.member.fullName} · {when(r.pickupAt)}
          </h1>
        </div>
        <RideChip status={r.displayStatus} />
      </div>
      {r.displayStatus === 'incident' ? (
        <div className="alert" role="status">
          <strong>Incident reported on this lift</strong>
          <p>The safeguarding lead has been told and holds the report. The lift stays at “Incident reported” until they sign the trip off.</p>
        </div>
      ) : null}
      {booked ? <p className="success">Lift booked. {data.member.preferredName} will be told by their chosen contact method.</p> : null}
      {msg ? <p className="success">{msg}</p> : null}
      <div className="d-grid">
        <div className="stack-lg">
          <section className="section">
            <h2>Lift</h2>
            <KV
              items={[
                ['Pick up', `${when(r.pickupAt)} from ${r.pickupAddress}`],
                ['Going to', r.destination],
                ['Lift home', r.returnNeeded && r.returnAt ? time(r.returnAt) : r.returnCancelled ? 'Cancelled' : 'Not needed'],
                ['With', r.companion ? 'A carer or companion' : 'Travelling alone'],
                ['Booked by', r.bookedByRole === 'member' ? 'Member (in the app)' : 'Church office'],
                ['Phone', data.member.phone ?? '—'],
                ...(r.needsNote ? ([['This time', r.needsNote]] as [string, string][]) : []),
                ...(r.cancelReason ? ([['Cancelled', CANCEL_REASONS[r.cancelReason as CancelReason] ?? r.cancelReason]] as [string, string][]) : []),
                ...(r.notAtPickupAt ? ([['Not at pickup', time(r.notAtPickupAt)]] as [string, string][]) : []),
                ...(r.pickedUpAt ? ([['Picked up', time(r.pickedUpAt)]] as [string, string][]) : []),
                ...(r.droppedOffAt ? ([['Dropped off', time(r.droppedOffAt)]] as [string, string][]) : []),
              ]}
            />
            <div className="stack-sm">
              <h3 className="h3">Driver will know</h3>
              <Tags items={data.driverKnows} />
            </div>
          </section>
          <section className="section">
            <h2>Drivers asked</h2>
            {data.invites?.length ? (
              <table className="data">
                <thead>
                  <tr>
                    <th>Driver</th>
                    <th>Reply</th>
                  </tr>
                </thead>
                <tbody>
                  {data.invites.map((i) => (
                    <tr key={i.driverId}>
                      <td>{i.name}</td>
                      <td>
                        {i.status === 'accepted' ? 'Accepted' : i.status === 'declined' ? `Declined: ${DECLINE_REASONS[i.declineReason as DeclineReason] ?? ''}` : i.status === 'withdrawn' ? 'Withdrawn' : 'Waiting'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="muted">No eligible drivers were found for this member’s needs.</p>
            )}
          </section>
          {data.logs ? (
            <section className="section">
              <h2>Trip logs</h2>
              <div className="cols-2">
                <div className="panel">
                  <strong>Driver log</strong>
                  {data.logs.driver ? (
                    <KV items={[['As planned', yn(data.logs.driver.wentAsPlanned)], ['Anything to report', yn(data.logs.driver.anythingToReport)], ['Needs changed', yn(data.logs.driver.needsChanged)]]} />
                  ) : (
                    <p className="muted">Not in yet</p>
                  )}
                </div>
                <div className="panel">
                  <strong>Member log</strong>
                  {data.logs.member ? (
                    <KV items={[['On time', ON_TIME[data.logs.member.onTime as OnTime] ?? '—'], ['Felt safe', yn(data.logs.member.feltSafe)], ['Rating', String(data.logs.member.rating ?? '—')], ['Call back', yn(data.logs.member.callbackRequested)]]} />
                  ) : (
                    <p className="muted">Not in yet</p>
                  )}
                </div>
              </div>
            </section>
          ) : null}
        </div>
        <aside className="section">
          <h2>Actions</h2>
          {data.driver ? (
            <p>
              Driver: <strong>{data.driver.firstName}</strong> · {data.driver.vehicle.colour} {data.driver.vehicle.makeModel} ({data.driver.vehicle.registration})
            </p>
          ) : null}
          {open ? (
            <button
              type="button"
              className="btn btn-primary block"
              onClick={async () => {
                const res = await post<{ invited: number; eligible: number }>(`/rides/${id}/resend-invites`).catch(() => null);
                setMsg(res ? (res.invited ? `Invites sent to ${res.invited} more driver(s).` : `No new drivers to ask (${res.eligible} eligible already asked).`) : 'Could not re-send invites.');
                mutate();
              }}
            >
              Re-send invites
            </button>
          ) : null}
          {data.canLog ? (
            <Link className="btn btn-primary block" href={`/office/rides/${id}/log`}>
              Fill in member’s trip log
            </Link>
          ) : null}
          {data.canCancel ? (
            <Link className="btn btn-danger block" href={`/office/rides/${id}/cancel`}>
              Cancel lift
            </Link>
          ) : null}
          {data.canRebook ? (
            <Link className="btn btn-secondary block" href={`/office/rides/${id}/cancel?rebook=1`}>
              Rebook for a new date
            </Link>
          ) : null}
          {['driver_found', 'completed', 'logged'].includes(r.status) ? (
            <Link className="btn btn-danger block" href={`/concern/${id}?back=/office/rides/${id}`}>
              Report a concern
            </Link>
          ) : null}
          <Link className="btn btn-secondary block" href={`/office/members/${data.member.id}`}>
            Member profile
          </Link>
        </aside>
      </div>
    </>
  );
}
