import { getTableName, sql, type Column, type SQL } from 'drizzle-orm';
import { concerns, rideInvites, rides, tripLogs } from './schema';

/**
 * Always-qualified column reference ("table"."column").
 * Drizzle leaves columns unqualified in single-table queries, which makes
 * correlated subqueries ambiguous — use this for every column inside one.
 */
export const q = (c: Column): SQL => sql.raw(`"${getTableName(c.table)}"."${c.name}"`);

/** Has this ride got the driver's / member's trip log? */
export const tripLogExists = (author: 'driver' | 'member') =>
  sql<boolean>`EXISTS (SELECT 1 FROM ${tripLogs} WHERE ${q(tripLogs.rideId)} = ${q(rides.id)} AND ${q(tripLogs.author)} = ${author})`;

/** Number of concerns on this ride (optionally only open ones). */
export const concernCount = (onlyOpen = false) =>
  sql<number>`(SELECT count(*) FROM ${concerns} WHERE ${q(concerns.rideId)} = ${q(rides.id)}${onlyOpen ? sql` AND ${q(concerns.status)} = 'open'` : sql``})`.mapWith(Number);

/** Number of invites on this ride (optionally only with a given status). */
export const inviteCount = (status?: 'declined' | 'sent') =>
  sql<number>`(SELECT count(*) FROM ${rideInvites} WHERE ${q(rideInvites.rideId)} = ${q(rides.id)}${status ? sql` AND ${q(rideInvites.status)} = ${status}` : sql``})`.mapWith(Number);
