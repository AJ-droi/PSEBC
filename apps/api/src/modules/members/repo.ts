import type { Queryable } from '../../db/pool';
import { query, queryOne } from '../../db/pool';
import { decryptJson } from '../../lib/crypto';

export interface MemberRow {
  id: string;
  full_name: string;
  preferred_name: string;
  address_line: string;
  town: string;
  postcode: string;
  finding_notes: string;
  phone: string;
  can_receive_sms: boolean;
  contact_method: string;
  booked_by: string;
  emergency_name: string;
  emergency_relationship: string;
  emergency_phone: string;
  has_representative: boolean;
  representative_name: string;
  representative_phone: string;
  representative_role: string;
  mobility_aids: string[];
  help_needed: string[];
  vehicle_requirement: string;
  notes_for_driver: string;
  health_enc: string | null;
  consent_given: boolean;
  consent_given_by: string | null;
  consent_recorded_at: Date | null;
  needs_updated_at: Date;
  status: 'active' | 'closed';
  closed_at: Date | null;
  delete_after: Date | null;
  created_at: Date;
}

export interface HealthDetails {
  flags: string[];
  unwellInstructions: string;
}

export const health = (row: Pick<MemberRow, 'health_enc'>): HealthDetails =>
  decryptJson<HealthDetails>(row.health_enc, { flags: [], unwellInstructions: '' });

export async function getMember(id: string, db?: Queryable): Promise<MemberRow | null> {
  return queryOne<MemberRow>('SELECT * FROM members WHERE id = $1', [id], db);
}

export function toNeedsDto(m: MemberRow) {
  return {
    mobilityAids: m.mobility_aids,
    helpNeeded: m.help_needed,
    vehicleRequirement: m.vehicle_requirement,
    notesForDriver: m.notes_for_driver,
  };
}

/** Full profile for the member, the office and safeguarding. Health is included only when asked. */
export function toMemberDto(m: MemberRow, opts: { includeHealth: boolean }) {
  const h = opts.includeHealth ? health(m) : null;
  return {
    id: m.id,
    fullName: m.full_name,
    preferredName: m.preferred_name,
    addressLine: m.address_line,
    town: m.town,
    postcode: m.postcode,
    findingNotes: m.finding_notes,
    phone: m.phone,
    canReceiveSms: m.can_receive_sms,
    contactMethod: m.contact_method,
    bookedBy: m.booked_by,
    emergencyName: m.emergency_name,
    emergencyRelationship: m.emergency_relationship,
    emergencyPhone: m.emergency_phone,
    hasRepresentative: m.has_representative,
    representativeName: m.representative_name,
    representativePhone: m.representative_phone,
    representativeRole: m.representative_role,
    ...toNeedsDto(m),
    healthFlags: h?.flags ?? null,
    unwellInstructions: h?.unwellInstructions ?? null,
    consentGiven: m.consent_given,
    consentGivenBy: m.consent_given_by,
    consentRecordedAt: m.consent_recorded_at,
    needsUpdatedAt: m.needs_updated_at,
    status: m.status,
    closedAt: m.closed_at,
    deleteAfter: m.delete_after,
    createdAt: m.created_at,
  };
}

export async function searchMembers(q: string, limit = 50) {
  return query<Pick<MemberRow, 'id' | 'full_name' | 'preferred_name' | 'town' | 'postcode' | 'consent_given' | 'status' | 'phone'>>(
    `SELECT id, full_name, preferred_name, town, postcode, consent_given, status, phone
       FROM members
      WHERE ($1 = '' OR lower(full_name) LIKE '%' || lower($1) || '%' OR lower(preferred_name) LIKE '%' || lower($1) || '%')
      ORDER BY status, full_name
      LIMIT $2`,
    [q.trim(), limit],
  );
}
