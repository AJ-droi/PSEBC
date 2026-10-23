import { and, asc, count, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import {
  DRIVER_DETAIL_ACCESS,
  HEALTH_FLAGS,
  HELP_NEEDED,
  MOBILITY_AIDS,
  VEHICLE_REQUIREMENTS,
  RIDE_DISPLAY_LABELS,
  isCancellable,
  labelList,
  rideDisplayStatus,
  postcodeArea,
} from '@psebc/shared';
import { db } from '../../db/client';
import { tripLogExists } from '../../db/sql';
import { drivers, members, rideInvites, rides, tripLogs, type Member, type Ride } from '../../db/schema';
import { forbidden, notFound } from '../../lib/errors';
import type { SessionUser } from '../../middleware/auth';
import { audit, type Actor } from '../../services/audit';
import { getMember, health } from '../members/repo';
import { getRide } from './repo';

const DRIVER_VISIBLE_TO_MEMBER = ['driver_found', 'completed', 'logged', 'signed_off'];

/** What the member and driver both see about needs — labels only, no health (invite + "David knows"). */
export function needsSummary(m: Pick<Member, 'mobilityAids' | 'helpNeeded' | 'vehicleRequirement'>, ride?: Pick<Ride, 'companion'>): string[] {
  const items = [...labelList(MOBILITY_AIDS, m.mobilityAids), ...labelList(HELP_NEEDED, m.helpNeeded)];
  if (m.vehicleRequirement && m.vehicleRequirement !== 'any') items.push(VEHICLE_REQUIREMENTS[m.vehicleRequirement as keyof typeof VEHICLE_REQUIREMENTS]);
  if (ride?.companion && !m.helpNeeded.includes('carer_travels')) items.push('A carer or companion is travelling');
  return items;
}

/** Status plus what screens should show for it ("Incident reported" overrides until sign-off). */
export function statusFields(r: Pick<Ride, 'status' | 'incidentReportedAt'>) {
  const displayStatus = rideDisplayStatus(r.status, r.incidentReportedAt);
  return { status: r.status, displayStatus, statusLabel: RIDE_DISPLAY_LABELS[displayStatus], incidentReportedAt: r.incidentReportedAt };
}

function rideCore(r: Ride) {
  return {
    id: r.id,
    ...statusFields(r),
    pickupAt: r.pickupAt,
    destination: r.destination,
    returnNeeded: r.returnNeeded,
    returnAt: r.returnNeeded ? r.returnAt : null,
    returnCancelled: r.returnCancelled,
    companion: r.companion,
    createdAt: r.createdAt,
  };
}

async function driverCard(driverId: string | null) {
  if (!driverId) return null;
  const [d] = await db.select().from(drivers).where(eq(drivers.id, driverId));
  if (!d) return null;
  return {
    id: d.id,
    firstName: d.fullName.split(' ')[0],
    photoUrl: d.photoDocId ? `/api/documents/${d.photoDocId}` : null,
    vehicle: { makeModel: d.vehicleMakeModel, colour: d.vehicleColour, registration: d.vehicleReg },
  };
}

async function logsFor(rideId: string) {
  const logs = await db.select().from(tripLogs).where(eq(tripLogs.rideId, rideId));
  const pick = (a: 'driver' | 'member') => {
    const l = logs.find((x) => x.author === a);
    if (!l) return null;
    const { id: _id, rideId: _r, submittedBy: _s, ...rest } = l;
    return rest;
  };
  return { driver: pick('driver'), member: pick('member') };
}

/** Role-aware view of one ride. Enforces "who can see what" (PRD §3) and time-limited access (story 4.3). */
export async function rideView(user: SessionUser, actor: Actor, rideId: string) {
  const ride = await getRide(rideId);
  if (!ride) throw notFound('Lift');

  // ---- Member (own lift), church office and safeguarding --------------------
  const isOwnMember = user.role === 'member' && user.memberId === ride.memberId;
  const isOffice = user.role === 'coordinator' || user.role === 'admin';
  if (isOwnMember || isOffice || user.role === 'safeguarding') {
    const member = (await getMember(ride.memberId))!;
    const logs = await logsFor(ride.id);
    const base = {
      view: 'member' as const,
      ride: {
        ...rideCore(ride),
        pickupAddress: ride.pickupAddress,
        needsNote: ride.needsNote,
        bookedByRole: ride.bookedByRole,
        cancelReason: ride.cancelReason,
        rebookedFromId: ride.rebookedFromId,
        pickedUpAt: ride.pickedUpAt,
        droppedOffAt: ride.droppedOffAt,
        notAtPickupAt: ride.notAtPickupAt,
        unmatchedFlaggedAt: ride.unmatchedFlaggedAt,
        signedOffAt: ride.signedOffAt,
      },
      member: { id: member.id, fullName: member.fullName, preferredName: member.preferredName, phone: isOwnMember ? undefined : member.phone },
      driver: DRIVER_VISIBLE_TO_MEMBER.includes(ride.status) ? await driverCard(ride.driverId) : null,
      driverKnows: needsSummary(member, ride),
      canCancel: isCancellable(ride.status, ride.pickupAt) && user.role !== 'safeguarding',
      canRebook: ride.status === 'cancelled' && user.role !== 'safeguarding',
      memberLogDone: !!logs.member,
      canLog: ['completed', 'logged'].includes(ride.status) && !logs.member && user.role !== 'safeguarding',
    };
    if (isOwnMember) return base;
    const invites = await db
      .select({ driverId: rideInvites.driverId, name: drivers.fullName, status: rideInvites.status, declineReason: rideInvites.declineReason })
      .from(rideInvites)
      .innerJoin(drivers, eq(drivers.id, rideInvites.driverId))
      .where(eq(rideInvites.rideId, ride.id))
      .orderBy(asc(rideInvites.sentAt));
    return { ...base, view: 'office' as const, invites, logs };
  }

  // ---- Driver ------------------------------------------------------------
  if (user.role === 'driver' && user.driverId) {
    if (ride.driverId === user.driverId) {
      if (DRIVER_DETAIL_ACCESS.includes(ride.status)) return driverTripView(ride, actor);
      // Story 4.3: after sign-off the driver keeps only the trip record.
      return {
        view: 'driver_record' as const,
        ride: { ...rideCore(ride), pickedUpAt: ride.pickedUpAt, droppedOffAt: ride.droppedOffAt },
        message: ride.status === 'signed_off' ? 'This trip is closed. Member details are no longer shown.' : 'This lift is closed.',
      };
    }
    const [invite] = await db
      .select({ status: rideInvites.status })
      .from(rideInvites)
      .where(and(eq(rideInvites.rideId, ride.id), eq(rideInvites.driverId, user.driverId)));
    if (invite) return inviteView(ride, invite.status);
  }
  throw forbidden();
}

/** Story 3.2: the invite shows date, time, pickup area, destination and needs summary only. */
async function inviteView(ride: Ride, inviteStatus: string) {
  const m = (await getMember(ride.memberId))!;
  const [sent] = await db.select({ n: count() }).from(rideInvites).where(eq(rideInvites.rideId, ride.id));
  const open = inviteStatus === 'sent' && ['invites_sent', 'unmatched'].includes(ride.status) && ride.pickupAt > new Date();
  return {
    view: 'invite' as const,
    ride: {
      id: ride.id,
      status: ride.status,
      pickupAt: ride.pickupAt,
      pickupArea: `${postcodeArea(m.postcode)}, ${m.town}`,
      destination: ride.destination,
      returnNeeded: ride.returnNeeded,
      returnAt: ride.returnNeeded ? ride.returnAt : null,
    },
    needs: needsSummary(m, ride),
    invitedCount: sent?.n ?? 0,
    inviteStatus,
    open,
    closedReason: open
      ? null
      : inviteStatus === 'withdrawn' || ride.status === 'driver_found'
        ? 'Another driver has already accepted this lift.'
        : ride.status === 'cancelled'
          ? 'This lift was cancelled.'
          : 'This request is closed.',
  };
}

/** Story 4.2: after acceptance the driver sees name, address, phone, emergency contact and consented health notes. */
async function driverTripView(ride: Ride, actor: Actor) {
  const m = (await getMember(ride.memberId))!;
  const h = m.consentGiven ? health(m) : { flags: [], unwellInstructions: '' };
  const logs = await logsFor(ride.id);
  await audit(actor, { action: 'member.view_needs', entityType: 'member', entityId: m.id, details: { via: 'driver_trip', rideId: ride.id } });
  return {
    view: 'driver_trip' as const,
    ride: {
      ...rideCore(ride),
      pickupAddress: ride.pickupAddress,
      needsNote: ride.needsNote,
      pickedUpAt: ride.pickedUpAt,
      droppedOffAt: ride.droppedOffAt,
      notAtPickupAt: ride.notAtPickupAt,
      completedAt: ride.completedAt,
    },
    member: {
      preferredName: m.preferredName,
      fullName: m.fullName,
      phone: m.phone,
      findingNotes: m.findingNotes,
      emergencyName: m.emergencyName,
      emergencyRelationship: m.emergencyRelationship,
      emergencyPhone: m.emergencyPhone,
      howToHelp: needsSummary(m, ride),
      notesForDriver: m.notesForDriver,
      healthNotes: labelList(HEALTH_FLAGS, h.flags),
      unwellInstructions: h.unwellInstructions,
      needsUpdatedAt: m.needsUpdatedAt,
    },
    driverLogDone: !!logs.driver,
    canWithdraw: ride.status === 'driver_found' && ride.pickupAt > new Date(),
  };
}

export async function memberRides(memberId: string) {
  const rows = await db
    .select({ ride: rides, driverName: drivers.fullName, memberLogged: tripLogExists('member') })
    .from(rides)
    .leftJoin(drivers, eq(drivers.id, rides.driverId))
    .where(and(eq(rides.memberId, memberId), sql`${rides.pickupAt} > now() - interval '30 days'`))
    .orderBy(asc(rides.pickupAt));
  const toItem = ({ ride: r, driverName, memberLogged }: (typeof rows)[number]) => ({
    ...rideCore(r),
    driverFirstName: driverName && DRIVER_VISIBLE_TO_MEMBER.includes(r.status) ? driverName.split(' ')[0] : null,
    needsLog: ['completed', 'logged'].includes(r.status) && !memberLogged,
  });
  const soon = new Date(Date.now() - 6 * 3_600_000);
  const isUpcoming = (r: Ride) => ['requested', 'invites_sent', 'unmatched', 'driver_found'].includes(r.status) && r.pickupAt > soon;
  return {
    upcoming: rows.filter((x) => isUpcoming(x.ride)).map(toItem),
    toLog: rows.filter((x) => ['completed', 'logged'].includes(x.ride.status) && !x.memberLogged).map(toItem),
    past: rows
      .filter((x) => !isUpcoming(x.ride))
      .reverse()
      .slice(0, 10)
      .map(toItem),
  };
}

export async function driverHome(driverId: string) {
  const [driver] = await db.select().from(drivers).where(eq(drivers.id, driverId));
  if (!driver) throw notFound('Driver');
  const invites = await db
    .select({ ride: rides, postcode: members.postcode, town: members.town })
    .from(rideInvites)
    .innerJoin(rides, eq(rides.id, rideInvites.rideId))
    .innerJoin(members, eq(members.id, rides.memberId))
    .where(and(eq(rideInvites.driverId, driverId), eq(rideInvites.status, 'sent'), inArray(rides.status, ['invites_sent', 'unmatched']), gt(rides.pickupAt, new Date())))
    .orderBy(asc(rides.pickupAt));
  const trips = await db
    .select({ ride: rides, preferredName: members.preferredName, town: members.town, driverLogged: tripLogExists('driver') })
    .from(rides)
    .innerJoin(members, eq(members.id, rides.memberId))
    .where(and(eq(rides.driverId, driverId), inArray(rides.status, ['driver_found', 'completed', 'logged'])))
    .orderBy(asc(rides.pickupAt));
  const validTo = [driver.approvedUntil, driver.dbsRenewalDate, driver.insuranceExpiry].filter(Boolean).sort()[0] ?? null;
  return {
    driver: { firstName: driver.fullName.split(' ')[0], status: driver.status, validTo, loneWorkingAcknowledged: !!driver.loneWorkingAckAt },
    invites: invites.map(({ ride: r, postcode, town }) => ({
      id: r.id,
      pickupAt: r.pickupAt,
      pickupArea: `${postcodeArea(postcode)}, ${town}`,
      destination: r.destination,
      returnAt: r.returnNeeded ? r.returnAt : null,
    })),
    trips: trips.map(({ ride: r, preferredName, town, driverLogged }) => ({
      id: r.id,
      ...statusFields(r),
      pickupAt: r.pickupAt,
      memberName: preferredName,
      town,
      needsLog: ['completed', 'logged'].includes(r.status) && !driverLogged,
    })),
  };
}

/** Every lift for one member, newest first, one page at a time (office member page). */
export async function memberRideHistory(memberId: string, page: { limit: number; offset: number }) {
  const rows = await db
    .select({ ride: rides, driverName: drivers.fullName })
    .from(rides)
    .leftJoin(drivers, eq(drivers.id, rides.driverId))
    .where(eq(rides.memberId, memberId))
    .orderBy(desc(rides.pickupAt), desc(rides.id))
    .limit(page.limit)
    .offset(page.offset);
  const total = await db.$count(rides, eq(rides.memberId, memberId));
  return {
    rows: rows.map(({ ride: r, driverName }) => ({
      ...rideCore(r),
      driverFirstName: driverName && DRIVER_VISIBLE_TO_MEMBER.includes(r.status) ? driverName.split(' ')[0] : null,
    })),
    total,
  };
}
