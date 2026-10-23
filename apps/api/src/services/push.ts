import webpush from 'web-push';
import { and, eq } from 'drizzle-orm';
import { env, pushEnabled } from '../config/env';
import { db } from '../db/client';
import { pushSubscriptions, users } from '../db/schema';
import { logger } from '../lib/logger';

/**
 * Web Push: a system notification (with the phone's alert sound) even when the
 * app is closed or the phone is locked.
 *
 * Privacy (PRD §9 "no personal data on phones beyond the app session"): a push
 * shows on the lock screen, so it never carries names, addresses, times or health
 * information — only a generic title by message kind. The details are behind sign-in.
 */

const GENERIC_TITLES: Record<string, string> = {
  invite: 'New lift request',
  driver_found: 'Your driver is booked',
  driver_changed: 'Update about your lift',
  booked: 'Lift booked',
  cancelled: 'A lift has changed',
  reminder: 'Lift reminder',
  log_request: 'How was your trip?',
  unmatched: 'A lift needs a driver',
  not_at_pickup: 'Urgent: member not at pickup',
  concern: 'Safeguarding: incident reported',
  felt_unsafe: 'Safeguarding: please check the app',
  driver_pending: 'Driver waiting for approval',
  driver_decision: 'Update about your application',
  driver_expiring: 'A check is expiring soon',
  driver_expired: 'A check has expired',
  phone_task: 'Please phone a member',
};

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
  urgent: boolean;
}

export function pushPayloadFor(kind: string, link: string | null): PushPayload {
  return {
    title: GENERIC_TITLES[kind] ?? 'New message from PSEBC Lifts',
    body: 'Open PSEBC Lifts to see the details.',
    url: link && link.startsWith('/') ? link : '/notifications',
    tag: kind,
    urgent: ['not_at_pickup', 'concern', 'felt_unsafe', 'invite'].includes(kind),
  };
}

export interface PushSender {
  send(sub: { endpoint: string; p256dh: string; auth: string }, payload: PushPayload): Promise<void>;
}

/** Thrown for subscriptions the push service says are gone (404/410) — we delete those. */
export class GoneSubscription extends Error {}

const webPushSender: PushSender = {
  async send(sub, payload) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
        {
          vapidDetails: { subject: env().VAPID_SUBJECT, publicKey: env().VAPID_PUBLIC_KEY, privateKey: env().VAPID_PRIVATE_KEY },
          TTL: 60 * 60 * 6,
          urgency: payload.urgent ? 'high' : 'normal',
          topic: payload.tag.slice(0, 32),
        },
      );
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) throw new GoneSubscription();
      throw err;
    }
  },
};

let sender: PushSender = webPushSender;
/** Tests swap in a fake sender. */
export function setPushSender(s: PushSender | null): void {
  sender = s ?? webPushSender;
}

/** Send one queued push message to every device this person turned alerts on for. */
export async function deliverPush(userId: string, kind: string, link: string | null): Promise<number> {
  if (!pushEnabled()) return 0;
  const subs = await db
    .select({ id: pushSubscriptions.id, endpoint: pushSubscriptions.endpoint, p256dh: pushSubscriptions.p256dh, auth: pushSubscriptions.auth })
    .from(pushSubscriptions)
    .innerJoin(users, eq(users.id, pushSubscriptions.userId))
    .where(and(eq(pushSubscriptions.userId, userId), eq(users.status, 'active')));
  const payload = pushPayloadFor(kind, link);
  let sent = 0;
  for (const sub of subs) {
    try {
      await sender.send(sub, payload);
      await db.update(pushSubscriptions).set({ lastUsedAt: new Date() }).where(eq(pushSubscriptions.id, sub.id));
      sent++;
    } catch (err) {
      if (err instanceof GoneSubscription) {
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
      } else {
        logger.warn({ err: (err as Error).message }, 'push send failed');
        throw err;
      }
    }
  }
  return sent;
}
