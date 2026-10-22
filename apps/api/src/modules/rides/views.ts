import {
  DRIVER_DETAIL_ACCESS,
  HEALTH_FLAGS,
  HELP_NEEDED,
  MOBILITY_AIDS,
  VEHICLE_REQUIREMENTS,
  isCancellable,
  labelList,
  postcodeArea,
  type RideStatus,
} from '@psebc/shared';
import { query, queryOne } from '../../db/pool';
import { forbidden, notFound } from '../../lib/errors';
import type { SessionUser } from '../../middleware/auth';
import { audit, type Actor } from '../../services/audit';
import { getMember, health, type MemberRow } from '../members/repo';
import { getRide, type RideRow } from './repo';

/** What the member and driver both see about needs — labels only, no health (invite + "David knows"). */
export function needsSummary(m: Pick<MemberRow, 'mobility_aids' | 'help_needed' | 'vehicle_requirement'>, ride?: Pick<RideRow, 'companion'>): string[] {
  const items = [...labelList(MOBILITY_AIDS, m.mobility_aids), ...labelList(HELP_NEEDED, m.help_needed)];
  if (m.vehicle_requirement && m.vehicle_requirement !== 'any') items.push(VEHICLE_REQUIREMENTS[m.vehicle_requirement as keyof typeof VEHICLE_REQUIREMENTS]);
  if (ride?.companion && !m.help_needed.includes('carer_travels')) items.push('A carer or companion is travelling');
  return items;
}

function rideCore(r: RideRow) {
  return {
    id: r.id,
    status: r.status,
    pickupAt: r.pickup_at,
    destination: r.destination,
    returnNeeded: r.return_needed,
    returnAt: r.return_needed ? r.return_at : null,
    returnCancelled: r.return_cancelled,
    companion: r.companion,
    createdAt: r.created_at,
  };
}

interface DriverCard {
  id: string;
  full_name: string;
  phone: string;
  photo_doc_id: string | null;
  vehicle_make_model: string;
  vehicle_colour: string;
  vehicle_reg: string;
}

async function driverCard(driverId: string | null) {
  if (!driverId) return null;
  const d = await queryOne<DriverCard>('SELECT id, full_name, phone, photo_doc_id, vehicle_make_model, vehicle_colour, vehicle_reg FROM drivers WHERE id = $1', [driverId]);
  if (!d) return null;
  return {
    id: d.id,
    firstName: d.full_name.split(' ')[0],
    photoUrl: d.photo_doc_id ? `/api/documents/${d.photo_doc_id}` : null,
    vehicle: { makeModel: d.vehicle_make_model, colour: d.vehicle_colour, registration: d.vehicle_reg },
  };
}

async function logsFor(rideId: string) {
  const logs = await query<{ author: string; went_as_planned: boolean | null; anything_to_report: boolean | null; needs_changed: boolean | null; on_time: string | null; felt_safe: boolean | null; rating: number | null; callback_requested: boolean; comments: string; submitted_by_role: string; created_at: Date }>(
    'SELECT author, went_as_planned, anything_to_report, needs_changed, on_time, felt_safe, rating, callback_requested, comments, submitted_by_role, created_at FROM trip_logs WHERE ride_id = $1',
    [rideId],
  );
  const pick = (a: string) => logs.find((l) => l.author === a) ?? null;
  return { driver: pick('driver'), member: pick('member') };
}

/** Role-aware view of one ride. Enforces "who can see what" (PRD §3) and time-limited access (story 4.3). */
export async function rideView(user: SessionUser, actor: Actor, rideId: string) {
  const ride = await getRide(rideId);
  if (!ride) throw notFound('Lift');

  // ---- Member (own lift) and church office --------------------------------
  const isOwnMember = user.role === 'member' && user.memberId === ride.member_id;
  const isOffice = user.role === 'coordinator' || user.role === 'admin';
  if (isOwnMember || isOffice || user.role === 'safeguarding') {
    const member = (await getMember(ride.member_id))!;
    const showDriver = ['driver_found', 'completed', 'logged', 'signed_off'].includes(ride.status);
    const logs = await logsFor(ride.id);
    const base = {
      view: 'member' as const,
      ride: {
        ...rideCore(ride),
        pickupAddress: ride.pickup_address,
        needsNote: ride.needs_note,
        bookedByRole: ride.booked_by_role,
        cancelReason: ride.cancel_reason,
        rebookedFromId: ride.rebooked_from_id,
        pickedUpAt: ride.picked_up_at,
        droppedOffAt: ride.dropped_off_at,
        notAtPickupAt: ride.not_at_pickup_at,
        unmatchedFlaggedAt: ride.unmatched_flagged_at,
        signedOffAt: ride.signed_off_at,
      },
      member: { id: member.id, fullName: member.full_name, preferredName: member.preferred_name, phone: isOwnMember ? undefined : member.phone },
      driver: showDriver ? await driverCard(ride.driver_id) : null,
      driverKnows: needsSummary(member, ride),
      canCancel: isCancellable(ride.status, ride.pickup_at) && user.role !== 'safeguarding',
      canRebook: ride.status === 'cancelled' && user.role !== 'safeguarding',
      memberLogDone: !!logs.member,
      canLog: ['completed', 'logged'].includes(ride.status) && !logs.member && user.role !== 'safeguarding',
    };
    if (isOffice || user.role === 'safeguarding') {
      const invites = await query<{ driver_id: string; full_name: string; status: string; decline_reason: string | null }>(
        `SELECT i.driver_id, d.full_name, i.status, i.decline_reason FROM ride_invites i JOIN drivers d ON d.id = i.driver_id WHERE i.ride_id = $1 ORDER BY i.sent_at`,
        [ride.id],
      );
      return {
        ...base,
        view: 'office' as const,
        invites: invites.map((i) => ({ driverId: i.driver_id, name: i.full_name, status: i.status, declineReason: i.decline_reason })),
        logs: {
          driver: logs.driver ? { ...logs.driver } : null,
          member: logs.member ? { ...logs.member } : null,
        },
      };
    }
    return base;
  }

  // ---- Driver ------------------------------------------------------------
  if (user.role === 'driver' && user.driverId) {
    if (ride.driver_id === user.driverId) {
      if (DRIVER_DETAIL_ACCESS.includes(ride.status)) return driverTripView(ride, actor);
      // Story 4.3: after sign-off the driver keeps only the trip record.
      return {
        view: 'driver_record' as const,
        ride: { ...rideCore(ride), pickedUpAt: ride.picked_up_at, droppedOffAt: ride.dropped_off_at },
        message: ride.status === 'signed_off' ? 'This trip is closed. Member details are no longer shown.' : 'This lift is closed.',
      };
    }
    const invite = await queryOne<{ status: string }>('SELECT status FROM ride_invites WHERE ride_id = $1 AND driver_id = $2', [ride.id, user.driverId]);
    if (invite) return inviteView(ride, invite.status);
  }
  throw forbidden();
}

/** Story 3.2: the invite shows date, time, pickup area, destination and needs summary only. */
async function inviteView(ride: RideRow, inviteStatus: string) {
  const m = (await getMember(ride.member_id))!;
  const sent = await queryOne<{ n: number }>(`SELECT count(*) AS n FROM ride_invites WHERE ride_id = $1`, [ride.id]);
  const open = inviteStatus === 'sent' && ['invites_sent', 'unmatched'].includes(ride.status) && ride.pickup_at > new Date();
  return {
    view: 'invite' as const,
    ride: {
      id: ride.id,
      status: ride.status,
      pickupAt: ride.pickup_at,
      pickupArea: `${postcodeArea(m.postcode)}, ${m.town}`,
      destination: ride.destination,
      returnNeeded: ride.return_needed,
      returnAt: ride.return_needed ? ride.return_at : null,
    },
    needs: needsSummary(m, ride),
    invitedCount: sent?.n ?? 0,
    inviteStatus,
    open,
    closedReason: open ? null : inviteStatus === 'withdrawn' || ride.status === 'driver_found' ? 'Another driver has already accepted this lift.' : ride.status === 'cancelled' ? 'This lift was cancelled.' : 'This request is closed.',
  };
}

/** Story 4.2: after acceptance the driver sees name, address, phone, emergency contact and consented health notes. */
async function driverTripView(ride: RideRow, actor: Actor) {
  const m = (await getMember(ride.member_id))!;
  const h = m.consent_given ? health(m) : { flags: [], unwellInstructions: '' };
  const logs = await logsFor(ride.id);
  await audit(actor, { action: 'member.view_needs', entityType: 'member', entityId: m.id, details: { via: 'driver_trip', rideId: ride.id } });
  return {
    view: 'driver_trip' as const,
    ride: {
      ...rideCore(ride),
      pickupAddress: ride.pickup_address,
      needsNote: ride.needs_note,
      pickedUpAt: ride.picked_up_at,
      droppedOffAt: ride.dropped_off_at,
      notAtPickupAt: ride.not_at_pickup_at,
      completedAt: ride.completed_at,
    },
    member: {
      preferredName: m.preferred_name,
      fullName: m.full_name,
      phone: m.phone,
      findingNotes: m.finding_notes,
      emergencyName: m.emergency_name,
      emergencyRelationship: m.emergency_relationship,
      emergencyPhone: m.emergency_phone,
      howToHelp: needsSummary(m, ride),
      notesForDriver: m.notes_for_driver,
      healthNotes: labelList(HEALTH_FLAGS, h.flags),
      unwellInstructions: h.unwellInstructions,
      needsUpdatedAt: m.needs_updated_at,
    },
    driverLogDone: !!logs.driver,
    canWithdraw: ride.status === 'driver_found' && ride.pickup_at > new Date(),
  };
}

export async function memberRides(memberId: string) {
  const rows = await query<RideRow & { driver_name: string | null; member_logged: boolean }>(
    `SELECT r.*, d.full_name AS driver_name,
            EXISTS (SELECT 1 FROM trip_logs l WHERE l.ride_id = r.id AND l.author = 'member') AS member_logged
       FROM rides r LEFT JOIN drivers d ON d.id = r.driver_id
      WHERE r.member_id = $1 AND (r.pickup_at > now() - interval '30 days')
      ORDER BY r.pickup_at`,
    [memberId],
  );
  const toItem = (r: (typeof rows)[number]) => ({
    ...rideCore(r),
    driverFirstName: r.driver_name && ['driver_found', 'completed', 'logged', 'signed_off'].includes(r.status) ? r.driver_name.split(' ')[0] : null,
    needsLog: ['completed', 'logged'].includes(r.status) && !r.member_logged,
  });
  const upcoming = rows.filter((r) => ['requested', 'invites_sent', 'unmatched', 'driver_found'].includes(r.status) && r.pickup_at > new Date(Date.now() - 6 * 3_600_000)).map(toItem);
  const toLog = rows.filter((r) => ['completed', 'logged'].includes(r.status) && !r.member_logged).map(toItem);
  const past = rows.filter((r) => !upcoming.some((u) => u.id === r.id)).reverse().slice(0, 10).map(toItem);
  return { upcoming, toLog, past };
}

export async function driverHome(driverId: string) {
  const driver = await queryOne<{ full_name: string; status: string; approved_until: string | null; lone_working_ack_at: Date | null; dbs_renewal_date: string; insurance_expiry: string }>(
    'SELECT full_name, status, approved_until, lone_working_ack_at, dbs_renewal_date, insurance_expiry FROM drivers WHERE id = $1',
    [driverId],
  );
  if (!driver) throw notFound('Driver');
  const invites = await query<RideRow & { postcode: string; town: string }>(
    `SELECT r.*, m.postcode, m.town FROM ride_invites i
       JOIN rides r ON r.id = i.ride_id JOIN members m ON m.id = r.member_id
      WHERE i.driver_id = $1 AND i.status = 'sent' AND r.status IN ('invites_sent', 'unmatched') AND r.pickup_at > now()
      ORDER BY r.pickup_at`,
    [driverId],
  );
  const trips = await query<RideRow & { preferred_name: string; town: string; driver_logged: boolean }>(
    `SELECT r.*, m.preferred_name, m.town,
            EXISTS (SELECT 1 FROM trip_logs l WHERE l.ride_id = r.id AND l.author = 'driver') AS driver_logged
       FROM rides r JOIN members m ON m.id = r.member_id
      WHERE r.driver_id = $1 AND r.status IN ('driver_found', 'completed', 'logged')
      ORDER BY r.pickup_at`,
    [driverId],
  );
  const validTo = [driver.approved_until, driver.dbs_renewal_date, driver.insurance_expiry].filter(Boolean).sort()[0] ?? null;
  return {
    driver: { firstName: driver.full_name.split(' ')[0], status: driver.status, validTo, loneWorkingAcknowledged: !!driver.lone_working_ack_at },
    invites: invites.map((r) => ({ id: r.id, pickupAt: r.pickup_at, pickupArea: `${postcodeArea(r.postcode)}, ${r.town}`, destination: r.destination, returnAt: r.return_needed ? r.return_at : null })),
    trips: trips.map((r) => ({
      id: r.id,
      status: r.status as RideStatus,
      pickupAt: r.pickup_at,
      memberName: r.preferred_name,
      town: r.town,
      needsLog: ['completed', 'logged'].includes(r.status) && !r.driver_logged,
    })),
  };
}
