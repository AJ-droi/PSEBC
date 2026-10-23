import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { createUserSchema } from '@psebc/shared';
import { db, withTx } from '../../db/client';
import { auditLog, settings, users } from '../../db/schema';
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
    const rows = await db
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        role: users.role,
        status: users.status,
        mfaEnabled: users.mfaEnabled,
        memberId: users.memberId,
        driverId: users.driverId,
        lastLoginAt: users.lastLoginAt,
      })
      .from(users)
      .orderBy(asc(users.status), asc(users.role), asc(users.fullName));
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
    const passwordHash = await bcrypt.hash(input.password, 12);
    const id = await withTx(async (tx) => {
      const [row] = await tx
        .insert(users)
        .values({
          email: input.email,
          fullName: input.fullName,
          phone: input.phone ?? null,
          role: input.role,
          passwordHash,
          memberId: input.role === 'member' ? input.memberId : null,
          driverId: input.role === 'driver' ? input.driverId : null,
        })
        .returning({ id: users.id });
      await audit(actorFrom(req), { action: 'user.create', entityType: 'user', entityId: row!.id, details: { role: input.role } }, tx);
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
    const updated = await db
      .update(users)
      .set({ passwordHash: await bcrypt.hash(password, 12), tokenVersion: sql`${users.tokenVersion} + 1`, failedLogins: 0, lockedUntil: null })
      .where(eq(users.id, id))
      .returning({ id: users.id });
    if (!updated.length) throw notFound('User');
    await audit(actorFrom(req), { action: 'user.reset_password', entityType: 'user', entityId: id });
    res.json({ ok: true });
  }),
);

adminRouter.post(
  '/users/:id/reset-mfa',
  requireRole('admin'),
  ah(async (req, res) => {
    const id = uuidParam(req);
    await db
      .update(users)
      .set({ mfaEnabled: false, mfaSecret: null, tokenVersion: sql`${users.tokenVersion} + 1` })
      .where(eq(users.id, id));
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
    const closed = await db
      .update(users)
      .set({ status: 'closed', closedAt: sql`now()`, tokenVersion: sql`${users.tokenVersion} + 1` })
      .where(eq(users.id, id))
      .returning({ id: users.id });
    if (!closed.length) throw notFound('User');
    await audit(actorFrom(req), { action: 'user.close', entityType: 'user', entityId: id });
    res.json({ ok: true });
  }),
);

/** Audit trail — who saw and changed what (PRD §4, §9). */
adminRouter.get(
  '/audit',
  requireRole('admin', 'safeguarding'),
  ah(async (req, res) => {
    const entityType = String(req.query.entityType ?? '');
    const entityId = String(req.query.entityId ?? '');
    const entries = await db
      .select({
        id: auditLog.id,
        at: auditLog.at,
        actorName: auditLog.actorName,
        actorRole: auditLog.actorRole,
        action: auditLog.action,
        entityType: auditLog.entityType,
        entityId: auditLog.entityId,
        details: auditLog.details,
      })
      .from(auditLog)
      .where(and(entityType ? eq(auditLog.entityType, entityType) : undefined, entityId ? eq(auditLog.entityId, entityId) : undefined))
      .orderBy(desc(auditLog.at))
      .limit(200);
    res.json({ entries });
  }),
);

const asObject = (rows: { key: string; value: unknown }[]) => Object.fromEntries(rows.map((r) => [r.key, r.value]));

adminRouter.get(
  '/settings',
  requireRole('admin', 'safeguarding', 'coordinator'),
  ah(async (_req, res) => {
    res.json({ settings: asObject(await db.select({ key: settings.key, value: settings.value }).from(settings)) });
  }),
);

/** Settings every signed-in person may see (e.g. the church office phone number shown on member screens). */
adminRouter.get(
  '/public-settings',
  requireAuth,
  ah(async (_req, res) => {
    res.json(asObject(await db.select({ key: settings.key, value: settings.value }).from(settings).where(inArray(settings.key, ['church_office_phone']))));
  }),
);
