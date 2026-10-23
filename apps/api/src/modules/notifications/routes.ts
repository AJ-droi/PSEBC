import { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { env, pushEnabled } from '../../config/env';
import { db } from '../../db/client';
import { notifications, pushSubscriptions } from '../../db/schema';
import { ah, parse, uuidParam } from '../../lib/http';
import { currentUser, requireAuth } from '../../middleware/auth';

export const notificationsRouter = Router();

notificationsRouter.get(
  '/',
  requireAuth,
  ah(async (req, res) => {
    const rows = await db
      .select({
        id: notifications.id,
        kind: notifications.kind,
        title: notifications.title,
        body: notifications.body,
        link: notifications.link,
        channel: notifications.channel,
        readAt: notifications.readAt,
        createdAt: notifications.createdAt,
      })
      .from(notifications)
      .where(and(eq(notifications.userId, currentUser(req).id), inArray(notifications.channel, ['in_app', 'phone_task'])))
      .orderBy(desc(notifications.createdAt))
      .limit(50);
    res.json({ notifications: rows, unread: rows.filter((r) => !r.readAt).length });
  }),
);

notificationsRouter.post(
  '/:id/read',
  requireAuth,
  ah(async (req, res) => {
    await db
      .update(notifications)
      .set({ readAt: sql`now()` })
      .where(and(eq(notifications.id, uuidParam(req)), eq(notifications.userId, currentUser(req).id), isNull(notifications.readAt)));
    res.json({ ok: true });
  }),
);

notificationsRouter.post(
  '/read-all',
  requireAuth,
  ah(async (req, res) => {
    await db
      .update(notifications)
      .set({ readAt: sql`now()` })
      .where(and(eq(notifications.userId, currentUser(req).id), isNull(notifications.readAt), eq(notifications.channel, 'in_app')));
    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------------------
// Phone/desktop alerts (Web Push)
// ---------------------------------------------------------------------------

/** The public key the browser needs to subscribe, or null when alerts aren't set up on the server. */
notificationsRouter.get('/push-key', requireAuth, (_req, res) => {
  res.json({ publicKey: pushEnabled() ? env().VAPID_PUBLIC_KEY : null });
});

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(1000).startsWith('https://'),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }),
});

/** Save this device for the signed-in person. Re-subscribing moves the device to the current user. */
notificationsRouter.post(
  '/push-subscribe',
  requireAuth,
  ah(async (req, res) => {
    const sub = parse(subscriptionSchema, req.body);
    const userId = currentUser(req).id;
    const userAgent = String(req.headers['user-agent'] ?? '').slice(0, 200);
    await db
      .insert(pushSubscriptions)
      .values({ userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent })
      .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent } });
    res.status(201).json({ ok: true });
  }),
);

/** Called on sign-out so a shared phone stops getting the previous person's alerts. */
notificationsRouter.post(
  '/push-unsubscribe',
  requireAuth,
  ah(async (req, res) => {
    const { endpoint } = parse(z.object({ endpoint: z.string().max(1000) }), req.body);
    await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, currentUser(req).id)));
    res.json({ ok: true });
  }),
);
