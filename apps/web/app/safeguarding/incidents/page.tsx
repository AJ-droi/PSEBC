'use client';
import Link from 'next/link';
import useSWR from 'swr';
import { CONCERN_KINDS, labelList } from '@psebc/shared';
import { DesktopShell } from '@/components/shells';
import { Loading } from '@/components/ui';
import { Alert } from '@/components/icons';
import { fetcher } from '@/lib/api';
import { when } from '@/lib/format';

interface C {
  id: string;
  rideId: string;
  kinds: string[];
  reporterRole: string;
  reporterName: string;
  anyoneHurt: boolean;
  status: 'open' | 'reviewed';
  createdAt: string;
  reviewedAt: string | null;
  pickupAt: string;
  memberName: string;
  driverName: string | null;
}

/**
 * Safeguarding home: open incidents first (PRD §9 — incidents visible to safeguarding only;
 * story 6.2 — concerns reach the safeguarding lead straight away).
 */
export default function Incidents() {
  return <DesktopShell roles={['safeguarding']}>{() => <Inner />}</DesktopShell>;
}

function Inner() {
  const { data } = useSWR<{ concerns: C[] }>('/concerns', fetcher, { refreshInterval: 30_000 });
  const { data: summary } = useSWR<{ ready: number; pending_drivers: number }>('/safeguarding/summary', fetcher);
  const open = data?.concerns.filter((c) => c.status === 'open') ?? [];
  const reviewed = data?.concerns.filter((c) => c.status === 'reviewed') ?? [];

  return (
    <>
      <div className="d-head">
        <div>
          <h1 className="d-title">Incidents</h1>
          <p className="muted">
            {open.length ? `${open.length} open incident${open.length === 1 ? '' : 's'} to review` : 'No open incidents'}
            {summary ? ` · ${summary.ready} trip${summary.ready === 1 ? '' : 's'} ready to sign off · ${summary.pending_drivers} driver${summary.pending_drivers === 1 ? '' : 's'} to approve` : ''}
          </p>
        </div>
        <div className="row">
          <Link className="btn btn-secondary" href="/safeguarding">
            Sign-off queue
          </Link>
          <Link className="btn btn-secondary" href="/safeguarding/approvals">
            Driver approvals
          </Link>
        </div>
      </div>

      {!data ? <Loading /> : null}

      {data ? (
        <section aria-labelledby="open" className="stack">
          <h2 id="open" className="h2">
            Open incidents {open.length ? <span className="badge" style={{ background: 'var(--alert)', color: '#fff' }}>{open.length}</span> : null}
          </h2>
          {open.length === 0 ? (
            <div className="success">Nothing waiting. Every reported incident has been reviewed.</div>
          ) : (
            <div className="cols-2">
              {open.map((c) => (
                <article key={c.id} className="alert" aria-labelledby={`c-${c.id}`}>
                  <div className="between" style={{ alignItems: 'flex-start' }}>
                    <strong id={`c-${c.id}`} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: '1.0625rem' }}>
                      <Alert /> {labelList(CONCERN_KINDS, c.kinds).join(', ')}
                    </strong>
                    {c.anyoneHurt ? <span className="chip chip-incident">Someone hurt</span> : null}
                  </div>
                  <p>
                    {c.memberName}
                    {c.driverName ? ` with ${c.driverName.split(' ')[0]}` : ''} · lift on {when(c.pickupAt)}
                  </p>
                  <p className="small">
                    Reported by {c.reporterName} ({c.reporterRole}) · {when(c.createdAt)}
                  </p>
                  <Link className="btn btn-danger-solid sm" style={{ alignSelf: 'flex-start' }} href={`/safeguarding/trips/${c.rideId}`}>
                    Review now
                  </Link>
                </article>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {reviewed.length ? (
        <section className="section" aria-labelledby="done">
          <h2 id="done">Reviewed</h2>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Reported</th>
                  <th>Trip</th>
                  <th>Kind</th>
                  <th>By</th>
                  <th>Reviewed</th>
                </tr>
              </thead>
              <tbody>
                {reviewed.map((c) => (
                  <tr key={c.id}>
                    <td>{when(c.createdAt)}</td>
                    <td>
                      <Link href={`/safeguarding/trips/${c.rideId}`}>
                        {c.memberName}
                        {c.driverName ? ` with ${c.driverName.split(' ')[0]}` : ''} · {when(c.pickupAt)}
                      </Link>
                    </td>
                    <td>{labelList(CONCERN_KINDS, c.kinds).join(', ')}</td>
                    <td>
                      {c.reporterName} ({c.reporterRole})
                    </td>
                    <td>{c.reviewedAt ? when(c.reviewedAt) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}
