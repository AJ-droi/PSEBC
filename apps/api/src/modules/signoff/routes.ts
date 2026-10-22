import { Router } from 'express';
import { signoffSchema, RIDE_STATUS_LABELS, type RideStatus } from '@psebc/shared';
import { query, withTx } from '../../db/pool';
import { ah, parse, uuidParam } from '../../lib/http';
import { AppError, conflict, notFound } from '../../lib/errors';
import { currentUser, requireRole } from '../../middleware/auth';
import { actorFrom, audit } from '../../services/audit';
import { lockRide, getRide } from '../rides/repo';
import { needsSummary } from '../rides/views';
import { getMember } from '../members/repo';

export const signoffRouter = Router();

/**
 * F11 Safeguarding sign-off queue (story 6.1 PSEBC-27).
 * A trip is ready when both logs are in, or 72 hours after completion with the missing log noted.
 */
signoffRouter.get(
  '/queue',
  requireRole('safeguarding'),
  ah(async (_req, res) => {
    const rows = await query<{
      id: string;
      status: RideStatus;
      pickup_at: Date;
      member_name: string;
      driver_name: string | null;
      missing_log_note: string | null;
      driver_logged: boolean;
      member_logged: boolean;
      open_concerns: number;
      concerns: number;
      completed_at: Date | null;
    }>(
      `SELECT r.id, r.status, r.pickup_at, r.completed_at, r.missing_log_note, m.preferred_name AS member_name, d.full_name AS driver_name,
              EXISTS (SELECT 1 FROM trip_logs l WHERE l.ride_id = r.id AND l.author = 'driver') AS driver_logged,
              EXISTS (SELECT 1 FROM trip_logs l WHERE l.ride_id = r.id AND l.author = 'member') AS member_logged,
              (SELECT count(*) FROM concerns c WHERE c.ride_id = r.id AND c.status = 'open') AS open_concerns,
              (SELECT count(*) FROM concerns c WHERE c.ride_id = r.id) AS concerns
         FROM rides r JOIN members m ON m.id = r.member_id LEFT JOIN drivers d ON d.id = r.driver_id
        WHERE r.status IN ('completed', 'logged')
        ORDER BY (r.status = 'logged') DESC, open_concerns DESC, r.pickup_at`,
    );
    res.json({
      trips: rows.map((r) => ({
        id: r.id,
        status: r.status,
        statusLabel: RIDE_STATUS_LABELS[r.status],
        pickupAt: r.pickup_at,
        completedAt: r.completed_at,
        memberName: r.member_name,
        driverName: r.driver_name?.split(' ')[0] ?? null,
        driverLogged: r.driver_logged,
        memberLogged: r.member_logged,
        missingLogNote: r.missing_log_note,
        openConcerns: r.open_concerns,
        concerns: r.concerns,
        ready: r.status === 'logged',
      })),
    });
  }),
);

/** Full trip record for the safeguarding lead, including concerns. */
signoffRouter.get(
  '/trips/:id',
  requireRole('safeguarding'),
  ah(async (req, res) => {
    const id = uuidParam(req);
    const ride = await getRide(id);
    if (!ride) throw notFound('Trip');
    const member = (await getMember(ride.member_id))!;
    const driver = ride.driver_id ? (await query<{ full_name: string; phone: string }>('SELECT full_name, phone FROM drivers WHERE id = $1', [ride.driver_id]))[0] : null;
    const logs = await query('SELECT author, went_as_planned AS "wentAsPlanned", anything_to_report AS "anythingToReport", needs_changed AS "needsChanged", on_time AS "onTime", felt_safe AS "feltSafe", rating, callback_requested AS "callbackRequested", comments, submitted_by_role AS "submittedByRole", created_at AS "createdAt" FROM trip_logs WHERE ride_id = $1', [id]);
    const concerns = await query(
      `SELECT id, reporter_role AS "reporterRole", reporter_name AS "reporterName", occurred_when AS "occurredWhen", occurred_where AS "occurredWhere", kinds,
              who_involved AS "whoInvolved", description, action_taken AS "actionTaken", anyone_hurt AS "anyoneHurt",
              emergency_services_called AS "emergencyServicesCalled", family_told AS "familyTold", status,
              reviewed_by_name AS "reviewedBy", reviewed_at AS "reviewedAt", outcome, review_notes AS "reviewNotes", created_at AS "createdAt"
         FROM concerns WHERE ride_id = $1 ORDER BY created_at`,
      [id],
    );
    await audit(actorFrom(req), { action: 'trip.view_record', entityType: 'ride', entityId: id });
    res.json({
      trip: {
        id: ride.id,
        status: ride.status,
        pickupAt: ride.pickup_at,
        destination: ride.destination,
        pickedUpAt: ride.picked_up_at,
        droppedOffAt: ride.dropped_off_at,
        notAtPickupAt: ride.not_at_pickup_at,
        returnAt: ride.return_needed ? ride.return_at : null,
        completedAt: ride.completed_at,
        missingLogNote: ride.missing_log_note,
        signedOffAt: ride.signed_off_at,
        signedOffBy: ride.signed_off_by_name,
        signoffOutcome: ride.signoff_outcome,
        signoffNotes: ride.signoff_notes,
      },
      member: { id: member.id, name: member.full_name, preferredName: member.preferred_name, needs: needsSummary(member, ride) },
      driver: driver ? { name: driver.full_name, phone: driver.phone } : null,
      logs,
      concerns,
    });
  }),
);

/**
 * Sign off a trip (stories 6.1, 6.2, 4.3). Records name and date; ends the driver's
 * access to the member's details (enforced by status in the ride views).
 */
signoffRouter.post(
  '/trips/:id/signoff',
  requireRole('safeguarding'),
  ah(async (req, res) => {
    const id = uuidParam(req);
    const input = parse(signoffSchema, req.body);
    const user = currentUser(req);
    await withTx(async (db) => {
      const ride = await lockRide(id, db);
      if (!ride) throw notFound('Trip');
      if (ride.status !== 'logged') throw conflict('This trip is not ready for sign-off yet. It needs both logs, or 72 hours after completion.');
      const open = await query<{ n: number }>(`SELECT count(*) AS n FROM concerns WHERE ride_id = $1 AND status = 'open'`, [id], db);
      if ((open[0]?.n ?? 0) > 0) throw new AppError(409, 'concern_open', 'Review the concern before signing off');
      await db.query(
        `UPDATE rides SET status = 'signed_off', signed_off_at = now(), signed_off_by = $2, signed_off_by_name = $3, signoff_outcome = $4, signoff_notes = $5, updated_at = now() WHERE id = $1`,
        [id, user.id, user.fullName, input.outcome, input.notes],
      );
      await audit(actorFrom(req), { action: 'trip.signoff', entityType: 'ride', entityId: id, details: { outcome: input.outcome } }, db);
    });
    res.json({ ok: true });
  }),
);

/** Safeguarding home counts. */
signoffRouter.get(
  '/summary',
  requireRole('safeguarding'),
  ah(async (_req, res) => {
    const [row] = await query<{ ready: number; waiting: number; open_concerns: number; pending_drivers: number }>(
      `SELECT (SELECT count(*) FROM rides WHERE status = 'logged') AS ready,
              (SELECT count(*) FROM rides WHERE status = 'completed') AS waiting,
              (SELECT count(*) FROM concerns WHERE status = 'open') AS open_concerns,
              (SELECT count(*) FROM drivers WHERE status = 'pending') AS pending_drivers`,
    );
    res.json(row);
  }),
);
