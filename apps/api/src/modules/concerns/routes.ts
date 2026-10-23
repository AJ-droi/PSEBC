import { Router } from 'express';
import { asc, desc, eq, sql } from 'drizzle-orm';
import { CONCERN_KINDS, concernReviewSchema, concernSchema, labelList } from '@psebc/shared';
import { db, withTx } from '../../db/client';
import { concerns, drivers, members, rides } from '../../db/schema';
import { ah, parse, uuidParam } from '../../lib/http';
import { conflict, forbidden, notFound } from '../../lib/errors';
import { formatWhen } from '../../lib/time';
import { currentUser, requireAuth, requireRole } from '../../middleware/auth';
import { actorFrom, audit } from '../../services/audit';
import { flushSoon, notifyRole } from '../../services/notify';
import { getRide, markIncident } from '../rides/repo';

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
    const { rideId, ...input } = parse(concernSchema, req.body);
    const user = currentUser(req);
    const ride = await getRide(rideId);
    if (!ride) throw notFound('Lift');
    const involved =
      (user.role === 'driver' && user.driverId === ride.driverId) ||
      (user.role === 'member' && user.memberId === ride.memberId) ||
      ['coordinator', 'admin', 'safeguarding'].includes(user.role);
    if (!involved) throw forbidden('Only people involved in this trip can report a concern about it');
    if (ride.status === 'signed_off') throw conflict('This trip is closed. Please contact the safeguarding lead directly.');

    const id = await withTx(async (tx) => {
      const [row] = await tx
        .insert(concerns)
        .values({ ...input, rideId, reportedBy: user.id, reporterRole: user.role, reporterName: user.fullName, notifiedAt: sql`now()` })
        .returning({ id: concerns.id });
      await markIncident(tx, rideId);
      await audit(actorFrom(req), { action: 'concern.report', entityType: 'concern', entityId: row!.id, details: { rideId, kinds: input.kinds, anyoneHurt: input.anyoneHurt } }, tx);
      await notifyRole(
        tx,
        ['safeguarding'],
        {
          kind: 'concern',
          title: input.anyoneHurt ? 'URGENT: concern reported — someone was hurt' : 'Concern reported on a lift',
          body: `${labelList(CONCERN_KINDS, input.kinds).join(', ')} — lift on ${formatWhen(ride.pickupAt)}, reported by a ${user.role}. Please review in the app.`,
          link: `/safeguarding/trips/${rideId}`,
          rideId,
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
    const rows = await db
      .select({
        id: concerns.id,
        rideId: concerns.rideId,
        kinds: concerns.kinds,
        reporterRole: concerns.reporterRole,
        reporterName: concerns.reporterName,
        anyoneHurt: concerns.anyoneHurt,
        status: concerns.status,
        createdAt: concerns.createdAt,
        reviewedAt: concerns.reviewedAt,
        pickupAt: rides.pickupAt,
        memberName: members.preferredName,
        driverName: drivers.fullName,
      })
      .from(concerns)
      .innerJoin(rides, eq(rides.id, concerns.rideId))
      .innerJoin(members, eq(members.id, rides.memberId))
      .leftJoin(drivers, eq(drivers.id, rides.driverId))
      .orderBy(asc(sql`${concerns.status} = 'reviewed'`), desc(concerns.createdAt))
      .limit(200);
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
    const updated = await db
      .update(concerns)
      .set({ status: 'reviewed', reviewedBy: user.id, reviewedByName: user.fullName, reviewedAt: sql`now()`, outcome: input.outcome, reviewNotes: input.notes })
      .where(eq(concerns.id, id))
      .returning({ id: concerns.id });
    if (!updated.length) throw notFound('Concern');
    await audit(actorFrom(req), { action: 'concern.review', entityType: 'concern', entityId: id, details: { outcome: input.outcome } });
    res.json({ ok: true });
  }),
);
