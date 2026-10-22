'use client';
import Link from 'next/link';
import { Suspense, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import { DesktopShell } from '@/components/shells';
import { DriverForm } from '@/components/driver-form';
import { DriverChip, ErrorBox, Loading, TextArea, TextField } from '@/components/ui';
import { fetcher, post } from '@/lib/api';
import { useSubmit } from '@/lib/form';
import { date } from '@/lib/format';
import type { DriverDetail } from '@/lib/types';


export default function DriverPage() {
  return (
    <DesktopShell roles={['admin']}>
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
  const saved = useSearchParams().get('saved');
  const { data, error, mutate } = useSWR<{ driver: DriverDetail }>(`/drivers/${id}`, fetcher);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const d = data.driver;
  return (
    <>
      <div className="d-head">
        <div>
          <p className="muted">
            <Link href="/office/drivers">Drivers</Link> / {d.fullName}
          </p>
          <h1 className="d-title">{d.fullName}</h1>
          <p className="muted">
            {d.status === 'approved' && d.approvedUntil ? `Approved until ${date(d.approvedUntil)} by ${d.decidedBy}` : null}
            {d.loneWorkingAcknowledgedAt ? ` · Lone-working guidance confirmed ${date(d.loneWorkingAcknowledgedAt)}` : ' · Lone-working guidance not yet confirmed'}
          </p>
        </div>
        <DriverChip status={d.status} />
      </div>
      {saved ? <p className="success">Saved.{d.status === 'pending' ? ' Safeguarding has been asked to review.' : ''}</p> : null}
      <section className="section">
        <h2>Evidence on file</h2>
        <ul className="stack-sm" style={{ margin: 0, paddingLeft: 20 }}>
          {['photo', 'licence', 'insurance'].map((k) => {
            const doc = d.documents.find((x) => x.kind === k);
            return (
              <li key={k}>
                <strong style={{ textTransform: 'capitalize' }}>{k}</strong>: {doc ? <a href={doc.url}>{doc.filename}</a> : <span className="muted">not uploaded</span>}
                {doc ? <span className="muted small"> · {date(doc.uploadedAt)}</span> : null}
              </li>
            );
          })}
        </ul>
      </section>
      {d.status !== 'closed' ? (
        <>
          <DriverForm
            driverId={id}
            status={d.status}
            initial={{
              fullName: d.fullName,
              phone: d.phone,
              email: d.email,
              postcode: d.postcode,
              dbsNumber: d.dbsNumber,
              dbsIssueDate: d.dbsIssueDate,
              dbsRenewalDate: d.dbsRenewalDate,
              insuranceExpiry: d.insuranceExpiry,
              vehicleMakeModel: d.vehicleMakeModel,
              vehicleColour: d.vehicleColour,
              vehicleReg: d.vehicleReg,
              passengerSeats: d.passengerSeats,
              vehicleCaps: d.vehicleCaps,
              helpCaps: d.helpCaps,
            }}
          />
          <div className="cols-2">
            <DriverLogin driverId={id} name={d.fullName} email={d.email} phone={d.phone} />
            <CloseDriver driverId={id} name={d.fullName} onDone={() => mutate()} />
          </div>
        </>
      ) : (
        <p className="alert">This volunteer has left the scheme.</p>
      )}
    </>
  );
}

function DriverLogin({ driverId, name, email: initialEmail, phone }: { driverId: string; name: string; email: string; phone: string }) {
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const { busy, error, fields, run } = useSubmit();
  if (done) return <p className="success">Login created for {name}.</p>;
  return (
    <section className="section">
      <h2>App login</h2>
      <ErrorBox error={error} />
      <TextField label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} error={fields.email} />
      <TextField label="Starting password" hint="At least 10 characters" value={password} onChange={(e) => setPassword(e.target.value)} error={fields.password} />
      <button className="btn btn-secondary" type="button" disabled={busy} onClick={async () => (await run(() => post('/admin/users', { email, password, fullName: name, role: 'driver', driverId, phone }))) && setDone(true)}>
        Create login
      </button>
    </section>
  );
}

function CloseDriver({ driverId, name, onDone }: { driverId: string; name: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const { busy, error, run } = useSubmit();
  return (
    <section className="section">
      <h2>Volunteer leaving</h2>
      <p className="muted small">Login stops immediately, their accepted lifts are offered to other drivers, and personal data is deleted after 12 months.</p>
      {!open ? (
        <button className="btn btn-danger" type="button" onClick={() => setOpen(true)}>
          Close {name}’s account
        </button>
      ) : (
        <>
          <ErrorBox error={error} />
          <TextArea label="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
          <div className="row">
            <button className="btn btn-danger-solid" type="button" disabled={busy} onClick={async () => (await run(() => post(`/drivers/${driverId}/close`, { reason }))) && onDone()}>
              Yes, close the account
            </button>
            <button className="btn btn-secondary" type="button" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </>
      )}
    </section>
  );
}
