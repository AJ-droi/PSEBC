'use client';
import { formatUkPhone,telHref } from '@psebc/shared';
import Link from 'next/link';
import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import useSWR from 'swr';
import { RoleGate } from '@/components/shells';
import { BackBar, ErrorBox, Loading, Tags } from '@/components/ui';
import { Check, Phone } from '@/components/icons';
import { fetcher, post } from '@/lib/api';
import { useSubmit } from '@/lib/form';
import { date, dayLong, time } from '@/lib/format';
import type { DriverRecordView, DriverTripView, RideView } from '@/lib/types';

/** F06 (after acceptance) + F07 Trip progress — stories 4.2, 5.1. */
export default function Trip() {
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
  const [confirmNotThere, setConfirmNotThere] = useState(false);
  const router = useRouter();
  if (loadError) return <ErrorBox error={loadError} />;
  if (!data) return <Loading />;

  if (data.view === 'driver_record') {
    const rec = data as DriverRecordView;
    return (
      <>
        <BackBar href="/driver" />
        <main className="screen" id="main">
          <h1 className="title">Trip on {dayLong(rec.ride.pickupAt)}</h1>
          <p className="lede">{rec.message}</p>
          <div className="panel">
            <p>To {rec.ride.destination}</p>
            {rec.ride.pickedUpAt ? <p className="muted">Picked up {time(rec.ride.pickedUpAt)}</p> : null}
            {rec.ride.droppedOffAt ? <p className="muted">Dropped off {time(rec.ride.droppedOffAt)}</p> : null}
          </div>
        </main>
      </>
    );
  }
  if (data.view === 'invite') {
    router.replace(`/driver/invites/${id}`);
    return <Loading />;
  }
  if (data.view !== 'driver_trip') return <ErrorBox error="This trip is not available." />;
  const t = data as DriverTripView;
  const r = t.ride;
  const m = t.member;
  const step = r.droppedOffAt ? 2 : r.pickedUpAt ? 1 : 0;

  const act = async (event: 'picked_up' | 'dropped_off' | 'not_at_pickup') => {
    const ok = await run(() => post(`/rides/${id}/progress`, { event }));
    if (ok) {
      setConfirmNotThere(false);
      await mutate();
    }
  };

  return (
    <>
      <BackBar href="/driver" crumb={`${dayLong(r.pickupAt)} · Pick up ${time(r.pickupAt)}`} />
      <main className="screen" id="main">
        <h1 className="title">Your lift with {m.preferredName}</h1>
        <ErrorBox error={error} />
        <ol className="progress-list panel" aria-label="Trip progress">
          {[
            ['Accepted', ''],
            ['Picked up', r.pickedUpAt ? time(r.pickedUpAt) : ''],
            ['Dropped off', r.droppedOffAt ? time(r.droppedOffAt) : ''],
          ].map(([label, at], i) => (
            <li key={label} className={i <= step ? 'done' : i === step + 1 ? 'current' : ''}>
              <span className="dot">{i <= step ? <Check /> : null}</span>
              <span>
                <strong>{label}</strong> {at ? <span className="muted">{at}</span> : null}
              </span>
            </li>
          ))}
        </ol>

        <section className="panel" aria-label="Pick up">
          <div className="small muted">Pick up from</div>
          <strong style={{ fontSize: '1.125rem' }}>{r.pickupAddress}</strong>
          {m.findingNotes ? <p className="muted">{m.findingNotes}</p> : null}
          <div className="row">
            <a className="btn btn-secondary sm grow" href={telHref(m.phone)}>
              <Phone /> Call {m.preferredName}
            </a>
            <a className="btn btn-secondary sm grow" href={telHref(m.emergencyPhone)}>
              <Phone /> Emergency contact
            </a>
          </div>
          <p className="small muted">
            Emergency contact: {m.emergencyName} ({m.emergencyRelationship}) · {formatUkPhone(m.emergencyPhone)}
          </p>
          <p className="small muted">
            Going to {r.destination}
            {r.returnNeeded && r.returnAt ? ` · lift home ${time(r.returnAt)}` : ''}
          </p>
        </section>

        <section className="stack-sm" aria-label="How to help">
          <h2 className="h3">How to help</h2>
          <Tags items={m.howToHelp} />
          {m.notesForDriver ? <p className="muted">{m.notesForDriver}</p> : null}
          {r.needsNote ? <p><strong>This time:</strong> {r.needsNote}</p> : null}
        </section>

        {m.healthNotes.length || m.unwellInstructions ? (
          <section className="notice" aria-label="Health notes">
            <div className="h3">Health notes</div>
            {m.healthNotes.map((h) => (
              <p key={h}>{h}.</p>
            ))}
            {m.unwellInstructions ? <p>If unwell: {m.unwellInstructions}</p> : null}
            <p className="small">Updated {date(m.needsUpdatedAt)} · You can see these until the trip is closed.</p>
          </section>
        ) : null}

        {confirmNotThere ? (
          <div className="alert" role="alertdialog" aria-labelledby="nat">
            <strong id="nat">Tell the church office {m.preferredName} isn’t at the pickup?</strong>
            <p>They’ll call {m.preferredName} and their emergency contact. Please wait nearby.</p>
            <div className="row">
              <button className="btn btn-danger-solid sm" type="button" onClick={() => act('not_at_pickup')} disabled={busy}>
                Yes, tell the office
              </button>
              <button className="btn btn-secondary sm" type="button" onClick={() => setConfirmNotThere(false)}>
                No
              </button>
            </div>
          </div>
        ) : null}
        {r.notAtPickupAt && !r.pickedUpAt ? <p className="success">The church office has been told ({time(r.notAtPickupAt)}).</p> : null}
      </main>
      <div className="m-foot">
        {step === 0 && r.status === 'driver_found' ? (
          <button className="btn btn-primary block" type="button" onClick={() => act('picked_up')} disabled={busy}>
            I’ve picked {m.preferredName} up
          </button>
        ) : null}
        {step === 1 ? (
          <button className="btn btn-primary block" type="button" onClick={() => act('dropped_off')} disabled={busy}>
            I’ve dropped {m.preferredName} off
          </button>
        ) : null}
        {step === 2 && !t.driverLogDone ? (
          <Link className="btn btn-primary block" href={`/driver/trips/${id}/log`}>
            Trip complete · log it now
          </Link>
        ) : null}
        <div className="row">
          {step === 0 ? (
            <button className="btn btn-secondary sm grow" type="button" onClick={() => setConfirmNotThere(true)}>
              Not at pickup
            </button>
          ) : null}
          <Link className="btn btn-danger sm grow" href={`/concern/${id}?back=/driver/trips/${id}`}>
            Report a concern
          </Link>
        </div>
        {t.canWithdraw ? (
          <button
            type="button"
            className="link-btn"
            onClick={async () => {
              if (!window.confirm('Hand this lift back? We’ll ask other drivers.')) return;
              const ok = await run(() => post(`/rides/${id}/withdraw`, { note: '' }));
              if (ok) router.replace('/driver');
            }}
          >
            I can no longer do this lift
          </button>
        ) : null}
      </div>
    </>
  );
}
