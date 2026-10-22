'use client';
import Link from 'next/link';
import useSWR from 'swr';
import { CONCERN_KINDS, labelList } from '@psebc/shared';
import { DesktopShell } from '@/components/shells';
import { Loading } from '@/components/ui';
import { fetcher } from '@/lib/api';
import { when } from '@/lib/format';

interface C {
  id: string;
  rideId: string;
  kinds: string[];
  reporterRole: string;
  reporterName: string;
  anyoneHurt: boolean;
  status: string;
  createdAt: string;
  pickupAt: string;
  memberName: string;
  driverName: string | null;
}

/** Incident reports — visible to safeguarding only (PRD §9). */
export default function Incidents() {
  const { data } = useSWR<{ concerns: C[] }>('/concerns', fetcher);
  return (
    <DesktopShell roles={['safeguarding']}>
      {() => (
        <>
          <h1 className="d-title">Incidents</h1>
          <section className="section">
            {!data ? (
              <Loading />
            ) : data.concerns.length === 0 ? (
              <p className="muted">No concerns have been reported.</p>
            ) : (
              <table className="data">
                <thead>
                  <tr>
                    <th>Reported</th>
                    <th>Trip</th>
                    <th>Kind</th>
                    <th>By</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.concerns.map((c) => (
                    <tr key={c.id}>
                      <td>{when(c.createdAt)}</td>
                      <td>
                        <Link href={`/safeguarding/trips/${c.rideId}`}>
                          {c.memberName}
                          {c.driverName ? ` with ${c.driverName.split(' ')[0]}` : ''} · {when(c.pickupAt)}
                        </Link>
                      </td>
                      <td>
                        {labelList(CONCERN_KINDS, c.kinds).join(', ')}
                        {c.anyoneHurt ? <span className="chip chip-cancelled" style={{ marginLeft: 6 }}>Hurt</span> : null}
                      </td>
                      <td>
                        {c.reporterName} ({c.reporterRole})
                      </td>
                      <td>{c.status === 'open' ? <span className="chip chip-cancelled">Open</span> : <span className="chip chip-approved">Reviewed</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </DesktopShell>
  );
}
