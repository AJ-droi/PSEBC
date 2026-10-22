import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { createUserSchema } from '@psebc/shared';
import { query, queryOne, withTx } from '../../db/pool';
import { ah, parse, uuidParam } from '../../lib/http';
import { badRequest, notFound } from '../../lib/errors';
import { requireAuth, requireRole } from '../../middleware/auth';
import { actorFrom, audit } from '../../services/audit';

export const adminRouter = Router();

/** Individual logins for every role (PRD §10). Admin creates them. */
adminRouter.get(
  '/users',
  requireRole('admin'),
  ah(async (_req, res) => {
    const rows = await query(
      `SELECT id, email, full_name AS "fullName", role, status, mfa_enabled AS "mfaEnabled", member_id AS "memberId", driver_id AS "driverId", last_login_at AS "lastLoginAt"
         FROM users ORDER BY status, role, full_name`,
    );
    res.json({ users: rows });
  }),
);

adminRouter.post(
  '/users',
  requireRole('admin'),
  ah(async (req, res) => {
    const input = parse(createUserSchema, req.body);
    if (input.role === 'member' && !input.memberId) throw badRequest('Choose the member this login is for');
    if (input.role === 'driver' && !input.driverId) throw badRequest('Choose the driver this login is for');
    const hash = await bcrypt.hash(input.password, 12);
    const id = await withTx(async (db) => {
      const [row] = await query<{ id: string }>(
        `INSERT INTO users (email, full_name, phone, role, password_hash, member_id, driver_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [input.email, input.fullName, input.phone ?? null, input.role, hash, input.role === 'member' ? input.memberId : null, input.role === 'driver' ? input.driverId : null],
        db,
      );
      await audit(actorFrom(req), { action: 'user.create', entityType: 'user', entityId: row!.id, details: { role: input.role } }, db);
      return row!.id;
    });
    res.status(201).json({ id });
  }),
);

adminRouter.post(
  '/users/:id/reset-password',
  requireRole('admin'),
  ah(async (req, res) => {
    const id = uuidParam(req);
    const { password } = parse(z.object({ password: z.string().min(10, 'Use at least 10 characters') }), req.body);
    const r = await query(`UPDATE users SET password_hash = $2, token_version = token_version + 1, failed_logins = 0, locked_until = NULL WHERE id = $1 RETURNING id`, [id, await bcrypt.hash(password, 12)]);
    if (!r.length) throw notFound('User');
    await audit(actorFrom(req), { action: 'user.reset_password', entityType: 'user', entityId: id });
    res.json({ ok: true });
  }),
);

adminRouter.post(
  '/users/:id/reset-mfa',
  requireRole('admin'),
  ah(async (req, res) => {
    const id = uuidParam(req);
    await query(`UPDATE users SET mfa_enabled = false, mfa_secret = NULL, token_version = token_version + 1 WHERE id = $1`, [id]);
    await audit(actorFrom(req), { action: 'user.reset_mfa', entityType: 'user', entityId: id });
    res.json({ ok: true });
  }),
);

/** Closing a staff login (coordinator/admin/safeguarding). Members and drivers use their own close routes. */
adminRouter.post(
  '/users/:id/close',
  requireRole('admin'),
  ah(async (req, res) => {
    const id = uuidParam(req);
    const u = await queryOne<{ role: string }>('SELECT role FROM users WHERE id = $1', [id]);
    if (!u) throw notFound('User');
    await query(`UPDATE users SET status = 'closed', closed_at = now(), token_version = token_version + 1 WHERE id = $1`, [id]);
    await audit(actorFrom(req), { action: 'user.close', entityType: 'user', entityId: id });
    res.json({ ok: true });
  }),
);

/** Audit trail — who saw and changed what (PRD §4 Must have, §9). */
adminRouter.get(
  '/audit',
  requireRole('admin', 'safeguarding'),
  ah(async (req, res) => {
    const entityType = String(req.query.entityType ?? '');
    const entityId = String(req.query.entityId ?? '');
    const rows = await query(
      `SELECT id, at, actor_name AS "actorName", actor_role AS "actorRole", action, entity_type AS "entityType", entity_id AS "entityId", details
         FROM audit_log
        WHERE ($1 = '' OR entity_type = $1) AND ($2 = '' OR entity_id = $2)
        ORDER BY at DESC LIMIT 200`,
      [entityType, entityId],
    );
    res.json({ entries: rows });
  }),
);

adminRouter.get(
  '/settings',
  requireRole('admin', 'safeguarding', 'coordinator'),
  ah(async (_req, res) => {
    const rows = await query<{ key: string; value: unknown }>('SELECT key, value FROM settings');
    res.json({ settings: Object.fromEntries(rows.map((r) => [r.key, r.value])) });
  }),
);

/** Settings every signed-in person may see (e.g. the church office phone number shown on member screens). */
adminRouter.get(
  '/public-settings',
  requireAuth,
  ah(async (_req, res) => {
    const rows = await query<{ key: string; value: unknown }>(`SELECT key, value FROM settings WHERE key IN ('church_office_phone')`);
    res.json(Object.fromEntries(rows.map((r) => [r.key, r.value])));
  }),
);
