import type { RideStatus } from './domain';

/**
 * Ride status machine (PRD §8).
 * Requested → Invites sent (or Unmatched) → Driver found → Completed → Logged → Signed off.
 * Cancelled is reachable from statuses 1–3 only.
 */
const TRANSITIONS: Record<RideStatus, readonly RideStatus[]> = {
  requested: ['invites_sent', 'unmatched', 'cancelled'],
  invites_sent: ['driver_found', 'unmatched', 'invites_sent', 'cancelled'],
  unmatched: ['invites_sent', 'driver_found', 'cancelled'],
  // A driver who withdraws sends the ride back to matching.
  driver_found: ['completed', 'cancelled', 'invites_sent', 'unmatched'],
  completed: ['logged'],
  logged: ['signed_off'],
  signed_off: [],
  cancelled: [],
};

export function canTransition(from: RideStatus, to: RideStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export class InvalidTransitionError extends Error {
  constructor(
    public readonly from: RideStatus,
    public readonly to: RideStatus,
  ) {
    super(`A ride cannot move from ${from} to ${to}`);
  }
}

export function assertTransition(from: RideStatus, to: RideStatus): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

export const CANCELLABLE: readonly RideStatus[] = ['requested', 'invites_sent', 'unmatched', 'driver_found'];

/** Statuses in which an assigned driver may see the member's details (story 4.2 / 4.3). */
export const DRIVER_DETAIL_ACCESS: readonly RideStatus[] = ['driver_found', 'completed', 'logged'];

/** Statuses that count as an open commitment for the driver (matching rule 4). */
export const DRIVER_BUSY: readonly RideStatus[] = ['driver_found'];

export function isCancellable(status: RideStatus, pickupAt: Date, now = new Date()): boolean {
  return CANCELLABLE.includes(status) && now < pickupAt;
}
