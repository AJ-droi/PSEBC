/**
 * Driver calendar (story 3.4 / PSEBC-20).
 *
 * A driver books out the days they can't drive. Matching rule 6 then never invites them on
 * those days, and any invite already waiting for them on a day they book out is withdrawn and
 * the lift re-matched. Members (and the office) see how many suitable drivers are free on each
 * day before they book — a count only, never who, because driver identity is shared in Epic 4.
 */
import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import {
  findEligibleDrivers,
  isoDayRange,
  ukDate,
  type DriverAvailabilityInput,
  type HelpCap,
  type HelpNeeded,
  type MatchDriver,
  type MobilityAid,
  type VehicleCap,
  type VehicleRequirement,
} from '@psebc/shared';
import { db, withTx, type Executor } from '../../db/client';
import { driverDaysOff, driverExclusions, drivers, members, rideInvites, rides } from '../../db/schema';
import { AppError, badRequest, notFound } from '../../lib/errors';
import { audit, type Actor } from '../../services/audit';
import { matchAndInvite } from '../rides/matching.service';
import { lockRide } from '../rides/repo';

/** The UK calendar date of a ride's pickup, in SQL (matches ukDate() in TypeScript). */
const pickupDay = sql<string>`(${rides.pickupAt} AT TIME ZONE 'Europe/London')::date`;

export interface DriverCalendar {
  from: string;
  to: string;
  /** Days the driver has booked out. */
  daysOff: string[];
  /** Days the driver has an accepted lift (can't be booked out without handing the lift back first). */
  booked: string[];
}

export async function getDriverCalendar(driverId: string, from: string, to: string, tx: Executor = db): Promise<DriverCalendar> {
  const off = await tx
    .select({ day: driverDaysOff.day })
    .from(driverDaysOff)
    .where(and(eq(driverDaysOff.driverId, driverId), gte(driverDaysOff.day, from), lte(driverDaysOff.day, to)))
    .orderBy(driverDaysOff.day);
  return { from, to, daysOff: off.map((o) => o.day), booked: await bookedDays(driverId, from, to, tx) };
}

async function bookedDays(driverId: string, from: string, to: string, tx: Executor): Promise<string[]> {
  const rows = await tx
    .selectDistinct({ day: pickupDay })
    .from(rides)
    .where(and(eq(rides.driverId, driverId), eq(rides.status, 'driver_found'), sql`${pickupDay} BETWEEN ${from}::date AND ${to}::date`));
  return rows.map((r) => String(r.day)).sort();
}

/**
 * Replace the driver's days off between `from` and `to` with `daysOff`.
 * Refuses a day with an accepted lift: the driver hands that lift back first, so the member is never left without a driver silently.
 */
export async function setDriverCalendar(actor: Actor, driverId: string, input: DriverAvailabilityInput) {
  const today = ukDate(new Date());
  if (input.from < today) throw badRequest('Days that have already passed can’t be changed', { fields: { from: 'Start from today or later' } });
  const wanted = [...new Set(input.daysOff)].sort();

  return withTx(async (tx) => {
    const [driver] = await tx.select({ id: drivers.id, status: drivers.status }).from(drivers).where(eq(drivers.id, driverId)).for('update');
    if (!driver || driver.status === 'closed') throw notFound('Driver');

    const before = await getDriverCalendar(driverId, input.from, input.to, tx);
    const clash = wanted.filter((d) => before.booked.includes(d));
    if (clash.length) {
      throw new AppError(409, 'booked_that_day', 'You have a lift booked on a day you marked as off. Hand that lift back first, or call the church office.', { days: clash });
    }

    const added = wanted.filter((d) => !before.daysOff.includes(d));
    const removed = before.daysOff.filter((d) => !wanted.includes(d));
    if (removed.length) await tx.delete(driverDaysOff).where(and(eq(driverDaysOff.driverId, driverId), inArray(driverDaysOff.day, removed)));
    if (added.length) await tx.insert(driverDaysOff).values(added.map((day) => ({ driverId, day }))).onConflictDoNothing();

    // Invites already waiting for this driver on a day they've just booked out are withdrawn, and the lift re-matched
    // (so if nobody else is free it goes to the coordinator straight away, as in story 3.3).
    const affected = added.length
      ? await tx
          .select({ rideId: rideInvites.rideId })
          .from(rideInvites)
          .innerJoin(rides, eq(rides.id, rideInvites.rideId))
          .where(and(eq(rideInvites.driverId, driverId), eq(rideInvites.status, 'sent'), sql`${pickupDay} IN (${sql.join(added.map((d) => sql`${d}::date`), sql`, `)})`))
      : [];
    for (const { rideId } of affected) {
      const ride = await lockRide(rideId, tx);
      await tx
        .update(rideInvites)
        .set({ status: 'withdrawn', respondedAt: sql`now()` })
        .where(and(eq(rideInvites.rideId, rideId), eq(rideInvites.driverId, driverId), eq(rideInvites.status, 'sent')));
      if (ride && (ride.status === 'invites_sent' || ride.status === 'unmatched')) await matchAndInvite(tx, ride, actor);
    }

    if (added.length || removed.length) {
      await audit(actor, { action: 'driver.calendar_update', entityType: 'driver', entityId: driverId, details: { added, removed, withdrawnInvites: affected.length } }, tx);
    }
    return { ...(await getDriverCalendar(driverId, input.from, input.to, tx)), withdrawnInvites: affected.length };
  });
}

/**
 * For each day, how many approved drivers could take this member — car, help, checks, safeguarding exclusions
 * and the driver's own calendar (rules 1, 2, 3, 5, 6). Rule 4 (already driving at that time) needs a time, so it
 * is applied when the lift is booked. Counts only: no driver is named.
 */
export async function freeDriversByDay(memberId: string, from: string, to: string): Promise<{ date: string; driversFree: number }[]> {
  const [member] = await db
    .select({ id: members.id, mobilityAids: members.mobilityAids, helpNeeded: members.helpNeeded, vehicleRequirement: members.vehicleRequirement })
    .from(members)
    .where(eq(members.id, memberId));
  if (!member) throw notFound('Member');

  const pool = await db.select().from(drivers).where(eq(drivers.status, 'approved'));
  const ids = pool.map((d) => d.id);
  const exclusions = ids.length ? await db.select().from(driverExclusions).where(and(eq(driverExclusions.memberId, memberId), inArray(driverExclusions.driverId, ids))) : [];
  const off = ids.length
    ? await db
        .select({ driverId: driverDaysOff.driverId, day: driverDaysOff.day })
        .from(driverDaysOff)
        .where(and(inArray(driverDaysOff.driverId, ids), gte(driverDaysOff.day, from), lte(driverDaysOff.day, to)))
    : [];

  const asDate = (d: string | null) => (d ? new Date(`${d}T00:00:00Z`) : null);
  const base: MatchDriver[] = pool.map((d) => ({
    id: d.id,
    status: d.status,
    approvedUntil: asDate(d.approvedUntil),
    dbsExpiry: asDate(d.dbsRenewalDate),
    insuranceExpiry: asDate(d.insuranceExpiry),
    passengerSeats: d.passengerSeats,
    vehicleCaps: d.vehicleCaps as VehicleCap[],
    helpCaps: d.helpCaps as HelpCap[],
    busyTimes: [],
    excludedMemberIds: exclusions.filter((e) => e.driverId === d.id).map((e) => e.memberId),
    daysOff: off.filter((o) => o.driverId === d.id).map((o) => o.day),
  }));
  const needs = {
    id: member.id,
    mobilityAids: member.mobilityAids as MobilityAid[],
    helpNeeded: member.helpNeeded as HelpNeeded[],
    vehicleRequirement: member.vehicleRequirement as VehicleRequirement,
  };
  return isoDayRange(from, to).map((date) => ({
    date,
    // Midday UTC is the same calendar day in London all year round.
    driversFree: findEligibleDrivers(needs, { pickupAt: new Date(`${date}T12:00:00Z`), returnAt: null, companion: false }, base).eligible.length,
  }));
}
