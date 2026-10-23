import { and, count, eq, sql } from 'drizzle-orm';
import {
  CANCEL_REASONS,
  DECLINE_REASONS,
  RULES,
  assertTransition,
  isCancellable,
  type CancelPart,
  type CancelReason,
  type DeclineReason,
  type RideRequestInput,
} from '@psebc/shared';
import { withTx, type Tx } from '../../db/client';
import { drivers, rideInvites, rides, tripLogs, type Ride } from '../../db/schema';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import { addHours, formatWhen } from '../../lib/time';
import { audit, type Actor } from '../../services/audit';
import { notifyDriver, notifyMember, notifyRole, notifyUsers } from '../../services/notify';
import type { SessionUser } from '../../middleware/auth';
import { getMember } from '../members/repo';
import { matchAndInvite } from './matching.service';
import { getRide, lockRide, setStatus } from './repo';

const OFFICE = ['coordinator', 'admin'] as const;
const isOffice = (u: SessionUser) => (OFFICE as readonly string[]).includes(u.role);

/** Who may act for this member: the member themself or the church office (story 2.2). */
export function assertCanActForMember(user: SessionUser, memberId: string): void {
  if (isOffice(user)) return;
  if (user.role === 'member' && user.memberId === memberId) return;
  throw forbidden();
}

function requireDriver(user: SessionUser): string {
  if (user.role !== 'driver' || !user.driverId) throw forbidden('Only volunteer drivers can do this');
  return user.driverId;
}

const withdrawOpenInvites = (tx: Tx, rideId: string) =>
  tx
    .update(rideInvites)
    .set({ status: 'withdrawn', respondedAt: sql`now()` })
    .where(and(eq(rideInvites.rideId, rideId), eq(rideInvites.status, 'sent')))
    .returning({ driverId: rideInvites.driverId });

// ---------------------------------------------------------------------------
// F04 Request a ride (story 2.1 PSEBC-12, 2.2 PSEBC-13)
// ---------------------------------------------------------------------------

export async function requestRide(user: SessionUser, actor: Actor, input: RideRequestInput, opts: { rebookedFrom?: string } = {}) {
  const memberId = user.role === 'member' ? user.memberId : input.memberId;
  if (!memberId) throw badRequest('Choose the member this lift is for');
  assertCanActForMember(user, memberId);

  const pickupAt = new Date(input.pickupAt);
  if (pickupAt.getTime() < Date.now() + 30 * 60_000) throw badRequest('Choose a pickup time at least 30 minutes from now');

  return withTx(async (tx) => {
    const member = await getMember(memberId, tx);
    if (!member || member.status !== 'active') throw notFound('Member');
    // Story 1.1: "The profile can't be used until consent to share needs with the assigned driver is recorded."
    if (!member.consentGiven) {
      throw new AppError(409, 'no_consent', 'Lifts can’t be booked until consent to share needs with the driver is recorded. Please call the church office.');
    }
    const [ride] = await tx
      .insert(rides)
      .values({
        memberId,
        bookedByUserId: user.id,
        bookedByRole: user.role,
        pickupAt,
        pickupFromHome: input.pickupFromHome,
        pickupAddress: input.pickupFromHome ? `${member.addressLine}, ${member.town} ${member.postcode}` : input.pickupAddress,
        destination: input.destination,
        returnNeeded: input.returnNeeded,
        returnAt: input.returnNeeded && input.returnAt ? new Date(input.returnAt) : null,
        companion: input.companion,
        needsNote: input.needsNote,
        rebookedFromId: opts.rebookedFrom ?? null,
      })
      .returning();
    await audit(
      actor,
      { action: opts.rebookedFrom ? 'ride.rebook' : 'ride.request', entityType: 'ride', entityId: ride!.id, details: { memberId, bookedByRole: user.role, rebookedFrom: opts.rebookedFrom } },
      tx,
    );

    const outcome = await matchAndInvite(tx, ride!, actor);

    // Story 2.2: a member booked for by the office gets a text or phone-call confirmation.
    await notifyMember(tx, memberId, {
      kind: 'booked',
      title: 'Lift booked',
      body: `Your lift on ${formatWhen(pickupAt)} to ${input.destination} is booked. We’ll tell you when a driver says yes.`,
      link: `/member/rides/${ride!.id}`,
      rideId: ride!.id,
    });
    return { id: ride!.id, status: outcome.status, invited: outcome.invited.length };
  });
}

// ---------------------------------------------------------------------------
// F06 Invite response (story 3.2 PSEBC-18)
// ---------------------------------------------------------------------------

export async function acceptInvite(user: SessionUser, actor: Actor, rideId: string) {
  const driverId = requireDriver(user);
  return withTx(async (tx) => {
    const ride = await lockRide(rideId, tx);
    if (!ride) throw notFound('Lift');
    const [invite] = await tx
      .select({ id: rideInvites.id, status: rideInvites.status })
      .from(rideInvites)
      .where(and(eq(rideInvites.rideId, rideId), eq(rideInvites.driverId, driverId)))
      .for('update');
    if (!invite) throw forbidden('This request was not sent to you');
    if (ride.status === 'driver_found' || invite.status === 'withdrawn') throw conflict('Another driver has already accepted this lift. Thank you for offering.');
    if (ride.status === 'cancelled') throw conflict('This lift has been cancelled');
    if (invite.status !== 'sent') throw conflict('You have already replied to this request');
    if (ride.status !== 'invites_sent' && ride.status !== 'unmatched') throw conflict('This lift is no longer open');

    const [driver] = await tx.select().from(drivers).where(eq(drivers.id, driverId));
    // Rule 1 is re-checked at the moment of acceptance (a check may have expired since the invite).
    if (driver?.status !== 'approved') throw forbidden('Only approved drivers can accept lifts');
    if (!driver.loneWorkingAckAt) throw new AppError(409, 'lone_working', 'Please confirm you have read the lone-working guidance first');

    assertTransition(ride.status, 'driver_found');
    await tx.update(rideInvites).set({ status: 'accepted', respondedAt: sql`now()` }).where(eq(rideInvites.id, invite.id));
    await withdrawOpenInvites(tx, rideId);
    await setStatus(tx, rideId, 'driver_found', { driverId, acceptedAt: new Date(), unmatchedFlaggedAt: null });
    await audit(actor, { action: 'ride.accept', entityType: 'ride', entityId: rideId, details: { driverId } }, tx);

    const firstName = driver.fullName.split(' ')[0];
    await notifyMember(tx, ride.memberId, {
      kind: 'driver_found',
      title: 'Your driver is booked',
      body: `${firstName} will pick you up on ${formatWhen(ride.pickupAt)} in a ${driver.vehicleColour} ${driver.vehicleMakeModel} (${driver.vehicleReg}).`,
      link: `/member/rides/${rideId}`,
      rideId,
    });
    if (ride.bookedByUserId && ride.bookedByRole !== 'member') {
      await notifyUsers(tx, [ride.bookedByUserId], { kind: 'driver_found', title: 'Driver found', body: `${firstName} accepted the lift on ${formatWhen(ride.pickupAt)}.`, link: `/office/rides/${rideId}`, rideId });
    }
    return { ok: true };
  });
}

export async function declineInvite(user: SessionUser, actor: Actor, rideId: string, reason: DeclineReason, note: string) {
  const driverId = requireDriver(user);
  return withTx(async (tx) => {
    const ride = await lockRide(rideId, tx);
    if (!ride) throw notFound('Lift');
    const declined = await tx
      .update(rideInvites)
      .set({ status: 'declined', declineReason: reason, declineNote: note, respondedAt: sql`now()` })
      .where(and(eq(rideInvites.rideId, rideId), eq(rideInvites.driverId, driverId), eq(rideInvites.status, 'sent')))
      .returning({ id: rideInvites.id });
    if (declined.length === 0) throw conflict('This request is no longer open');
    await audit(actor, { action: 'ride.decline', entityType: 'ride', entityId: rideId, details: { driverId, reason } }, tx);

    const [open] = await tx
      .select({ n: count() })
      .from(rideInvites)
      .where(and(eq(rideInvites.rideId, rideId), eq(rideInvites.status, 'sent')));
    if (ride.status === 'invites_sent' && open?.n === 0) {
      await setStatus(tx, rideId, 'unmatched', { unmatchedFlaggedAt: new Date() });
      await notifyRole(
        tx,
        ['coordinator', 'admin'],
        { kind: 'unmatched', title: 'No driver for a lift', body: `Every invited driver declined the lift on ${formatWhen(ride.pickupAt)}. Latest reason: ${DECLINE_REASONS[reason]}.`, link: `/office/rides/${rideId}`, rideId },
        { email: true },
      );
    }
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// F05 Cancel and rebook (story 2.3 PSEBC-14, 2.4 PSEBC-15)
// ---------------------------------------------------------------------------

export async function cancelRide(user: SessionUser, actor: Actor, rideId: string, reason: CancelReason, part: CancelPart, note: string) {
  return withTx(async (tx) => {
    const ride = await lockRide(rideId, tx);
    if (!ride) throw notFound('Lift');
    assertCanActForMember(user, ride.memberId);
    if (!isCancellable(ride.status, ride.pickupAt)) throw conflict('This lift can no longer be cancelled. Please call the church office.');

    if (part === 'return_only') {
      if (!ride.returnNeeded) throw badRequest('This lift has no lift home to cancel');
      await tx
        .update(rides)
        .set({ returnNeeded: false, returnCancelled: true, cancelNote: `${CANCEL_REASONS[reason]} ${note}`.trim(), updatedAt: sql`now()` })
        .where(eq(rides.id, rideId));
      await audit(actor, { action: 'ride.cancel_return', entityType: 'ride', entityId: rideId, details: { reason } }, tx);
      if (ride.driverId) {
        await notifyDriver(tx, ride.driverId, { kind: 'cancelled', title: 'Lift home cancelled', body: `The lift home on ${formatWhen(ride.pickupAt)} is no longer needed. The lift there is still on.`, link: `/driver/trips/${rideId}`, rideId });
      }
      return { ok: true, status: ride.status };
    }

    assertTransition(ride.status, 'cancelled');
    await setStatus(tx, rideId, 'cancelled', { cancelledAt: new Date(), cancelledBy: user.id, cancelReason: reason, cancelNote: note });
    const openInvites = await withdrawOpenInvites(tx, rideId);
    await audit(actor, { action: 'ride.cancel', entityType: 'ride', entityId: rideId, details: { reason, byRole: user.role } }, tx);

    // Story 2.3: "the driver is notified".
    if (ride.driverId) {
      await notifyDriver(tx, ride.driverId, { kind: 'cancelled', title: 'Lift cancelled', body: `The lift on ${formatWhen(ride.pickupAt)} has been cancelled. You don’t need to go.`, link: '/driver', rideId });
    }
    for (const i of openInvites) {
      await notifyDriver(tx, i.driverId, { kind: 'cancelled', title: 'Request withdrawn', body: `The lift request for ${formatWhen(ride.pickupAt)} is no longer needed.`, link: '/driver', rideId });
    }
    if (user.role === 'member') {
      await notifyRole(tx, ['coordinator'], { kind: 'cancelled', title: 'Lift cancelled by member', body: `A lift on ${formatWhen(ride.pickupAt)} was cancelled: ${CANCEL_REASONS[reason]}.`, link: `/office/rides/${rideId}`, rideId });
    }
    return { ok: true, status: 'cancelled' as const };
  });
}

/** Story 2.4: copy details from the cancelled ride into a new request; needs come from the profile. */
export async function rebookRide(user: SessionUser, actor: Actor, rideId: string, pickupAt: string, returnAt: string | null | undefined) {
  const old = await getRide(rideId);
  if (!old) throw notFound('Lift');
  assertCanActForMember(user, old.memberId);
  if (old.status !== 'cancelled') throw conflict('Only a cancelled lift can be rebooked');
  return requestRide(
    user,
    actor,
    {
      memberId: old.memberId,
      pickupAt,
      pickupFromHome: old.pickupFromHome,
      pickupAddress: old.pickupFromHome ? '' : old.pickupAddress,
      destination: old.destination,
      returnNeeded: !!returnAt,
      returnAt: returnAt ?? null,
      companion: old.companion,
      needsNote: old.needsNote,
    },
    { rebookedFrom: rideId },
  );
}

/** A driver who can no longer make an accepted lift hands it back; the app asks other drivers. */
export async function driverWithdraw(user: SessionUser, actor: Actor, rideId: string, note: string) {
  const driverId = requireDriver(user);
  return withTx(async (tx) => {
    const ride = await lockRide(rideId, tx);
    if (!ride) throw notFound('Lift');
    if (ride.driverId !== driverId) throw forbidden();
    if (ride.status !== 'driver_found' || ride.pickupAt <= new Date()) throw conflict('This lift can no longer be handed back. Please call the church office.');
    await tx
      .update(rideInvites)
      .set({ status: 'declined', declineReason: 'not_free', declineNote: note, respondedAt: sql`now()` })
      .where(and(eq(rideInvites.rideId, rideId), eq(rideInvites.driverId, driverId)));
    await setStatus(tx, rideId, 'invites_sent', { driverId: null, acceptedAt: null });
    await audit(actor, { action: 'ride.driver_withdraw', entityType: 'ride', entityId: rideId, details: { driverId } }, tx);
    const outcome = await matchAndInvite(tx, (await lockRide(rideId, tx))!, actor);
    await notifyMember(tx, ride.memberId, { kind: 'driver_changed', title: 'We’re finding you a new driver', body: `Your driver can no longer take the lift on ${formatWhen(ride.pickupAt)}. We’re asking other drivers now.`, link: `/member/rides/${rideId}`, rideId });
    await notifyRole(tx, ['coordinator'], { kind: 'driver_withdrew', title: 'A driver handed back a lift', body: `The lift on ${formatWhen(ride.pickupAt)} needs a new driver.`, link: `/office/rides/${rideId}`, rideId });
    return { ok: true, status: outcome.status };
  });
}

/** Coordinator "Re-send invites" on an unmatched request (story 3.3). */
export async function resendInvites(actor: Actor, rideId: string) {
  return withTx(async (tx) => {
    const ride = await lockRide(rideId, tx);
    if (!ride) throw notFound('Lift');
    if (!['invites_sent', 'unmatched', 'requested'].includes(ride.status)) throw conflict('This lift already has a driver or is closed');
    const outcome = await matchAndInvite(tx, ride, actor);
    return { status: outcome.status, invited: outcome.invited.length, eligible: outcome.eligibleCount };
  });
}

// ---------------------------------------------------------------------------
// F07 Trip progress (story 5.1 PSEBC-24)
// ---------------------------------------------------------------------------

export async function recordProgress(user: SessionUser, actor: Actor, rideId: string, event: 'picked_up' | 'dropped_off' | 'not_at_pickup') {
  const driverId = requireDriver(user);
  return withTx(async (tx) => {
    const ride = await lockRide(rideId, tx);
    if (!ride) throw notFound('Lift');
    if (ride.driverId !== driverId) throw forbidden();
    if (ride.status !== 'driver_found') throw conflict('This trip is already complete');
    const now = new Date();

    if (event === 'picked_up') {
      if (ride.pickedUpAt) throw conflict('Pickup is already recorded');
      await tx.update(rides).set({ pickedUpAt: now, updatedAt: sql`now()` }).where(eq(rides.id, rideId));
    } else if (event === 'dropped_off') {
      if (!ride.pickedUpAt) throw badRequest('Record the pickup first');
      assertTransition(ride.status, 'completed');
      await setStatus(tx, rideId, 'completed', { droppedOffAt: now, completedAt: now, logsDueAt: addHours(now, RULES.logTimeoutHours) });
      await notifyMember(tx, ride.memberId, { kind: 'log_request', title: 'How was your trip?', body: 'Please tell us how your lift went. It takes about a minute.', link: `/member/rides/${rideId}/log`, rideId });
    } else {
      await tx.update(rides).set({ notAtPickupAt: now, updatedAt: sql`now()` }).where(eq(rides.id, rideId));
      // Story 5.1: "'member not at pickup' alerts the church office."
      const m = await getMember(ride.memberId, tx);
      await notifyRole(
        tx,
        ['coordinator', 'admin'],
        {
          kind: 'not_at_pickup',
          title: 'Member not at pickup',
          body: `${m?.preferredName ?? 'The member'} was not at the pickup for ${formatWhen(ride.pickupAt)}. The driver is waiting. Please call them or their emergency contact.`,
          link: `/office/rides/${rideId}`,
          rideId,
        },
        { sms: true, email: true },
      );
    }
    await audit(actor, { action: `trip.${event}`, entityType: 'ride', entityId: rideId, details: { at: now.toISOString() } }, tx);
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// F08 / F09 Trip logs (stories 5.2 PSEBC-25, 5.3 PSEBC-26, 6.3 PSEBC-29)
// ---------------------------------------------------------------------------

export async function submitDriverLog(user: SessionUser, actor: Actor, rideId: string, input: { wentAsPlanned: boolean; anythingToReport: boolean; needsChanged: boolean; comments: string }) {
  const driverId = requireDriver(user);
  return withTx(async (tx) => {
    const ride = await lockRide(rideId, tx);
    if (!ride) throw notFound('Lift');
    if (ride.driverId !== driverId) throw forbidden();
    assertLoggable(ride);
    await tx.insert(tripLogs).values({ rideId, author: 'driver', submittedBy: user.id, submittedByRole: user.role, ...input });
    await audit(actor, { action: 'trip.driver_log', entityType: 'ride', entityId: rideId, details: { anythingToReport: input.anythingToReport, needsChanged: input.needsChanged } }, tx);
    if (input.needsChanged) {
      await notifyRole(tx, ['coordinator'], {
        kind: 'needs_changed',
        title: 'A member’s needs may have changed',
        body: `The driver for the lift on ${formatWhen(ride.pickupAt)} thinks the member’s needs have changed. Please check with them before updating their profile.`,
        link: `/office/members/${ride.memberId}`,
        rideId,
      });
    }
    await maybeMarkLogged(tx, ride, actor);
    return { ok: true, openConcern: input.anythingToReport };
  });
}

export async function submitMemberLog(
  user: SessionUser,
  actor: Actor,
  rideId: string,
  input: { onTime: string; feltSafe: boolean; rating?: number | null; comments: string; callbackRequested: boolean },
) {
  return withTx(async (tx) => {
    const ride = await lockRide(rideId, tx);
    if (!ride) throw notFound('Lift');
    assertCanActForMember(user, ride.memberId);
    assertLoggable(ride);
    await tx.insert(tripLogs).values({
      rideId,
      author: 'member',
      submittedBy: user.id,
      submittedByRole: user.role,
      onTime: input.onTime,
      feltSafe: input.feltSafe,
      rating: input.rating ?? null,
      comments: input.comments,
      callbackRequested: input.callbackRequested,
    });
    await audit(actor, { action: 'trip.member_log', entityType: 'ride', entityId: rideId, details: { feltSafe: input.feltSafe, byRole: user.role } }, tx);
    const m = await getMember(ride.memberId, tx);
    if (input.callbackRequested) {
      await notifyRole(tx, ['coordinator'], {
        kind: 'callback',
        title: `Please call ${m?.preferredName ?? 'a member'}`,
        body: `${m?.fullName ?? 'A member'} asked for a call back after the lift on ${formatWhen(ride.pickupAt)}. Phone: ${m?.phone ?? ''}`,
        link: `/office/members/${ride.memberId}`,
        rideId,
      });
    }
    if (!input.feltSafe) {
      // Story 5.3: 'No' to feeling safe opens the concern report — and safeguarding is told today.
      await notifyRole(
        tx,
        ['safeguarding'],
        { kind: 'felt_unsafe', title: 'A member did not feel safe', body: `A member said they did not feel safe on the lift on ${formatWhen(ride.pickupAt)}. A concern report may follow.`, link: `/safeguarding/trips/${rideId}`, rideId },
        { email: true, sms: true },
      );
    }
    await maybeMarkLogged(tx, ride, actor);
    return { ok: true, openConcern: !input.feltSafe };
  });
}

function assertLoggable(ride: Ride): void {
  if (!['completed', 'logged'].includes(ride.status)) throw conflict('This trip can be logged once the driver marks it complete');
}

/** Status 5 "Logged": both logs received. */
async function maybeMarkLogged(tx: Tx, ride: Ride, actor: Actor): Promise<void> {
  if (ride.status !== 'completed') return;
  const logs = await tx.select({ author: tripLogs.author }).from(tripLogs).where(eq(tripLogs.rideId, ride.id));
  const authors = new Set(logs.map((l) => l.author));
  if (authors.has('driver') && authors.has('member')) {
    await setStatus(tx, ride.id, 'logged', { loggedAt: new Date() });
    await audit(actor, { action: 'trip.logged', entityType: 'ride', entityId: ride.id }, tx);
  }
}
