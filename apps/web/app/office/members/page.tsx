'use client';
import { formatUkPhone } from '@psebc/shared';
import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';
import { DesktopShell } from '@/components/shells';
import { Loading } from '@/components/ui';
import { fetcher } from '@/lib/api';

interface Row {
  id: string;
  fullName: string;
  preferredName: string;
  town: string;
  postcode: string;
  phone: string;
  consentGiven: boolean;
  status: string;
}

export default function Members() {
  return <DesktopShell roles={['coordinator', 'admin']}>{() => <Inner />}</DesktopShell>;
}

function Inner() {
  const [q, setQ] = useState('');
  const { data } = useSWR<{ members: Row[] }>(`/members?q=${encodeURIComponent(q)}`, fetcher);
  return (
    <>
      <div className="d-head">
        <h1 className="d-title">Members</h1>
        <Link className="btn btn-primary" href="/office/members/new">
          Add a member
        </Link>
      </div>
      <section className="section">
        <div className="field" style={{ maxWidth: 420 }}>
          <label className="label sm" htmlFor="q">
            Search by name
          </label>
          <input id="q" className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Start typing a name" />
        </div>
        {!data ? (
          <Loading />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Town</th>
                  <th>Phone</th>
                  <th>Consent</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.members.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <Link href={`/office/members/${m.id}`}>{m.fullName}</Link>
                    </td>
                    <td>
                      {m.town} {m.postcode}
                    </td>
                    <td>{formatUkPhone(m.phone)}</td>
                    <td>{m.consentGiven ? <span className="chip chip-approved">Recorded</span> : <span className="chip chip-pending">Needed</span>}</td>
                    <td>{m.status === 'active' ? 'Active' : <span className="chip chip-closed">Closed</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
