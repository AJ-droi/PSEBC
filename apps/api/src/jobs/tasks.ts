import { and, eq, inArray, isNotNull, isNull, lt, lte, ne, or, sql } from 'drizzle-orm';
import { RULES } from '@psebc/shared';
import { db, withTx } from '../db/client';
import { tripLogExists } from '../db/sql';
import { documents, drivers, members, rideInvites, rides, settings, users } from '../db/schema';
import { formatWhen } from '../lib/time';
import { logger } from '../lib/logger';
import { featureOn } from '../lib/release';
import { audit, SYSTEM_ACTOR } from '../services/audit';
import { flushOutbox, notifyDriver, notifyMember, notifyRole } from '../services/notify';

/**
 * Background checks. Each is idempotent and safe to run at any interval, so they
 * can run in-process (node-cron) or from an external cron hitting POST /api/jobs/run.
 */

async function setting(key: string, fallback: number): Promise<number> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, key));
  const v = Number(row?.value);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const earliestExpiry = sql<string>`LEAST(${drivers.approvedUntil}, ${drivers.dbsRenewalDate}, ${drivers.insuranceExpiry})`;

/** Story 3.3 (PSEBC-19): flag to the coordinator if no driver accepts within 24h, or 2h before pickup. */
export async function flagUnmatched(now = new Date()): Promise<number> {
  const afterH = await setting('unmatched_after_hours', RULES.unmatchedAfterHours);
  const beforeH = await setting('unmatched_before_pickup_hours', RULES.unmatchedBeforePickupHours);
  const due = await db
    .select()
    .from(rides)
    .where(and(eq(rides.status, 'invites_sent'), or(lte(rides.createdAt, new Date(now.getTime() - afterH * HOUR)), lte(rides.pickupAt, new Date(now.getTime() + beforeH * HOUR)))));
  for (const ride of due) {
    await withTx(async (tx) => {
      const flagged = await tx
        .update(rides)
        .set({ status: 'unmatched', unmatchedFlaggedAt: now, updatedAt: sql`now()` })
        .where(and(eq(rides.id, ride.id), eq(rides.status, 'invites_sent')))
        .returning({ id: rides.id });
      if (!flagged.length) return;
      await notifyRole(
        tx,
        ['coordinator', 'admin'],
        { kind: 'unmatched', title: 'No driver has accepted yet', body: `Nobody has accepted the lift on ${formatWhen(ride.pickupAt)}. Please call the member or re-send invites.`, link: `/office/rides/${ride.id}`, rideId: ride.id },
        { email: true, sms: true },
      );
      await audit(SYSTEM_ACTOR, { action: 'ride.flag_unmatched', entityType: 'ride', entityId: ride.id }, tx);
    });
  }
  return due.length;
}

/** Requests that reach pickup time with no driver are closed as "no driver found". */
export async function closeExpiredRequests(now = new Date()): Promise<number> {
  const closed = await db
    .update(rides)
    .set({ status: 'cancelled', cancelReason: 'no_driver', cancelledAt: now, updatedAt: sql`now()` })
    .where(and(inArray(rides.status, ['requested', 'invites_sent', 'unmatched']), lt(rides.pickupAt, new Date(now.getTime() - HOUR))))
    .returning({ id: rides.id });
  for (const r of closed) {
    await db
      .update(rideInvites)
      .set({ status: 'withdrawn', respondedAt: sql`now()` })
      .where(and(eq(rideInvites.rideId, r.id), eq(rideInvites.status, 'sent')));
    await audit(SYSTEM_ACTOR, { action: 'ride.no_driver', entityType: 'ride', entityId: r.id });
  }
  return closed.length;
}

/** Story 6.1: ready for sign-off 72 hours after completion if a log is missing (missing log noted). */
export async function applyLogTimeout(now = new Date()): Promise<number> {
  const due = await db
    .select({ id: rides.id, driverLogged: tripLogExists('driver'), memberLogged: tripLogExists('member') })
    .from(rides)
    .where(and(eq(rides.status, 'completed'), lte(rides.logsDueAt, now)));
  for (const r of due) {
    const missing = [!r.driverLogged && 'driver log', !r.memberLogged && 'member log'].filter(Boolean).join(' and ');
    await db
      .update(rides)
      .set({ status: 'logged', loggedAt: now, missingLogNote: missing ? `${missing[0]!.toUpperCase()}${missing.slice(1)} missing (72 hours passed)` : null, updatedAt: sql`now()` })
      .where(and(eq(rides.id, r.id), eq(rides.status, 'completed')));
    await audit(SYSTEM_ACTOR, { action: 'trip.log_timeout', entityType: 'ride', entityId: r.id, details: { missing } });
  }
  return due.length;
}

/** Story 1.4 (PSEBC-10): remind 30 days before DBS/insurance expiry; on expiry set status Expired automatically. */
export async function checkDriverExpiry(now = new Date()): Promise<{ reminded: number; expired: number }> {
  const today = now.toISOString().slice(0, 10);
  const days = await setting('expiry_reminder_days', RULES.expiryReminderDays);
  const soon = new Date(now.getTime() + days * DAY).toISOString().slice(0, 10);

  const expired = await db
    .update(drivers)
    .set({ status: 'expired', updatedAt: sql`now()` })
    .where(and(eq(drivers.status, 'approved'), sql`${earliestExpiry} < ${today}::date`))
    .returning({ id: drivers.id, fullName: drivers.fullName });
  for (const d of expired) {
    await withTx(async (tx) => {
      await tx
        .update(rideInvites)
        .set({ status: 'withdrawn', respondedAt: sql`now()` })
        .where(and(eq(rideInvites.driverId, d.id), eq(rideInvites.status, 'sent')));
      await audit(SYSTEM_ACTOR, { action: 'driver.expire', entityType: 'driver', entityId: d.id }, tx);
      await notifyRole(tx, ['safeguarding', 'admin'], { kind: 'driver_expired', title: 'Driver checks expired', body: `${d.fullName}’s checks have expired. They won’t get lift requests until renewed and re-approved.`, link: `/safeguarding/approvals/${d.id}` }, { email: true });
      await notifyDriver(tx, d.id, { kind: 'driver_expired', title: 'Your checks have expired', body: 'You won’t get lift requests until your DBS or insurance is renewed. Please contact the church office.', link: '/driver' });
    });
  }

  const expiring = await db
    .select({
      id: drivers.id,
      fullName: drivers.fullName,
      firstExpiry: earliestExpiry,
      which: sql<string>`CASE WHEN ${drivers.insuranceExpiry} <= ${drivers.dbsRenewalDate} THEN 'insurance' ELSE 'DBS check' END`,
    })
    .from(drivers)
    .where(
      and(
        eq(drivers.status, 'approved'),
        sql`${earliestExpiry} <= ${soon}::date`,
        or(isNull(drivers.expiryRemindedFor), ne(drivers.expiryRemindedFor, earliestExpiry)),
      ),
    );
  for (const d of expiring) {
    await withTx(async (tx) => {
      await tx.update(drivers).set({ expiryRemindedFor: d.firstExpiry }).where(eq(drivers.id, d.id));
      await notifyRole(tx, ['safeguarding'], { kind: 'driver_expiring', title: 'Driver check expiring soon', body: `${d.fullName}’s ${d.which} expires on ${d.firstExpiry}.`, link: `/safeguarding/approvals/${d.id}` }, { email: true });
      await notifyDriver(tx, d.id, { kind: 'driver_expiring', title: 'Your check is expiring soon', body: `Your ${d.which} expires on ${d.firstExpiry}. Please give the church office your renewed details.`, link: '/driver' });
      await audit(SYSTEM_ACTOR, { action: 'driver.expiry_reminder', entityType: 'driver', entityId: d.id, details: { expires: d.firstExpiry } }, tx);
    });
  }
  return { reminded: expiring.length, expired: expired.length };
}

/** Day-before reminder to the member and driver (Should have). */
export async function sendReminders(now = new Date()): Promise<number> {
  const due = await db
    .select()
    .from(rides)
    .where(and(eq(rides.status, 'driver_found'), isNull(rides.reminderSentAt), sql`${rides.pickupAt} BETWEEN ${now} AND ${new Date(now.getTime() + DAY)}`));
  for (const r of due) {
    await withTx(async (tx) => {
      await tx.update(rides).set({ reminderSentAt: sql`now()` }).where(eq(rides.id, r.id));
      await notifyMember(tx, r.memberId, { kind: 'reminder', title: 'Lift reminder', body: `Reminder: your lift is on ${formatWhen(r.pickupAt)}.`, link: `/member/rides/${r.id}`, rideId: r.id });
      if (r.driverId) await notifyDriver(tx, r.driverId, { kind: 'reminder', title: 'Lift reminder', body: `Reminder: you’re driving on ${formatWhen(r.pickupAt)}.`, link: `/driver/trips/${r.id}`, rideId: r.id });
    });
  }
  return due.length;
}

/** Retention (PRD §9): anonymise personal data once the deletion date passes. Trip logs are kept (6 years). */
export async function applyRetention(now = new Date()): Promise<number> {
  const due = (table: typeof members | typeof drivers | typeof users) => and(eq(table.status, 'closed'), isNotNull(table.deleteAfter), lte(table.deleteAfter, now));
  const anonMembers = await db
    .update(members)
    .set({
      fullName: 'Former member',
      preferredName: 'Former member',
      addressLine: '',
      town: '',
      postcode: '',
      findingNotes: '',
      phone: '',
      emergencyName: '',
      emergencyRelationship: '',
      emergencyPhone: '',
      representativeName: '',
      representativePhone: '',
      mobilityAids: [],
      helpNeeded: [],
      notesForDriver: '',
      healthEnc: null,
      deleteAfter: null,
      updatedAt: sql`now()`,
    })
    .where(due(members))
    .returning({ id: members.id });
  const anonDrivers = await db
    .update(drivers)
    .set({ fullName: 'Former driver', phone: '', email: '', postcode: '', dbsNumber: '', vehicleReg: '', photoDocId: null, licenceDocId: null, insuranceDocId: null, deleteAfter: null, updatedAt: sql`now()` })
    .where(due(drivers))
    .returning({ id: drivers.id });
  if (anonDrivers.length) {
    await db.delete(documents).where(
      inArray(
        documents.driverId,
        anonDrivers.map((d) => d.id),
      ),
    );
  }
  await db
    .update(users)
    .set({ email: sql`'deleted-' || ${users.id} || '@invalid'`, fullName: 'Former user', phone: null, mfaSecret: null, deleteAfter: null })
    .where(due(users));
  for (const m of anonMembers) await audit(SYSTEM_ACTOR, { action: 'member.anonymise', entityType: 'member', entityId: m.id });
  for (const d of anonDrivers) await audit(SYSTEM_ACTOR, { action: 'driver.anonymise', entityType: 'driver', entityId: d.id });
  return anonMembers.length + anonDrivers.length;
}

export async function runAll(now = new Date()) {
  const result = {
    unmatched: await flagUnmatched(now),
    noDriver: await closeExpiredRequests(now),
    // Trips only reach "completed" once Epic 5 (trip logging) is live.
    logTimeouts: featureOn('tripLogging') ? await applyLogTimeout(now) : 0,
    expiry: await checkDriverExpiry(now),
    reminders: await sendReminders(now),
    anonymised: await applyRetention(now),
    delivered: await flushOutbox(),
  };
  logger.info({ result }, 'scheduled jobs ran');
  return result;
}
