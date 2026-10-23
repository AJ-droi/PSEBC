import { Router } from 'express';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { notifications } from '../../db/schema';
import { ah, uuidParam } from '../../lib/http';
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
