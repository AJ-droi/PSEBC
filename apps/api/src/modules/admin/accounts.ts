import { RULES } from '@psebc/shared';
import { query, withTx } from '../../db/pool';
import { notFound } from '../../lib/errors';
import { addMonths, formatWhen } from '../../lib/time';
import { audit, type Actor } from '../../services/audit';
import { notifyDriver, notifyMember, notifyRole } from '../../services/notify';
import { matchAndInvite } from '../rides/matching.service';
import type { RideRow } from '../rides/repo';

/**
 * F13 Close an account (story 1.5 PSEBC-11).
 * Login stops immediately (status + token_version bump, checked on every request),
 * future lifts are cancelled (member) or reassigned (driver), and a personal-data
 * deletion date is set (12 months; DPO to confirm).
 */
export async function closeMemberAccount(memberId: string, actor: Actor, closedByUserId: string, reason: string) {
  const deleteAfter = addMonths(new Date(), RULES.deletionAfterMonths);
  return withTx(async (db) => {
    const r = await db.query(`UPDATE members SET status = 'closed', closed_at = now(), delete_after = $2, updated_at = now() WHERE id = $1 AND status = 'active'`, [memberId, deleteAfter]);
    if (r.rowCount === 0) throw notFound('Active member');
    await db.query(`UPDATE users SET status = 'closed', closed_at = now(), delete_after = $2, token_version = token_version + 1 WHERE member_id = $1`, [memberId, deleteAfter]);
    const future = await query<RideRow>(
      `SELECT * FROM rides WHERE member_id = $1 AND status IN ('requested', 'invites_sent', 'unmatched', 'driver_found') FOR UPDATE`,
      [memberId],
      db,
    );
    for (const ride of future) {
      await db.query(`UPDATE rides SET status = 'cancelled', cancelled_at = now(), cancelled_by = $2, cancel_reason = 'account_closed', updated_at = now() WHERE id = $1`, [ride.id, closedByUserId]);
      await db.query(`UPDATE ride_invites SET status = 'withdrawn', responded_at = now() WHERE ride_id = $1 AND status = 'sent'`, [ride.id]);
      if (ride.driver_id) {
        await notifyDriver(db, ride.driver_id, { kind: 'cancelled', title: 'Lift cancelled', body: `The lift on ${formatWhen(ride.pickup_at)} has been cancelled.`, link: '/driver', rideId: ride.id });
      }
    }
    await audit(actor, { action: 'member.close', entityType: 'member', entityId: memberId, details: { reason, cancelledRides: future.length, deleteAfter: deleteAfter.toISOString() } }, db);
    return { ok: true, cancelledRides: future.length, deleteAfter };
  });
}

export async function closeDriverAccount(driverId: string, actor: Actor, reason: string) {
  const deleteAfter = addMonths(new Date(), RULES.deletionAfterMonths);
  return withTx(async (db) => {
    const r = await db.query(`UPDATE drivers SET status = 'closed', closed_at = now(), delete_after = $2, updated_at = now() WHERE id = $1 AND status <> 'closed'`, [driverId, deleteAfter]);
    if (r.rowCount === 0) throw notFound('Open driver record');
    await db.query(`UPDATE users SET status = 'closed', closed_at = now(), delete_after = $2, token_version = token_version + 1 WHERE driver_id = $1`, [driverId, deleteAfter]);
    await db.query(`UPDATE ride_invites SET status = 'withdrawn', responded_at = now() WHERE driver_id = $1 AND status = 'sent'`, [driverId]);
    const accepted = await query<RideRow>(`SELECT * FROM rides WHERE driver_id = $1 AND status = 'driver_found' FOR UPDATE`, [driverId], db);
    for (const ride of accepted) {
      await db.query(`UPDATE ride_invites SET status = 'withdrawn' WHERE ride_id = $1 AND driver_id = $2`, [ride.id, driverId]);
      await db.query(`UPDATE rides SET status = 'invites_sent', driver_id = NULL, accepted_at = NULL, updated_at = now() WHERE id = $1`, [ride.id]);
      const fresh = (await query<RideRow>('SELECT * FROM rides WHERE id = $1', [ride.id], db))[0]!;
      await matchAndInvite(db, fresh, actor);
      await notifyMember(db, ride.member_id, { kind: 'driver_changed', title: 'We’re finding you a new driver', body: `Your driver for ${formatWhen(ride.pickup_at)} can no longer take you. We’re asking other drivers now.`, link: `/member/rides/${ride.id}`, rideId: ride.id });
    }
    if (accepted.length) {
      await notifyRole(db, ['coordinator'], { kind: 'reassigned', title: 'Lifts being reassigned', body: `${accepted.length} lift(s) are being offered to other drivers because a driver left the scheme.`, link: '/office' });
    }
    await audit(actor, { action: 'driver.close', entityType: 'driver', entityId: driverId, details: { reason, reassigned: accepted.length, deleteAfter: deleteAfter.toISOString() } }, db);
    return { ok: true, reassignedRides: accepted.length, deleteAfter };
  });
}
