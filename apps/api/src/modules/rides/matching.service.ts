import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import {
  DRIVER_BUSY,
  INELIGIBLE_LABELS,
  findEligibleDrivers,
  type HelpCap,
  type HelpNeeded,
  type IneligibleReason,
  type MatchDriver,
  type MatchMemberNeeds,
  type MobilityAid,
  type VehicleCap,
  type VehicleRequirement,
} from '@psebc/shared';
import type { Tx } from '../../db/client';
import { driverExclusions, drivers, members, rideInvites, rides, type Ride } from '../../db/schema';
import { formatWhen } from '../../lib/time';
import { audit, type Actor } from '../../services/audit';
import { notifyDriver, notifyRole } from '../../services/notify';

export interface MatchOutcome {
  invited: string[];
  eligibleCount: number;
  rejected: { driverId: string; reason: IneligibleReason }[];
  status: 'invites_sent' | 'unmatched';
}

const asDate = (d: string | null) => (d ? new Date(`${d}T00:00:00Z`) : null);

/**
 * Story 3.1 / 3.2 (PSEBC-17, PSEBC-18): filter drivers with the five rules and
 * invite every eligible driver at once. If no one is eligible the request goes
 * straight to the coordinator rather than waiting (PRD §8).
 *
 * Must be called inside a transaction that already holds a row lock on the ride.
 */
export async function matchAndInvite(tx: Tx, ride: Ride, actor: Actor): Promise<MatchOutcome> {
  const [member] = await tx
    .select({ id: members.id, mobilityAids: members.mobilityAids, helpNeeded: members.helpNeeded, vehicleRequirement: members.vehicleRequirement, postcode: members.postcode, town: members.town })
    .from(members)
    .where(eq(members.id, ride.memberId));
  if (!member) throw new Error('member missing for ride');

  const candidates = await tx.select().from(drivers).where(ne(drivers.status, 'closed'));
  const busy = await tx
    .select({ driverId: rides.driverId, pickupAt: rides.pickupAt, returnAt: rides.returnAt })
    .from(rides)
    .where(
      and(
        inArray(rides.status, [...DRIVER_BUSY]),
        ne(rides.id, ride.id),
        sql`${rides.driverId} IS NOT NULL`,
        sql`${rides.pickupAt} BETWEEN ${ride.pickupAt}::timestamptz - interval '1 day' AND ${ride.pickupAt}::timestamptz + interval '1 day'`,
      ),
    );
  const exclusions = await tx.select().from(driverExclusions).where(eq(driverExclusions.memberId, member.id));
  const priorInvites = await tx.select({ driverId: rideInvites.driverId, status: rideInvites.status }).from(rideInvites).where(eq(rideInvites.rideId, ride.id));
  const alreadyAsked = new Set(priorInvites.filter((i) => i.status === 'sent' || i.status === 'declined').map((i) => i.driverId));

  const needs: MatchMemberNeeds = {
    id: member.id,
    mobilityAids: member.mobilityAids as MobilityAid[],
    helpNeeded: member.helpNeeded as HelpNeeded[],
    vehicleRequirement: member.vehicleRequirement as VehicleRequirement,
  };
  const pool: MatchDriver[] = candidates.map((d) => ({
    id: d.id,
    status: d.status,
    approvedUntil: asDate(d.approvedUntil),
    dbsExpiry: asDate(d.dbsRenewalDate),
    insuranceExpiry: asDate(d.insuranceExpiry),
    passengerSeats: d.passengerSeats,
    vehicleCaps: d.vehicleCaps as VehicleCap[],
    helpCaps: d.helpCaps as HelpCap[],
    busyTimes: busy.filter((b) => b.driverId === d.id).flatMap((b) => [b.pickupAt, b.returnAt].filter((t): t is Date => !!t)),
    excludedMemberIds: exclusions.filter((e) => e.driverId === d.id).map((e) => e.memberId),
  }));

  const result = findEligibleDrivers(needs, { pickupAt: ride.pickupAt, returnAt: ride.returnNeeded ? ride.returnAt : null, companion: ride.companion }, pool);
  const toInvite = result.eligible.filter((id) => !alreadyAsked.has(id));
  const stillOpen = priorInvites.some((i) => i.status === 'sent');

  for (const driverId of toInvite) {
    await tx
      .insert(rideInvites)
      .values({ rideId: ride.id, driverId })
      .onConflictDoUpdate({
        target: [rideInvites.rideId, rideInvites.driverId],
        set: { status: 'sent', sentAt: sql`now()`, respondedAt: null, declineReason: null },
      });
    await notifyDriver(tx, driverId, {
      kind: 'invite',
      title: 'New lift request',
      body: `${formatWhen(ride.pickupAt)} from ${member.postcode.split(' ')[0]}, ${member.town} to ${ride.destination}. First to accept gets the lift.`,
      link: `/driver/invites/${ride.id}`,
      rideId: ride.id,
    });
  }

  const status: MatchOutcome['status'] = toInvite.length > 0 || stillOpen ? 'invites_sent' : 'unmatched';
  await tx
    .update(rides)
    .set({ status, unmatchedFlaggedAt: status === 'unmatched' ? new Date() : null, updatedAt: sql`now()` })
    .where(eq(rides.id, ride.id));

  if (status === 'unmatched') {
    const counts = result.rejected.reduce<Record<string, number>>((acc, r) => {
      acc[INELIGIBLE_LABELS[r.reason]] = (acc[INELIGIBLE_LABELS[r.reason]] ?? 0) + 1;
      return acc;
    }, {});
    const why = Object.entries(counts)
      .map(([k, v]) => `${v} ${k.toLowerCase()}`)
      .join('; ');
    await notifyRole(
      tx,
      ['coordinator', 'admin'],
      { kind: 'unmatched', title: 'No driver for a lift', body: `No eligible driver for ${formatWhen(ride.pickupAt)}. ${why || 'No approved drivers yet.'}`, link: `/office/rides/${ride.id}`, rideId: ride.id },
      { email: true },
    );
  }

  await audit(actor, { action: 'ride.match', entityType: 'ride', entityId: ride.id, details: { invited: toInvite.length, eligible: result.eligible.length, rejected: result.rejected, status } }, tx);
  return { invited: toInvite, eligibleCount: result.eligible.length, rejected: result.rejected, status };
}
