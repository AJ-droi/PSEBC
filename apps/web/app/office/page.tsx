'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import type { RideStatus } from '@psebc/shared';
import { DesktopShell } from '@/components/shells';
import { ErrorBox, Loading, RideChip } from '@/components/ui';
import { fetcher, post } from '@/lib/api';
import { dayShort, time, when } from '@/lib/format';
import { MemberPicker } from '@/components/member-picker';

interface Overview {
  week: { from: string; to: string };
  attention: { type: 'no_driver' | 'not_at_pickup' | 'phone_log'; rideId: string; memberId?: string; memberName: string; phone: string; emergencyPhone?: string; pickupAt: string; detail: string }[];
  tasks: { id: string; title: string; body: string; link: string | null; createdAt: string }[];
  upcoming: { id: string; memberName: string; pickupAt: string; destination: string; status: RideStatus; statusLabel: string; driverName: string | null; bookedBy: string }[];
}

const LABELS = { no_driver: 'No driver yet', not_at_pickup: 'Not at pickup', phone_log: 'Trip log by phone' };

/** Church office "Lifts this week" (design O-Coordinator). */
export default function Office() {
  return <DesktopShell roles={['coordinator', 'admin']}>{() => <Inner />}</DesktopShell>;
}

function Inner() {
  const [offset, setOffset] = useState(0);
  const from = startOfWeek(offset);
  const { data, error, mutate } = useSWR<Overview>(`/office/overview?from=${from.toISOString()}`, fetcher, { refreshInterval: 30_000 });
  const router = useRouter();
  const [resent, setResent] = useState<string | null>(null);

  return (
    <>
      <div className="d-head">
        <div>
          <h1 className="d-title">Lifts this week</h1>
          <p className="muted">
            {dayShort(from)} – {dayShort(new Date(from.getTime() + 6 * 86_400_000))}
            <span className="row" style={{ display: 'inline-flex', marginLeft: 12, gap: 4 }}>
              <button type="button" className="link-btn" onClick={() => setOffset(offset - 1)}>
                Previous week
              </button>
              ·
              <button type="button" className="link-btn" onClick={() => setOffset(offset + 1)}>
                Next week
              </button>
            </span>
          </p>
        </div>
        <MemberPicker label="Book a lift for a member" action="Start booking" onPick={(id) => router.push(`/office/book?memberId=${id}`)} />
      </div>
      <ErrorBox error={error} />
      {!data ? <Loading /> : null}
      {data ? (
        <div className="d-grid">
          <section className="section" aria-labelledby="up">
            <div className="between">
              <h2 id="up">Upcoming lifts</h2>
              <span className="muted">{data.upcoming.length} lifts</span>
            </div>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>When</th>
                    <th>Going to</th>
                    <th>Status</th>
                    <th>Driver</th>
                    <th>Booked by</th>
                  </tr>
                </thead>
                <tbody>
                  {data.upcoming.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <Link href={`/office/rides/${r.id}`}>{r.memberName}</Link>
                      </td>
                      <td>{when(r.pickupAt)}</td>
                      <td>{r.destination.replace('Princes Street Church: ', '')}</td>
                      <td>
                        <RideChip status={r.status} />
                      </td>
                      <td>{r.driverName ?? '—'}</td>
                      <td>{r.bookedBy}</td>
                    </tr>
                  ))}
                  {data.upcoming.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="muted">
                        No lifts this week.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>

          <section className="section" aria-labelledby="att">
            <h2 id="att">
              Needs attention <span className="badge">{data.attention.length + data.tasks.length}</span>
            </h2>
            {resent ? <p className="success">{resent}</p> : null}
            {data.attention.length + data.tasks.length === 0 ? <p className="muted">Nothing needs you right now.</p> : null}
            {data.attention.map((a) => (
              <div key={a.type + a.rideId} className={`attention${a.type === 'not_at_pickup' ? ' red' : ''}`}>
                <strong>{LABELS[a.type]}</strong>
                <span>
                  <Link href={`/office/rides/${a.rideId}`}>{a.memberName}</Link> · {a.type === 'not_at_pickup' ? `today ${time(a.pickupAt)}` : when(a.pickupAt)}
                </span>
                <span className="small">{a.detail}</span>
                <div className="row">
                  <a className="btn btn-secondary sm" href={`tel:${a.phone.replace(/\s/g, '')}`}>
                    Call {a.memberName.split(' ')[0]}
                  </a>
                  {a.type === 'no_driver' ? (
                    <button
                      className="btn btn-primary sm"
                      type="button"
                      onClick={async () => {
                        const r = await post<{ invited: number }>(`/rides/${a.rideId}/resend-invites`).catch(() => null);
                        setResent(r ? (r.invited ? `Invites sent to ${r.invited} more driver(s).` : 'No other eligible drivers. Consider asking a driver directly.') : 'Could not re-send.');
                        mutate();
                      }}
                    >
                      Re-send invites
                    </button>
                  ) : null}
                  {a.type === 'not_at_pickup' && a.emergencyPhone ? (
                    <a className="btn btn-secondary sm" href={`tel:${a.emergencyPhone.replace(/\s/g, '')}`}>
                      Call emergency contact
                    </a>
                  ) : null}
                  {a.type === 'phone_log' ? (
                    <Link className="btn btn-primary sm" href={`/office/rides/${a.rideId}/log`}>
                      Fill in log
                    </Link>
                  ) : null}
                </div>
              </div>
            ))}
            {data.tasks.map((t) => (
              <div key={t.id} className="attention">
                <strong>{t.title}</strong>
                <span className="small">{t.body}</span>
                <div className="row">
                  {t.link ? (
                    <Link className="btn btn-secondary sm" href={t.link.replace('/member/rides/', '/office/rides/')}>
                      Open
                    </Link>
                  ) : null}
                  <button
                    className="btn btn-primary sm"
                    type="button"
                    onClick={async () => {
                      await post(`/notifications/${t.id}/read`);
                      mutate();
                    }}
                  >
                    Done
                  </button>
                </div>
              </div>
            ))}
          </section>
        </div>
      ) : null}
    </>
  );
}

function startOfWeek(offset: number): Date {
  const d = new Date();
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + offset * 7);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}
