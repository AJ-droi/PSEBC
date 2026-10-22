'use client';
import Link from 'next/link';
import useSWR from 'swr';
import { BackBar, Loading } from '@/components/ui';
import { RoleGate } from '@/components/shells';
import { fetcher, post } from '@/lib/api';
import { when } from '@/lib/format';
import { homeFor } from '@/lib/session';

interface N {
  id: string;
  title: string;
  body: string;
  link: string | null;
  channel: string;
  readAt: string | null;
  createdAt: string;
}

export default function Notifications() {
  const { data, mutate } = useSWR<{ notifications: N[] }>('/notifications', fetcher);
  return (
    <div className="mobile">
      <RoleGate roles={['member', 'driver', 'coordinator', 'admin', 'safeguarding']}>
        {(me) => (
          <>
            <BackBar href={homeFor(me.user.role)} crumb="Messages" />
            <main className="screen" id="main">
              <div className="between">
                <h1 className="title">Messages</h1>
                <button
                  type="button"
                  className="link-btn"
                  onClick={async () => {
                    await post('/notifications/read-all');
                    mutate();
                  }}
                >
                  Mark all read
                </button>
              </div>
              {!data ? <Loading /> : null}
              {data?.notifications.length === 0 ? <p className="muted">No messages yet.</p> : null}
              <div className="stack">
                {data?.notifications.map((n) => (
                  <Link
                    key={n.id}
                    href={n.link ?? '#'}
                    className={`card${n.readAt ? '' : ' highlight'}`}
                    onClick={() => {
                      if (!n.readAt) post(`/notifications/${n.id}/read`).catch(() => undefined);
                    }}
                  >
                    <div className="between">
                      <strong>{n.title}</strong>
                      <span className="small muted">{when(n.createdAt)}</span>
                    </div>
                    <span className="muted">{n.body}</span>
                    {n.channel === 'phone_task' ? <span className="chip chip-invites_sent" style={{ alignSelf: 'flex-start' }}>Phone call needed</span> : null}
                  </Link>
                ))}
              </div>
            </main>
          </>
        )}
      </RoleGate>
    </div>
  );
}
