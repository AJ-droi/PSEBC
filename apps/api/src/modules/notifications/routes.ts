import { Router } from 'express';
import { query } from '../../db/pool';
import { ah, uuidParam } from '../../lib/http';
import { currentUser, requireAuth } from '../../middleware/auth';

export const notificationsRouter = Router();

notificationsRouter.get(
  '/',
  requireAuth,
  ah(async (req, res) => {
    const user = currentUser(req);
    const rows = await query(
      `SELECT id, kind, title, body, link, channel, read_at AS "readAt", created_at AS "createdAt"
         FROM notifications WHERE user_id = $1 AND channel IN ('in_app', 'phone_task')
        ORDER BY created_at DESC LIMIT 50`,
      [user.id],
    );
    const unread = rows.filter((r) => !(r as { readAt: unknown }).readAt).length;
    res.json({ notifications: rows, unread });
  }),
);

notificationsRouter.post(
  '/:id/read',
  requireAuth,
  ah(async (req, res) => {
    await query('UPDATE notifications SET read_at = now() WHERE id = $1 AND user_id = $2 AND read_at IS NULL', [uuidParam(req), currentUser(req).id]);
    res.json({ ok: true });
  }),
);

notificationsRouter.post(
  '/read-all',
  requireAuth,
  ah(async (req, res) => {
    await query(`UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL AND channel = 'in_app'`, [currentUser(req).id]);
    res.json({ ok: true });
  }),
);
