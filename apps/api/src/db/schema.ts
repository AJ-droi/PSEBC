/**
 * Drizzle ORM schema — the single source of truth for the database.
 * `npm run db:generate -w @psebc/api` turns changes here into SQL migrations in ./drizzle.
 */
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigserial,
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { RIDE_STATUSES, ROLES, DRIVER_STATUSES } from '@psebc/shared';

// ---------- Enums ----------
export const userRole = pgEnum('user_role', ROLES);
export const accountStatus = pgEnum('account_status', ['active', 'closed']);
export const driverStatus = pgEnum('driver_status', DRIVER_STATUSES);
export const rideStatus = pgEnum('ride_status', RIDE_STATUSES);
export const inviteStatus = pgEnum('invite_status', ['sent', 'accepted', 'declined', 'withdrawn']);
export const logAuthor = pgEnum('log_author', ['driver', 'member']);
export const concernStatus = pgEnum('concern_status', ['open', 'reviewed']);

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

const id = () => uuid('id').primaryKey().defaultRandom();
const tstz = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => tstz('created_at').notNull().defaultNow();
const day = (name: string) => date(name, { mode: 'string' });

// ---------- Members (F01). Health details are encrypted at field level (healthEnc). ----------
export const members = pgTable(
  'members',
  {
    id: id(),
    fullName: text('full_name').notNull(),
    preferredName: text('preferred_name').notNull(),
    addressLine: text('address_line').notNull(),
    town: text('town').notNull(),
    postcode: text('postcode').notNull(),
    findingNotes: text('finding_notes').notNull().default(''),
    phone: text('phone').notNull(),
    canReceiveSms: boolean('can_receive_sms').notNull().default(true),
    contactMethod: text('contact_method').notNull().default('text'),
    bookedBy: text('booked_by').notNull().default('self'),
    emergencyName: text('emergency_name').notNull(),
    emergencyRelationship: text('emergency_relationship').notNull(),
    emergencyPhone: text('emergency_phone').notNull(),
    hasRepresentative: boolean('has_representative').notNull().default(false),
    representativeName: text('representative_name').notNull().default(''),
    representativePhone: text('representative_phone').notNull().default(''),
    representativeRole: text('representative_role').notNull().default(''),
    mobilityAids: text('mobility_aids').array().notNull().default(sql`'{}'`),
    helpNeeded: text('help_needed').array().notNull().default(sql`'{}'`),
    vehicleRequirement: text('vehicle_requirement').notNull().default('any'),
    notesForDriver: text('notes_for_driver').notNull().default(''),
    /** AES-256-GCM JSON {flags, unwellInstructions} — see lib/crypto.ts */
    healthEnc: text('health_enc'),
    consentGiven: boolean('consent_given').notNull().default(false),
    consentGivenBy: text('consent_given_by'),
    consentRecordedAt: tstz('consent_recorded_at'),
    consentRecordedBy: uuid('consent_recorded_by'),
    needsUpdatedAt: tstz('needs_updated_at').notNull().defaultNow(),
    status: accountStatus('status').notNull().default('active'),
    closedAt: tstz('closed_at'),
    deleteAfter: tstz('delete_after'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [index('members_name_idx').on(sql`lower(${t.fullName})`)],
);

// ---------- Drivers (F02, F03) ----------
export const drivers = pgTable(
  'drivers',
  {
    id: id(),
    fullName: text('full_name').notNull(),
    phone: text('phone').notNull(),
    email: text('email').notNull(),
    postcode: text('postcode').notNull(),
    photoDocId: uuid('photo_doc_id'),
    dbsNumber: text('dbs_number').notNull(),
    dbsIssueDate: day('dbs_issue_date').notNull(),
    dbsRenewalDate: day('dbs_renewal_date').notNull(),
    licenceDocId: uuid('licence_doc_id'),
    insuranceDocId: uuid('insurance_doc_id'),
    insuranceExpiry: day('insurance_expiry').notNull(),
    vehicleMakeModel: text('vehicle_make_model').notNull(),
    vehicleColour: text('vehicle_colour').notNull(),
    vehicleReg: text('vehicle_reg').notNull(),
    passengerSeats: integer('passenger_seats').notNull(),
    vehicleCaps: text('vehicle_caps').array().notNull().default(sql`'{}'`),
    helpCaps: text('help_caps').array().notNull().default(sql`'{}'`),
    status: driverStatus('status').notNull().default('pending'),
    approvedUntil: day('approved_until'),
    decidedBy: uuid('decided_by'),
    decidedByName: text('decided_by_name'),
    decidedAt: tstz('decided_at'),
    decisionNotes: text('decision_notes').notNull().default(''),
    /** The expiry date we last reminded about (avoids repeat reminders). */
    expiryRemindedFor: day('expiry_reminded_for'),
    loneWorkingAckAt: tstz('lone_working_ack_at'),
    closedAt: tstz('closed_at'),
    deleteAfter: tstz('delete_after'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [index('drivers_status_idx').on(t.status), check('passenger_seats_range', sql`${t.passengerSeats} BETWEEN 1 AND 8`)],
);

export const driverExclusions = pgTable(
  'driver_exclusions',
  {
    driverId: uuid('driver_id')
      .notNull()
      .references(() => drivers.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.driverId, t.memberId] })],
);

// ---------- Users / logins (PRD §10: individual logins) ----------
export const users = pgTable(
  'users',
  {
    id: id(),
    email: text('email').notNull().unique(),
    fullName: text('full_name').notNull(),
    phone: text('phone'),
    role: userRole('role').notNull(),
    passwordHash: text('password_hash').notNull(),
    mfaSecret: text('mfa_secret'),
    mfaEnabled: boolean('mfa_enabled').notNull().default(false),
    memberId: uuid('member_id').references(() => members.id),
    driverId: uuid('driver_id').references(() => drivers.id),
    status: accountStatus('status').notNull().default('active'),
    /** Bump to end every session at once (story 1.5). */
    tokenVersion: integer('token_version').notNull().default(0),
    failedLogins: integer('failed_logins').notNull().default(0),
    lockedUntil: tstz('locked_until'),
    lastLoginAt: tstz('last_login_at'),
    closedAt: tstz('closed_at'),
    deleteAfter: tstz('delete_after'),
    createdAt: createdAt(),
  },
  (t) => [
    index('users_role_idx').on(t.role).where(sql`${t.status} = 'active'`),
    check('member_link', sql`${t.role} <> 'member' OR ${t.memberId} IS NOT NULL`),
    check('driver_link', sql`${t.role} <> 'driver' OR ${t.driverId} IS NOT NULL`),
  ],
);

// ---------- Uploaded evidence (licence, insurance, photo) ----------
export const documents = pgTable(
  'documents',
  {
    id: id(),
    driverId: uuid('driver_id').references(() => drivers.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    filename: text('filename').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    data: bytea('data').notNull(),
    uploadedBy: uuid('uploaded_by'),
    createdAt: createdAt(),
  },
  (t) => [check('documents_kind', sql`${t.kind} IN ('photo', 'licence', 'insurance')`)],
);

// ---------- Rides (F04–F07) ----------
export const rides = pgTable(
  'rides',
  {
    id: id(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id),
    bookedByUserId: uuid('booked_by_user_id').references(() => users.id),
    bookedByRole: userRole('booked_by_role').notNull(),
    pickupAt: tstz('pickup_at').notNull(),
    pickupFromHome: boolean('pickup_from_home').notNull().default(true),
    pickupAddress: text('pickup_address').notNull(),
    destination: text('destination').notNull(),
    returnNeeded: boolean('return_needed').notNull().default(false),
    returnAt: tstz('return_at'),
    companion: boolean('companion').notNull().default(false),
    needsNote: text('needs_note').notNull().default(''),
    status: rideStatus('status').notNull().default('requested'),
    driverId: uuid('driver_id').references(() => drivers.id),
    acceptedAt: tstz('accepted_at'),
    pickedUpAt: tstz('picked_up_at'),
    droppedOffAt: tstz('dropped_off_at'),
    notAtPickupAt: tstz('not_at_pickup_at'),
    completedAt: tstz('completed_at'),
    logsDueAt: tstz('logs_due_at'),
    loggedAt: tstz('logged_at'),
    missingLogNote: text('missing_log_note'),
    unmatchedFlaggedAt: tstz('unmatched_flagged_at'),
    cancelledAt: tstz('cancelled_at'),
    cancelledBy: uuid('cancelled_by').references(() => users.id),
    cancelReason: text('cancel_reason'),
    cancelNote: text('cancel_note'),
    returnCancelled: boolean('return_cancelled').notNull().default(false),
    rebookedFromId: uuid('rebooked_from_id').references((): AnyPgColumn => rides.id),
    signedOffAt: tstz('signed_off_at'),
    signedOffBy: uuid('signed_off_by').references(() => users.id),
    signedOffByName: text('signed_off_by_name'),
    signoffOutcome: text('signoff_outcome'),
    signoffNotes: text('signoff_notes'),
    reminderSentAt: tstz('reminder_sent_at'),
    createdAt: createdAt(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('rides_status_idx').on(t.status),
    index('rides_member_idx').on(t.memberId, t.pickupAt.desc()),
    index('rides_driver_idx').on(t.driverId, t.pickupAt.desc()),
    index('rides_pickup_idx').on(t.pickupAt),
    check('return_after_pickup', sql`${t.returnAt} IS NULL OR ${t.returnAt} > ${t.pickupAt}`),
  ],
);

export const rideInvites = pgTable(
  'ride_invites',
  {
    id: id(),
    rideId: uuid('ride_id')
      .notNull()
      .references(() => rides.id, { onDelete: 'cascade' }),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => drivers.id),
    status: inviteStatus('status').notNull().default('sent'),
    declineReason: text('decline_reason'),
    declineNote: text('decline_note'),
    sentAt: tstz('sent_at').notNull().defaultNow(),
    respondedAt: tstz('responded_at'),
  },
  (t) => [
    unique('ride_invites_ride_driver').on(t.rideId, t.driverId),
    index('ride_invites_driver_idx').on(t.driverId, t.status),
    // Database-level guarantee that only one driver can hold a ride (story 3.2).
    uniqueIndex('one_accepted_invite_per_ride').on(t.rideId).where(sql`${t.status} = 'accepted'`),
  ],
);

// ---------- Trip logs (F08 driver, F09 member) ----------
export const tripLogs = pgTable(
  'trip_logs',
  {
    id: id(),
    rideId: uuid('ride_id')
      .notNull()
      .references(() => rides.id, { onDelete: 'cascade' }),
    author: logAuthor('author').notNull(),
    submittedBy: uuid('submitted_by').references(() => users.id),
    submittedByRole: userRole('submitted_by_role').notNull(),
    wentAsPlanned: boolean('went_as_planned'),
    anythingToReport: boolean('anything_to_report'),
    needsChanged: boolean('needs_changed'),
    onTime: text('on_time'),
    feltSafe: boolean('felt_safe'),
    rating: integer('rating'),
    callbackRequested: boolean('callback_requested').notNull().default(false),
    comments: text('comments').notNull().default(''),
    createdAt: createdAt(),
  },
  (t) => [unique('trip_logs_ride_author').on(t.rideId, t.author), check('rating_range', sql`${t.rating} BETWEEN 1 AND 5`)],
);

// ---------- Concerns (F10). Visible to safeguarding only. ----------
export const concerns = pgTable(
  'concerns',
  {
    id: id(),
    rideId: uuid('ride_id')
      .notNull()
      .references(() => rides.id),
    reportedBy: uuid('reported_by').references(() => users.id),
    reporterRole: userRole('reporter_role').notNull(),
    reporterName: text('reporter_name').notNull(),
    occurredWhen: text('occurred_when').notNull(),
    occurredWhere: text('occurred_where').notNull(),
    kinds: text('kinds').array().notNull(),
    whoInvolved: text('who_involved').notNull().default(''),
    description: text('description').notNull(),
    actionTaken: text('action_taken').notNull().default(''),
    anyoneHurt: boolean('anyone_hurt').notNull(),
    emergencyServicesCalled: boolean('emergency_services_called').notNull(),
    familyTold: text('family_told').notNull(),
    status: concernStatus('status').notNull().default('open'),
    notifiedAt: tstz('notified_at'),
    reviewedBy: uuid('reviewed_by').references(() => users.id),
    reviewedByName: text('reviewed_by_name'),
    reviewedAt: tstz('reviewed_at'),
    outcome: text('outcome'),
    reviewNotes: text('review_notes'),
    createdAt: createdAt(),
  },
  (t) => [index('concerns_ride_idx').on(t.rideId), index('concerns_open_idx').on(t.status).where(sql`${t.status} = 'open'`)],
);

// ---------- Notifications (in-app + outbox for email/SMS) ----------
export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    /** For members without a login (text/phone). */
    memberId: uuid('member_id').references(() => members.id, { onDelete: 'cascade' }),
    channel: text('channel').$type<'in_app' | 'email' | 'sms' | 'phone_task'>().notNull(),
    toAddress: text('to_address'),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    link: text('link'),
    rideId: uuid('ride_id').references(() => rides.id, { onDelete: 'cascade' }),
    readAt: tstz('read_at'),
    delivered: boolean('delivered').notNull().default(false),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    createdAt: createdAt(),
  },
  (t) => [
    check('notifications_channel', sql`${t.channel} IN ('in_app', 'email', 'sms', 'phone_task')`),
    index('notifications_outbox_idx').on(t.createdAt).where(sql`${t.delivered} = false AND ${t.channel} IN ('email', 'sms')`),
    index('notifications_user_idx').on(t.userId, t.createdAt.desc()).where(sql`${t.channel} = 'in_app'`),
  ],
);

// ---------- Audit trail (PRD §9). Append-only — enforced by a trigger in migration 0001. ----------
export const auditLog = pgTable(
  'audit_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    at: tstz('at').notNull().defaultNow(),
    actorId: uuid('actor_id'),
    actorRole: text('actor_role'),
    actorName: text('actor_name'),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
    ip: text('ip'),
  },
  (t) => [index('audit_entity_idx').on(t.entityType, t.entityId, t.at.desc()), index('audit_at_idx').on(t.at.desc())],
);

// ---------- Settings a volunteer admin may change without code ----------
export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: tstz('updated_at').notNull().defaultNow(),
});

export type Member = typeof members.$inferSelect;
export type Driver = typeof drivers.$inferSelect;
export type User = typeof users.$inferSelect;
export type Ride = typeof rides.$inferSelect;
export type RideInvite = typeof rideInvites.$inferSelect;
export type TripLog = typeof tripLogs.$inferSelect;
export type Concern = typeof concerns.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
