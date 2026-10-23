'use client';
import { useState } from 'react';
import useSWR from 'swr';
import { DesktopShell } from '@/components/shells';
import { Loading, SelectField } from '@/components/ui';
import { fetcher } from '@/lib/api';
import { Pager, usePage } from '@/components/pager';
import type { PageMeta } from '@psebc/shared';
import { when } from '@/lib/format';

interface E {
  id: number;
  at: string;
  actorName: string;
  actorRole: string;
  action: string;
  entityType: string;
  entityId: string | null;
  details: Record<string, unknown>;
}

/** Audit trail — who saw and changed what (PRD §4, §9). */
export default function Audit() {
  const [type, setType] = useState('');
  const { key, setPage } = usePage('/admin/audit', { entityType: type }, 50);
  const { data } = useSWR<{ entries: E[]; pagination: PageMeta }>(key, fetcher, { keepPreviousData: true });
  return (
    <DesktopShell roles={['safeguarding', 'admin']}>
      {() => (
        <>
          <div className="d-head">
            <h1 className="d-title">Audit trail</h1>
            <div style={{ minWidth: 240 }}>
              <SelectField label="Show" value={type} onChange={(e) => setType(e.target.value)} options={[{ value: '', label: 'Everything' }, { value: 'member', label: 'Members' }, { value: 'driver', label: 'Drivers' }, { value: 'ride', label: 'Lifts' }, { value: 'concern', label: 'Concerns' }, { value: 'user', label: 'Logins' }]} />
            </div>
          </div>
          <section className="section">
            {!data ? (
              <Loading />
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Who</th>
                      <th>What</th>
                      <th>Record</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.entries.map((e) => (
                      <tr key={e.id}>
                        <td style={{ whiteSpace: 'nowrap' }}>{when(e.at)}</td>
                        <td>
                          {e.actorName} <span className="muted small">({e.actorRole})</span>
                        </td>
                        <td>{e.action.replace('.', ': ').replace(/_/g, ' ')}</td>
                        <td className="small muted">
                          {e.entityType} {e.entityId?.slice(0, 8)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <Pager pagination={data?.pagination} onPage={setPage} noun="entries" />
          </section>
        </>
      )}
    </DesktopShell>
  );
}
