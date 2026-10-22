import { describe, expect, it } from 'vitest';
import { findEligibleDrivers, whyIneligible, type MatchDriver, type MatchMemberNeeds, type MatchRide } from './matching';
import { canTransition, isCancellable } from './status';

const margaret: MatchMemberNeeds = {
  id: 'm1',
  mobilityAids: ['walking_frame'],
  helpNeeded: ['door', 'car'],
  vehicleRequirement: 'easy_access',
};

const sunday: MatchRide = {
  pickupAt: new Date('2026-11-08T09:45:00Z'),
  returnAt: new Date('2026-11-08T12:30:00Z'),
  companion: false,
};

const base: MatchDriver = {
  id: 'd1',
  status: 'approved',
  approvedUntil: new Date('2027-01-31'),
  dbsExpiry: new Date('2027-03-14'),
  insuranceExpiry: new Date('2027-01-31'),
  passengerSeats: 4,
  vehicleCaps: ['walking_frame', 'easy_access', 'carer', 'folding_wheelchair'],
  helpCaps: ['door', 'car', 'wheelchair_boot'],
  busyTimes: [],
  excludedMemberIds: [],
};

describe('matching rules (PRD §8, PSEBC-17)', () => {
  it('accepts an approved driver whose car and help fit', () => {
    expect(whyIneligible(margaret, sunday, base)).toBeNull();
  });

  it.each(['pending', 'rejected', 'expired', 'draft', 'closed'] as const)('never invites a %s driver (PSEBC-9)', (status) => {
    expect(whyIneligible(margaret, sunday, { ...base, status })).toBe('not_approved');
  });

  it('rejects a driver whose insurance has expired by the ride date', () => {
    expect(whyIneligible(margaret, sunday, { ...base, insuranceExpiry: new Date('2026-11-01') })).toBe('check_expired');
  });

  it('rejects a car without easy access when the member needs it', () => {
    expect(whyIneligible(margaret, sunday, { ...base, vehicleCaps: ['walking_frame'] })).toBe('vehicle_unsuitable');
  });

  it('needs wheelchair space and the help to lift it for a wheelchair user', () => {
    const wheelchair: MatchMemberNeeds = { ...margaret, mobilityAids: ['folding_wheelchair'], vehicleRequirement: 'any' };
    expect(whyIneligible(wheelchair, sunday, { ...base, vehicleCaps: ['easy_access'] })).toBe('vehicle_unsuitable');
    expect(whyIneligible(wheelchair, sunday, { ...base, helpCaps: ['door', 'car'] })).toBe('cannot_give_help');
  });

  it('needs a second seat when a carer travels', () => {
    expect(whyIneligible(margaret, { ...sunday, companion: true }, { ...base, passengerSeats: 1 })).toBe('vehicle_unsuitable');
  });

  it('rejects a driver who has not said they can help to the door (story 1.6)', () => {
    expect(whyIneligible(margaret, sunday, { ...base, helpCaps: ['car'] })).toBe('cannot_give_help');
  });

  it('rejects a driver with an overlapping accepted ride', () => {
    expect(whyIneligible(margaret, sunday, { ...base, busyTimes: [new Date('2026-11-08T10:00:00Z')] })).toBe('busy');
    expect(whyIneligible(margaret, sunday, { ...base, busyTimes: [new Date('2026-11-08T16:00:00Z')] })).toBeNull();
  });

  it('respects a safeguarding exclusion for this member', () => {
    expect(whyIneligible(margaret, sunday, { ...base, excludedMemberIds: ['m1'] })).toBe('excluded');
  });

  it('returns every eligible driver so all are invited at once', () => {
    const r = findEligibleDrivers(margaret, sunday, [base, { ...base, id: 'd2' }, { ...base, id: 'd3', status: 'pending' }]);
    expect(r.eligible).toEqual(['d1', 'd2']);
    expect(r.rejected).toEqual([{ driverId: 'd3', reason: 'not_approved' }]);
  });
});

describe('ride status machine (PRD §8)', () => {
  it('follows the six-step flow', () => {
    expect(canTransition('requested', 'invites_sent')).toBe(true);
    expect(canTransition('invites_sent', 'driver_found')).toBe(true);
    expect(canTransition('driver_found', 'completed')).toBe(true);
    expect(canTransition('completed', 'logged')).toBe(true);
    expect(canTransition('logged', 'signed_off')).toBe(true);
  });
  it('only allows cancelling from statuses 1–3', () => {
    expect(canTransition('driver_found', 'cancelled')).toBe(true);
    expect(canTransition('completed', 'cancelled')).toBe(false);
    expect(canTransition('signed_off', 'cancelled')).toBe(false);
  });
  it('only allows cancelling before the pickup time (PSEBC-14)', () => {
    const pickup = new Date('2026-11-08T09:45:00Z');
    expect(isCancellable('driver_found', pickup, new Date('2026-11-08T09:00:00Z'))).toBe(true);
    expect(isCancellable('driver_found', pickup, new Date('2026-11-08T09:50:00Z'))).toBe(false);
  });
});
