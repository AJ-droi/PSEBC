'use client';
import Link from 'next/link';
import { Suspense, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import { Pager, usePage } from '@/components/pager';
import { BOOKED_BY, CONTACT_METHODS, HEALTH_FLAGS, HELP_NEEDED, MOBILITY_AIDS, VEHICLE_REQUIREMENTS, formatUkPhone, labelList, type PageMeta } from '@psebc/shared';
import { DesktopShell } from '@/components/shells';
import { ErrorBox, KV, Loading, RideChip, Tags, TextArea, TextField } from '@/components/ui';
import { fetcher, post } from '@/lib/api';
import { useSubmit } from '@/lib/form';
import { date, when } from '@/lib/format';
import type { Me } from '@/lib/session';
import type { MemberProfile, RideCore } from '@/lib/types';

type Item = RideCore & { driverFirstName: string | null };

export default function MemberPage() {
  return (
    <DesktopShell roles={['coordinator', 'admin']}>
      {(me) => (
        <Suspense>
          <Inner me={me} />
        </Suspense>
      )}
    </DesktopShell>
  );
}

function Inner({ me }: { me: Me }) {
  const { id } = useParams<{ id: string }>();
  const sp = useSearchParams();
  const { data, error, mutate } = useSWR<{ member: MemberProfile }>(`/members/${id}`, fetcher);
  const history = usePage('/rides/history', { memberId: id }, 10);
  const { data: rides } = useSWR<{ rides: Item[]; pagination: PageMeta }>(history.key, fetcher, { keepPreviousData: true });
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const m = data.member;
  const closed = m.status === 'closed';
  return (
    <>
      <div className="d-head">
        <div>
          <p className="muted">
            <Link href="/office/members">Members</Link> / {m.fullName}
          </p>
          <h1 className="d-title">{m.fullName}</h1>
        </div>
        {!closed ? (
          <div className="row">
            <Link className="btn btn-secondary" href={`/office/members/${id}/needs`}>
              Update needs
            </Link>
            <Link className="btn btn-primary" href={`/office/book?memberId=${id}`}>
              Book a lift
            </Link>
          </div>
        ) : (
          <span className="chip chip-closed">Account closed</span>
        )}
      </div>
      {sp.get('created') ? <p className="success">Member added.{m.consentGiven ? '' : ' Lifts can’t be booked until consent is recorded.'}</p> : null}
      {sp.get('updated') ? <p className="success">Needs updated. The change is recorded in the audit trail.</p> : null}
      {!m.consentGiven && !closed ? (
        <div className="notice">
          <strong>Consent not recorded.</strong> This profile can’t be used for bookings until the member (or their representative) agrees to share their needs with the driver.{' '}
          <Link href={`/office/members/${id}/needs`}>Record consent</Link>
        </div>
      ) : null}
      {closed ? (
        <div className="alert">
          Closed on {date(m.closedAt!)}. Personal data will be deleted after {date(m.deleteAfter!)}.
        </div>
      ) : null}
      <div className="d-grid">
        <div className="stack-lg">
          <section className="section">
            <h2>Details</h2>
            <KV
              items={[
                ['Called', m.preferredName],
                ['Address', `${m.addressLine}, ${m.town} ${m.postcode}`],
                ['Finding them', m.findingNotes || '—'],
                ['Phone', formatUkPhone(m.phone)],
                ['Texts', m.canReceiveSms ? 'Yes' : 'No'],
                ['Contact by', CONTACT_METHODS[m.contactMethod as keyof typeof CONTACT_METHODS] ?? m.contactMethod],
                ['Usually booked by', BOOKED_BY[m.bookedBy as keyof typeof BOOKED_BY] ?? m.bookedBy],
                ['Emergency contact', `${m.emergencyName} (${m.emergencyRelationship}) · ${formatUkPhone(m.emergencyPhone)}`],
                ['Representative', m.hasRepresentative ? `${m.representativeName} · ${m.representativeRole} · ${formatUkPhone(m.representativePhone)}` : 'None'],
              ]}
            />
          </section>
          <section className="section">
            <h2>Needs and health</h2>
            <Tags items={[...labelList(MOBILITY_AIDS, m.mobilityAids), ...labelList(HELP_NEEDED, m.helpNeeded), VEHICLE_REQUIREMENTS[m.vehicleRequirement as keyof typeof VEHICLE_REQUIREMENTS]]} />
            {m.notesForDriver ? <p className="muted">Note for driver: {m.notesForDriver}</p> : null}
            <Tags tone="amber" items={labelList(HEALTH_FLAGS, m.healthFlags ?? [])} />
            {m.unwellInstructions ? <p className="muted">If unwell: {m.unwellInstructions}</p> : null}
            <p className="small muted">
              {m.consentGiven ? `Consent given by the ${m.consentGivenBy ?? 'member'} on ${date(m.consentRecordedAt!)}.` : 'Consent not recorded.'} Needs last updated {date(m.needsUpdatedAt)}.
            </p>
          </section>
          <section className="section">
            <h2>Lifts</h2>
            {!rides ? (
              <Loading />
            ) : (
              <table className="data">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Going to</th>
                    <th>Status</th>
                    <th>Driver</th>
                  </tr>
                </thead>
                <tbody>
                  {rides.rides.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <Link href={`/office/rides/${r.id}`}>{when(r.pickupAt)}</Link>
                      </td>
                      <td>{r.destination.replace('Princes Street Church: ', '')}</td>
                      <td>
                        <RideChip status={r.displayStatus} />
                      </td>
                      <td>{r.driverFirstName ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <Pager pagination={rides?.pagination} onPage={history.setPage} noun="lifts" />
          </section>
        </div>
        {me.user.role === 'admin' && !closed ? (
          <aside className="stack-lg">
            <CreateLogin memberId={id} name={m.fullName} />
            <CloseAccount memberId={id} name={m.preferredName} onDone={() => mutate()} />
          </aside>
        ) : null}
      </div>
    </>
  );
}

function CreateLogin({ memberId, name }: { memberId: string; name: string }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const { busy, error, fields, run } = useSubmit();
  if (done) return <p className="success">Login created. Give {name} their email and password in person.</p>;
  return (
    <section className="section">
      <h2>App login</h2>
      <p className="muted small">Only if they will use the app themselves. Members who don’t can be booked for by the office.</p>
      <ErrorBox error={error} />
      <TextField label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} error={fields.email} />
      <TextField label="Starting password" hint="At least 10 characters" value={password} onChange={(e) => setPassword(e.target.value)} error={fields.password} />
      <button className="btn btn-secondary" type="button" disabled={busy} onClick={async () => (await run(() => post('/admin/users', { email, password, fullName: name, role: 'member', memberId }))) && setDone(true)}>
        Create login
      </button>
    </section>
  );
}

/** F13 Close an account (story 1.5). */
function CloseAccount({ memberId, name, onDone }: { memberId: string; name: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const { busy, error, run } = useSubmit();
  return (
    <section className="section">
      <h2>Close account</h2>
      <p className="muted small">Login stops immediately, future lifts are cancelled and personal data is deleted after 12 months.</p>
      {!open ? (
        <button className="btn btn-danger" type="button" onClick={() => setOpen(true)}>
          Close {name}’s account
        </button>
      ) : (
        <>
          <ErrorBox error={error} />
          <TextArea label="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
          <div className="row">
            <button className="btn btn-danger-solid" type="button" disabled={busy} onClick={async () => (await run(() => post(`/members/${memberId}/close`, { reason }))) && onDone()}>
              Yes, close the account
            </button>
            <button className="btn btn-secondary" type="button" onClick={() => setOpen(false)}>
              Keep it open
            </button>
          </div>
        </>
      )}
    </section>
  );
}
