import type { PoolClient } from 'pg';
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
import { query, queryOne, withTx } from '../../db/pool';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import { addHours, formatWhen } from '../../lib/time';
import { audit, type Actor } from '../../services/audit';
import { notifyDriver, notifyMember, notifyRole, notifyUsers } from '../../services/notify';
import type { SessionUser } from '../../middleware/auth';
import { getMember } from '../members/repo';
import { matchAndInvite } from './matching.service';
import { getRide, lockRide, setStatus, type RideRow } from './repo';

const OFFICE = ['coordinator', 'admin'] as const;
const isOffice = (u: SessionUser) => (OFFICE as readonly string[]).includes(u.role);

/** Who may act for this member: the member themself or the church office (story 2.2). */
export function assertCanActForMember(user: SessionUser, memberId: string): void {
  if (isOffice(user)) return;
  if (user.role === 'member' && user.memberId === memberId) return;
  throw forbidden();
}

// ---------------------------------------------------------------------------
// F04 Request a ride (story 2.1 PSEBC-12, 2.2 PSEBC-13)
// ---------------------------------------------------------------------------

export async function requestRide(user: SessionUser, actor: Actor, input: RideRequestInput, opts: { rebookedFrom?: string } = {}) {
  const memberId = user.role === 'member' ? user.memberId : input.memberId;
  if (!memberId) throw badRequest('Choose the member this lift is for');
  assertCanActForMember(user, memberId);

  const pickupAt = new Date(input.pickupAt);
  if (pickupAt.getTime() < Date.now() + 30 * 60_000) throw badRequest('Choose a pickup time at least 30 minutes from now');

  return withTx(async (db) => {
    const member = await getMember(memberId, db);
    if (!member || member.status !== 'active') throw notFound('Member');
    // Story 1.1: "The profile can't be used until consent to share needs with the assigned driver is recorded."
    if (!member.consent_given) {
      throw new AppError(409, 'no_consent', 'Lifts can’t be booked until consent to share needs with the driver is recorded. Please call the church office.');
    }
    const address = input.pickupFromHome ? `${member.address_line}, ${member.town} ${member.postcode}` : input.pickupAddress;
    const [ride] = await query<RideRow>(
      `INSERT INTO rides (member_id, booked_by_user_id, booked_by_role, pickup_at, pickup_from_home, pickup_address,
                          destination, return_needed, return_at, companion, needs_note, rebooked_from_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        memberId,
        user.id,
        user.role,
        pickupAt,
        input.pickupFromHome,
        address,
        input.destination,
        input.returnNeeded,
        input.returnNeeded ? input.returnAt : null,
        input.companion,
        input.needsNote,
        opts.rebookedFrom ?? null,
      ],
      db,
    );
    await audit(actor, { action: opts.rebookedFrom ? 'ride.rebook' : 'ride.request', entityType: 'ride', entityId: ride!.id, details: { memberId, bookedByRole: user.role, rebookedFrom: opts.rebookedFrom } }, db);

    const outcome = await matchAndInvite(db, ride!, actor);

    // Story 2.2: a member booked for by the office gets a text or phone-call confirmation.
    await notifyMember(db, memberId, {
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
  return withTx(async (db) => {
    const ride = await lockRide(rideId, db);
    if (!ride) throw notFound('Lift');
    const invite = await queryOne<{ id: string; status: string }>('SELECT id, status FROM ride_invites WHERE ride_id = $1 AND driver_id = $2 FOR UPDATE', [rideId, driverId], db);
    if (!invite) throw forbidden('This request was not sent to you');
    if (ride.status === 'driver_found' || invite.status === 'withdrawn') throw conflict('Another driver has already accepted this lift. Thank you for offering.');
    if (ride.status === 'cancelled') throw conflict('This lift has been cancelled');
    if (invite.status !== 'sent') throw conflict('You have already replied to this request');
    if (ride.status !== 'invites_sent' && ride.status !== 'unmatched') throw conflict('This lift is no longer open');

    const driver = await queryOne<{ status: string; lone_working_ack_at: Date | null; full_name: string; vehicle_make_model: string; vehicle_colour: string; vehicle_reg: string }>(
      'SELECT status, lone_working_ack_at, full_name, vehicle_make_model, vehicle_colour, vehicle_reg FROM drivers WHERE id = $1',
      [driverId],
      db,
    );
    // Rule 1 is re-checked at the moment of acceptance (a check may have expired since the invite).
    if (driver?.status !== 'approved') throw forbidden('Only approved drivers can accept lifts');
    if (!driver.lone_working_ack_at) throw new AppError(409, 'lone_working', 'Please confirm you have read the lone-working guidance first');

    assertTransition(ride.status, 'driver_found');
    await db.query(`UPDATE ride_invites SET status = 'accepted', responded_at = now() WHERE id = $1`, [invite.id]);
    await db.query(`UPDATE ride_invites SET status = 'withdrawn', responded_at = now() WHERE ride_id = $1 AND status = 'sent'`, [rideId]);
    await setStatus(db, rideId, 'driver_found', { driver_id: driverId, accepted_at: new Date(), unmatched_flagged_at: null });
    await audit(actor, { action: 'ride.accept', entityType: 'ride', entityId: rideId, details: { driverId } }, db);

    const firstName = driver.full_name.split(' ')[0];
    await notifyMember(db, ride.member_id, {
      kind: 'driver_found',
      title: 'Your driver is booked',
      body: `${firstName} will pick you up on ${formatWhen(ride.pickup_at)} in a ${driver.vehicle_colour} ${driver.vehicle_make_model} (${driver.vehicle_reg}).`,
      link: `/member/rides/${rideId}`,
      rideId,
    });
    if (ride.booked_by_user_id && ride.booked_by_role !== 'member') {
      await notifyUsers(db, [ride.booked_by_user_id], { kind: 'driver_found', title: 'Driver found', body: `${firstName} accepted the lift on ${formatWhen(ride.pickup_at)}.`, link: `/office/rides/${rideId}`, rideId });
    }
    return { ok: true };
  });
}

export async function declineInvite(user: SessionUser, actor: Actor, rideId: string, reason: DeclineReason, note: string) {
  const driverId = requireDriver(user);
  return withTx(async (db) => {
    const ride = await lockRide(rideId, db);
    if (!ride) throw notFound('Lift');
    const res = await db.query(
      `UPDATE ride_invites SET status = 'declined', decline_reason = $3, decline_note = $4, responded_at = now()
        WHERE ride_id = $1 AND driver_id = $2 AND status = 'sent'`,
      [rideId, driverId, reason, note],
    );
    if (res.rowCount === 0) throw conflict('This request is no longer open');
    await audit(actor, { action: 'ride.decline', entityType: 'ride', entityId: rideId, details: { driverId, reason } }, db);

    const open = await queryOne<{ n: number }>(`SELECT count(*) AS n FROM ride_invites WHERE ride_id = $1 AND status = 'sent'`, [rideId], db);
    if (ride.status === 'invites_sent' && open?.n === 0) {
      await setStatus(db, rideId, 'unmatched', { unmatched_flagged_at: new Date() });
      await notifyRole(db, ['coordinator', 'admin'], {
        kind: 'unmatched',
        title: 'No driver for a lift',
        body: `Every invited driver declined the lift on ${formatWhen(ride.pickup_at)}. Latest reason: ${DECLINE_REASONS[reason]}.`,
        link: `/office/rides/${rideId}`,
        rideId,
      }, { email: true });
    }
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// F05 Cancel and rebook (story 2.3 PSEBC-14, 2.4 PSEBC-15)
// ---------------------------------------------------------------------------

export async function cancelRide(user: SessionUser, actor: Actor, rideId: string, reason: CancelReason, part: CancelPart, note: string) {
  return withTx(async (db) => {
    const ride = await lockRide(rideId, db);
    if (!ride) throw notFound('Lift');
    assertCanActForMember(user, ride.member_id);
    if (!isCancellable(ride.status, ride.pickup_at)) throw conflict('This lift can no longer be cancelled. Please call the church office.');

    if (part === 'return_only') {
      if (!ride.return_needed) throw badRequest('This lift has no lift home to cancel');
      await db.query(`UPDATE rides SET return_needed = false, return_cancelled = true, cancel_note = $2, updated_at = now() WHERE id = $1`, [rideId, `${CANCEL_REASONS[reason]} ${note}`.trim()]);
      await audit(actor, { action: 'ride.cancel_return', entityType: 'ride', entityId: rideId, details: { reason } }, db);
      if (ride.driver_id) {
        await notifyDriver(db, ride.driver_id, { kind: 'cancelled', title: 'Lift home cancelled', body: `The lift home on ${formatWhen(ride.pickup_at)} is no longer needed. The lift there is still on.`, link: `/driver/trips/${rideId}`, rideId });
      }
      return { ok: true, status: ride.status };
    }

    assertTransition(ride.status, 'cancelled');
    await setStatus(db, rideId, 'cancelled', { cancelled_at: new Date(), cancelled_by: user.id, cancel_reason: reason, cancel_note: note });
    const openInvites = await query<{ driver_id: string }>(`UPDATE ride_invites SET status = 'withdrawn', responded_at = now() WHERE ride_id = $1 AND status = 'sent' RETURNING driver_id`, [rideId], db);
    await audit(actor, { action: 'ride.cancel', entityType: 'ride', entityId: rideId, details: { reason, byRole: user.role } }, db);

    // Story 2.3: "the driver is notified".
    if (ride.driver_id) {
      await notifyDriver(db, ride.driver_id, { kind: 'cancelled', title: 'Lift cancelled', body: `The lift on ${formatWhen(ride.pickup_at)} has been cancelled. You don’t need to go.`, link: '/driver', rideId });
    }
    for (const i of openInvites) {
      await notifyDriver(db, i.driver_id, { kind: 'cancelled', title: 'Request withdrawn', body: `The lift request for ${formatWhen(ride.pickup_at)} is no longer needed.`, link: '/driver', rideId });
    }
    if (user.role === 'member') {
      await notifyRole(db, ['coordinator'], { kind: 'cancelled', title: 'Lift cancelled by member', body: `A lift on ${formatWhen(ride.pickup_at)} was cancelled: ${CANCEL_REASONS[reason]}.`, link: `/office/rides/${rideId}`, rideId });
    }
    return { ok: true, status: 'cancelled' as const };
  });
}

/** Story 2.4: copy details from the cancelled ride into a new request; needs come from the profile. */
export async function rebookRide(user: SessionUser, actor: Actor, rideId: string, pickupAt: string, returnAt: string | null | undefined) {
  const old = await getRide(rideId);
  if (!old) throw notFound('Lift');
  assertCanActForMember(user, old.member_id);
  if (old.status !== 'cancelled') throw conflict('Only a cancelled lift can be rebooked');
  return requestRide(
    user,
    actor,
    {
      memberId: old.member_id,
      pickupAt,
      pickupFromHome: old.pickup_from_home,
      pickupAddress: old.pickup_from_home ? '' : old.pickup_address,
      destination: old.destination,
      returnNeeded: !!returnAt,
      returnAt: returnAt ?? null,
      companion: old.companion,
      needsNote: old.needs_note,
    },
    { rebookedFrom: rideId },
  );
}

/** A driver who can no longer make an accepted lift hands it back; the app asks other drivers. */
export async function driverWithdraw(user: SessionUser, actor: Actor, rideId: string, note: string) {
  const driverId = requireDriver(user);
  return withTx(async (db) => {
    const ride = await lockRide(rideId, db);
    if (!ride) throw notFound('Lift');
    if (ride.driver_id !== driverId) throw forbidden();
    if (ride.status !== 'driver_found' || ride.pickup_at <= new Date()) throw conflict('This lift can no longer be handed back. Please call the church office.');
    await db.query(`UPDATE ride_invites SET status = 'declined', decline_reason = 'not_free', decline_note = $3, responded_at = now() WHERE ride_id = $1 AND driver_id = $2`, [rideId, driverId, note]);
    await setStatus(db, rideId, 'invites_sent', { driver_id: null, accepted_at: null });
    await audit(actor, { action: 'ride.driver_withdraw', entityType: 'ride', entityId: rideId, details: { driverId } }, db);
    const fresh = (await lockRide(rideId, db))!;
    const outcome = await matchAndInvite(db, fresh, actor);
    await notifyMember(db, ride.member_id, { kind: 'driver_changed', title: 'We’re finding you a new driver', body: `Your driver can no longer take the lift on ${formatWhen(ride.pickup_at)}. We’re asking other drivers now.`, link: `/member/rides/${rideId}`, rideId });
    await notifyRole(db, ['coordinator'], { kind: 'driver_withdrew', title: 'A driver handed back a lift', body: `The lift on ${formatWhen(ride.pickup_at)} needs a new driver.`, link: `/office/rides/${rideId}`, rideId });
    return { ok: true, status: outcome.status };
  });
}

/** Coordinator "Re-send invites" on an unmatched request (story 3.3). */
export async function resendInvites(actor: Actor, rideId: string) {
  return withTx(async (db) => {
    const ride = await lockRide(rideId, db);
    if (!ride) throw notFound('Lift');
    if (!['invites_sent', 'unmatched', 'requested'].includes(ride.status)) throw conflict('This lift already has a driver or is closed');
    const outcome = await matchAndInvite(db, ride, actor);
    return { status: outcome.status, invited: outcome.invited.length, eligible: outcome.eligibleCount };
  });
}

// ---------------------------------------------------------------------------
// F07 Trip progress (story 5.1 PSEBC-24)
// ---------------------------------------------------------------------------

export async function recordProgress(user: SessionUser, actor: Actor, rideId: string, event: 'picked_up' | 'dropped_off' | 'not_at_pickup') {
  const driverId = requireDriver(user);
  return withTx(async (db) => {
    const ride = await lockRide(rideId, db);
    if (!ride) throw notFound('Lift');
    if (ride.driver_id !== driverId) throw forbidden();
    if (ride.status !== 'driver_found') throw conflict('This trip is already complete');
    const now = new Date();

    if (event === 'picked_up') {
      if (ride.picked_up_at) throw conflict('Pickup is already recorded');
      await db.query('UPDATE rides SET picked_up_at = $2, updated_at = now() WHERE id = $1', [rideId, now]);
    } else if (event === 'dropped_off') {
      if (!ride.picked_up_at) throw badRequest('Record the pickup first');
      assertTransition(ride.status, 'completed');
      await setStatus(db, rideId, 'completed', { dropped_off_at: now, completed_at: now, logs_due_at: addHours(now, RULES.logTimeoutHours) });
      await notifyMember(db, ride.member_id, { kind: 'log_request', title: 'How was your trip?', body: 'Please tell us how your lift went. It takes about a minute.', link: `/member/rides/${rideId}/log`, rideId });
    } else {
      await db.query('UPDATE rides SET not_at_pickup_at = $2, updated_at = now() WHERE id = $1', [rideId, now]);
      // Story 5.1: "'member not at pickup' alerts the church office."
      const m = await getMember(ride.member_id, db);
      await notifyRole(db, ['coordinator', 'admin'], {
        kind: 'not_at_pickup',
        title: 'Member not at pickup',
        body: `${m?.preferred_name ?? 'The member'} was not at the pickup for ${formatWhen(ride.pickup_at)}. The driver is waiting. Please call them or their emergency contact.`,
        link: `/office/rides/${rideId}`,
        rideId,
      }, { sms: true, email: true });
    }
    await audit(actor, { action: `trip.${event}`, entityType: 'ride', entityId: rideId, details: { at: now.toISOString() } }, db);
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// F08 / F09 Trip logs (stories 5.2 PSEBC-25, 5.3 PSEBC-26, 6.3 PSEBC-29)
// ---------------------------------------------------------------------------

export async function submitDriverLog(user: SessionUser, actor: Actor, rideId: string, input: { wentAsPlanned: boolean; anythingToReport: boolean; needsChanged: boolean; comments: string }) {
  const driverId = requireDriver(user);
  return withTx(async (db) => {
    const ride = await lockRide(rideId, db);
    if (!ride) throw notFound('Lift');
    if (ride.driver_id !== driverId) throw forbidden();
    assertLoggable(ride);
    await db.query(
      `INSERT INTO trip_logs (ride_id, author, submitted_by, submitted_by_role, went_as_planned, anything_to_report, needs_changed, comments)
       VALUES ($1, 'driver', $2, $3, $4, $5, $6, $7)`,
      [rideId, user.id, user.role, input.wentAsPlanned, input.anythingToReport, input.needsChanged, input.comments],
    );
    await audit(actor, { action: 'trip.driver_log', entityType: 'ride', entityId: rideId, details: { anythingToReport: input.anythingToReport, needsChanged: input.needsChanged } }, db);
    if (input.needsChanged) {
      await notifyRole(db, ['coordinator'], { kind: 'needs_changed', title: 'A member’s needs may have changed', body: `The driver for the lift on ${formatWhen(ride.pickup_at)} thinks the member’s needs have changed. Please check with them before updating their profile.`, link: `/office/members/${ride.member_id}`, rideId });
    }
    await maybeMarkLogged(db, ride, actor);
    return { ok: true, openConcern: input.anythingToReport };
  });
}

export async function submitMemberLog(
  user: SessionUser,
  actor: Actor,
  rideId: string,
  input: { onTime: string; feltSafe: boolean; rating?: number | null; comments: string; callbackRequested: boolean },
) {
  return withTx(async (db) => {
    const ride = await lockRide(rideId, db);
    if (!ride) throw notFound('Lift');
    assertCanActForMember(user, ride.member_id);
    assertLoggable(ride);
    await db.query(
      `INSERT INTO trip_logs (ride_id, author, submitted_by, submitted_by_role, on_time, felt_safe, rating, comments, callback_requested)
       VALUES ($1, 'member', $2, $3, $4, $5, $6, $7, $8)`,
      [rideId, user.id, user.role, input.onTime, input.feltSafe, input.rating ?? null, input.comments, input.callbackRequested],
    );
    await audit(actor, { action: 'trip.member_log', entityType: 'ride', entityId: rideId, details: { feltSafe: input.feltSafe, byRole: user.role } }, db);
    const m = await getMember(ride.member_id, db);
    if (input.callbackRequested) {
      await notifyRole(db, ['coordinator'], { kind: 'callback', title: `Please call ${m?.preferred_name ?? 'a member'}`, body: `${m?.full_name ?? 'A member'} asked for a call back after the lift on ${formatWhen(ride.pickup_at)}. Phone: ${m?.phone ?? ''}`, link: `/office/members/${ride.member_id}`, rideId });
    }
    if (!input.feltSafe) {
      // Story 5.3: 'No' to feeling safe opens the concern report — and safeguarding is told today.
      await notifyRole(db, ['safeguarding'], { kind: 'felt_unsafe', title: 'A member did not feel safe', body: `A member said they did not feel safe on the lift on ${formatWhen(ride.pickup_at)}. A concern report may follow.`, link: `/safeguarding/trips/${rideId}`, rideId }, { email: true, sms: true });
    }
    await maybeMarkLogged(db, ride, actor);
    return { ok: true, openConcern: !input.feltSafe };
  });
}

function assertLoggable(ride: RideRow): void {
  if (!['completed', 'logged'].includes(ride.status)) throw conflict('This trip can be logged once the driver marks it complete');
}

/** Status 5 "Logged": both logs received. */
async function maybeMarkLogged(db: PoolClient, ride: RideRow, actor: Actor): Promise<void> {
  if (ride.status !== 'completed') return;
  const logs = await query<{ author: string }>('SELECT author FROM trip_logs WHERE ride_id = $1', [ride.id], db);
  const authors = new Set(logs.map((l) => l.author));
  if (authors.has('driver') && authors.has('member')) {
    await setStatus(db, ride.id, 'logged', { logged_at: new Date() });
    await audit(actor, { action: 'trip.logged', entityType: 'ride', entityId: ride.id }, db);
  }
}

function requireDriver(user: SessionUser): string {
  if (user.role !== 'driver' || !user.driverId) throw forbidden('Only volunteer drivers can do this');
  return user.driverId;
}
