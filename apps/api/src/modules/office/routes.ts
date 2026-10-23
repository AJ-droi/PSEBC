import { Router } from 'express';
import { aliasedTable, and, asc, desc, eq, gt, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { inviteCount, q, tripLogExists } from '../../db/sql';
import { drivers, members, notifications, rides, users } from '../../db/schema';
import { ah } from '../../lib/http';
import { pageFrom } from '../../lib/pagination';
import { requireRole } from '../../middleware/auth';
import { statusFields } from '../rides/views';

export const officeRouter = Router();

const bookedBy = aliasedTable(users, 'booked_by');
/** "Needs attention" lists are things to act on now, not browse; cap each so the page stays light. */
const ATTENTION_CAP = 50;

/** Church office "Lifts this week" (design O-Coordinator): needs attention + upcoming lifts. */
officeRouter.get(
  '/overview',
  requireRole('coordinator', 'admin', 'safeguarding'),
  ah(async (req, res) => {
    const page = pageFrom(req);
    const from = req.query.from ? new Date(String(req.query.from)) : startOfWeek(new Date());
    const to = new Date(from.getTime() + 7 * 86_400_000);

    const unmatched = await db
      .select({
        id: rides.id,
        pickupAt: rides.pickupAt,
        memberId: rides.memberId,
        fullName: members.fullName,
        phone: members.phone,
        invited: inviteCount(),
        declined: inviteCount('declined'),
      })
      .from(rides)
      .innerJoin(members, eq(members.id, rides.memberId))
      .where(and(eq(rides.status, 'unmatched'), gt(rides.pickupAt, sql`now() - interval '2 hours'`)))
      .orderBy(asc(rides.pickupAt))
      .limit(ATTENTION_CAP);

    const notAtPickup = await db
      .select({ id: rides.id, pickupAt: rides.pickupAt, fullName: members.fullName, phone: members.phone, emergencyPhone: members.emergencyPhone, driverName: drivers.fullName })
      .from(rides)
      .innerJoin(members, eq(members.id, rides.memberId))
      .leftJoin(drivers, eq(drivers.id, rides.driverId))
      .where(and(gt(rides.notAtPickupAt, sql`now() - interval '12 hours'`), eq(rides.status, 'driver_found'), isNull(rides.pickedUpAt)))
      .limit(ATTENTION_CAP);

    // Members without a login whose trip still needs their side of the log.
    const phoneLogs = await db
      .select({ id: rides.id, pickupAt: rides.pickupAt, fullName: members.fullName, phone: members.phone, memberId: members.id })
      .from(rides)
      .innerJoin(members, eq(members.id, rides.memberId))
      .where(
        and(
          inArray(rides.status, ['completed', 'logged']),
          sql`NOT ${tripLogExists('member')}`,
          sql`NOT EXISTS (SELECT 1 FROM ${users} WHERE ${q(users.memberId)} = ${q(members.id)} AND ${q(users.status)} = 'active')`,
        ),
      )
      .orderBy(asc(rides.pickupAt))
      .limit(ATTENTION_CAP);

    const tasks = await db
      .selectDistinctOn([notifications.title, notifications.rideId], { id: notifications.id, title: notifications.title, body: notifications.body, link: notifications.link, createdAt: notifications.createdAt })
      .from(notifications)
      .where(and(eq(notifications.channel, 'phone_task'), isNull(notifications.readAt), eq(notifications.userId, req.user!.id)))
      .orderBy(notifications.title, notifications.rideId, desc(notifications.createdAt))
      .limit(ATTENTION_CAP);

    const upcoming = await db
      .select({
        id: rides.id,
        memberName: members.fullName,
        pickupAt: rides.pickupAt,
        destination: rides.destination,
        status: rides.status,
        incidentReportedAt: rides.incidentReportedAt,
        driverName: drivers.fullName,
        bookedByRole: rides.bookedByRole,
        bookedByName: bookedBy.fullName,
      })
      .from(rides)
      .innerJoin(members, eq(members.id, rides.memberId))
      .leftJoin(drivers, eq(drivers.id, rides.driverId))
      .leftJoin(bookedBy, eq(bookedBy.id, rides.bookedByUserId))
      .where(and(gte(rides.pickupAt, from), lt(rides.pickupAt, to)))
      .orderBy(asc(rides.pickupAt), asc(rides.id))
      .limit(page.limit)
      .offset(page.offset);
    const upcomingTotal = await db.$count(rides, and(gte(rides.pickupAt, from), lt(rides.pickupAt, to)));

    res.json({
      week: { from, to },
      attention: [
        ...unmatched.map((r) => ({
          type: 'no_driver' as const,
          rideId: r.id,
          memberId: r.memberId,
          memberName: r.fullName,
          phone: r.phone,
          pickupAt: r.pickupAt,
          detail: r.invited === 0 ? 'No eligible driver for this member’s needs.' : `Nobody accepted. ${r.invited} driver(s) asked${r.declined ? `, ${r.declined} declined` : ''}.`,
        })),
        ...notAtPickup.map((r) => ({
          type: 'not_at_pickup' as const,
          rideId: r.id,
          memberName: r.fullName,
          phone: r.phone,
          emergencyPhone: r.emergencyPhone,
          pickupAt: r.pickupAt,
          detail: `${r.driverName?.split(' ')[0] ?? 'The driver'} is waiting outside. No answer at the door.`,
        })),
        ...phoneLogs.map((r) => ({
          type: 'phone_log' as const,
          rideId: r.id,
          memberId: r.memberId,
          memberName: r.fullName,
          phone: r.phone,
          pickupAt: r.pickupAt,
          detail: 'This member doesn’t use the app. Call them and fill in the trip log for them.',
        })),
      ],
      tasks,
      pagination: page.meta(upcomingTotal),
      attentionCapped: [unmatched, notAtPickup, phoneLogs, tasks].some((l) => l.length >= ATTENTION_CAP),
      upcoming: upcoming.map((r) => ({
        id: r.id,
        memberName: r.memberName,
        pickupAt: r.pickupAt,
        destination: r.destination,
        ...statusFields(r),
        driverName: r.driverName?.split(' ')[0] ?? null,
        bookedBy: r.bookedByRole === 'member' ? 'Member' : `Office${r.bookedByName ? ` (${r.bookedByName.split(' ')[0]})` : ''}`,
      })),
    });
  }),
);

function startOfWeek(d: Date): Date {
  const r = new Date(d);
  const day = (r.getUTCDay() + 6) % 7; // Monday = 0
  r.setUTCDate(r.getUTCDate() - day);
  r.setUTCHours(0, 0, 0, 0);
  return r;
}
