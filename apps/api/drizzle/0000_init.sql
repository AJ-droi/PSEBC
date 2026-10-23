CREATE TYPE "public"."account_status" AS ENUM('active', 'closed');--> statement-breakpoint
CREATE TYPE "public"."concern_status" AS ENUM('open', 'reviewed');--> statement-breakpoint
CREATE TYPE "public"."driver_status" AS ENUM('draft', 'pending', 'approved', 'rejected', 'expired', 'closed');--> statement-breakpoint
CREATE TYPE "public"."invite_status" AS ENUM('sent', 'accepted', 'declined', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."log_author" AS ENUM('driver', 'member');--> statement-breakpoint
CREATE TYPE "public"."ride_status" AS ENUM('requested', 'invites_sent', 'unmatched', 'driver_found', 'completed', 'logged', 'signed_off', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('member', 'coordinator', 'driver', 'admin', 'safeguarding');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" uuid,
	"actor_role" text,
	"actor_name" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" text
);
--> statement-breakpoint
CREATE TABLE "concerns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ride_id" uuid NOT NULL,
	"reported_by" uuid,
	"reporter_role" "user_role" NOT NULL,
	"reporter_name" text NOT NULL,
	"occurred_when" text NOT NULL,
	"occurred_where" text NOT NULL,
	"kinds" text[] NOT NULL,
	"who_involved" text DEFAULT '' NOT NULL,
	"description" text NOT NULL,
	"action_taken" text DEFAULT '' NOT NULL,
	"anyone_hurt" boolean NOT NULL,
	"emergency_services_called" boolean NOT NULL,
	"family_told" text NOT NULL,
	"status" "concern_status" DEFAULT 'open' NOT NULL,
	"notified_at" timestamp with time zone,
	"reviewed_by" uuid,
	"reviewed_by_name" text,
	"reviewed_at" timestamp with time zone,
	"outcome" text,
	"review_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid,
	"kind" text NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_kind" CHECK ("documents"."kind" IN ('photo', 'licence', 'insurance'))
);
--> statement-breakpoint
CREATE TABLE "driver_exclusions" (
	"driver_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "driver_exclusions_driver_id_member_id_pk" PRIMARY KEY("driver_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "drivers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" text NOT NULL,
	"phone" text NOT NULL,
	"email" text NOT NULL,
	"postcode" text NOT NULL,
	"photo_doc_id" uuid,
	"dbs_number" text NOT NULL,
	"dbs_issue_date" date NOT NULL,
	"dbs_renewal_date" date NOT NULL,
	"licence_doc_id" uuid,
	"insurance_doc_id" uuid,
	"insurance_expiry" date NOT NULL,
	"vehicle_make_model" text NOT NULL,
	"vehicle_colour" text NOT NULL,
	"vehicle_reg" text NOT NULL,
	"passenger_seats" integer NOT NULL,
	"vehicle_caps" text[] DEFAULT '{}' NOT NULL,
	"help_caps" text[] DEFAULT '{}' NOT NULL,
	"status" "driver_status" DEFAULT 'pending' NOT NULL,
	"approved_until" date,
	"decided_by" uuid,
	"decided_by_name" text,
	"decided_at" timestamp with time zone,
	"decision_notes" text DEFAULT '' NOT NULL,
	"expiry_reminded_for" date,
	"lone_working_ack_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"delete_after" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "passenger_seats_range" CHECK ("drivers"."passenger_seats" BETWEEN 1 AND 8)
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" text NOT NULL,
	"preferred_name" text NOT NULL,
	"address_line" text NOT NULL,
	"town" text NOT NULL,
	"postcode" text NOT NULL,
	"finding_notes" text DEFAULT '' NOT NULL,
	"phone" text NOT NULL,
	"can_receive_sms" boolean DEFAULT true NOT NULL,
	"contact_method" text DEFAULT 'text' NOT NULL,
	"booked_by" text DEFAULT 'self' NOT NULL,
	"emergency_name" text NOT NULL,
	"emergency_relationship" text NOT NULL,
	"emergency_phone" text NOT NULL,
	"has_representative" boolean DEFAULT false NOT NULL,
	"representative_name" text DEFAULT '' NOT NULL,
	"representative_phone" text DEFAULT '' NOT NULL,
	"representative_role" text DEFAULT '' NOT NULL,
	"mobility_aids" text[] DEFAULT '{}' NOT NULL,
	"help_needed" text[] DEFAULT '{}' NOT NULL,
	"vehicle_requirement" text DEFAULT 'any' NOT NULL,
	"notes_for_driver" text DEFAULT '' NOT NULL,
	"health_enc" text,
	"consent_given" boolean DEFAULT false NOT NULL,
	"consent_given_by" text,
	"consent_recorded_at" timestamp with time zone,
	"consent_recorded_by" uuid,
	"needs_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "account_status" DEFAULT 'active' NOT NULL,
	"closed_at" timestamp with time zone,
	"delete_after" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"member_id" uuid,
	"channel" text NOT NULL,
	"to_address" text,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"link" text,
	"ride_id" uuid,
	"read_at" timestamp with time zone,
	"delivered" boolean DEFAULT false NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_channel" CHECK ("notifications"."channel" IN ('in_app', 'email', 'sms', 'phone_task'))
);
--> statement-breakpoint
CREATE TABLE "ride_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ride_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"status" "invite_status" DEFAULT 'sent' NOT NULL,
	"decline_reason" text,
	"decline_note" text,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone,
	CONSTRAINT "ride_invites_ride_driver" UNIQUE("ride_id","driver_id")
);
--> statement-breakpoint
CREATE TABLE "rides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"booked_by_user_id" uuid,
	"booked_by_role" "user_role" NOT NULL,
	"pickup_at" timestamp with time zone NOT NULL,
	"pickup_from_home" boolean DEFAULT true NOT NULL,
	"pickup_address" text NOT NULL,
	"destination" text NOT NULL,
	"return_needed" boolean DEFAULT false NOT NULL,
	"return_at" timestamp with time zone,
	"companion" boolean DEFAULT false NOT NULL,
	"needs_note" text DEFAULT '' NOT NULL,
	"status" "ride_status" DEFAULT 'requested' NOT NULL,
	"driver_id" uuid,
	"accepted_at" timestamp with time zone,
	"picked_up_at" timestamp with time zone,
	"dropped_off_at" timestamp with time zone,
	"not_at_pickup_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"logs_due_at" timestamp with time zone,
	"logged_at" timestamp with time zone,
	"missing_log_note" text,
	"unmatched_flagged_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	"cancel_reason" text,
	"cancel_note" text,
	"return_cancelled" boolean DEFAULT false NOT NULL,
	"rebooked_from_id" uuid,
	"signed_off_at" timestamp with time zone,
	"signed_off_by" uuid,
	"signed_off_by_name" text,
	"signoff_outcome" text,
	"signoff_notes" text,
	"reminder_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "return_after_pickup" CHECK ("rides"."return_at" IS NULL OR "rides"."return_at" > "rides"."pickup_at")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trip_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ride_id" uuid NOT NULL,
	"author" "log_author" NOT NULL,
	"submitted_by" uuid,
	"submitted_by_role" "user_role" NOT NULL,
	"went_as_planned" boolean,
	"anything_to_report" boolean,
	"needs_changed" boolean,
	"on_time" text,
	"felt_safe" boolean,
	"rating" integer,
	"callback_requested" boolean DEFAULT false NOT NULL,
	"comments" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_logs_ride_author" UNIQUE("ride_id","author"),
	CONSTRAINT "rating_range" CHECK ("trip_logs"."rating" BETWEEN 1 AND 5)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"full_name" text NOT NULL,
	"phone" text,
	"role" "user_role" NOT NULL,
	"password_hash" text NOT NULL,
	"mfa_secret" text,
	"mfa_enabled" boolean DEFAULT false NOT NULL,
	"member_id" uuid,
	"driver_id" uuid,
	"status" "account_status" DEFAULT 'active' NOT NULL,
	"token_version" integer DEFAULT 0 NOT NULL,
	"failed_logins" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"delete_after" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "member_link" CHECK ("users"."role" <> 'member' OR "users"."member_id" IS NOT NULL),
	CONSTRAINT "driver_link" CHECK ("users"."role" <> 'driver' OR "users"."driver_id" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "concerns" ADD CONSTRAINT "concerns_ride_id_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concerns" ADD CONSTRAINT "concerns_reported_by_users_id_fk" FOREIGN KEY ("reported_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concerns" ADD CONSTRAINT "concerns_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_exclusions" ADD CONSTRAINT "driver_exclusions_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_exclusions" ADD CONSTRAINT "driver_exclusions_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_ride_id_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ride_invites" ADD CONSTRAINT "ride_invites_ride_id_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ride_invites" ADD CONSTRAINT "ride_invites_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rides" ADD CONSTRAINT "rides_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rides" ADD CONSTRAINT "rides_booked_by_user_id_users_id_fk" FOREIGN KEY ("booked_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rides" ADD CONSTRAINT "rides_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rides" ADD CONSTRAINT "rides_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rides" ADD CONSTRAINT "rides_rebooked_from_id_rides_id_fk" FOREIGN KEY ("rebooked_from_id") REFERENCES "public"."rides"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rides" ADD CONSTRAINT "rides_signed_off_by_users_id_fk" FOREIGN KEY ("signed_off_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_logs" ADD CONSTRAINT "trip_logs_ride_id_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_logs" ADD CONSTRAINT "trip_logs_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id","at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_at_idx" ON "audit_log" USING btree ("at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "concerns_ride_idx" ON "concerns" USING btree ("ride_id");--> statement-breakpoint
CREATE INDEX "concerns_open_idx" ON "concerns" USING btree ("status") WHERE "concerns"."status" = 'open';--> statement-breakpoint
CREATE INDEX "drivers_status_idx" ON "drivers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "members_name_idx" ON "members" USING btree (lower("full_name"));--> statement-breakpoint
CREATE INDEX "notifications_outbox_idx" ON "notifications" USING btree ("created_at") WHERE "notifications"."delivered" = false AND "notifications"."channel" IN ('email', 'sms');--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at" DESC NULLS LAST) WHERE "notifications"."channel" = 'in_app';--> statement-breakpoint
CREATE INDEX "ride_invites_driver_idx" ON "ride_invites" USING btree ("driver_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "one_accepted_invite_per_ride" ON "ride_invites" USING btree ("ride_id") WHERE "ride_invites"."status" = 'accepted';--> statement-breakpoint
CREATE INDEX "rides_status_idx" ON "rides" USING btree ("status");--> statement-breakpoint
CREATE INDEX "rides_member_idx" ON "rides" USING btree ("member_id","pickup_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "rides_driver_idx" ON "rides" USING btree ("driver_id","pickup_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "rides_pickup_idx" ON "rides" USING btree ("pickup_at");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role") WHERE "users"."status" = 'active';