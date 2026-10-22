'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { HELP_CAPS, VEHICLE_CAPS, labelList, type DriverStatus } from '@psebc/shared';
import { fetcher, post } from '@/lib/api';
import { useSubmit } from '@/lib/form';
import { date } from '@/lib/format';
import type { DriverDetail } from '@/lib/types';
import { DriverChip, ErrorBox, KV, Loading, RadioCards, TextArea, TextField } from './ui';
import { MemberPicker } from './member-picker';

interface Row {
  id: string;
  fullName: string;
  status: DriverStatus;
  createdAt: string;
  expiresOn: string;
  expiringSoon: boolean;
  reapproval: boolean;
}

/** F03 Driver approval (stories 1.3 PSEBC-9, 1.4 PSEBC-10). Safeguarding lead only. */
export function ApprovalsWorkspace({ selectedId }: { selectedId?: string }) {
  const { data, mutate } = useSWR<{ drivers: Row[] }>('/drivers', fetcher);
  const pending = data?.drivers.filter((d) => d.status === 'pending') ?? [];
  const expiring = data?.drivers.filter((d) => d.expiringSoon || d.status === 'expired') ?? [];
  const others = data?.drivers.filter((d) => !pending.includes(d) && !expiring.includes(d) && d.status !== 'draft') ?? [];
  const link = (d: Row, sub: string) => (
    <Link key={d.id} className="list-link" href={`/safeguarding/approvals/${d.id}`} aria-current={d.id === selectedId ? 'true' : undefined}>
      <strong>{d.fullName}</strong>
      <span className="small muted">{sub}</span>
    </Link>
  );
  return (
    <div className="d-split">
      <aside className="section" style={{ padding: 16 }}>
        <h2>Waiting for a decision ({pending.length})</h2>
        {!data ? <Loading /> : null}
        {pending.map((d) => link(d, d.reapproval ? 'Details changed · re-approval' : `New driver · added ${date(d.createdAt)}`))}
        <h2 style={{ marginTop: 12 }}>Expiring in 30 days</h2>
        {expiring.length === 0 ? <p className="small muted">None</p> : null}
        {expiring.map((d) => link(d, d.status === 'expired' ? 'Expired' : `Expires ${date(d.expiresOn)}`))}
        <h2 style={{ marginTop: 12 }}>All drivers</h2>
        {others.map((d) => link(d, d.status))}
      </aside>
      {selectedId ? <Decision id={selectedId} onDone={() => mutate()} /> : <section className="section"><p className="muted">Choose a driver to review.</p></section>}
    </div>
  );
}

function Decision({ id, onDone }: { id: string; onDone: () => void }) {
  const { data, mutate } = useSWR<{ driver: DriverDetail; suggestedApprovedUntil: string }>(`/drivers/${id}`, fetcher);
  const [decision, setDecision] = useState<'approved' | 'rejected'>('approved');
  const [until, setUntil] = useState('');
  const [notes, setNotes] = useState('');
  const [excluded, setExcluded] = useState<{ id: string; name: string }[]>([]);
  const [done, setDone] = useState<string | null>(null);
  const { busy, error, fields, run } = useSubmit();

  useEffect(() => {
    if (data) {
      setUntil(data.suggestedApprovedUntil);
      setExcluded(data.driver.exclusions.map((e) => ({ id: e.memberId, name: e.name })));
      setNotes('');
      setDone(null);
    }
  }, [data]);

  if (!data) return <Loading />;
  const d = data.driver;
  const doc = (k: string) => d.documents.find((x) => x.kind === k);

  return (
    <section className="section">
      <div className="between">
        <div className="row">
          <span className="avatar lg" role="img" aria-label={`Photo of ${d.fullName}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {d.photoUrl ? <img src={d.photoUrl} alt="" /> : d.fullName.charAt(0)}
          </span>
          <div>
            <h1 className="d-title" style={{ fontSize: '1.75rem' }}>
              {d.fullName}
            </h1>
            <p className="muted">
              {d.postcode} · {d.phone}
            </p>
          </div>
        </div>
        <DriverChip status={d.status} />
      </div>
      {done ? <p className="success">{done}</p> : null}
      <h2>Checks</h2>
      <KV
        items={[
          ['DBS certificate', `${d.dbsNumber} · issued ${date(d.dbsIssueDate)} · renewal due ${date(d.dbsRenewalDate)}`],
          ['Driving licence', doc('licence') ? <a href={doc('licence')!.url}>{doc('licence')!.filename}</a> : <span className="field-error">Not uploaded</span>],
          ['Insurance', <>{doc('insurance') ? <a href={doc('insurance')!.url}>{doc('insurance')!.filename}</a> : <span className="field-error">Not uploaded</span>} · expires {date(d.insuranceExpiry)}</>],
        ]}
      />
      <h2>Vehicle and help</h2>
      <KV
        items={[
          ['Car', `${d.vehicleColour} ${d.vehicleMakeModel} · ${d.vehicleReg} · ${d.passengerSeats} passenger seats`],
          ['Can take', labelList(VEHICLE_CAPS, d.vehicleCaps).join(' · ') || '—'],
          ['Can help with', labelList(HELP_CAPS, d.helpCaps).join(' · ') || '—'],
        ]}
      />
      {d.decidedAt ? (
        <p className="small muted">
          Last decision by {d.decidedBy} on {date(d.decidedAt)}
          {d.decisionNotes ? ` · ${d.decisionNotes}` : ''}
        </p>
      ) : null}
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          const ok = await run(() => post(`/drivers/${id}/decision`, { decision, approvedUntil: decision === 'approved' ? until : undefined, excludedMemberIds: excluded.map((x) => x.id), notes }));
          if (ok) {
            setDone(decision === 'approved' ? `${d.fullName} is approved until ${date(until)}. They’ll now receive suitable lift requests.` : `${d.fullName} has been rejected. They won’t receive lift requests.`);
            mutate();
            onDone();
          }
        }}
      >
        <ErrorBox error={error} />
        <RadioCards legend="Decision" name="d" inline value={decision} onChange={setDecision} options={[{ value: 'approved', label: 'Approve' }, { value: 'rejected', label: 'Reject' }]} />
        {decision === 'approved' ? (
          <TextField label="Approved until" hint={`Set to the earliest check expiry (${date(data.suggestedApprovedUntil)}) or sooner.`} type="date" max={data.suggestedApprovedUntil} value={until} onChange={(e) => setUntil(e.target.value)} error={fields.approvedUntil} />
        ) : null}
        <div className="stack-sm">
          <MemberPicker label="Members not to match (optional)" action="Add" onPick={(mid) => fetch(`/api/members/${mid}`).then((r) => r.json()).then((j) => setExcluded((p) => (p.some((x) => x.id === mid) ? p : [...p, { id: mid, name: j.member.fullName }])))} />
          <p className="small muted">For example a family member or a past concern. This driver will never be invited for them.</p>
          {excluded.length ? (
            <ul className="tags">
              {excluded.map((x) => (
                <li key={x.id} className="tag amber">
                  {x.name}{' '}
                  <button type="button" className="link-btn" style={{ minHeight: 0 }} aria-label={`Remove ${x.name}`} onClick={() => setExcluded((p) => p.filter((y) => y.id !== x.id))}>
                    ×
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <TextArea label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        <button className="btn btn-primary" type="submit" disabled={busy}>
          Record decision
        </button>
        <p className="small muted">Your name and today’s date are saved with this decision.</p>
      </form>
    </section>
  );
}
