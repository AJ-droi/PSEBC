/**
 * Domain vocabulary shared by the API and the web app.
 * Every list here is a "set list" (PRD 1.1) so needs can be matched by code,
 * and every label is plain English for screens (PRD §10 accessibility).
 */

export const ROLES = ['member', 'coordinator', 'driver', 'admin', 'safeguarding'] as const;
export type Role = (typeof ROLES)[number];

/** Roles that must use multi-factor sign-in (PRD §10 Security). */
export const MFA_ROLES: readonly Role[] = ['admin', 'safeguarding'];

/** Roles that work on the desktop "church office" side. */
export const OFFICE_ROLES: readonly Role[] = ['coordinator', 'admin', 'safeguarding'];

// ---------- Member needs (F01 screen 4 and 5) ----------

export const MOBILITY_AIDS = {
  walking_stick: 'Walking stick',
  walking_frame: 'Walking frame or rollator',
  folding_wheelchair: 'Folding wheelchair (I can move to a car seat)',
} as const;
export type MobilityAid = keyof typeof MOBILITY_AIDS;

export const HELP_NEEDED = {
  door: 'Help to and from the front door',
  car: 'Help getting in and out of the car',
  front_seat: 'I prefer the front seat',
  carer_travels: 'A carer travels with me',
} as const;
export type HelpNeeded = keyof typeof HELP_NEEDED;

export const VEHICLE_REQUIREMENTS = {
  any: 'Any car',
  easy_access: 'Easy-access car (higher seat)',
  folding_wheelchair: 'Room for a folding wheelchair',
  carer_seat: 'Seats for me and a carer',
} as const;
export type VehicleRequirement = keyof typeof VEHICLE_REQUIREMENTS;

/** Minimum-necessary health flags a driver may need on a journey (PRD §9). */
export const HEALTH_FLAGS = {
  diabetes: 'Diabetes: may need a snack or drink',
  seizures: 'Epilepsy or seizures',
  memory: 'Memory problems',
  hearing_sight: 'Hearing or sight loss',
  oxygen: 'Uses oxygen',
  heart: 'Heart condition',
  breathing: 'Breathing difficulties',
  continence: 'May need a toilet stop',
} as const;
export type HealthFlag = keyof typeof HEALTH_FLAGS;

export const CONTACT_METHODS = {
  text: 'Text message',
  phone: 'Phone call',
  family: 'Through my family or carer',
  office: 'Through the church office',
} as const;
export type ContactMethod = keyof typeof CONTACT_METHODS;

export const BOOKED_BY = {
  self: 'I’ll book in the app',
  office: 'The church office',
  family: 'A family member or carer',
} as const;
export type BookedBy = keyof typeof BOOKED_BY;

export const RELATIONSHIPS = [
  'Son or daughter',
  'Husband, wife or partner',
  'Other family',
  'Friend or neighbour',
  'Carer',
] as const;

export const REPRESENTATIVE_ROLES = [
  'Helps me with my arrangements',
  'Holds lasting power of attorney',
  'Carer',
] as const;

// ---------- Driver capability (F02) ----------

export const VEHICLE_CAPS = {
  folding_wheelchair: 'Folding wheelchair',
  walking_frame: 'Walking frame or rollator',
  easy_access: 'Easy-access (higher seat)',
  carer: 'A carer as well',
} as const;
export type VehicleCap = keyof typeof VEHICLE_CAPS;

export const HELP_CAPS = {
  door: 'Help to and from the front door',
  car: 'Help getting in and out of the car',
  wheelchair_boot: 'Lift a wheelchair into the boot',
  steps: 'Help with steps or stairs',
} as const;
export type HelpCap = keyof typeof HELP_CAPS;

export const DRIVER_STATUSES = ['draft', 'pending', 'approved', 'rejected', 'expired', 'closed'] as const;
export type DriverStatus = (typeof DRIVER_STATUSES)[number];

export const DRIVER_STATUS_LABELS: Record<DriverStatus, string> = {
  draft: 'Draft',
  pending: 'Pending approval',
  approved: 'Approved',
  rejected: 'Rejected',
  expired: 'Expired',
  closed: 'Closed',
};

// ---------- Rides (PRD §8) ----------

export const RIDE_STATUSES = [
  'requested',
  'invites_sent',
  'unmatched',
  'driver_found',
  'completed',
  'logged',
  'signed_off',
  'cancelled',
] as const;
export type RideStatus = (typeof RIDE_STATUSES)[number];

/** Member-facing words follow the design's "Ride status" chips. */
export const RIDE_STATUS_LABELS: Record<RideStatus, string> = {
  requested: 'Requested',
  invites_sent: 'Finding a driver',
  unmatched: 'Unmatched',
  driver_found: 'Driver found',
  completed: 'Completed',
  logged: 'Logged',
  signed_off: 'Signed off',
  cancelled: 'Cancelled',
};

/**
 * What screens show for a ride. An incident doesn't change where the ride is in the
 * PRD §8 lifecycle (it still has to be completed, logged and signed off), but until
 * safeguarding signs the trip off everyone should see that an incident was reported.
 */
export type RideDisplayStatus = RideStatus | 'incident';

export const RIDE_DISPLAY_LABELS: Record<RideDisplayStatus, string> = {
  ...RIDE_STATUS_LABELS,
  incident: 'Incident reported',
};

export function rideDisplayStatus(status: RideStatus, incidentReportedAt: Date | string | null | undefined): RideDisplayStatus {
  if (incidentReportedAt && status !== 'signed_off' && status !== 'cancelled') return 'incident';
  return status;
}

export const DESTINATIONS = [
  'Princes Street Church: Sunday service',
  'Princes Street Church: coffee morning',
  'Princes Street Church: Bible study',
  'Princes Street Church: midweek activity',
] as const;

export const CANCEL_REASONS = {
  unwell: 'I’m not well enough',
  plans_changed: 'My plans have changed',
  other_transport: 'Someone else is taking me',
  driver_unavailable: 'Driver can no longer take this lift',
  account_closed: 'Account closed',
  no_driver: 'No driver was found in time',
  other: 'Something else',
} as const;
export type CancelReason = keyof typeof CANCEL_REASONS;
/** Reasons a member or coordinator can choose on F05 (the rest are set by the system). */
export const USER_CANCEL_REASONS: CancelReason[] = ['unwell', 'plans_changed', 'other_transport', 'other'];

export const CANCEL_PARTS = {
  both: 'Both lifts, there and home',
  return_only: 'Just the lift home',
} as const;
export type CancelPart = keyof typeof CANCEL_PARTS;

export const DECLINE_REASONS = {
  not_free: 'I’m not free at that time',
  car_unsuitable: 'My car isn’t suitable',
  cant_help: 'I can’t give the help needed',
  too_far: 'It’s too far for me',
  knows_person: 'I know this person',
  other: 'Another reason',
} as const;
export type DeclineReason = keyof typeof DECLINE_REASONS;

// ---------- Trip logs and concerns (F08–F11) ----------

export const ON_TIME = { yes: 'Yes', bit_late: 'A bit late', no: 'No' } as const;
export type OnTime = keyof typeof ON_TIME;

export const CONCERN_KINDS = {
  fell_hurt: 'Fell or was hurt',
  unwell: 'Became unwell',
  safety_wellbeing: 'Worried about their safety or wellbeing',
  other: 'Something else',
} as const;
export type ConcernKind = keyof typeof CONCERN_KINDS;

export const YES_NO_UNSURE = { yes: 'Yes', no: 'No', unsure: 'Not sure' } as const;
export type YesNoUnsure = keyof typeof YES_NO_UNSURE;

export const SIGNOFF_OUTCOMES = {
  no_action: 'No further action',
  follow_up: 'Follow up with the member',
  refer: 'Refer under safeguarding policy',
} as const;
export type SignoffOutcome = keyof typeof SIGNOFF_OUTCOMES;

// ---------- Business constants (PRD §6, §8, §9) ----------

export const RULES = {
  /** Unmatched alert: no acceptance within this many hours of booking… (3.3) */
  unmatchedAfterHours: 24,
  /** …or this many hours before pickup, whichever comes first. (3.3) */
  unmatchedBeforePickupHours: 2,
  /** A trip is ready for sign-off this long after completion even if a log is missing. (6.1) */
  logTimeoutHours: 72,
  /** Reminder before DBS / insurance expiry. (1.4) */
  expiryReminderDays: 30,
  /** Personal-data deletion after an account is closed (1.5, DPO to confirm). */
  deletionAfterMonths: 12,
  /** Two rides closer than this are treated as overlapping for one driver. (§8 rule 4) */
  overlapMinutes: 90,
  /** Church renewal period for a DBS check, used when no explicit renewal date is given. */
  dbsRenewalYears: 3,
} as const;

export function labelList<T extends Record<string, string>>(map: T, keys: readonly string[] | null | undefined): string[] {
  return (keys ?? []).map((k) => (map as Record<string, string>)[k] ?? k);
}

/** "CF62 0XX" -> "CF62" — the pickup *area* shown on an invite before acceptance (3.2). */
export function postcodeArea(postcode: string | null | undefined): string {
  if (!postcode) return '';
  return postcode.trim().toUpperCase().split(/\s+/)[0] ?? '';
}
