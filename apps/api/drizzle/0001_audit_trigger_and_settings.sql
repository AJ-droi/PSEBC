-- Audit trail is append-only (PRD §9): block UPDATE and DELETE on audit_log.
CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();--> statement-breakpoint
-- Defaults a volunteer admin can change without code.
INSERT INTO settings (key, value) VALUES
  ('unmatched_after_hours', '24'),
  ('unmatched_before_pickup_hours', '2'),
  ('log_timeout_hours', '72'),
  ('expiry_reminder_days', '30'),
  ('church_office_phone', '"01446 000000"')
ON CONFLICT (key) DO NOTHING;
