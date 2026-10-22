import { Router } from 'express';
import { CONCERN_KINDS, concernReviewSchema, concernSchema, labelList } from '@psebc/shared';
import { query, queryOne, withTx } from '../../db/pool';
import { ah, parse, uuidParam } from '../../lib/http';
import { conflict, forbidden, notFound } from '../../lib/errors';
import { formatWhen } from '../../lib/time';
import { currentUser, requireAuth, requireRole } from '../../middleware/auth';
import { actorFrom, audit } from '../../services/audit';
import { flushSoon, notifyRole } from '../../services/notify';
import { getRide } from '../rides/repo';

export const concernsRouter = Router();

/**
 * F10 Concern report (stories 5.2, 5.3, 6.2 — PSEBC-25/26/28).
 * Anyone involved in the trip can report; only safeguarding can read it.
 * The safeguarding lead is notified immediately by every channel we have.
 */
concernsRouter.post(
  '/',
  requireAuth,
  ah(async (req, res) => {
    const input = parse(concernSchema, req.body);
    const user = currentUser(req);
    const ride = await getRide(input.rideId);
    if (!ride) throw notFound('Lift');
    const involved =
      (user.role === 'driver' && user.driverId === ride.driver_id) ||
      (user.role === 'member' && user.memberId === ride.member_id) ||
      ['coordinator', 'admin', 'safeguarding'].includes(user.role);
    if (!involved) throw forbidden('Only people involved in this trip can report a concern about it');
    if (ride.status === 'signed_off') throw conflict('This trip is closed. Please contact the safeguarding lead directly.');

    const id = await withTx(async (db) => {
      const [row] = await query<{ id: string }>(
        `INSERT INTO concerns (ride_id, reported_by, reporter_role, reporter_name, occurred_when, occurred_where, kinds, who_involved,
                               description, action_taken, anyone_hurt, emergency_services_called, family_told, notified_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now()) RETURNING id`,
        [ride.id, user.id, user.role, user.fullName, input.occurredWhen, input.occurredWhere, input.kinds, input.whoInvolved, input.description, input.actionTaken, input.anyoneHurt, input.emergencyServicesCalled, input.familyTold],
        db,
      );
      await audit(actorFrom(req), { action: 'concern.report', entityType: 'concern', entityId: row!.id, details: { rideId: ride.id, kinds: input.kinds, anyoneHurt: input.anyoneHurt } }, db);
      await notifyRole(
        db,
        ['safeguarding'],
        {
          kind: 'concern',
          title: input.anyoneHurt ? 'URGENT: concern reported — someone was hurt' : 'Concern reported on a lift',
          body: `${labelList(CONCERN_KINDS, input.kinds).join(', ')} — lift on ${formatWhen(ride.pickup_at)}, reported by a ${user.role}. Please review in the app.`,
          link: `/safeguarding/trips/${ride.id}`,
          rideId: ride.id,
        },
        { email: true, sms: true },
      );
      return row!.id;
    });
    flushSoon();
    res.status(201).json({ id });
  }),
);

/** Incidents list for safeguarding only. */
concernsRouter.get(
  '/',
  requireRole('safeguarding'),
  ah(async (_req, res) => {
    const rows = await query(
      `SELECT c.id, c.ride_id AS "rideId", c.kinds, c.reporter_role AS "reporterRole", c.reporter_name AS "reporterName",
              c.anyone_hurt AS "anyoneHurt", c.status, c.created_at AS "createdAt", c.reviewed_at AS "reviewedAt",
              r.pickup_at AS "pickupAt", m.preferred_name AS "memberName", d.full_name AS "driverName"
         FROM concerns c JOIN rides r ON r.id = c.ride_id JOIN members m ON m.id = r.member_id LEFT JOIN drivers d ON d.id = r.driver_id
        ORDER BY (c.status = 'open') DESC, c.created_at DESC LIMIT 200`,
    );
    res.json({ concerns: rows });
  }),
);

/** Story 6.2: a trip can't be signed off until its concern is marked reviewed. */
concernsRouter.post(
  '/:id/review',
  requireRole('safeguarding'),
  ah(async (req, res) => {
    const id = uuidParam(req);
    const input = parse(concernReviewSchema, req.body);
    const user = currentUser(req);
    const c = await queryOne<{ status: string }>('SELECT status FROM concerns WHERE id = $1', [id]);
    if (!c) throw notFound('Concern');
    await query(
      `UPDATE concerns SET status = 'reviewed', reviewed_by = $2, reviewed_by_name = $3, reviewed_at = now(), outcome = $4, review_notes = $5 WHERE id = $1`,
      [id, user.id, user.fullName, input.outcome, input.notes],
    );
    await audit(actorFrom(req), { action: 'concern.review', entityType: 'concern', entityId: id, details: { outcome: input.outcome } });
    res.json({ ok: true });
  }),
);
