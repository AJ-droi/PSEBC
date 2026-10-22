'use client';
import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';
import { CONCERN_KINDS, ON_TIME, SIGNOFF_OUTCOMES, YES_NO_UNSURE, labelList, type OnTime, type SignoffOutcome, type YesNoUnsure } from '@psebc/shared';
import { fetcher, post } from '@/lib/api';
import { useSubmit } from '@/lib/form';
import { dayLong, time, when } from '@/lib/format';
import { ErrorBox, Loading, RideChip, SelectField, Tags, TextArea } from './ui';
import type { RideStatus } from '@psebc/shared';

interface QueueItem {
  id: string;
  status: RideStatus;
  pickupAt: string;
  memberName: string;
  driverName: string | null;
  driverLogged: boolean;
  memberLogged: boolean;
  missingLogNote: string | null;
  openConcerns: number;
  concerns: number;
  ready: boolean;
}

interface Concern {
  id: string;
  reporterRole: string;
  reporterName: string;
  occurredWhen: string;
  occurredWhere: string;
  kinds: string[];
  whoInvolved: string;
  description: string;
  actionTaken: string;
  anyoneHurt: boolean;
  emergencyServicesCalled: boolean;
  familyTold: string;
  status: 'open' | 'reviewed';
  reviewedBy: string | null;
  reviewedAt: string | null;
  outcome: string | null;
  reviewNotes: string | null;
  createdAt: string;
}

interface TripRecord {
  trip: { id: string; status: RideStatus; pickupAt: string; destination: string; pickedUpAt: string | null; droppedOffAt: string | null; notAtPickupAt: string | null; returnAt: string | null; missingLogNote: string | null; signedOffAt: string | null; signedOffBy: string | null; signoffOutcome: string | null; signoffNotes: string | null };
  member: { id: string; name: string; preferredName: string; needs: string[] };
  driver: { name: string; phone: string } | null;
  logs: { author: 'driver' | 'member'; wentAsPlanned: boolean | null; anythingToReport: boolean | null; needsChanged: boolean | null; onTime: string | null; feltSafe: boolean | null; rating: number | null; callbackRequested: boolean; comments: string; submittedByRole: string }[];
  concerns: Concern[];
}

/** F11 Safeguarding sign-off (stories 4.3, 6.1, 6.2) — desktop, safeguarding lead only. */
export function SignoffWorkspace({ selectedId }: { selectedId?: string }) {
  const { data: queue, mutate: refreshQueue } = useSWR<{ trips: QueueItem[] }>('/safeguarding/queue', fetcher, { refreshInterval: 60_000 });
  const ready = queue?.trips.filter((t) => t.ready) ?? [];
  const waiting = queue?.trips.filter((t) => !t.ready) ?? [];
  return (
    <div className="d-split">
      <aside className="section" style={{ padding: 16 }}>
        <h2>Waiting for sign-off ({ready.length})</h2>
        {!queue ? <Loading /> : null}
        {queue && ready.length === 0 ? <p className="muted small">Nothing waiting. Well done.</p> : null}
        {ready.map((t) => (
          <QueueLink key={t.id} t={t} selected={t.id === selectedId} />
        ))}
        {waiting.length ? (
          <>
            <h2 style={{ marginTop: 12 }}>Waiting for logs ({waiting.length})</h2>
            {waiting.map((t) => (
              <QueueLink key={t.id} t={t} selected={t.id === selectedId} />
            ))}
          </>
        ) : null}
      </aside>
      {selectedId ? <TripDetail id={selectedId} onChange={() => refreshQueue()} /> : <section className="section"><p className="muted">Choose a trip to review.</p></section>}
    </div>
  );
}

function QueueLink({ t, selected }: { t: QueueItem; selected: boolean }) {
  return (
    <Link className="list-link" href={`/safeguarding/trips/${t.id}`} aria-current={selected ? 'true' : undefined}>
      <span className="between">
        <strong>
          {t.memberName}
          {t.driverName ? ` · ${t.driverName}` : ''}
        </strong>
        {t.openConcerns ? <span className="chip chip-cancelled">Concern</span> : null}
      </span>
      <span className="small muted">
        {when(t.pickupAt)} · {t.missingLogNote ? t.missingLogNote : t.driverLogged && t.memberLogged ? 'both logs in' : `waiting for ${!t.driverLogged ? 'driver' : 'member'} log`}
      </span>
    </Link>
  );
}

const yn = (v: boolean | null) => (v === true ? 'Yes' : v === false ? 'No' : '—');

function TripDetail({ id, onChange }: { id: string; onChange: () => void }) {
  const { data, error, mutate } = useSWR<TripRecord>(`/safeguarding/trips/${id}`, fetcher);
  const [outcome, setOutcome] = useState<SignoffOutcome>('no_action');
  const [notes, setNotes] = useState('');
  const { busy, error: submitError, run } = useSubmit();
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const t = data.trip;
  const driverLog = data.logs.find((l) => l.author === 'driver');
  const memberLog = data.logs.find((l) => l.author === 'member');
  const open = data.concerns.filter((c) => c.status === 'open');
  const driverFirst = data.driver?.name.split(' ')[0] ?? 'the driver';

  return (
    <section className="section">
      <div className="between">
        <h1 className="d-title" style={{ fontSize: '1.75rem' }}>
          {data.member.preferredName} with {driverFirst}
        </h1>
        <RideChip status={t.status} />
      </div>
      <p className="muted">
        {dayLong(t.pickupAt)}
        {t.pickedUpAt ? ` · Picked up ${time(t.pickedUpAt)}` : ''}
        {t.droppedOffAt ? ` · Dropped off ${time(t.droppedOffAt)}` : ''}
        {t.notAtPickupAt ? ` · Not at pickup reported ${time(t.notAtPickupAt)}` : ''}
      </p>
      {t.missingLogNote ? <p className="notice">{t.missingLogNote}</p> : null}
      <div className="cols-2">
        <div className="panel">
          <strong>Driver log</strong>
          {driverLog ? (
            <p>
              {driverLog.wentAsPlanned ? 'Went as planned' : 'Did not go as planned'} · {driverLog.anythingToReport ? 'Concern reported' : 'Nothing to report'}
              {driverLog.needsChanged ? ' · Needs may have changed' : ''}
              {driverLog.comments ? <span className="muted"> · “{driverLog.comments}”</span> : null}
            </p>
          ) : (
            <p className="muted">Missing</p>
          )}
        </div>
        <div className="panel">
          <strong>Member log</strong>
          {memberLog ? (
            <p>
              {ON_TIME[memberLog.onTime as OnTime] === 'Yes' ? 'On time' : `On time: ${ON_TIME[memberLog.onTime as OnTime] ?? '—'}`} · {memberLog.feltSafe ? 'Felt safe' : 'Did NOT feel safe'}
              {memberLog.rating ? ` · Rated ${memberLog.rating}` : ''}
              {memberLog.submittedByRole !== 'member' ? ' · completed by the office' : ''}
              {memberLog.comments ? <span className="muted"> · “{memberLog.comments}”</span> : null}
            </p>
          ) : (
            <p className="muted">Missing</p>
          )}
        </div>
      </div>
      <div className="stack-sm">
        <strong>Needs on this trip</strong>
        <Tags items={data.member.needs} />
      </div>

      {data.concerns.map((c) => (
        <ConcernCard key={c.id} c={c} onReviewed={() => { mutate(); onChange(); }} />
      ))}

      {t.status === 'signed_off' ? (
        <p className="success">
          Signed off by {t.signedOffBy} on {when(t.signedOffAt!)}. {data.driver ? `${driverFirst} no longer has access to ${data.member.preferredName}’s details.` : ''}
        </p>
      ) : t.status === 'logged' ? (
        <div className="stack">
          <ErrorBox error={submitError} />
          <SelectField label="Outcome" value={outcome} onChange={(e) => setOutcome(e.target.value as SignoffOutcome)} options={(Object.keys(SIGNOFF_OUTCOMES) as SignoffOutcome[]).map((k) => ({ value: k, label: SIGNOFF_OUTCOMES[k] }))} />
          <TextArea label="Review notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          <button
            className="btn btn-primary"
            type="button"
            disabled={busy || open.length > 0}
            onClick={async () => {
              const ok = await run(() => post(`/safeguarding/trips/${id}/signoff`, { outcome, notes }));
              if (ok) {
                mutate();
                onChange();
              }
            }}
          >
            Sign off this trip
          </button>
          <p className="small muted">{open.length ? 'Review the concern before signing off.' : `This ends ${driverFirst}’s access to ${data.member.preferredName}’s details. Your name and today’s date are recorded.`}</p>
        </div>
      ) : (
        <p className="muted">This trip is not ready for sign-off yet. It needs both logs, or 72 hours after completion.</p>
      )}
    </section>
  );
}

function ConcernCard({ c, onReviewed }: { c: Concern; onReviewed: () => void }) {
  const [reviewed, setReviewed] = useState(false);
  const [outcome, setOutcome] = useState<SignoffOutcome>('follow_up');
  const [notes, setNotes] = useState('');
  const { busy, error, run } = useSubmit();
  return (
    <div className={c.status === 'open' ? 'alert' : 'panel'}>
      <strong>
        Concern reported by {c.reporterName} ({c.reporterRole}) · {labelList(CONCERN_KINDS, c.kinds).join(', ')} · {c.occurredWhen}, {c.occurredWhere}
      </strong>
      <p style={{ whiteSpace: 'pre-wrap' }}>{c.description}</p>
      {c.actionTaken ? <p>Action taken: {c.actionTaken}</p> : null}
      {c.whoInvolved ? <p>Who was involved: {c.whoInvolved}</p> : null}
      <p className="small">
        {c.anyoneHurt ? 'Someone was hurt' : 'No one hurt'} · Emergency services {c.emergencyServicesCalled ? 'called' : 'not called'} · Family told: {YES_NO_UNSURE[c.familyTold as YesNoUnsure] ?? c.familyTold}
      </p>
      {c.status === 'reviewed' ? (
        <p className="small">
          Reviewed by {c.reviewedBy} on {when(c.reviewedAt!)} · {SIGNOFF_OUTCOMES[c.outcome as SignoffOutcome] ?? c.outcome}
          {c.reviewNotes ? ` · ${c.reviewNotes}` : ''}
        </p>
      ) : (
        <div className="stack" style={{ background: 'var(--surface)', padding: 12, borderRadius: 12 }}>
          <ErrorBox error={error} />
          <label className="check">
            <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} /> I have reviewed this concern
          </label>
          <SelectField label="Outcome" value={outcome} onChange={(e) => setOutcome(e.target.value as SignoffOutcome)} options={(Object.keys(SIGNOFF_OUTCOMES) as SignoffOutcome[]).map((k) => ({ value: k, label: SIGNOFF_OUTCOMES[k] }))} />
          <TextArea label="Review notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          <button className="btn btn-primary sm" type="button" disabled={!reviewed || busy} onClick={async () => (await run(() => post(`/concerns/${c.id}/review`, { outcome, notes }))) && onReviewed()}>
            Mark as reviewed
          </button>
          <p className="small muted">The app records the concern. It doesn’t replace the church’s safeguarding procedure.</p>
        </div>
      )}
    </div>
  );
}
