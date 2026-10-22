import { Router } from 'express';
import { RIDE_STATUS_LABELS, type RideStatus } from '@psebc/shared';
import { query } from '../../db/pool';
import { ah } from '../../lib/http';
import { requireRole } from '../../middleware/auth';

export const officeRouter = Router();

/** Church office "Lifts this week" (design O-Coordinator): needs attention + upcoming lifts. */
officeRouter.get(
  '/overview',
  requireRole('coordinator', 'admin', 'safeguarding'),
  ah(async (req, res) => {
    const from = req.query.from ? new Date(String(req.query.from)) : startOfWeek(new Date());
    const to = new Date(from.getTime() + 7 * 86_400_000);

    const unmatched = await query<{ id: string; pickup_at: Date; member_id: string; full_name: string; phone: string; unmatched_flagged_at: Date | null; declines: string[] | null; invited: number }>(
      `SELECT r.id, r.pickup_at, r.member_id, m.full_name, m.phone, r.unmatched_flagged_at,
              (SELECT array_agg(i.decline_reason) FROM ride_invites i WHERE i.ride_id = r.id AND i.status = 'declined') AS declines,
              (SELECT count(*) FROM ride_invites i WHERE i.ride_id = r.id) AS invited
         FROM rides r JOIN members m ON m.id = r.member_id
        WHERE r.status = 'unmatched' AND r.pickup_at > now() - interval '2 hours'
        ORDER BY r.pickup_at`,
    );
    const notAtPickup = await query<{ id: string; pickup_at: Date; full_name: string; phone: string; emergency_phone: string; not_at_pickup_at: Date; driver_name: string }>(
      `SELECT r.id, r.pickup_at, m.full_name, m.phone, m.emergency_phone, r.not_at_pickup_at, d.full_name AS driver_name
         FROM rides r JOIN members m ON m.id = r.member_id LEFT JOIN drivers d ON d.id = r.driver_id
        WHERE r.not_at_pickup_at > now() - interval '12 hours' AND r.status = 'driver_found' AND r.picked_up_at IS NULL`,
    );
    const phoneLogs = await query<{ id: string; pickup_at: Date; full_name: string; phone: string; member_id: string }>(
      `SELECT r.id, r.pickup_at, m.full_name, m.phone, m.id AS member_id
         FROM rides r JOIN members m ON m.id = r.member_id
        WHERE r.status IN ('completed', 'logged')
          AND NOT EXISTS (SELECT 1 FROM trip_logs l WHERE l.ride_id = r.id AND l.author = 'member')
          AND NOT EXISTS (SELECT 1 FROM users u WHERE u.member_id = m.id AND u.status = 'active')
        ORDER BY r.pickup_at`,
    );
    const tasks = await query<{ id: string; title: string; body: string; link: string | null; created_at: Date }>(
      `SELECT DISTINCT ON (n.title, n.ride_id) n.id, n.title, n.body, n.link, n.created_at
         FROM notifications n
        WHERE n.channel = 'phone_task' AND n.read_at IS NULL AND n.user_id = $1
        ORDER BY n.title, n.ride_id, n.created_at DESC`,
      [req.user!.id],
    );
    const upcoming = await query<{ id: string; full_name: string; pickup_at: Date; destination: string; status: RideStatus; driver_name: string | null; booked_by_role: string; booked_by_name: string | null }>(
      `SELECT r.id, m.full_name, r.pickup_at, r.destination, r.status, d.full_name AS driver_name, r.booked_by_role, u.full_name AS booked_by_name
         FROM rides r JOIN members m ON m.id = r.member_id LEFT JOIN drivers d ON d.id = r.driver_id LEFT JOIN users u ON u.id = r.booked_by_user_id
        WHERE r.pickup_at >= $1 AND r.pickup_at < $2
        ORDER BY r.pickup_at`,
      [from, to],
    );

    res.json({
      week: { from, to },
      attention: [
        ...unmatched.map((r) => ({
          type: 'no_driver' as const,
          rideId: r.id,
          memberId: r.member_id,
          memberName: r.full_name,
          phone: r.phone,
          pickupAt: r.pickup_at,
          detail: r.invited === 0 ? 'No eligible driver for this member’s needs.' : `Nobody accepted. ${r.invited} driver(s) asked${r.declines?.length ? `, ${r.declines.length} declined` : ''}.`,
        })),
        ...notAtPickup.map((r) => ({
          type: 'not_at_pickup' as const,
          rideId: r.id,
          memberName: r.full_name,
          phone: r.phone,
          emergencyPhone: r.emergency_phone,
          pickupAt: r.pickup_at,
          detail: `${r.driver_name?.split(' ')[0] ?? 'The driver'} is waiting outside. No answer at the door.`,
        })),
        ...phoneLogs.map((r) => ({
          type: 'phone_log' as const,
          rideId: r.id,
          memberId: r.member_id,
          memberName: r.full_name,
          phone: r.phone,
          pickupAt: r.pickup_at,
          detail: 'This member doesn’t use the app. Call them and fill in the trip log for them.',
        })),
      ],
      tasks: tasks.map((t) => ({ id: t.id, title: t.title, body: t.body, link: t.link, createdAt: t.created_at })),
      upcoming: upcoming.map((r) => ({
        id: r.id,
        memberName: r.full_name,
        pickupAt: r.pickup_at,
        destination: r.destination,
        status: r.status,
        statusLabel: RIDE_STATUS_LABELS[r.status],
        driverName: r.driver_name?.split(' ')[0] ?? null,
        bookedBy: r.booked_by_role === 'member' ? 'Member' : `Office${r.booked_by_name ? ` (${r.booked_by_name.split(' ')[0]})` : ''}`,
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
