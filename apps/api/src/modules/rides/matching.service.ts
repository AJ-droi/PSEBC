import type { PoolClient } from 'pg';
import {
  DRIVER_BUSY,
  INELIGIBLE_LABELS,
  findEligibleDrivers,
  type MatchDriver,
  type MatchMemberNeeds,
  type HelpCap,
  type HelpNeeded,
  type MobilityAid,
  type VehicleCap,
  type VehicleRequirement,
  type DriverStatus,
  type IneligibleReason,
} from '@psebc/shared';
import { query } from '../../db/pool';
import { formatWhen } from '../../lib/time';
import { audit, type Actor } from '../../services/audit';
import { notifyDriver, notifyRole } from '../../services/notify';
import type { RideRow } from './repo';

interface DriverRow {
  id: string;
  status: DriverStatus;
  approved_until: string | null;
  dbs_renewal_date: string | null;
  insurance_expiry: string | null;
  passenger_seats: number;
  vehicle_caps: VehicleCap[];
  help_caps: HelpCap[];
}

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
export async function matchAndInvite(db: PoolClient, ride: RideRow, actor: Actor): Promise<MatchOutcome> {
  const [member] = await query<{ id: string; mobility_aids: MobilityAid[]; help_needed: HelpNeeded[]; vehicle_requirement: VehicleRequirement; postcode: string; town: string }>(
    'SELECT id, mobility_aids, help_needed, vehicle_requirement, postcode, town FROM members WHERE id = $1',
    [ride.member_id],
    db,
  );
  if (!member) throw new Error('member missing for ride');

  const drivers = await query<DriverRow>(
    `SELECT id, status, approved_until, dbs_renewal_date, insurance_expiry, passenger_seats, vehicle_caps, help_caps
       FROM drivers WHERE status <> 'closed'`,
    [],
    db,
  );
  const busy = await query<{ driver_id: string; pickup_at: Date; return_at: Date | null }>(
    `SELECT driver_id, pickup_at, return_at FROM rides
      WHERE driver_id IS NOT NULL AND status = ANY($1::ride_status[]) AND id <> $2
        AND pickup_at BETWEEN $3::timestamptz - interval '1 day' AND $3::timestamptz + interval '1 day'`,
    [DRIVER_BUSY, ride.id, ride.pickup_at],
    db,
  );
  const exclusions = await query<{ driver_id: string; member_id: string }>('SELECT driver_id, member_id FROM driver_exclusions WHERE member_id = $1', [member.id], db);
  const priorInvites = await query<{ driver_id: string; status: string }>('SELECT driver_id, status FROM ride_invites WHERE ride_id = $1', [ride.id], db);
  const alreadyAsked = new Set(priorInvites.filter((i) => i.status === 'sent' || i.status === 'declined').map((i) => i.driver_id));

  const needs: MatchMemberNeeds = {
    id: member.id,
    mobilityAids: member.mobility_aids,
    helpNeeded: member.help_needed,
    vehicleRequirement: member.vehicle_requirement,
  };
  const candidates: MatchDriver[] = drivers.map((d) => ({
    id: d.id,
    status: d.status,
    approvedUntil: asDate(d.approved_until),
    dbsExpiry: asDate(d.dbs_renewal_date),
    insuranceExpiry: asDate(d.insurance_expiry),
    passengerSeats: d.passenger_seats,
    vehicleCaps: d.vehicle_caps,
    helpCaps: d.help_caps,
    busyTimes: busy.filter((b) => b.driver_id === d.id).flatMap((b) => [b.pickup_at, b.return_at].filter((t): t is Date => !!t)),
    excludedMemberIds: exclusions.filter((e) => e.driver_id === d.id).map((e) => e.member_id),
  }));

  const result = findEligibleDrivers(
    needs,
    { pickupAt: ride.pickup_at, returnAt: ride.return_needed ? ride.return_at : null, companion: ride.companion },
    candidates,
  );
  const toInvite = result.eligible.filter((id) => !alreadyAsked.has(id));
  const stillOpen = priorInvites.some((i) => i.status === 'sent');

  for (const driverId of toInvite) {
    await db.query(
      `INSERT INTO ride_invites (ride_id, driver_id) VALUES ($1, $2)
       ON CONFLICT (ride_id, driver_id) DO UPDATE SET status = 'sent', sent_at = now(), responded_at = NULL, decline_reason = NULL`,
      [ride.id, driverId],
    );
    await notifyDriver(db, driverId, {
      kind: 'invite',
      title: 'New lift request',
      body: `${formatWhen(ride.pickup_at)} from ${member.postcode.split(' ')[0]}, ${member.town} to ${ride.destination}. First to accept gets the lift.`,
      link: `/driver/invites/${ride.id}`,
      rideId: ride.id,
    });
  }

  const status: MatchOutcome['status'] = toInvite.length > 0 || stillOpen ? 'invites_sent' : 'unmatched';
  await db.query(
    `UPDATE rides SET status = $2::ride_status, unmatched_flagged_at = CASE WHEN $2::text = 'unmatched' THEN now() ELSE NULL END, updated_at = now() WHERE id = $1`,
    [ride.id, status],
  );

  if (status === 'unmatched') {
    const counts = result.rejected.reduce<Record<string, number>>((acc, r) => {
      acc[INELIGIBLE_LABELS[r.reason]] = (acc[INELIGIBLE_LABELS[r.reason]] ?? 0) + 1;
      return acc;
    }, {});
    const why = Object.entries(counts)
      .map(([k, v]) => `${v} ${k.toLowerCase()}`)
      .join('; ');
    await notifyRole(
      db,
      ['coordinator', 'admin'],
      {
        kind: 'unmatched',
        title: 'No driver for a lift',
        body: `No eligible driver for ${formatWhen(ride.pickup_at)}. ${why || 'No approved drivers yet.'}`,
        link: `/office/rides/${ride.id}`,
        rideId: ride.id,
      },
      { email: true },
    );
  }

  await audit(
    actor,
    {
      action: 'ride.match',
      entityType: 'ride',
      entityId: ride.id,
      details: { invited: toInvite.length, eligible: result.eligible.length, rejected: result.rejected, status },
    },
    db,
  );
  return { invited: toInvite, eligibleCount: result.eligible.length, rejected: result.rejected, status };
}
