import { RULES } from '@psebc/shared';
import { query, withTx } from '../db/pool';
import { formatWhen } from '../lib/time';
import { logger } from '../lib/logger';
import { audit, SYSTEM_ACTOR } from '../services/audit';
import { flushOutbox, notifyDriver, notifyMember, notifyRole } from '../services/notify';
import type { RideRow } from '../modules/rides/repo';

/**
 * Background checks. Each is idempotent and safe to run at any interval, so they
 * can run in-process (node-cron) or from an external cron hitting POST /api/jobs/run.
 */

async function setting(key: string, fallback: number): Promise<number> {
  const rows = await query<{ value: unknown }>('SELECT value FROM settings WHERE key = $1', [key]);
  const v = Number(rows[0]?.value);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/** Story 3.3 (PSEBC-19): flag to the coordinator if no driver accepts within 24h, or 2h before pickup. */
export async function flagUnmatched(now = new Date()): Promise<number> {
  const afterH = await setting('unmatched_after_hours', RULES.unmatchedAfterHours);
  const beforeH = await setting('unmatched_before_pickup_hours', RULES.unmatchedBeforePickupHours);
  const rides = await query<RideRow>(
    `SELECT * FROM rides WHERE status = 'invites_sent'
       AND (created_at <= $1::timestamptz - make_interval(hours => $2::int) OR pickup_at <= $1::timestamptz + make_interval(hours => $3::int))`,
    [now, afterH, beforeH],
  );
  for (const ride of rides) {
    await withTx(async (db) => {
      const r = await db.query(`UPDATE rides SET status = 'unmatched', unmatched_flagged_at = $2, updated_at = now() WHERE id = $1 AND status = 'invites_sent'`, [ride.id, now]);
      if (r.rowCount === 0) return;
      await notifyRole(db, ['coordinator', 'admin'], {
        kind: 'unmatched',
        title: 'No driver has accepted yet',
        body: `Nobody has accepted the lift on ${formatWhen(ride.pickup_at)}. Please call the member or re-send invites.`,
        link: `/office/rides/${ride.id}`,
        rideId: ride.id,
      }, { email: true, sms: true });
      await audit(SYSTEM_ACTOR, { action: 'ride.flag_unmatched', entityType: 'ride', entityId: ride.id }, db);
    });
  }
  return rides.length;
}

/** Requests that reach pickup time with no driver are closed as "no driver found". */
export async function closeExpiredRequests(now = new Date()): Promise<number> {
  const rows = await query<{ id: string; member_id: string; pickup_at: Date }>(
    `UPDATE rides SET status = 'cancelled', cancel_reason = 'no_driver', cancelled_at = $1, updated_at = now()
      WHERE status IN ('requested', 'invites_sent', 'unmatched') AND pickup_at < $1::timestamptz - interval '1 hour'
      RETURNING id, member_id, pickup_at`,
    [now],
  );
  for (const r of rows) {
    await query(`UPDATE ride_invites SET status = 'withdrawn', responded_at = now() WHERE ride_id = $1 AND status = 'sent'`, [r.id]);
    await audit(SYSTEM_ACTOR, { action: 'ride.no_driver', entityType: 'ride', entityId: r.id });
  }
  return rows.length;
}

/** Story 6.1: ready for sign-off 72 hours after completion if a log is missing (missing log noted). */
export async function applyLogTimeout(now = new Date()): Promise<number> {
  const rides = await query<{ id: string; driver_logged: boolean; member_logged: boolean }>(
    `SELECT r.id,
            EXISTS (SELECT 1 FROM trip_logs l WHERE l.ride_id = r.id AND l.author = 'driver') AS driver_logged,
            EXISTS (SELECT 1 FROM trip_logs l WHERE l.ride_id = r.id AND l.author = 'member') AS member_logged
       FROM rides r WHERE r.status = 'completed' AND r.logs_due_at <= $1`,
    [now],
  );
  for (const r of rides) {
    const missing = [!r.driver_logged && 'driver log', !r.member_logged && 'member log'].filter(Boolean).join(' and ');
    await query(`UPDATE rides SET status = 'logged', logged_at = $2, missing_log_note = $3, updated_at = now() WHERE id = $1 AND status = 'completed'`, [r.id, now, missing ? `${missing[0]!.toUpperCase()}${missing.slice(1)} missing (72 hours passed)` : null]);
    await audit(SYSTEM_ACTOR, { action: 'trip.log_timeout', entityType: 'ride', entityId: r.id, details: { missing } });
  }
  return rides.length;
}

/** Story 1.4 (PSEBC-10): remind 30 days before DBS/insurance expiry; on expiry set status Expired automatically. */
export async function checkDriverExpiry(now = new Date()): Promise<{ reminded: number; expired: number }> {
  const today = now.toISOString().slice(0, 10);
  const days = await setting('expiry_reminder_days', RULES.expiryReminderDays);
  const soon = new Date(now.getTime() + days * 86_400_000).toISOString().slice(0, 10);

  const expired = await query<{ id: string; full_name: string }>(
    `UPDATE drivers SET status = 'expired', updated_at = now()
      WHERE status = 'approved' AND LEAST(approved_until, dbs_renewal_date, insurance_expiry) < $1::date
      RETURNING id, full_name`,
    [today],
  );
  for (const d of expired) {
    await withTx(async (db) => {
      await db.query(`UPDATE ride_invites SET status = 'withdrawn', responded_at = now() WHERE driver_id = $1 AND status = 'sent'`, [d.id]);
      await audit(SYSTEM_ACTOR, { action: 'driver.expire', entityType: 'driver', entityId: d.id }, db);
      await notifyRole(db, ['safeguarding', 'admin'], { kind: 'driver_expired', title: 'Driver checks expired', body: `${d.full_name}’s checks have expired. They won’t get lift requests until renewed and re-approved.`, link: `/safeguarding/approvals/${d.id}` }, { email: true });
      await notifyDriver(db, d.id, { kind: 'driver_expired', title: 'Your checks have expired', body: 'You won’t get lift requests until your DBS or insurance is renewed. Please contact the church office.', link: '/driver' });
    });
  }

  const expiring = await query<{ id: string; full_name: string; first_expiry: string; which: string }>(
    `SELECT id, full_name, LEAST(approved_until, dbs_renewal_date, insurance_expiry)::text AS first_expiry,
            CASE WHEN insurance_expiry <= dbs_renewal_date THEN 'insurance' ELSE 'DBS check' END AS which
       FROM drivers
      WHERE status = 'approved' AND LEAST(approved_until, dbs_renewal_date, insurance_expiry) <= $1::date
        AND (expiry_reminded_for IS NULL OR expiry_reminded_for <> LEAST(approved_until, dbs_renewal_date, insurance_expiry))`,
    [soon],
  );
  for (const d of expiring) {
    await withTx(async (db) => {
      await db.query('UPDATE drivers SET expiry_reminded_for = $2 WHERE id = $1', [d.id, d.first_expiry]);
      await notifyRole(db, ['safeguarding'], { kind: 'driver_expiring', title: 'Driver check expiring soon', body: `${d.full_name}’s ${d.which} expires on ${d.first_expiry}.`, link: `/safeguarding/approvals/${d.id}` }, { email: true });
      await notifyDriver(db, d.id, { kind: 'driver_expiring', title: 'Your check is expiring soon', body: `Your ${d.which} expires on ${d.first_expiry}. Please give the church office your renewed details.`, link: '/driver' });
      await audit(SYSTEM_ACTOR, { action: 'driver.expiry_reminder', entityType: 'driver', entityId: d.id, details: { expires: d.first_expiry } }, db);
    });
  }
  return { reminded: expiring.length, expired: expired.length };
}

/** Day-before reminder to the member and driver (Should have). */
export async function sendReminders(now = new Date()): Promise<number> {
  const rides = await query<RideRow>(
    `SELECT * FROM rides WHERE status = 'driver_found' AND reminder_sent_at IS NULL AND pickup_at BETWEEN $1 AND $1::timestamptz + interval '24 hours'`,
    [now],
  );
  for (const r of rides) {
    await withTx(async (db) => {
      await db.query('UPDATE rides SET reminder_sent_at = now() WHERE id = $1', [r.id]);
      await notifyMember(db, r.member_id, { kind: 'reminder', title: 'Lift reminder', body: `Reminder: your lift is on ${formatWhen(r.pickup_at)}.`, link: `/member/rides/${r.id}`, rideId: r.id });
      if (r.driver_id) await notifyDriver(db, r.driver_id, { kind: 'reminder', title: 'Lift reminder', body: `Reminder: you’re driving on ${formatWhen(r.pickup_at)}.`, link: `/driver/trips/${r.id}`, rideId: r.id });
    });
  }
  return rides.length;
}

/** Retention (PRD §9): anonymise personal data once the deletion date passes. Trip logs are kept (6 years). */
export async function applyRetention(now = new Date()): Promise<number> {
  const members = await query<{ id: string }>(
    `UPDATE members SET full_name = 'Former member', preferred_name = 'Former member', address_line = '', town = '', postcode = '',
            finding_notes = '', phone = '', emergency_name = '', emergency_relationship = '', emergency_phone = '',
            representative_name = '', representative_phone = '', mobility_aids = '{}', help_needed = '{}', notes_for_driver = '',
            health_enc = NULL, delete_after = NULL, updated_at = now()
      WHERE status = 'closed' AND delete_after IS NOT NULL AND delete_after <= $1 RETURNING id`,
    [now],
  );
  const drivers = await query<{ id: string }>(
    `UPDATE drivers SET full_name = 'Former driver', phone = '', email = '', postcode = '', dbs_number = '', vehicle_reg = '',
            photo_doc_id = NULL, licence_doc_id = NULL, insurance_doc_id = NULL, delete_after = NULL, updated_at = now()
      WHERE status = 'closed' AND delete_after IS NOT NULL AND delete_after <= $1 RETURNING id`,
    [now],
  );
  for (const d of drivers) await query('DELETE FROM documents WHERE driver_id = $1', [d.id]);
  await query(`UPDATE users SET email = 'deleted-' || id || '@invalid', full_name = 'Former user', phone = NULL, mfa_secret = NULL, delete_after = NULL WHERE status = 'closed' AND delete_after IS NOT NULL AND delete_after <= $1`, [now]);
  for (const m of members) await audit(SYSTEM_ACTOR, { action: 'member.anonymise', entityType: 'member', entityId: m.id });
  for (const d of drivers) await audit(SYSTEM_ACTOR, { action: 'driver.anonymise', entityType: 'driver', entityId: d.id });
  return members.length + drivers.length;
}

export async function runAll(now = new Date()) {
  const result = {
    unmatched: await flagUnmatched(now),
    noDriver: await closeExpiredRequests(now),
    logTimeouts: await applyLogTimeout(now),
    expiry: await checkDriverExpiry(now),
    reminders: await sendReminders(now),
    anonymised: await applyRetention(now),
    delivered: await flushOutbox(),
  };
  logger.info({ result }, 'scheduled jobs ran');
  return result;
}
