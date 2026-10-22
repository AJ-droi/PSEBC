import { DECLINE_REASONS, INELIGIBLE_LABELS } from '@psebc/shared';
import { query } from '../../db/pool';
import { env } from '../../config/env';

/**
 * 7.1 Monthly reports dashboard (CR-01). Counts only — never health information.
 * Per-member names are behind REPORTS_SHOW_MEMBER_NAMES until the DPIA covers them (task 8.12).
 */
export async function monthlyReport(month: string) {
  const start = new Date(`${month}-01T00:00:00Z`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  const prevStart = new Date(start);
  prevStart.setUTCMonth(prevStart.getUTCMonth() - 1);

  const [s] = await query<{
    completed: number;
    prev_completed: number;
    requested: number;
    cancelled: number;
    no_driver: number;
    concerns: number;
    concerns_reviewed: number;
    avg_rating: number | null;
    ratings: number;
    members_used: number;
    signed_off_7d: number;
    matched_before_pickup: number;
    approved_at_accept: number;
    concerns_notified_24h: number;
  }>(
    `WITH month_rides AS (SELECT * FROM rides WHERE pickup_at >= $1 AND pickup_at < $2)
     SELECT
       (SELECT count(*) FROM month_rides WHERE status IN ('completed','logged','signed_off')) AS completed,
       (SELECT count(*) FROM rides WHERE pickup_at >= $3 AND pickup_at < $1 AND status IN ('completed','logged','signed_off')) AS prev_completed,
       (SELECT count(*) FROM month_rides WHERE rebooked_from_id IS NULL) AS requested,
       (SELECT count(*) FROM month_rides WHERE status = 'cancelled' AND cancel_reason <> 'no_driver') AS cancelled,
       (SELECT count(*) FROM month_rides WHERE (status = 'cancelled' AND cancel_reason = 'no_driver') OR (status IN ('unmatched','invites_sent') AND pickup_at < now())) AS no_driver,
       (SELECT count(*) FROM concerns c JOIN month_rides r ON r.id = c.ride_id) AS concerns,
       (SELECT count(*) FROM concerns c JOIN month_rides r ON r.id = c.ride_id WHERE c.status = 'reviewed') AS concerns_reviewed,
       (SELECT round(avg(l.rating)::numeric, 1) FROM trip_logs l JOIN month_rides r ON r.id = l.ride_id WHERE l.rating IS NOT NULL) AS avg_rating,
       (SELECT count(*) FROM trip_logs l JOIN month_rides r ON r.id = l.ride_id WHERE l.rating IS NOT NULL) AS ratings,
       (SELECT count(DISTINCT member_id) FROM month_rides WHERE status IN ('completed','logged','signed_off')) AS members_used,
       (SELECT count(*) FROM month_rides WHERE status = 'signed_off' AND signed_off_at <= completed_at + interval '7 days') AS signed_off_7d,
       (SELECT count(*) FROM month_rides WHERE accepted_at IS NOT NULL AND accepted_at < pickup_at) AS matched_before_pickup,
       (SELECT count(*) FROM month_rides r JOIN drivers d ON d.id = r.driver_id WHERE r.status IN ('completed','logged','signed_off')) AS approved_at_accept,
       (SELECT count(*) FROM concerns c JOIN month_rides r ON r.id = c.ride_id WHERE c.notified_at <= c.created_at + interval '24 hours') AS concerns_notified_24h`,
    [start, end, prevStart],
  );

  const byWeek = await query<{ week: Date; trips: number }>(
    `SELECT date_trunc('week', pickup_at) AS week, count(*) AS trips
       FROM rides WHERE pickup_at >= $1 AND pickup_at < $2 AND status IN ('completed','logged','signed_off')
      GROUP BY 1 ORDER BY 1`,
    [start, end],
  );

  // Why no driver was found: decline reasons on rides that never got a driver, plus "no eligible driver" from matching.
  const declineReasons = await query<{ reason: string; n: number }>(
    `SELECT i.decline_reason AS reason, count(*) AS n
       FROM ride_invites i JOIN rides r ON r.id = i.ride_id
      WHERE r.pickup_at >= $1 AND r.pickup_at < $2 AND i.status = 'declined' AND r.driver_id IS NULL
        AND (r.status IN ('unmatched','cancelled','invites_sent'))
      GROUP BY 1 ORDER BY n DESC`,
    [start, end],
  );
  const ineligible = await query<{ reason: string; n: number }>(
    `SELECT x->>'reason' AS reason, count(*) AS n
       FROM audit_log a JOIN rides r ON r.id::text = a.entity_id,
            jsonb_array_elements(a.details->'rejected') x
      WHERE a.action = 'ride.match' AND (a.details->>'status') = 'unmatched' AND (a.details->>'eligible')::int = 0
        AND r.pickup_at >= $1 AND r.pickup_at < $2 AND r.driver_id IS NULL
        AND x->>'reason' IN ('vehicle_unsuitable', 'cannot_give_help', 'busy')
      GROUP BY 1 ORDER BY n DESC`,
    [start, end],
  );

  const workload = await query<{ name: string; trips: number; declined: number }>(
    `SELECT d.full_name AS name,
            (SELECT count(*) FROM rides r WHERE r.driver_id = d.id AND r.pickup_at >= $1 AND r.pickup_at < $2 AND r.status IN ('completed','logged','signed_off')) AS trips,
            (SELECT count(*) FROM ride_invites i JOIN rides r ON r.id = i.ride_id WHERE i.driver_id = d.id AND i.status = 'declined' AND r.pickup_at >= $1 AND r.pickup_at < $2) AS declined
       FROM drivers d WHERE d.status IN ('approved','expired','closed','pending')
      ORDER BY trips DESC, name`,
    [start, end],
  );

  const memberUsage = await query<{ name: string; trips: number; usual: string }>(
    `SELECT m.preferred_name AS name, count(*) AS trips, mode() WITHIN GROUP (ORDER BY r.destination) AS usual
       FROM rides r JOIN members m ON m.id = r.member_id
      WHERE r.pickup_at >= $1 AND r.pickup_at < $2 AND r.status IN ('completed','logged','signed_off')
      GROUP BY m.id, m.preferred_name ORDER BY trips DESC LIMIT 10`,
    [start, end],
  );

  const [expiring] = await query<{ n: number }>(
    `SELECT count(*) AS n FROM drivers WHERE status = 'approved' AND LEAST(approved_until, dbs_renewal_date, insurance_expiry) <= (current_date + interval '30 days')`,
  );

  const pct = (a: number, b: number) => (b === 0 ? null : Math.round((a / b) * 100));
  const showNames = env().REPORTS_SHOW_MEMBER_NAMES;
  const finishedRequests = s!.requested - s!.cancelled;

  return {
    month,
    summary: {
      tripsCompleted: s!.completed,
      tripsCompletedPreviousMonth: s!.prev_completed,
      liftsRequested: s!.requested,
      cancelled: s!.cancelled,
      noDriverFound: s!.no_driver,
      concernsReported: s!.concerns,
      concernsReviewed: s!.concerns_reviewed,
      averageRating: s!.avg_rating,
      ratingsCount: s!.ratings,
      membersUsed: s!.members_used,
      expiringDrivers: expiring?.n ?? 0,
    },
    successMeasures: {
      ridesWithApprovedDriverPct: pct(s!.approved_at_accept, s!.completed),
      tripsSignedOffWithin7DaysPct: pct(s!.signed_off_7d, s!.completed),
      incidentsReachingSafeguardingPct: pct(s!.concerns_notified_24h, s!.concerns),
      requestsMatchedPct: pct(s!.matched_before_pickup, finishedRequests),
      memberSatisfaction: s!.avg_rating,
    },
    byWeek: byWeek.map((w) => ({ weekStarting: w.week, trips: w.trips })),
    noDriverReasons: [
      ...ineligible.map((r) => ({ reason: INELIGIBLE_LABELS[r.reason as keyof typeof INELIGIBLE_LABELS] ?? r.reason, count: r.n })),
      ...declineReasons.map((r) => ({ reason: DECLINE_REASONS[r.reason as keyof typeof DECLINE_REASONS] ?? r.reason, count: r.n })),
    ],
    // Workload, not a ranking (sponsor decision) — first names only.
    driverWorkload: workload.filter((w) => w.trips > 0 || w.declined > 0).map((w) => ({ name: w.name.split(' ')[0], trips: w.trips, declined: w.declined })),
    memberUsage: showNames ? memberUsage.map((m) => ({ name: m.name, trips: m.trips, usuallyGoingTo: m.usual })) : null,
    memberUsageCounts: memberUsage.map((m) => m.trips),
  };
}

export function reportToCsv(r: Awaited<ReturnType<typeof monthlyReport>>): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines: string[] = [];
  const row = (...cells: unknown[]) => lines.push(cells.map(esc).join(','));
  row('PSEBC Lifts monthly report', r.month);
  row();
  row('Measure', 'Value');
  for (const [k, v] of Object.entries(r.summary)) row(k, v);
  row();
  row('Success measure', 'Percent');
  for (const [k, v] of Object.entries(r.successMeasures)) row(k, v);
  row();
  row('Week starting', 'Trips completed');
  for (const w of r.byWeek) row(new Date(w.weekStarting).toISOString().slice(0, 10), w.trips);
  row();
  row('Why no driver was found', 'Count');
  for (const n of r.noDriverReasons) row(n.reason, n.count);
  row();
  row('Driver', 'Trips', 'Declined');
  for (const d of r.driverWorkload) row(d.name, d.trips, d.declined);
  if (r.memberUsage) {
    row();
    row('Member', 'Trips', 'Usually going to');
    for (const m of r.memberUsage) row(m.name, m.trips, m.usuallyGoingTo);
  }
  return lines.join('\r\n') + '\r\n';
}
