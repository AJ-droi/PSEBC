-- PSEBC Transport App — initial schema (release 1)
-- Postgres 15+ (Neon). UUID keys via pgcrypto's gen_random_uuid().

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE user_role AS ENUM ('member', 'coordinator', 'driver', 'admin', 'safeguarding');
CREATE TYPE account_status AS ENUM ('active', 'closed');
CREATE TYPE driver_status AS ENUM ('draft', 'pending', 'approved', 'rejected', 'expired', 'closed');
CREATE TYPE ride_status AS ENUM ('requested', 'invites_sent', 'unmatched', 'driver_found', 'completed', 'logged', 'signed_off', 'cancelled');
CREATE TYPE invite_status AS ENUM ('sent', 'accepted', 'declined', 'withdrawn');
CREATE TYPE log_author AS ENUM ('driver', 'member');
CREATE TYPE concern_status AS ENUM ('open', 'reviewed');

-- ---------------------------------------------------------------------------
-- Members (F01). Health details are encrypted at field level (health_enc).
-- ---------------------------------------------------------------------------
CREATE TABLE members (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name                  text NOT NULL,
  preferred_name             text NOT NULL,
  address_line               text NOT NULL,
  town                       text NOT NULL,
  postcode                   text NOT NULL,
  finding_notes              text NOT NULL DEFAULT '',
  phone                      text NOT NULL,
  can_receive_sms            boolean NOT NULL DEFAULT true,
  contact_method             text NOT NULL DEFAULT 'text',
  booked_by                  text NOT NULL DEFAULT 'self',
  emergency_name             text NOT NULL,
  emergency_relationship     text NOT NULL,
  emergency_phone            text NOT NULL,
  has_representative         boolean NOT NULL DEFAULT false,
  representative_name        text NOT NULL DEFAULT '',
  representative_phone       text NOT NULL DEFAULT '',
  representative_role        text NOT NULL DEFAULT '',
  mobility_aids              text[] NOT NULL DEFAULT '{}',
  help_needed                text[] NOT NULL DEFAULT '{}',
  vehicle_requirement        text NOT NULL DEFAULT 'any',
  notes_for_driver           text NOT NULL DEFAULT '',
  health_enc                 text,                    -- AES-256-GCM JSON {flags, unwellInstructions}
  consent_given              boolean NOT NULL DEFAULT false,
  consent_given_by           text,
  consent_recorded_at        timestamptz,
  consent_recorded_by        uuid,
  needs_updated_at           timestamptz NOT NULL DEFAULT now(),
  status                     account_status NOT NULL DEFAULT 'active',
  closed_at                  timestamptz,
  delete_after               timestamptz,
  created_by                 uuid,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX members_name_idx ON members (lower(full_name));

-- ---------------------------------------------------------------------------
-- Drivers (F02, F03)
-- ---------------------------------------------------------------------------
CREATE TABLE drivers (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name            text NOT NULL,
  phone                text NOT NULL,
  email                text NOT NULL,
  postcode             text NOT NULL,
  photo_doc_id         uuid,
  dbs_number           text NOT NULL,
  dbs_issue_date       date NOT NULL,
  dbs_renewal_date     date NOT NULL,
  licence_doc_id       uuid,
  insurance_doc_id     uuid,
  insurance_expiry     date NOT NULL,
  vehicle_make_model   text NOT NULL,
  vehicle_colour       text NOT NULL,
  vehicle_reg          text NOT NULL,
  passenger_seats      int  NOT NULL CHECK (passenger_seats BETWEEN 1 AND 8),
  vehicle_caps         text[] NOT NULL DEFAULT '{}',
  help_caps            text[] NOT NULL DEFAULT '{}',
  status               driver_status NOT NULL DEFAULT 'pending',
  approved_until       date,
  decided_by           uuid,
  decided_by_name      text,
  decided_at           timestamptz,
  decision_notes       text NOT NULL DEFAULT '',
  expiry_reminded_for  date,                  -- the expiry date we last reminded about (avoids repeats)
  lone_working_ack_at  timestamptz,
  closed_at            timestamptz,
  delete_after         timestamptz,
  created_by           uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX drivers_status_idx ON drivers (status);

CREATE TABLE driver_exclusions (
  driver_id   uuid NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  member_id   uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (driver_id, member_id)
);

-- ---------------------------------------------------------------------------
-- Users / logins. One login per person per role (PRD §10: individual logins).
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email            text NOT NULL UNIQUE,
  full_name        text NOT NULL,
  phone            text,
  role             user_role NOT NULL,
  password_hash    text NOT NULL,
  mfa_secret       text,
  mfa_enabled      boolean NOT NULL DEFAULT false,
  member_id        uuid REFERENCES members(id),
  driver_id        uuid REFERENCES drivers(id),
  status           account_status NOT NULL DEFAULT 'active',
  token_version    int NOT NULL DEFAULT 0,       -- bump to end every session at once (story 1.5)
  failed_logins    int NOT NULL DEFAULT 0,
  locked_until     timestamptz,
  last_login_at    timestamptz,
  closed_at        timestamptz,
  delete_after     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT member_link CHECK (role <> 'member' OR member_id IS NOT NULL),
  CONSTRAINT driver_link CHECK (role <> 'driver' OR driver_id IS NOT NULL)
);
CREATE INDEX users_role_idx ON users (role) WHERE status = 'active';

-- ---------------------------------------------------------------------------
-- Uploaded evidence (licence, insurance, photo). Stored in Postgres to stay
-- within zero budget; the storage service can be swapped for object storage.
-- ---------------------------------------------------------------------------
CREATE TABLE documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id    uuid REFERENCES drivers(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('photo', 'licence', 'insurance')),
  filename     text NOT NULL,
  mime_type    text NOT NULL,
  size_bytes   int NOT NULL,
  data         bytea NOT NULL,
  uploaded_by  uuid,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Rides (F04–F07) and invites (F06)
-- ---------------------------------------------------------------------------
CREATE TABLE rides (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id                uuid NOT NULL REFERENCES members(id),
  booked_by_user_id        uuid REFERENCES users(id),
  booked_by_role           user_role NOT NULL,
  pickup_at                timestamptz NOT NULL,
  pickup_from_home         boolean NOT NULL DEFAULT true,
  pickup_address           text NOT NULL,
  destination              text NOT NULL,
  return_needed            boolean NOT NULL DEFAULT false,
  return_at                timestamptz,
  companion                boolean NOT NULL DEFAULT false,
  needs_note               text NOT NULL DEFAULT '',
  status                   ride_status NOT NULL DEFAULT 'requested',
  driver_id                uuid REFERENCES drivers(id),
  accepted_at              timestamptz,
  picked_up_at             timestamptz,
  dropped_off_at           timestamptz,
  not_at_pickup_at         timestamptz,
  completed_at             timestamptz,
  logs_due_at              timestamptz,
  logged_at                timestamptz,
  missing_log_note         text,
  unmatched_flagged_at     timestamptz,
  cancelled_at             timestamptz,
  cancelled_by             uuid REFERENCES users(id),
  cancel_reason            text,
  cancel_note              text,
  return_cancelled         boolean NOT NULL DEFAULT false,
  rebooked_from_id         uuid REFERENCES rides(id),
  signed_off_at            timestamptz,
  signed_off_by            uuid REFERENCES users(id),
  signed_off_by_name       text,
  signoff_outcome          text,
  signoff_notes            text,
  reminder_sent_at         timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT return_after_pickup CHECK (return_at IS NULL OR return_at > pickup_at)
);
CREATE INDEX rides_status_idx ON rides (status);
CREATE INDEX rides_member_idx ON rides (member_id, pickup_at DESC);
CREATE INDEX rides_driver_idx ON rides (driver_id, pickup_at DESC);
CREATE INDEX rides_pickup_idx ON rides (pickup_at);

CREATE TABLE ride_invites (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id         uuid NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  driver_id       uuid NOT NULL REFERENCES drivers(id),
  status          invite_status NOT NULL DEFAULT 'sent',
  decline_reason  text,
  decline_note    text,
  sent_at         timestamptz NOT NULL DEFAULT now(),
  responded_at    timestamptz,
  UNIQUE (ride_id, driver_id)
);
CREATE INDEX ride_invites_driver_idx ON ride_invites (driver_id, status);
-- Database-level guarantee that only one driver can hold a ride.
CREATE UNIQUE INDEX one_accepted_invite_per_ride ON ride_invites (ride_id) WHERE status = 'accepted';

-- ---------------------------------------------------------------------------
-- Trip logs (F08 driver, F09 member)
-- ---------------------------------------------------------------------------
CREATE TABLE trip_logs (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id              uuid NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  author               log_author NOT NULL,
  submitted_by         uuid REFERENCES users(id),
  submitted_by_role    user_role NOT NULL,
  went_as_planned      boolean,
  anything_to_report   boolean,
  needs_changed        boolean,
  on_time              text,
  felt_safe            boolean,
  rating               int CHECK (rating BETWEEN 1 AND 5),
  callback_requested   boolean NOT NULL DEFAULT false,
  comments             text NOT NULL DEFAULT '',
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ride_id, author)
);

-- ---------------------------------------------------------------------------
-- Concerns (F10). Visible to safeguarding only.
-- ---------------------------------------------------------------------------
CREATE TABLE concerns (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id                    uuid NOT NULL REFERENCES rides(id),
  reported_by                uuid REFERENCES users(id),
  reporter_role              user_role NOT NULL,
  reporter_name              text NOT NULL,
  occurred_when              text NOT NULL,
  occurred_where             text NOT NULL,
  kinds                      text[] NOT NULL,
  who_involved               text NOT NULL DEFAULT '',
  description                text NOT NULL,
  action_taken               text NOT NULL DEFAULT '',
  anyone_hurt                boolean NOT NULL,
  emergency_services_called  boolean NOT NULL,
  family_told                text NOT NULL,
  status                     concern_status NOT NULL DEFAULT 'open',
  notified_at                timestamptz,
  reviewed_by                uuid REFERENCES users(id),
  reviewed_by_name           text,
  reviewed_at                timestamptz,
  outcome                    text,
  review_notes               text,
  created_at                 timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX concerns_ride_idx ON concerns (ride_id);
CREATE INDEX concerns_open_idx ON concerns (status) WHERE status = 'open';

-- ---------------------------------------------------------------------------
-- Notifications (in-app, plus a record of email/SMS sent)
-- ---------------------------------------------------------------------------
CREATE TABLE notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES users(id) ON DELETE CASCADE,
  member_id   uuid REFERENCES members(id) ON DELETE CASCADE,  -- for members without a login (text/phone)
  channel     text NOT NULL CHECK (channel IN ('in_app', 'email', 'sms', 'phone_task')),
  to_address  text,                                           -- phone or email for external channels
  kind        text NOT NULL,
  title       text NOT NULL,
  body        text NOT NULL,
  link        text,
  ride_id     uuid REFERENCES rides(id) ON DELETE CASCADE,
  read_at     timestamptz,
  delivered   boolean NOT NULL DEFAULT false,
  attempts    int NOT NULL DEFAULT 0,
  last_error  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_outbox_idx ON notifications (created_at) WHERE delivered = false AND channel IN ('email', 'sms');
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC) WHERE channel = 'in_app';

-- ---------------------------------------------------------------------------
-- Audit trail (PRD §9). Append-only: updates and deletes are blocked.
-- ---------------------------------------------------------------------------
CREATE TABLE audit_log (
  id           bigserial PRIMARY KEY,
  at           timestamptz NOT NULL DEFAULT now(),
  actor_id     uuid,
  actor_role   text,
  actor_name   text,
  action       text NOT NULL,          -- e.g. member.view_needs, driver.approve
  entity_type  text NOT NULL,
  entity_id    text,
  details      jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip           text
);
CREATE INDEX audit_entity_idx ON audit_log (entity_type, entity_id, at DESC);
CREATE INDEX audit_at_idx ON audit_log (at DESC);

CREATE FUNCTION audit_log_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();

-- ---------------------------------------------------------------------------
-- Settings that a volunteer admin may change without code
-- ---------------------------------------------------------------------------
CREATE TABLE settings (
  key    text PRIMARY KEY,
  value  jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO settings (key, value) VALUES
  ('unmatched_after_hours', '24'),
  ('unmatched_before_pickup_hours', '2'),
  ('log_timeout_hours', '72'),
  ('expiry_reminder_days', '30'),
  ('church_office_phone', '"01446 000000"');
