'use client';
import { useState } from 'react';
import useSWR from 'swr';
import type { Role } from '@psebc/shared';
import { DesktopShell } from '@/components/shells';
import { ErrorBox, Loading, SelectField, TextField } from '@/components/ui';
import { fetcher, post } from '@/lib/api';
import { useSubmit } from '@/lib/form';
import { when } from '@/lib/format';

interface U {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  status: string;
  mfaEnabled: boolean;
  lastLoginAt: string | null;
}

/** Individual logins for every role (PRD §10). Member and driver logins are created from their profiles. */
export default function Users() {
  return <DesktopShell roles={['admin']}>{() => <Inner />}</DesktopShell>;
}

function Inner() {
  const { data, mutate } = useSWR<{ users: U[] }>('/admin/users', fetcher);
  const [form, setForm] = useState({ email: '', fullName: '', role: 'coordinator', password: '' });
  const { busy, error, fields, run } = useSubmit();
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <>
      <h1 className="d-title">Logins</h1>
      {msg ? <p className="success">{msg}</p> : null}
      <div className="d-grid">
        <section className="section">
          {!data ? (
            <Loading />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Security code</th>
                    <th>Last sign-in</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.users.map((u) => (
                    <tr key={u.id}>
                      <td>{u.fullName}</td>
                      <td>{u.email}</td>
                      <td style={{ textTransform: 'capitalize' }}>{u.role}</td>
                      <td>{u.role === 'admin' || u.role === 'safeguarding' ? (u.mfaEnabled ? 'Set up' : 'Not set up') : '—'}</td>
                      <td>{u.lastLoginAt ? when(u.lastLoginAt) : 'Never'}</td>
                      <td>
                        {u.status === 'active' ? (
                          <div className="row" style={{ gap: 4 }}>
                            <button
                              className="link-btn"
                              type="button"
                              onClick={async () => {
                                const pw = window.prompt(`New password for ${u.fullName} (at least 10 characters)`);
                                if (!pw) return;
                                const ok = await run(() => post(`/admin/users/${u.id}/reset-password`, { password: pw }));
                                if (ok) setMsg(`Password reset for ${u.fullName}. Their other sessions have been signed out.`);
                              }}
                            >
                              Reset password
                            </button>
                            {u.mfaEnabled ? (
                              <button
                                className="link-btn"
                                type="button"
                                onClick={async () => {
                                  const ok = await run(() => post(`/admin/users/${u.id}/reset-mfa`));
                                  if (ok) {
                                    setMsg(`${u.fullName} will set up a new security code next time they sign in.`);
                                    mutate();
                                  }
                                }}
                              >
                                Reset security code
                              </button>
                            ) : null}
                          </div>
                        ) : (
                          <span className="chip chip-closed">Closed</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <aside className="section">
          <h2>Add a staff login</h2>
          <p className="small muted">For the church office, admin and safeguarding. Admin and safeguarding set up a security code on first sign-in.</p>
          <ErrorBox error={error} />
          <TextField label="Full name" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} error={fields.fullName} />
          <TextField label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} error={fields.email} />
          <SelectField label="Role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} options={[{ value: 'coordinator', label: 'Booking coordinator' }, { value: 'admin', label: 'Admin' }, { value: 'safeguarding', label: 'Safeguarding (lead or delegate)' }]} />
          <TextField label="Starting password" hint="At least 10 characters" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} error={fields.password} />
          <button
            className="btn btn-primary"
            type="button"
            disabled={busy}
            onClick={async () => {
              const ok = await run(() => post('/admin/users', form));
              if (ok) {
                setMsg(`Login created for ${form.fullName}.`);
                setForm({ email: '', fullName: '', role: 'coordinator', password: '' });
                mutate();
              }
            }}
          >
            Create login
          </button>
        </aside>
      </div>
    </>
  );
}
