import { describe, expect, it } from 'vitest';
import { addIsoDays, isoDayRange, isoDaysBetween, ukDate } from './dates';
import { driverAvailabilitySchema, rideCancelSchema, rideSeriesSchema } from './schemas';

const lift = (day: string, pickup = '09:45:00Z', ret: string | null = '12:30:00Z') => ({ pickupAt: `${day}T${pickup}`, returnAt: ret ? `${day}T${ret}` : null });
const details = { destination: 'Princes Street Church: Sunday service', returnNeeded: true, pickupFromHome: true };

describe('UK calendar days', () => {
  it('reads the date in London time', () => {
    expect(ukDate(new Date('2026-07-04T23:30:00Z'))).toBe('2026-07-05');
    expect(ukDate(new Date('2026-12-04T23:30:00Z'))).toBe('2026-12-04');
  });
  it('adds days across month and clock changes', () => {
    expect(addIsoDays('2026-10-24', 7)).toBe('2026-10-31');
    expect(addIsoDays('2026-12-28', 7)).toBe('2027-01-04');
    expect(isoDaysBetween('2026-11-01', '2026-11-29')).toBe(28);
    expect(isoDayRange('2026-11-29', '2026-12-02')).toEqual(['2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02']);
  });
});

describe('recurring booking request (story 2.6, PSEBC-16)', () => {
  it('accepts the same lift on several days', () => {
    const r = rideSeriesSchema.safeParse({ ...details, occurrences: [lift('2026-11-08'), lift('2026-11-15'), lift('2026-11-22')] });
    expect(r.success).toBe(true);
  });
  it('needs at least two days, and at most twelve', () => {
    expect(rideSeriesSchema.safeParse({ ...details, occurrences: [lift('2026-11-08')] }).success).toBe(false);
    const thirteen = Array.from({ length: 13 }, (_, i) => lift(addIsoDays('2026-11-08', i * 7)));
    expect(rideSeriesSchema.safeParse({ ...details, occurrences: thirteen }).success).toBe(false);
  });
  it('rejects the same day twice', () => {
    const r = rideSeriesSchema.safeParse({ ...details, occurrences: [lift('2026-11-08'), lift('2026-11-08', '14:00:00Z', '16:00:00Z')] });
    expect(r.success).toBe(false);
  });
  it('needs a lift-home time on every day when a lift home is wanted, and it must be after pickup', () => {
    expect(rideSeriesSchema.safeParse({ ...details, occurrences: [lift('2026-11-08'), lift('2026-11-15', '09:45:00Z', null)] }).success).toBe(false);
    expect(rideSeriesSchema.safeParse({ ...details, occurrences: [lift('2026-11-08'), lift('2026-11-15', '12:00:00Z', '11:00:00Z')] }).success).toBe(false);
    expect(rideSeriesSchema.safeParse({ ...details, returnNeeded: false, occurrences: [lift('2026-11-08', '09:45:00Z', null), lift('2026-11-15', '09:45:00Z', null)] }).success).toBe(true);
  });
  it('cancelling defaults to just this lift', () => {
    expect(rideCancelSchema.parse({ reason: 'unwell' }).scope).toBe('this');
    expect(rideCancelSchema.parse({ reason: 'unwell', scope: 'series' }).scope).toBe('series');
  });
});

describe('driver calendar request (story 3.4, PSEBC-20)', () => {
  it('accepts days off inside the range', () => {
    expect(driverAvailabilitySchema.safeParse({ from: '2026-11-01', to: '2026-12-31', daysOff: ['2026-11-08', '2026-12-25'] }).success).toBe(true);
  });
  it('rejects days off outside the range, backwards ranges and ranges over 16 weeks', () => {
    expect(driverAvailabilitySchema.safeParse({ from: '2026-11-01', to: '2026-11-30', daysOff: ['2026-12-01'] }).success).toBe(false);
    expect(driverAvailabilitySchema.safeParse({ from: '2026-11-30', to: '2026-11-01', daysOff: [] }).success).toBe(false);
    expect(driverAvailabilitySchema.safeParse({ from: '2026-11-01', to: '2027-03-31', daysOff: [] }).success).toBe(false);
  });
});
