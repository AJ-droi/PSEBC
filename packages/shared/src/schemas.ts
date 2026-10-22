import { z } from 'zod';
import {
  BOOKED_BY,
  CANCEL_PARTS,
  CANCEL_REASONS,
  CONCERN_KINDS,
  CONTACT_METHODS,
  DECLINE_REASONS,
  HEALTH_FLAGS,
  HELP_CAPS,
  HELP_NEEDED,
  MOBILITY_AIDS,
  ON_TIME,
  ROLES,
  SIGNOFF_OUTCOMES,
  VEHICLE_CAPS,
  VEHICLE_REQUIREMENTS,
  YES_NO_UNSURE,
} from './domain';

const keys = <T extends Record<string, string>>(m: T) => Object.keys(m) as [keyof T & string, ...(keyof T & string)[]];
const enumOf = <T extends Record<string, string>>(m: T) => z.enum(keys(m));

const trimmed = (max = 200) => z.string().trim().max(max);
const required = (label: string, max = 200) => z.string().trim().min(1, `${label} is required`).max(max);
const phone = z
  .string()
  .trim()
  .min(6, 'Enter a phone number')
  .max(30)
  .regex(/^[+0-9 ()-]+$/, 'Use numbers only');
const ukPostcode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{1,2}[0-9][0-9A-Z]?\s?[0-9][A-Z]{2}$/, 'Enter a full UK postcode');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date');
const isoDateTime = z.string().datetime({ offset: true });

// ---------- Auth ----------

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter your email address'),
  password: z.string().min(1, 'Enter your password'),
});

export const mfaVerifySchema = z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code') });

export const createUserSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  fullName: required('Name'),
  role: z.enum(ROLES),
  phone: phone.optional(),
  password: z.string().min(10, 'Use at least 10 characters'),
  memberId: z.string().uuid().optional(),
  driverId: z.string().uuid().optional(),
});

// ---------- F01 Member registration (story 1.1) ----------

export const memberAboutSchema = z.object({
  fullName: required('Full name'),
  preferredName: required('Preferred name', 80),
  addressLine: required('Home address'),
  town: required('Town', 80),
  postcode: ukPostcode,
  findingNotes: trimmed(300).optional().default(''),
  phone,
});

export const memberContactSchema = z.object({
  canReceiveSms: z.boolean(),
  contactMethod: enumOf(CONTACT_METHODS),
  bookedBy: enumOf(BOOKED_BY),
});

export const memberEmergencySchema = z.object({
  emergencyName: required('Their name'),
  emergencyRelationship: required('Relationship', 80),
  emergencyPhone: phone,
  hasRepresentative: z.boolean(),
  representativeSameAsEmergency: z.boolean().default(true),
  representativeName: trimmed().optional().default(''),
  representativePhone: z.string().trim().max(30).optional().default(''),
  representativeRole: trimmed(80).optional().default(''),
});

export const memberNeedsSchema = z.object({
  mobilityAids: z.array(enumOf(MOBILITY_AIDS)).default([]),
  helpNeeded: z.array(enumOf(HELP_NEEDED)).default([]),
  vehicleRequirement: enumOf(VEHICLE_REQUIREMENTS),
  notesForDriver: trimmed(300).optional().default(''),
});

export const memberHealthSchema = z.object({
  healthFlags: z.array(enumOf(HEALTH_FLAGS)).default([]),
  unwellInstructions: trimmed(500).optional().default(''),
  consent: z.boolean(),
  consentGivenBy: z.enum(['member', 'representative']).default('member'),
});

export const memberCreateSchema = memberAboutSchema
  .merge(memberContactSchema)
  .merge(memberEmergencySchema)
  .merge(memberNeedsSchema)
  .merge(memberHealthSchema);
export type MemberCreateInput = z.infer<typeof memberCreateSchema>;

/** F12 — changing needs requires fresh consent when health information changes (story 1.7). */
export const memberNeedsUpdateSchema = memberNeedsSchema.merge(memberHealthSchema);
export type MemberNeedsUpdateInput = z.infer<typeof memberNeedsUpdateSchema>;

export const memberDetailsUpdateSchema = memberAboutSchema.merge(memberContactSchema).merge(memberEmergencySchema).partial();

// ---------- F02 Driver registration (story 1.2 / 1.6) ----------

export const driverCreateSchema = z.object({
  fullName: required('Full name'),
  phone,
  email: z.string().trim().toLowerCase().email('Enter an email address'),
  postcode: ukPostcode,
  dbsNumber: z.string().trim().regex(/^\d{12}$/, 'A DBS certificate number has 12 digits'),
  dbsIssueDate: isoDate,
  dbsRenewalDate: isoDate.optional(),
  insuranceExpiry: isoDate,
  vehicleMakeModel: required('Make and model'),
  vehicleColour: required('Colour', 40),
  vehicleReg: z.string().trim().toUpperCase().min(2).max(10),
  passengerSeats: z.coerce.number().int().min(1).max(8),
  vehicleCaps: z.array(enumOf(VEHICLE_CAPS)).default([]),
  helpCaps: z.array(enumOf(HELP_CAPS)).default([]),
  submit: z.boolean().default(true),
});
export type DriverCreateInput = z.infer<typeof driverCreateSchema>;
export const driverUpdateSchema = driverCreateSchema.partial();

// ---------- F03 Driver approval (story 1.3) ----------

export const driverDecisionSchema = z
  .object({
    decision: z.enum(['approved', 'rejected']),
    approvedUntil: isoDate.optional(),
    excludedMemberIds: z.array(z.string().uuid()).default([]),
    notes: trimmed(500).optional().default(''),
  })
  .refine((v) => v.decision === 'rejected' || !!v.approvedUntil, {
    message: 'Set the date the approval runs until',
    path: ['approvedUntil'],
  });

// ---------- F04 Request a ride (story 2.1 / 2.2) ----------

export const rideRequestSchema = z
  .object({
    memberId: z.string().uuid().optional(),
    pickupAt: isoDateTime,
    pickupFromHome: z.boolean().default(true),
    pickupAddress: trimmed(200).optional().default(''),
    destination: required('Where you are going'),
    returnNeeded: z.boolean(),
    returnAt: isoDateTime.optional().nullable(),
    companion: z.boolean().default(false),
    needsNote: trimmed(300).optional().default(''),
  })
  .refine((v) => v.pickupFromHome || v.pickupAddress.length > 0, {
    message: 'Enter where to pick you up',
    path: ['pickupAddress'],
  })
  .refine((v) => !v.returnNeeded || !!v.returnAt, { message: 'Choose a time for the lift home', path: ['returnAt'] })
  .refine((v) => !v.returnAt || new Date(v.returnAt) > new Date(v.pickupAt), {
    message: 'The lift home must be after the pickup',
    path: ['returnAt'],
  });
export type RideRequestInput = z.infer<typeof rideRequestSchema>;

// ---------- F05 Cancel / rebook (story 2.3 / 2.4) ----------

export const rideCancelSchema = z.object({
  reason: enumOf(CANCEL_REASONS),
  part: enumOf(CANCEL_PARTS).default('both'),
  note: trimmed(300).optional().default(''),
});

export const rideRebookSchema = z.object({
  pickupAt: isoDateTime,
  returnAt: isoDateTime.optional().nullable(),
});

// ---------- F06 Invite response (story 3.2) ----------

export const declineSchema = z.object({ reason: enumOf(DECLINE_REASONS), note: trimmed(300).optional().default('') });

// ---------- F07 Trip progress (story 5.1) ----------

export const tripProgressSchema = z.object({ event: z.enum(['picked_up', 'dropped_off', 'not_at_pickup']) });

// ---------- F08 / F09 Trip logs (story 5.2 / 5.3 / 6.3) ----------

export const driverLogSchema = z.object({
  wentAsPlanned: z.boolean(),
  anythingToReport: z.boolean(),
  needsChanged: z.boolean(),
  comments: trimmed(1000).optional().default(''),
});

export const memberLogSchema = z.object({
  onTime: enumOf(ON_TIME),
  feltSafe: z.boolean(),
  rating: z.number().int().min(1).max(5).optional().nullable(),
  comments: trimmed(1000).optional().default(''),
  callbackRequested: z.boolean().default(false),
});

// ---------- F10 Concern (story 5.2 / 5.3 / 6.2) ----------

export const concernSchema = z.object({
  rideId: z.string().uuid(),
  occurredWhen: required('When'),
  occurredWhere: required('Where'),
  kinds: z.array(enumOf(CONCERN_KINDS)).min(1, 'Choose at least one'),
  whoInvolved: trimmed(300).optional().default(''),
  description: required('What happened', 4000),
  actionTaken: trimmed(1000).optional().default(''),
  anyoneHurt: z.boolean(),
  emergencyServicesCalled: z.boolean(),
  familyTold: enumOf(YES_NO_UNSURE),
});
export type ConcernInput = z.infer<typeof concernSchema>;

// ---------- F11 Sign-off (story 6.1 / 6.2) ----------

export const concernReviewSchema = z.object({
  outcome: enumOf(SIGNOFF_OUTCOMES),
  notes: trimmed(2000).optional().default(''),
});

export const signoffSchema = z.object({
  outcome: enumOf(SIGNOFF_OUTCOMES).default('no_action'),
  notes: trimmed(2000).optional().default(''),
});

// ---------- F13 Close account (story 1.5) ----------

export const closeAccountSchema = z.object({
  reason: trimmed(300).optional().default(''),
});

export const reportQuerySchema = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) });
