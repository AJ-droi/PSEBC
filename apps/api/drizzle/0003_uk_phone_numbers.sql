-- Store every phone number in one UK format: E.164 (+447700900123).
-- Numbers that aren't valid UK numbers are left exactly as they were for the office to fix.
CREATE FUNCTION pg_temp.uk_e164(p text) RETURNS text AS $$
DECLARE
  n text := regexp_replace(coalesce(p, ''), '[[:space:]().-]', '', 'g');
BEGIN
  IF n = '' THEN RETURN p; END IF;
  IF n LIKE '+44%' THEN n := '0' || substr(n, 4);
  ELSIF n LIKE '0044%' THEN n := '0' || substr(n, 5);
  ELSIF n LIKE '44%' AND length(n) = 12 THEN n := '0' || substr(n, 3);
  END IF;
  n := regexp_replace(n, '^00(?=[1-378])', '0');
  IF n ~ '^0(1[0-9]{8,9}|2[0-9]{9}|3[0-9]{9}|7[0-9]{9}|80[0-9]{7,8})$' THEN
    RETURN '+44' || substr(n, 2);
  END IF;
  RETURN p;
END;
$$ LANGUAGE plpgsql IMMUTABLE;--> statement-breakpoint
UPDATE members SET phone = pg_temp.uk_e164(phone), emergency_phone = pg_temp.uk_e164(emergency_phone),
  representative_phone = CASE WHEN representative_phone = '' THEN '' ELSE pg_temp.uk_e164(representative_phone) END;--> statement-breakpoint
UPDATE drivers SET phone = pg_temp.uk_e164(phone);--> statement-breakpoint
UPDATE users SET phone = pg_temp.uk_e164(phone) WHERE phone IS NOT NULL;
