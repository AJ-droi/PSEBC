'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { CANCEL_PARTS, CANCEL_REASONS, CONCERN_KINDS, ON_TIME, USER_CANCEL_REASONS, YES_NO_UNSURE, type CancelPart, type CancelReason, type ConcernKind, type OnTime, type YesNoUnsure } from '@psebc/shared';
import { fetcher, post } from '@/lib/api';
import { useSubmit } from '@/lib/form';
import { dayLong, londonHHMM, londonToIso, time, timeOptions, upcomingDates } from '@/lib/format';
import type { MemberRideView } from '@/lib/types';
import { BackBar, CheckCards, ErrorBox, Loading, RadioCards, SelectField, TextArea, TextField, YesNo } from './ui';
import { Alert } from './icons';

// ---------------------------------------------------------------------------
// F05 Cancel or rebook (stories 2.3 PSEBC-14, 2.4 PSEBC-15)
// ---------------------------------------------------------------------------

export function CancelRide({ rideId, backHref, doneHref, startWithRebook }: { rideId: string; backHref: string; doneHref: (newId?: string) => string; startWithRebook?: boolean }) {
  const { data, error: loadError, mutate } = useSWR<MemberRideView>(`/rides/${rideId}`, fetcher);
  const [part, setPart] = useState<CancelPart>('both');
  const [reason, setReason] = useState<CancelReason | null>(null);
  const [mode, setMode] = useState<'cancel' | 'rebook'>(startWithRebook ? 'rebook' : 'cancel');
  const dates = useMemo(() => upcomingDates(), []);
  const times = useMemo(() => timeOptions(), []);
  const [date, setDate] = useState(dates[1]!.value);
  const [pickup, setPickup] = useState<string | null>(null);
  const [ret, setRet] = useState<string | null>(null);
  const { busy, error, fields, run } = useSubmit();
  const router = useRouter();

  if (loadError) return <ErrorBox error={loadError} />;
  if (!data) return <Loading />;
  const r = data.ride;
  const driver = data.driver?.firstName;
  const pickupHHMM = pickup ?? londonHHMM(r.pickupAt);
  const returnHHMM = ret ?? (r.returnAt ? londonHHMM(r.returnAt) : '12:30');

  async function cancel(thenRebook: boolean) {
    if (!reason) return;
    const ok = await run(() => post(`/rides/${rideId}/cancel`, { reason, part }));
    if (!ok) return;
    if (thenRebook && part === 'both') {
      await mutate();
      setMode('rebook');
      window.scrollTo({ top: 0 });
    } else router.replace(doneHref());
  }

  async function rebook() {
    const res = await run(() =>
      post<{ id: string }>(`/rides/${rideId}/rebook`, {
        pickupAt: londonToIso(date, pickupHHMM),
        returnAt: r.returnNeeded || r.returnAt ? londonToIso(date, returnHHMM) : null,
      }),
    );
    if (res) router.replace(doneHref(res.id));
  }

  if (mode === 'rebook') {
    return (
      <>
        <BackBar href={backHref} crumb="Book again" />
        <main className="screen" id="main">
          <div>
            <h1 className="title">Pick a new date</h1>
            <p className="lede">We’ll copy everything else from the cancelled lift to {r.destination.replace('Princes Street Church: ', '')}.</p>
          </div>
          <ErrorBox error={error} />
          <SelectField label="Date" value={date} onChange={(e) => setDate(e.target.value)} options={dates} />
          <SelectField label="Pick up at" value={pickupHHMM} onChange={(e) => setPickup(e.target.value)} options={times} error={fields.pickupAt} />
          {r.returnAt ? <SelectField label="Lift home at" value={returnHHMM} onChange={(e) => setRet(e.target.value)} options={times} error={fields.returnAt} /> : null}
        </main>
        <div className="m-foot">
          <button className="btn btn-primary block" type="button" onClick={rebook} disabled={busy}>
            {busy ? 'Booking…' : 'Book this lift'}
          </button>
        </div>
      </>
    );
  }

  if (!data.canCancel) {
    return (
      <>
        <BackBar href={backHref} />
        <main className="screen" id="main">
          <h1 className="title">This lift can’t be cancelled here</h1>
          <p className="lede">It may already have started. Please phone the church office.</p>
        </main>
      </>
    );
  }

  return (
    <>
      <BackBar href={backHref} crumb={`Lift on ${dayLong(r.pickupAt)}`} />
      <main className="screen" id="main">
        <div>
          <h1 className="title">Cancel this lift?</h1>
          <p className="lede">
            {time(r.pickupAt)} to {r.destination.replace('Princes Street Church: ', 'Princes Street Church, ')}
            {driver ? `, with ${driver}` : ''}.
          </p>
        </div>
        <ErrorBox error={error} />
        {r.returnNeeded ? (
          <RadioCards legend="Which part?" name="part" value={part} onChange={setPart} options={(Object.keys(CANCEL_PARTS) as CancelPart[]).map((k) => ({ value: k, label: CANCEL_PARTS[k] }))} />
        ) : null}
        <RadioCards legend="Why are you cancelling?" name="why" value={reason} onChange={setReason} error={fields.reason} options={USER_CANCEL_REASONS.map((k) => ({ value: k, label: CANCEL_REASONS[k] }))} />
        {driver ? <p className="panel">We’ll tell {driver} straight away.</p> : null}
      </main>
      <div className="m-foot">
        <button className="btn btn-danger-solid block" type="button" disabled={!reason || busy} onClick={() => cancel(false)}>
          {part === 'return_only' ? 'Cancel the lift home' : 'Cancel lift'}
        </button>
        {part === 'both' ? (
          <button className="btn btn-secondary block" type="button" disabled={!reason || busy} onClick={() => cancel(true)}>
            Cancel and pick a new date
          </button>
        ) : null}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// F09 Member trip log (stories 5.3 PSEBC-26, 6.3 PSEBC-29). Coordinators complete it after a phone check-in.
// ---------------------------------------------------------------------------

export function MemberLog({ rideId, backHref, doneHref, concernHref, forOffice }: { rideId: string; backHref: string; doneHref: string; concernHref: string; forOffice?: boolean }) {
  const { data, error: loadError } = useSWR<MemberRideView>(`/rides/${rideId}`, fetcher);
  const [onTime, setOnTime] = useState<OnTime | null>(null);
  const [feltSafe, setFeltSafe] = useState<boolean | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const [comments, setComments] = useState('');
  const [callback, setCallback] = useState(false);
  const { busy, error, run } = useSubmit();
  const router = useRouter();

  if (loadError) return <ErrorBox error={loadError} />;
  if (!data) return <Loading />;
  const driver = data.driver?.firstName ?? 'your driver';
  const you = forOffice ? data.member.preferredName : 'you';

  if (data.memberLogDone) {
    return (
      <>
        <BackBar href={backHref} />
        <main className="screen" id="main">
          <h1 className="title">Thank you</h1>
          <p className="lede">This trip has already been logged.</p>
        </main>
      </>
    );
  }

  async function send() {
    const res = await run(() => post<{ openConcern: boolean }>(`/rides/${rideId}/logs/member`, { onTime, feltSafe, rating, comments, callbackRequested: callback }));
    if (res) router.replace(res.openConcern ? concernHref : doneHref);
  }

  return (
    <>
      <BackBar href={backHref} crumb={forOffice ? `Trip log for ${data.member.preferredName}` : 'My lifts'} />
      <main className="screen" id="main">
        <div>
          <h1 className="title">How was {forOffice ? 'the' : 'your'} trip?</h1>
          <p className="lede">
            {dayLong(data.ride.pickupAt)} with {driver}
          </p>
        </div>
        <ErrorBox error={error} />
        <RadioCards legend={`Did the driver arrive on time?`} name="time" inline value={onTime} onChange={setOnTime} options={(Object.keys(ON_TIME) as OnTime[]).map((k) => ({ value: k, label: ON_TIME[k] }))} />
        <div className="stack-sm">
          <YesNo legend={`Did ${you} feel safe and looked after?`} name="safe" value={feltSafe} onChange={setFeltSafe} />
          {feltSafe === false ? (
            <div className="alert" role="status">
              <p>We’re sorry. Our safeguarding lead will be told today. On the next screen you can tell us what happened.</p>
            </div>
          ) : (
            <p className="small muted">If you answer No, we’ll let our safeguarding lead know.</p>
          )}
        </div>
        <fieldset className="q">
          <legend>How would you rate this trip? (optional)</legend>
          <div className="stars">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" aria-pressed={rating === n} aria-label={`${n} out of 5`} onClick={() => setRating(rating === n ? null : n)}>
                {n}
              </button>
            ))}
          </div>
          <div className="between small muted" style={{ maxWidth: 312 }}>
            <span>Very poor</span>
            <span>Very good</span>
          </div>
        </fieldset>
        <TextArea label="Is there anything you want to tell us?" placeholder="Optional" value={comments} onChange={(e) => setComments(e.target.value)} />
        <label className="check">
          <input type="checkbox" checked={callback} onChange={(e) => setCallback(e.target.checked)} /> Please ask someone to call {forOffice ? 'them' : 'me'}
        </label>
      </main>
      <div className="m-foot">
        <button className="btn btn-primary block" type="button" disabled={busy || !onTime || feltSafe === null} onClick={send}>
          {busy ? 'Sending…' : feltSafe === false ? 'Next' : 'Send'}
        </button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// F10 Concern report (stories 5.2, 5.3, 6.2). Safeguarding only.
// ---------------------------------------------------------------------------

export function ConcernForm({ rideId, pickupAt, backHref, doneHref }: { rideId: string; pickupAt?: string; backHref: string; doneHref: string }) {
  const [occurredWhen, setWhen] = useState(() => time(new Date()));
  const [occurredWhere, setWhere] = useState('');
  const [kinds, setKinds] = useState<ConcernKind[]>([]);
  const [whoInvolved, setWho] = useState('');
  const [description, setDescription] = useState('');
  const [actionTaken, setAction] = useState('');
  const [anyoneHurt, setHurt] = useState<boolean | null>(null);
  const [emergency, setEmergency] = useState<boolean | null>(null);
  const [familyTold, setFamily] = useState<YesNoUnsure | null>(null);
  const { busy, error, fields, run } = useSubmit();
  const [sent, setSent] = useState(false);
  const router = useRouter();

  async function send() {
    const ok = await run(() =>
      post('/concerns', { rideId, occurredWhen, occurredWhere, kinds, whoInvolved, description, actionTaken, anyoneHurt, emergencyServicesCalled: emergency, familyTold }),
    );
    if (ok) setSent(true);
  }

  if (sent) {
    return (
      <>
        <BackBar href={doneHref} />
        <main className="screen" id="main">
          <h1 className="title">Thank you</h1>
          <p className="lede">Your report has gone to the safeguarding lead. They have been told straight away and may contact you.</p>
          <button className="btn btn-primary block" type="button" onClick={() => router.replace(doneHref)}>
            Done
          </button>
        </main>
      </>
    );
  }

  return (
    <>
      <BackBar href={backHref} crumb={pickupAt ? `Lift on ${dayLong(pickupAt)}` : 'Report a concern'} />
      <main className="screen" id="main">
        <h1 className="title">Report a concern</h1>
        <div className="alert" role="note">
          <strong style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Alert /> If someone is in danger, call 999 first.
          </strong>
        </div>
        <ErrorBox error={error} />
        <div className="opt-row" style={{ gap: 12 }}>
          <div style={{ flex: 1 }}>
            <TextField label="When?" value={occurredWhen} onChange={(e) => setWhen(e.target.value)} error={fields.occurredWhen} />
          </div>
          <div style={{ flex: 1 }}>
            <TextField label="Where?" value={occurredWhere} onChange={(e) => setWhere(e.target.value)} error={fields.occurredWhere} placeholder="e.g. church car park" />
          </div>
        </div>
        <CheckCards legend="What kind of concern?" value={kinds} onChange={setKinds} error={fields.kinds} options={(Object.keys(CONCERN_KINDS) as ConcernKind[]).map((k) => ({ value: k, label: CONCERN_KINDS[k] }))} />
        <TextField label="Who was involved?" hint="Optional" value={whoInvolved} onChange={(e) => setWho(e.target.value)} />
        <TextArea label="Tell us what happened" hint="Facts only: what you saw and heard, in order." value={description} onChange={(e) => setDescription(e.target.value)} error={fields.description} rows={5} />
        <TextArea label="What did you do?" hint="Optional" value={actionTaken} onChange={(e) => setAction(e.target.value)} rows={2} />
        <YesNo legend="Was anyone hurt?" name="hurt" value={anyoneHurt} onChange={setHurt} error={fields.anyoneHurt} />
        <YesNo legend="Were emergency services called?" name="em" value={emergency} onChange={setEmergency} error={fields.emergencyServicesCalled} />
        <RadioCards legend="Has their family been told?" name="fam" inline value={familyTold} onChange={setFamily} error={fields.familyTold} options={(Object.keys(YES_NO_UNSURE) as YesNoUnsure[]).map((k) => ({ value: k, label: YES_NO_UNSURE[k] }))} />
      </main>
      <div className="m-foot">
        <button className="btn btn-danger-solid block" type="button" disabled={busy || anyoneHurt === null || emergency === null || !familyTold} onClick={send}>
          {busy ? 'Sending…' : 'Send to safeguarding'}
        </button>
        <p className="small muted" style={{ textAlign: 'center' }}>
          The safeguarding lead is told straight away. Only they can see this report.
        </p>
      </div>
    </>
  );
}

