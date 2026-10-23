import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { RULES } from '@psebc/shared';
import { withTx } from '../../db/client';
import { drivers, members, rideInvites, rides, users } from '../../db/schema';
import { notFound } from '../../lib/errors';
import { addMonths, formatWhen } from '../../lib/time';
import { audit, type Actor } from '../../services/audit';
import { notifyDriver, notifyMember, notifyRole } from '../../services/notify';
import { matchAndInvite } from '../rides/matching.service';

const OPEN_STATUSES = ['requested', 'invites_sent', 'unmatched', 'driver_found'] as const;

/**
 * F13 Close an account (story 1.5 PSEBC-11).
 * Login stops immediately (status + token_version bump, checked on every request),
 * future lifts are cancelled (member) or reassigned (driver), and a personal-data
 * deletion date is set (12 months; DPO to confirm).
 */
export async function closeMemberAccount(memberId: string, actor: Actor, closedByUserId: string, reason: string) {
  const deleteAfter = addMonths(new Date(), RULES.deletionAfterMonths);
  return withTx(async (tx) => {
    const closed = await tx
      .update(members)
      .set({ status: 'closed', closedAt: sql`now()`, deleteAfter, updatedAt: sql`now()` })
      .where(and(eq(members.id, memberId), eq(members.status, 'active')))
      .returning({ id: members.id });
    if (closed.length === 0) throw notFound('Active member');
    await tx
      .update(users)
      .set({ status: 'closed', closedAt: sql`now()`, deleteAfter, tokenVersion: sql`${users.tokenVersion} + 1` })
      .where(eq(users.memberId, memberId));
    const future = await tx
      .select()
      .from(rides)
      .where(and(eq(rides.memberId, memberId), inArray(rides.status, [...OPEN_STATUSES])))
      .for('update');
    for (const ride of future) {
      await tx
        .update(rides)
        .set({ status: 'cancelled', cancelledAt: sql`now()`, cancelledBy: closedByUserId, cancelReason: 'account_closed', updatedAt: sql`now()` })
        .where(eq(rides.id, ride.id));
      await tx
        .update(rideInvites)
        .set({ status: 'withdrawn', respondedAt: sql`now()` })
        .where(and(eq(rideInvites.rideId, ride.id), eq(rideInvites.status, 'sent')));
      if (ride.driverId) {
        await notifyDriver(tx, ride.driverId, { kind: 'cancelled', title: 'Lift cancelled', body: `The lift on ${formatWhen(ride.pickupAt)} has been cancelled.`, link: '/driver', rideId: ride.id });
      }
    }
    await audit(actor, { action: 'member.close', entityType: 'member', entityId: memberId, details: { reason, cancelledRides: future.length, deleteAfter: deleteAfter.toISOString() } }, tx);
    return { ok: true, cancelledRides: future.length, deleteAfter };
  });
}

export async function closeDriverAccount(driverId: string, actor: Actor, reason: string) {
  const deleteAfter = addMonths(new Date(), RULES.deletionAfterMonths);
  return withTx(async (tx) => {
    const closed = await tx
      .update(drivers)
      .set({ status: 'closed', closedAt: sql`now()`, deleteAfter, updatedAt: sql`now()` })
      .where(and(eq(drivers.id, driverId), ne(drivers.status, 'closed')))
      .returning({ id: drivers.id });
    if (closed.length === 0) throw notFound('Open driver record');
    await tx
      .update(users)
      .set({ status: 'closed', closedAt: sql`now()`, deleteAfter, tokenVersion: sql`${users.tokenVersion} + 1` })
      .where(eq(users.driverId, driverId));
    await tx
      .update(rideInvites)
      .set({ status: 'withdrawn', respondedAt: sql`now()` })
      .where(and(eq(rideInvites.driverId, driverId), eq(rideInvites.status, 'sent')));
    const accepted = await tx
      .select()
      .from(rides)
      .where(and(eq(rides.driverId, driverId), eq(rides.status, 'driver_found')))
      .for('update');
    for (const ride of accepted) {
      await tx
        .update(rideInvites)
        .set({ status: 'withdrawn' })
        .where(and(eq(rideInvites.rideId, ride.id), eq(rideInvites.driverId, driverId)));
      const [fresh] = await tx
        .update(rides)
        .set({ status: 'invites_sent', driverId: null, acceptedAt: null, updatedAt: sql`now()` })
        .where(eq(rides.id, ride.id))
        .returning();
      await matchAndInvite(tx, fresh!, actor);
      await notifyMember(tx, ride.memberId, {
        kind: 'driver_changed',
        title: 'We’re finding you a new driver',
        body: `Your driver for ${formatWhen(ride.pickupAt)} can no longer take you. We’re asking other drivers now.`,
        link: `/member/rides/${ride.id}`,
        rideId: ride.id,
      });
    }
    if (accepted.length) {
      await notifyRole(tx, ['coordinator'], { kind: 'reassigned', title: 'Lifts being reassigned', body: `${accepted.length} lift(s) are being offered to other drivers because a driver left the scheme.`, link: '/office' });
    }
    await audit(actor, { action: 'driver.close', entityType: 'driver', entityId: driverId, details: { reason, reassigned: accepted.length, deleteAfter: deleteAfter.toISOString() } }, tx);
    return { ok: true, reassignedRides: accepted.length, deleteAfter };
  });
}
