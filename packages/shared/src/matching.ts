import type { HelpCap, HelpNeeded, MobilityAid, VehicleCap, VehicleRequirement, DriverStatus } from './domain';
import { RULES } from './domain';

/**
 * Matching rules (PRD §8, story 3.1 / PSEBC-17).
 * Pure functions so the rules can be unit-tested and explained to safeguarding.
 * The app filters; drivers choose. Nobody is assigned without accepting.
 */

export interface MatchMemberNeeds {
  id: string;
  mobilityAids: MobilityAid[];
  helpNeeded: HelpNeeded[];
  vehicleRequirement: VehicleRequirement;
}

export interface MatchRide {
  pickupAt: Date;
  returnAt: Date | null;
  companion: boolean;
}

export interface MatchDriver {
  id: string;
  status: DriverStatus;
  approvedUntil: Date | null;
  dbsExpiry: Date | null;
  insuranceExpiry: Date | null;
  passengerSeats: number;
  vehicleCaps: VehicleCap[];
  helpCaps: HelpCap[];
  /** Pickup times of rides this driver has already accepted and not finished. */
  busyTimes: Date[];
  /** Member ids safeguarding has said this driver must not be matched with. */
  excludedMemberIds: string[];
}

export type IneligibleReason =
  | 'not_approved'
  | 'check_expired'
  | 'vehicle_unsuitable'
  | 'cannot_give_help'
  | 'busy'
  | 'excluded';

export const INELIGIBLE_LABELS: Record<IneligibleReason, string> = {
  not_approved: 'Not approved by safeguarding',
  check_expired: 'A check has expired',
  vehicle_unsuitable: 'Car not suitable',
  cannot_give_help: 'Cannot give the help needed',
  busy: 'Already driving at that time',
  excluded: 'Excluded for this member by safeguarding',
};

/** Rule 1 — approved and no check expired at the time of the ride. */
export function isApprovedAndInDate(d: Pick<MatchDriver, 'status' | 'approvedUntil' | 'dbsExpiry' | 'insuranceExpiry'>, at: Date): boolean {
  if (d.status !== 'approved') return false;
  for (const limit of [d.approvedUntil, d.dbsExpiry, d.insuranceExpiry]) {
    if (limit && endOfDay(limit) < at) return false;
  }
  return true;
}

/** Rule 2 — the vehicle meets the member's recorded requirement and today's companions. */
export function vehicleFits(member: MatchMemberNeeds, ride: MatchRide, d: MatchDriver): boolean {
  const caps = new Set(d.vehicleCaps);
  const needsSeats = 1 + (ride.companion || member.helpNeeded.includes('carer_travels') || member.vehicleRequirement === 'carer_seat' ? 1 : 0);
  if (d.passengerSeats < needsSeats) return false;
  if (needsSeats > 1 && !caps.has('carer')) return false;

  switch (member.vehicleRequirement) {
    case 'easy_access':
      if (!caps.has('easy_access')) return false;
      break;
    case 'folding_wheelchair':
      if (!caps.has('folding_wheelchair')) return false;
      break;
    default:
      break;
  }
  if (member.mobilityAids.includes('folding_wheelchair') && !caps.has('folding_wheelchair')) return false;
  if (member.mobilityAids.includes('walking_frame') && !caps.has('walking_frame')) return false;
  return true;
}

/** Rule 3 — the driver has said they can give each kind of help the member needs (story 1.6). */
export function canGiveHelp(member: MatchMemberNeeds, d: MatchDriver): boolean {
  const caps = new Set(d.helpCaps);
  if (member.helpNeeded.includes('door') && !caps.has('door')) return false;
  if (member.helpNeeded.includes('car') && !caps.has('car')) return false;
  if (member.mobilityAids.includes('folding_wheelchair') && !caps.has('wheelchair_boot')) return false;
  return true;
}

/** Rule 4 — no other accepted ride overlapping this pickup (or the lift home). */
export function isFree(ride: MatchRide, d: MatchDriver): boolean {
  const windowMs = RULES.overlapMinutes * 60_000;
  const times = [ride.pickupAt, ride.returnAt].filter((t): t is Date => !!t);
  return !d.busyTimes.some((busy) => times.some((t) => Math.abs(busy.getTime() - t.getTime()) < windowMs));
}

/** Rule 5 — safeguarding has not excluded this driver for this member. */
export function notExcluded(member: MatchMemberNeeds, d: MatchDriver): boolean {
  return !d.excludedMemberIds.includes(member.id);
}

export function whyIneligible(member: MatchMemberNeeds, ride: MatchRide, d: MatchDriver): IneligibleReason | null {
  if (d.status !== 'approved') return 'not_approved';
  if (!isApprovedAndInDate(d, ride.pickupAt)) return 'check_expired';
  if (!notExcluded(member, d)) return 'excluded';
  if (!vehicleFits(member, ride, d)) return 'vehicle_unsuitable';
  if (!canGiveHelp(member, d)) return 'cannot_give_help';
  if (!isFree(ride, d)) return 'busy';
  return null;
}

export interface MatchResult {
  eligible: string[];
  rejected: { driverId: string; reason: IneligibleReason }[];
}

/** All five rules must be true (PRD §8). */
export function findEligibleDrivers(member: MatchMemberNeeds, ride: MatchRide, drivers: MatchDriver[]): MatchResult {
  const result: MatchResult = { eligible: [], rejected: [] };
  for (const d of drivers) {
    const reason = whyIneligible(member, ride, d);
    if (reason) result.rejected.push({ driverId: d.id, reason });
    else result.eligible.push(d.id);
  }
  return result;
}

function endOfDay(d: Date): Date {
  const e = new Date(d);
  e.setUTCHours(23, 59, 59, 999);
  return e;
}
