'use client';
import { useEffect, useRef, useState } from 'react';
import { useSWRConfig } from 'swr';
import { chime, dismissPrompt, enablePushAlerts, promptDismissed, pushState, unlockAudioOnFirstTap, type PushState } from '@/lib/alerts';
import { Bell } from './icons';

/** The bell only needs the unread count and the newest few messages. */
export const BELL_KEY = '/notifications?pageSize=5';

const URGENT = new Set(['not_at_pickup', 'concern', 'felt_unsafe', 'invite']);

interface Inbox {
  unread: number;
  notifications: { kind: string; readAt: string | null }[];
}

/**
 * Plays the chime when the unread count goes up while the app is open, and
 * refreshes the inbox the moment a push arrives (so there's one sound, not two).
 */
export function useMessageAlerts(inbox: Inbox | undefined): void {
  const previous = useRef<number | null>(null);
  const { mutate } = useSWRConfig();

  useEffect(() => unlockAudioOnFirstTap(), []);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onMessage = (e: MessageEvent) => {
      if ((e.data as { type?: string })?.type === 'psebc-push') void mutate(BELL_KEY);
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [mutate]);

  useEffect(() => {
    if (!inbox) return;
    const before = previous.current;
    previous.current = inbox.unread;
    if (before === null || inbox.unread <= before) return; // first load or nothing new
    const newest = inbox.notifications.find((n) => !n.readAt);
    chime({ urgent: !!newest && URGENT.has(newest.kind) });
  }, [inbox]);
}

/** One-time banner offering phone/desktop alerts. Re-registers silently if already allowed. */
export function AlertsPrompt({ inset = false }: { inset?: boolean }) {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let alive = true;
    pushState()
      .then(async (s) => {
        // Already allowed on this device: make sure it's linked to whoever is signed in now.
        if (s === 'on' || (s === 'off' && typeof Notification !== 'undefined' && Notification.permission === 'granted')) s = await enablePushAlerts();
        if (alive) setState(s);
      })
      .catch(() => alive && setState('unsupported'));
    return () => {
      alive = false;
    };
  }, []);

  if (hidden || state !== 'off' || promptDismissed()) return null;
  return (
    <div className="notice" role="region" aria-label="Message alerts" style={{ margin: inset ? '8px 16px 0' : 0 }}>
      <div className="h3" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Bell /> Get an alert when you have a new message
      </div>
      <p>Your phone will make a sound, even when PSEBC Lifts is closed. Alerts never show names or addresses.</p>
      <div className="row">
        <button
          type="button"
          className="btn btn-primary sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setState(await enablePushAlerts());
            setBusy(false);
          }}
        >
          Turn on alerts
        </button>
        <button
          type="button"
          className="btn btn-secondary sm"
          onClick={() => {
            dismissPrompt();
            setHidden(true);
          }}
        >
          Not now
        </button>
      </div>
    </div>
  );
}
