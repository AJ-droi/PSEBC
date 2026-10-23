'use client';
/**
 * Message alerts.
 *
 * 1. While the app is open: a short chime (+ vibration on phones) whenever the
 *    number of unread messages goes up.
 * 2. When the app is closed or the phone is locked: Web Push. The phone shows a
 *    system notification with its own alert sound. Pushes never contain names or
 *    details (the API sends generic titles only).
 */

// ---------------------------------------------------------------------------
// Sound preference (per device, a convenience only — default on)
// ---------------------------------------------------------------------------

const SOUND_KEY = 'psebc-sound';

export function soundEnabled(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setSoundEnabled(on: boolean): void {
  try {
    localStorage.setItem(SOUND_KEY, on ? 'on' : 'off');
  } catch {
    /* private mode: preference just isn't remembered */
  }
}

// ---------------------------------------------------------------------------
// Chime (Web Audio — no sound file to download or cache)
// ---------------------------------------------------------------------------

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx ??= new Ctor();
  return ctx;
}

/** Browsers only allow sound after the person has tapped the page once; call on first interaction. */
export function unlockAudioOnFirstTap(): () => void {
  const unlock = () => {
    const a = audio();
    if (a && a.state === 'suspended') void a.resume();
  };
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
  return () => {
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
}

/** Two-note "ding-dong", loud enough to notice, short enough not to startle. */
export function chime(opts: { urgent?: boolean } = {}): void {
  if (!soundEnabled()) return;
  const a = audio();
  if (a) {
    if (a.state === 'suspended') void a.resume();
    const notes = opts.urgent ? [988, 1319, 988, 1319] : [880, 1319];
    notes.forEach((freq, i) => {
      const start = a.currentTime + i * 0.18;
      const osc = a.createOscillator();
      const gain = a.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.35, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.32);
      osc.connect(gain).connect(a.destination);
      osc.start(start);
      osc.stop(start + 0.34);
    });
  }
  try {
    navigator.vibrate?.(opts.urgent ? [200, 100, 200, 100, 200] : [120, 60, 120]);
  } catch {
    /* not supported */
  }
}

// ---------------------------------------------------------------------------
// Web Push (alerts when the app is closed)
// ---------------------------------------------------------------------------

export type PushState = 'unsupported' | 'unavailable' | 'denied' | 'off' | 'on';

export function pushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

async function serverKey(): Promise<string | null> {
  const res = await fetch('/api/notifications/push-key', { credentials: 'same-origin' });
  if (!res.ok) return null;
  return ((await res.json()) as { publicKey: string | null }).publicKey;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration('/');
  if (existing) return existing;
  await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  return navigator.serviceWorker.ready;
}

function base64UrlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  if (!(await serverKey())) return 'unavailable';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission !== 'granted') return 'off';
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = await reg?.pushManager.getSubscription();
  return sub ? 'on' : 'off';
}

/**
 * Ask permission (must be called from a tap) and register this device for the signed-in person.
 * Safe to call again: it re-sends the existing subscription so a shared device follows whoever is signed in.
 */
export async function enablePushAlerts(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  const key = await serverKey();
  if (!key) return 'unavailable';
  const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';
  const reg = await registration();
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(key) }));
  const res = await fetch('/api/notifications/push-subscribe', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(sub.toJSON()),
  });
  return res.ok ? 'on' : 'off';
}

/** Stop alerts on this device (used on sign-out so the next person doesn't get them). */
export async function disablePushAlerts(): Promise<void> {
  if (!pushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration('/');
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    await fetch('/api/notifications/push-unsubscribe', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    }).catch(() => undefined);
    await sub.unsubscribe();
  } catch {
    /* best effort */
  }
}

const DISMISS_KEY = 'psebc-alerts-prompt-dismissed';
export function promptDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}
export function dismissPrompt(): void {
  try {
    localStorage.setItem(DISMISS_KEY, '1');
  } catch {
    /* ignore */
  }
}
