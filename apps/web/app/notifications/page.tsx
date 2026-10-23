'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { chime, enablePushAlerts, pushState, setSoundEnabled, soundEnabled, type PushState } from '@/lib/alerts';
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
              <AlertSettings />
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

const PUSH_TEXT: Record<PushState, string> = {
  on: 'On for this device',
  off: 'Off',
  denied: 'Blocked in this browser’s settings',
  unsupported: 'Not available in this browser. On iPhone, add PSEBC Lifts to your Home Screen first.',
  unavailable: 'Not set up by the church yet',
};

/** Sound and phone-alert settings for this device. */
function AlertSettings() {
  const [sound, setSound] = useState(true);
  const [push, setPush] = useState<PushState | null>(null);
  useEffect(() => {
    setSound(soundEnabled());
    pushState().then(setPush).catch(() => setPush('unsupported'));
  }, []);
  return (
    <section className="panel" aria-labelledby="alerts-h">
      <h2 id="alerts-h" className="h3">
        Alerts on this device
      </h2>
      <label className="check">
        <input
          type="checkbox"
          checked={sound}
          onChange={(e) => {
            setSound(e.target.checked);
            setSoundEnabled(e.target.checked);
            if (e.target.checked) chime();
          }}
        />{' '}
        Play a sound for new messages
      </label>
      <div className="row">
        <button type="button" className="btn btn-secondary sm" onClick={() => chime()} disabled={!sound}>
          Test the sound
        </button>
      </div>
      <p className="small">
        <strong>Alerts when the app is closed:</strong> {push ? PUSH_TEXT[push] : 'Checking…'}
      </p>
      {push === 'off' ? (
        <button type="button" className="btn btn-primary sm" style={{ alignSelf: 'flex-start' }} onClick={async () => setPush(await enablePushAlerts())}>
          Turn on alerts
        </button>
      ) : null}
    </section>
  );
}
