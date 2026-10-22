import type { RideStatus } from '@psebc/shared';
import { queryOne, type Queryable } from '../../db/pool';

export interface RideRow {
  id: string;
  member_id: string;
  booked_by_user_id: string | null;
  booked_by_role: string;
  pickup_at: Date;
  pickup_from_home: boolean;
  pickup_address: string;
  destination: string;
  return_needed: boolean;
  return_at: Date | null;
  companion: boolean;
  needs_note: string;
  status: RideStatus;
  driver_id: string | null;
  accepted_at: Date | null;
  picked_up_at: Date | null;
  dropped_off_at: Date | null;
  not_at_pickup_at: Date | null;
  completed_at: Date | null;
  logs_due_at: Date | null;
  logged_at: Date | null;
  missing_log_note: string | null;
  unmatched_flagged_at: Date | null;
  cancelled_at: Date | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
  cancel_note: string | null;
  return_cancelled: boolean;
  rebooked_from_id: string | null;
  signed_off_at: Date | null;
  signed_off_by: string | null;
  signed_off_by_name: string | null;
  signoff_outcome: string | null;
  signoff_notes: string | null;
  reminder_sent_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export async function getRide(id: string, db?: Queryable): Promise<RideRow | null> {
  return queryOne<RideRow>('SELECT * FROM rides WHERE id = $1', [id], db);
}

/** Lock the ride row for the rest of the transaction (first-to-accept race, status changes). */
export async function lockRide(id: string, db: Queryable): Promise<RideRow | null> {
  return queryOne<RideRow>('SELECT * FROM rides WHERE id = $1 FOR UPDATE', [id], db);
}

export async function setStatus(db: Queryable, id: string, status: RideStatus, extra: Record<string, unknown> = {}): Promise<void> {
  const cols = Object.keys(extra);
  const sets = cols.map((c, i) => `${c} = $${i + 3}`);
  await db.query(`UPDATE rides SET status = $2${sets.length ? ', ' + sets.join(', ') : ''}, updated_at = now() WHERE id = $1`, [
    id,
    status,
    ...cols.map((c) => extra[c]),
  ]);
}
