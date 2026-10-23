import { Router } from 'express';
import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { signoffSchema, RIDE_STATUS_LABELS } from '@psebc/shared';
import { db, withTx } from '../../db/client';
import { concernCount, tripLogExists } from '../../db/sql';
import { concerns, drivers, members, rides, tripLogs } from '../../db/schema';
import { ah, parse, uuidParam } from '../../lib/http';
import { pageFrom } from '../../lib/pagination';
import { AppError, conflict, notFound } from '../../lib/errors';
import { currentUser, requireRole } from '../../middleware/auth';
import { actorFrom, audit } from '../../services/audit';
import { lockRide, getRide } from '../rides/repo';
import { needsSummary } from '../rides/views';
import { getMember } from '../members/repo';

export const signoffRouter = Router();

/**
 * F11 Safeguarding sign-off queue (story 6.1 PSEBC-27).
 * A trip is ready when both logs are in, or 72 hours after completion with the missing log noted.
 */
signoffRouter.get(
  '/queue',
  requireRole('safeguarding'),
  ah(async (req, res) => {
    // ?stage=ready (both logs in / 72h passed) or ?stage=waiting (waiting for logs); default both.
    const page = pageFrom(req);
    const stage = req.query.stage === 'ready' ? (['logged'] as const) : req.query.stage === 'waiting' ? (['completed'] as const) : (['completed', 'logged'] as const);
    const where = inArray(rides.status, [...stage]);
    const openConcerns = concernCount(true);
    const rows = await db
      .select({
        id: rides.id,
        status: rides.status,
        pickupAt: rides.pickupAt,
        completedAt: rides.completedAt,
        missingLogNote: rides.missingLogNote,
        incidentReportedAt: rides.incidentReportedAt,
        memberName: members.preferredName,
        driverName: drivers.fullName,
        driverLogged: tripLogExists('driver'),
        memberLogged: tripLogExists('member'),
        openConcerns,
        concerns: concernCount(false),
      })
      .from(rides)
      .innerJoin(members, eq(members.id, rides.memberId))
      .leftJoin(drivers, eq(drivers.id, rides.driverId))
      .where(where)
      .orderBy(desc(sql`${rides.status} = 'logged'`), desc(openConcerns), asc(rides.pickupAt), asc(rides.id))
      .limit(page.limit)
      .offset(page.offset);
    res.json({
      pagination: page.meta(await db.$count(rides, where)),
      trips: rows.map((r) => ({
        ...r,
        statusLabel: RIDE_STATUS_LABELS[r.status],
        driverName: r.driverName?.split(' ')[0] ?? null,
        ready: r.status === 'logged',
      })),
    });
  }),
);

/** Full trip record for the safeguarding lead, including concerns. */
signoffRouter.get(
  '/trips/:id',
  requireRole('safeguarding'),
  ah(async (req, res) => {
    const id = uuidParam(req);
    const ride = await getRide(id);
    if (!ride) throw notFound('Trip');
    const member = (await getMember(ride.memberId))!;
    const [driver] = ride.driverId ? await db.select({ name: drivers.fullName, phone: drivers.phone }).from(drivers).where(eq(drivers.id, ride.driverId)) : [];
    const logs = await db.select().from(tripLogs).where(eq(tripLogs.rideId, id));
    const rows = await db.select().from(concerns).where(eq(concerns.rideId, id)).orderBy(asc(concerns.createdAt));
    await audit(actorFrom(req), { action: 'trip.view_record', entityType: 'ride', entityId: id });
    res.json({
      trip: {
        id: ride.id,
        status: ride.status,
        pickupAt: ride.pickupAt,
        destination: ride.destination,
        pickedUpAt: ride.pickedUpAt,
        droppedOffAt: ride.droppedOffAt,
        notAtPickupAt: ride.notAtPickupAt,
        returnAt: ride.returnNeeded ? ride.returnAt : null,
        completedAt: ride.completedAt,
        missingLogNote: ride.missingLogNote,
        signedOffAt: ride.signedOffAt,
        signedOffBy: ride.signedOffByName,
        signoffOutcome: ride.signoffOutcome,
        signoffNotes: ride.signoffNotes,
      },
      member: { id: member.id, name: member.fullName, preferredName: member.preferredName, needs: needsSummary(member, ride) },
      driver: driver ?? null,
      logs,
      concerns: rows.map(({ reviewedByName, ...c }) => ({ ...c, reviewedBy: reviewedByName })),
    });
  }),
);

/**
 * Sign off a trip (stories 6.1, 6.2, 4.3). Records name and date; ends the driver's
 * access to the member's details (enforced by status in the ride views).
 */
signoffRouter.post(
  '/trips/:id/signoff',
  requireRole('safeguarding'),
  ah(async (req, res) => {
    const id = uuidParam(req);
    const input = parse(signoffSchema, req.body);
    const user = currentUser(req);
    await withTx(async (tx) => {
      const ride = await lockRide(id, tx);
      if (!ride) throw notFound('Trip');
      if (ride.status !== 'logged') throw conflict('This trip is not ready for sign-off yet. It needs both logs, or 72 hours after completion.');
      const [open] = await tx
        .select({ n: count() })
        .from(concerns)
        .where(and(eq(concerns.rideId, id), eq(concerns.status, 'open')));
      if ((open?.n ?? 0) > 0) throw new AppError(409, 'concern_open', 'Review the concern before signing off');
      await tx
        .update(rides)
        .set({ status: 'signed_off', signedOffAt: sql`now()`, signedOffBy: user.id, signedOffByName: user.fullName, signoffOutcome: input.outcome, signoffNotes: input.notes, updatedAt: sql`now()` })
        .where(eq(rides.id, id));
      await audit(actorFrom(req), { action: 'trip.signoff', entityType: 'ride', entityId: id, details: { outcome: input.outcome } }, tx);
    });
    res.json({ ok: true });
  }),
);

/** Safeguarding home counts. */
signoffRouter.get(
  '/summary',
  requireRole('safeguarding'),
  ah(async (_req, res) => {
    const n = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;
    res.json({
      ready: await n(db.select({ n: count() }).from(rides).where(eq(rides.status, 'logged'))),
      waiting: await n(db.select({ n: count() }).from(rides).where(eq(rides.status, 'completed'))),
      open_concerns: await n(db.select({ n: count() }).from(concerns).where(eq(concerns.status, 'open'))),
      pending_drivers: await n(db.select({ n: count() }).from(drivers).where(eq(drivers.status, 'pending'))),
    });
  }),
);
