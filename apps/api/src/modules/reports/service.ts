import { and, avg, count, countDistinct, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import { DECLINE_REASONS, INELIGIBLE_LABELS } from '@psebc/shared';
import { db } from '../../db/client';
import { q } from '../../db/sql';
import { auditLog, concerns, drivers, members, rideInvites, rides, tripLogs } from '../../db/schema';
import { env } from '../../config/env';

/**
 * 7.1 Monthly reports dashboard (CR-01). Counts only — never health information.
 * Per-member names are behind REPORTS_SHOW_MEMBER_NAMES until the DPIA covers them (task 8.12).
 */

const DONE = ['completed', 'logged', 'signed_off'] as const;

async function countRides(where: SQL | undefined): Promise<number> {
  const [r] = await db.select({ n: count() }).from(rides).where(where);
  return r?.n ?? 0;
}

export async function monthlyReport(month: string) {
  const start = new Date(`${month}-01T00:00:00Z`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  const prevStart = new Date(start);
  prevStart.setUTCMonth(prevStart.getUTCMonth() - 1);

  const inMonth = and(gte(rides.pickupAt, start), lt(rides.pickupAt, end));
  const done = inArray(rides.status, [...DONE]);

  const completed = await countRides(and(inMonth, done));
  const prevCompleted = await countRides(and(gte(rides.pickupAt, prevStart), lt(rides.pickupAt, start), done));
  const requested = await countRides(and(inMonth, isNull(rides.rebookedFromId)));
  const cancelled = await countRides(and(inMonth, eq(rides.status, 'cancelled'), ne(rides.cancelReason, 'no_driver')));
  const noDriver = await countRides(
    and(inMonth, or(and(eq(rides.status, 'cancelled'), eq(rides.cancelReason, 'no_driver')), and(inArray(rides.status, ['unmatched', 'invites_sent']), lt(rides.pickupAt, new Date())))),
  );
  const signedOff7d = await countRides(and(inMonth, eq(rides.status, 'signed_off'), lte(rides.signedOffAt, sql`${rides.completedAt} + interval '7 days'`)));
  const matchedBeforePickup = await countRides(and(inMonth, isNotNull(rides.acceptedAt), lt(rides.acceptedAt, rides.pickupAt)));

  const [c] = await db
    .select({
      total: count(),
      reviewed: sql<number>`count(*) FILTER (WHERE ${concerns.status} = 'reviewed')`.mapWith(Number),
      notified24h: sql<number>`count(*) FILTER (WHERE ${concerns.notifiedAt} <= ${concerns.createdAt} + interval '24 hours')`.mapWith(Number),
    })
    .from(concerns)
    .innerJoin(rides, eq(rides.id, concerns.rideId))
    .where(inMonth);

  const [ratings] = await db
    .select({ avg: avg(tripLogs.rating).mapWith(Number), n: count(tripLogs.rating) })
    .from(tripLogs)
    .innerJoin(rides, eq(rides.id, tripLogs.rideId))
    .where(and(inMonth, isNotNull(tripLogs.rating)));

  const [usage] = await db.select({ n: countDistinct(rides.memberId) }).from(rides).where(and(inMonth, done));
  // Every completed ride had an approved driver at acceptance (enforced at accept time).
  const [approvedAtAccept] = await db.select({ n: count() }).from(rides).innerJoin(drivers, eq(drivers.id, rides.driverId)).where(and(inMonth, done));

  const week = sql<Date>`date_trunc('week', ${rides.pickupAt})`;
  const byWeek = await db.select({ week, trips: count() }).from(rides).where(and(inMonth, done)).groupBy(week).orderBy(week);

  // Why no driver was found: decline reasons on rides that never got a driver…
  const declineReasons = await db
    .select({ reason: rideInvites.declineReason, n: count() })
    .from(rideInvites)
    .innerJoin(rides, eq(rides.id, rideInvites.rideId))
    .where(and(inMonth, eq(rideInvites.status, 'declined'), isNull(rides.driverId), inArray(rides.status, ['unmatched', 'cancelled', 'invites_sent'])))
    .groupBy(rideInvites.declineReason)
    .orderBy(desc(count()));
  // …plus the matching rules that ruled drivers out when nobody was eligible (from the audit trail).
  const reason = sql<string>`x->>'reason'`;
  const ineligible = await db
    .select({ reason, n: count() })
    .from(auditLog)
    .innerJoin(rides, sql`${rides.id}::text = ${auditLog.entityId}`)
    .innerJoin(sql`jsonb_array_elements(${auditLog.details}->'rejected') AS x`, sql`true`)
    .where(
      and(
        eq(auditLog.action, 'ride.match'),
        sql`${auditLog.details}->>'status' = 'unmatched'`,
        sql`(${auditLog.details}->>'eligible')::int = 0`,
        inMonth,
        isNull(rides.driverId),
        sql`${reason} IN ('vehicle_unsuitable', 'cannot_give_help', 'busy')`,
      ),
    )
    .groupBy(reason)
    .orderBy(desc(count()));

  // Driver workload — not a ranking (sponsor decision); first names only.
  const workload = await db
    .select({
      name: drivers.fullName,
      trips: sql<number>`(SELECT count(*) FROM ${rides} WHERE ${q(rides.driverId)} = ${q(drivers.id)} AND ${q(rides.pickupAt)} >= ${start} AND ${q(rides.pickupAt)} < ${end} AND ${q(rides.status)} IN ('completed','logged','signed_off'))`.mapWith(Number),
      declined: sql<number>`(SELECT count(*) FROM ${rideInvites} i JOIN ${rides} r ON r.id = i.ride_id WHERE i.driver_id = ${q(drivers.id)} AND i.status = 'declined' AND r.pickup_at >= ${start} AND r.pickup_at < ${end})`.mapWith(Number),
    })
    .from(drivers)
    .where(inArray(drivers.status, ['approved', 'expired', 'closed', 'pending']))
    .orderBy(drivers.fullName);

  const usual = sql<string>`mode() WITHIN GROUP (ORDER BY ${rides.destination})`;
  const memberUsage = await db
    .select({ name: members.preferredName, trips: count(), usual })
    .from(rides)
    .innerJoin(members, eq(members.id, rides.memberId))
    .where(and(inMonth, done))
    .groupBy(members.id, members.preferredName)
    .orderBy(desc(count()))
    .limit(10);

  const [expiring] = await db
    .select({ n: count() })
    .from(drivers)
    .where(and(eq(drivers.status, 'approved'), sql`LEAST(${drivers.approvedUntil}, ${drivers.dbsRenewalDate}, ${drivers.insuranceExpiry}) <= current_date + interval '30 days'`));

  const pct = (a: number, b: number) => (b === 0 ? null : Math.round((a / b) * 100));
  const averageRating = ratings?.n ? Math.round(ratings.avg * 10) / 10 : null;

  return {
    month,
    summary: {
      tripsCompleted: completed,
      tripsCompletedPreviousMonth: prevCompleted,
      liftsRequested: requested,
      cancelled,
      noDriverFound: noDriver,
      concernsReported: c?.total ?? 0,
      concernsReviewed: c?.reviewed ?? 0,
      averageRating,
      ratingsCount: ratings?.n ?? 0,
      membersUsed: usage?.n ?? 0,
      expiringDrivers: expiring?.n ?? 0,
    },
    successMeasures: {
      ridesWithApprovedDriverPct: pct(approvedAtAccept?.n ?? 0, completed),
      tripsSignedOffWithin7DaysPct: pct(signedOff7d, completed),
      incidentsReachingSafeguardingPct: pct(c?.notified24h ?? 0, c?.total ?? 0),
      requestsMatchedPct: pct(matchedBeforePickup, requested - cancelled),
      memberSatisfaction: averageRating,
    },
    byWeek: byWeek.map((w) => ({ weekStarting: w.week, trips: w.trips })),
    noDriverReasons: [
      ...ineligible.map((r) => ({ reason: INELIGIBLE_LABELS[r.reason as keyof typeof INELIGIBLE_LABELS] ?? r.reason, count: r.n })),
      ...declineReasons.map((r) => ({ reason: DECLINE_REASONS[r.reason as keyof typeof DECLINE_REASONS] ?? r.reason ?? 'Unknown', count: r.n })),
    ],
    driverWorkload: workload.filter((w) => w.trips > 0 || w.declined > 0).map((w) => ({ name: w.name.split(' ')[0], trips: w.trips, declined: w.declined })),
    memberUsage: env().REPORTS_SHOW_MEMBER_NAMES ? memberUsage.map((m) => ({ name: m.name, trips: m.trips, usuallyGoingTo: m.usual })) : null,
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
