'use client';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import useSWR from 'swr';
import { CANCEL_REASONS, type CancelReason, formatUkPhone, telHref } from '@psebc/shared';
import { RoleGate } from '@/components/shells';
import { BackBar, ErrorBox, Loading, RideChip, Tags } from '@/components/ui';
import { Check, Phone } from '@/components/icons';
import { fetcher } from '@/lib/api';
import { dayLong, time, when } from '@/lib/format';
import { useOfficePhone } from '@/lib/useSettings';
import type { MemberRideView } from '@/lib/types';

export default function MemberRide() {
  return (
    <div className="mobile">
      <RoleGate roles={['member']}>{() => <Suspense><RideStatus /></Suspense>}</RoleGate>
    </div>
  );
}

function RideStatus() {
  const { id } = useParams<{ id: string }>();
  const booked = useSearchParams().get('booked');
  const { data, error } = useSWR<MemberRideView>(`/rides/${id}`, fetcher, { refreshInterval: 30_000 });
  const phone = useOfficePhone();
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const r = data.ride;
  const callOffice = phone ? (
    <a className="btn btn-secondary block" href={telHref(phone)}>
      <Phone /> Call the church office
    </a>
  ) : null;

  // ---- Your driver is booked (story 4.1) ----
  if (data.driver && ['driver_found', 'completed', 'logged', 'signed_off'].includes(r.status)) {
    const d = data.driver;
    return (
      <>
        <BackBar href="/member" label="Back to my lifts" crumb="My lifts" />
        <main className="screen" id="main">
          <div>
            {r.displayStatus === 'incident' ? (
              <RideChip status="incident" />
            ) : (
              <span className="chip chip-driver_found">{r.status === 'driver_found' ? 'Lift confirmed' : RideChipText(r.status)}</span>
            )}
            <h1 className="title" style={{ marginTop: 12 }}>
              {r.displayStatus === 'driver_found' ? 'Your driver is booked' : 'Your lift'}
            </h1>
            <p className="lede">
              {dayLong(r.pickupAt)}, {time(r.pickupAt)}
            </p>
          </div>
          {r.displayStatus === 'incident' ? <IncidentNotice phone={phone} /> : null}
          <div className="panel" style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
            <span className="avatar lg" role="img" aria-label={`Photo of ${d.firstName}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {d.photoUrl ? <img src={d.photoUrl} alt="" /> : d.firstName.charAt(0)}
            </span>
            <div className="stack-sm" style={{ gap: 2 }}>
              <strong style={{ fontSize: '1.5rem' }}>{d.firstName}</strong>
              <span className="muted">will pick you up in a</span>
              <strong>
                {d.vehicle.colour} {d.vehicle.makeModel}
              </strong>
              <span className="chip chip-neutral" style={{ alignSelf: 'flex-start', letterSpacing: 1 }}>
                {d.vehicle.registration}
              </span>
            </div>
          </div>
          <div className="panel">
            <div className="h3">Lift home</div>
            <p>{r.returnNeeded && r.returnAt ? `${time(r.returnAt)}, also with ${d.firstName}` : 'No lift home booked'}</p>
          </div>
          <div className="panel">
            <div className="h3">{d.firstName} knows</div>
            <Tags items={data.driverKnows} />
          </div>
          {data.canLog ? (
            <Link className="btn btn-primary block" href={`/member/rides/${r.id}/log`}>
              Tell us how the trip went
            </Link>
          ) : null}
          {callOffice}
          {data.canCancel ? (
            <Link className="btn btn-danger block" href={`/member/rides/${r.id}/cancel`}>
              Cancel this lift
            </Link>
          ) : null}
        </main>
      </>
    );
  }

  // ---- Driver confirmed, details not shared in this release (Epics 1–3) ----
  if (r.status === 'driver_found') {
    return (
      <>
        <BackBar href="/member" label="Back to my lifts" crumb="My lifts" />
        <main className="screen" id="main">
          <div>
            <span className="chip chip-driver_found">
              <Check /> &nbsp;Lift confirmed
            </span>
            <h1 className="title" style={{ marginTop: 12 }}>
              A driver has said yes
            </h1>
            <p className="lede">
              {dayLong(r.pickupAt)}, {time(r.pickupAt)} to {r.destination.replace('Princes Street Church: ', 'Princes Street Church, ')}.
              {r.returnNeeded && r.returnAt ? ` Lift home at ${time(r.returnAt)}.` : ''}
            </p>
          </div>
          <div className="panel">
            <div className="h3">What happens next</div>
            <p>The church office will tell you who is driving before the day.</p>
          </div>
          <div className="panel">
            <div className="h3">Your driver will know</div>
            <Tags items={data.driverKnows} />
          </div>
          {callOffice}
          {data.canCancel ? (
            <Link className="btn btn-danger block" href={`/member/rides/${r.id}/cancel`}>
              Cancel this lift
            </Link>
          ) : null}
        </main>
      </>
    );
  }

  // ---- Cancelled ----
  if (r.status === 'cancelled') {
    return (
      <>
        <BackBar href="/member" crumb="My lifts" />
        <main className="screen" id="main">
          <RideChip status="cancelled" />
          <h1 className="title">This lift was cancelled</h1>
          <p className="lede">
            {when(r.pickupAt)} to {r.destination}.{r.cancelReason ? ` Reason: ${CANCEL_REASONS[r.cancelReason as CancelReason] ?? r.cancelReason}.` : ''}
          </p>
          {data.canRebook ? (
            <Link className="btn btn-primary block" href={`/member/rides/${r.id}/cancel?rebook=1`}>
              Book again for a new date
            </Link>
          ) : null}
          {callOffice}
        </main>
      </>
    );
  }

  // ---- Lift requested / finding a driver ----
  const unmatched = r.status === 'unmatched';
  return (
    <>
      <BackBar href="/member" crumb="My lifts" />
      <main className="screen" id="main">
        <div>
          {r.displayStatus === 'incident' ? (
            <RideChip status="incident" />
          ) : booked ? (
            <span className="chip chip-driver_found">
              <Check /> &nbsp;Lift booked
            </span>
          ) : (
            <RideChip status={r.displayStatus} />
          )}
          <h1 className="title" style={{ marginTop: 12 }}>
            {r.displayStatus === 'incident' ? 'Your lift' : unmatched ? 'We’re still looking for a driver' : 'We’re finding you a driver'}
          </h1>
          <p className="lede">
            {dayLong(r.pickupAt)}, {time(r.pickupAt)} to {r.destination.replace('Princes Street Church: ', 'Princes Street Church, ')}.
            {r.returnNeeded && r.returnAt ? ` Lift home at ${time(r.returnAt)}.` : ''}
          </p>
        </div>
        {r.displayStatus === 'incident' ? <IncidentNotice phone={phone} /> : null}
        <ol className="progress-list panel" aria-label="Progress">
          <li className="done">
            <span className="dot">
              <Check />
            </span>
            <div>
              <strong>Booked</strong>
              <div className="small muted">{when(r.createdAt)}</div>
            </div>
          </li>
          <li className="current">
            <span className="dot" />
            <div>
              <strong>Asking volunteer drivers</strong>
              <div className="small muted">Only checked drivers whose car suits your needs are asked.</div>
            </div>
          </li>
          <li>
            <span className="dot" />
            <div>
              <strong>Driver confirmed</strong>
              <div className="small muted">We’ll tell you their name and car.</div>
            </div>
          </li>
        </ol>
        <p className="muted">{unmatched ? 'The church office has been told and will call you.' : 'If no driver says yes in time, the church office will call you.'}</p>
        <Link className="btn btn-secondary block" href="/member">
          Back to my lifts
        </Link>
        {data.canCancel ? (
          <Link className="btn btn-danger block" href={`/member/rides/${r.id}/cancel`}>
            Cancel this lift
          </Link>
        ) : null}
      </main>
    </>
  );
}

/** Shown to the member while an incident on this lift is open (details stay with safeguarding). */
function IncidentNotice({ phone }: { phone: string }) {
  return (
    <div className="alert" role="status">
      <strong>An incident has been reported on this lift</strong>
      <p>Our safeguarding lead has been told and may contact you. If you need help now, please phone the church office{phone ? ` on ${formatUkPhone(phone)}` : ''}.</p>
    </div>
  );
}

function RideChipText(s: string) {
  return s === 'completed' ? 'Trip complete' : s === 'signed_off' ? 'Trip closed' : 'Trip logged';
}
