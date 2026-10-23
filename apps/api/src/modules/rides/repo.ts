import { eq, sql } from 'drizzle-orm';
import type { RideStatus } from '@psebc/shared';
import { db, type Executor } from '../../db/client';
import { rides, type Ride } from '../../db/schema';

export type RideRow = Ride;

export async function getRide(id: string, tx: Executor = db): Promise<Ride | null> {
  const [row] = await tx.select().from(rides).where(eq(rides.id, id));
  return row ?? null;
}

/** Lock the ride row for the rest of the transaction (first-to-accept race, status changes). */
export async function lockRide(id: string, tx: Executor): Promise<Ride | null> {
  const [row] = await tx.select().from(rides).where(eq(rides.id, id)).for('update');
  return row ?? null;
}

export async function setStatus(tx: Executor, id: string, status: RideStatus, extra: Partial<typeof rides.$inferInsert> = {}): Promise<void> {
  await tx
    .update(rides)
    .set({ ...extra, status, updatedAt: sql`now()` })
    .where(eq(rides.id, id));
}

/** Flag the ride as having an incident (first report wins; later reports keep the original time). */
export async function markIncident(tx: Executor, rideId: string): Promise<void> {
  await tx
    .update(rides)
    .set({ incidentReportedAt: sql`COALESCE(${rides.incidentReportedAt}, now())`, updatedAt: sql`now()` })
    .where(eq(rides.id, rideId));
}
