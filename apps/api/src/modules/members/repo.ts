import { asc, eq, ilike, or } from 'drizzle-orm';
import { db, type Executor } from '../../db/client';
import { members, type Member } from '../../db/schema';
import { decryptJson } from '../../lib/crypto';

export interface HealthDetails {
  flags: string[];
  unwellInstructions: string;
}

export const health = (row: Pick<Member, 'healthEnc'>): HealthDetails => decryptJson<HealthDetails>(row.healthEnc, { flags: [], unwellInstructions: '' });

export async function getMember(id: string, tx: Executor = db): Promise<Member | null> {
  const [row] = await tx.select().from(members).where(eq(members.id, id));
  return row ?? null;
}

/** Full profile for the member, the office and safeguarding. Health is included only when asked. */
export function toMemberDto(m: Member, opts: { includeHealth: boolean }) {
  const { healthEnc: _enc, consentRecordedBy: _by, createdBy: _cb, updatedAt: _u, ...rest } = m;
  const h = opts.includeHealth ? health(m) : null;
  return { ...rest, healthFlags: h?.flags ?? null, unwellInstructions: h?.unwellInstructions ?? null };
}

export async function searchMembers(q: string, limit = 50) {
  const term = q.trim();
  return db
    .select({
      id: members.id,
      fullName: members.fullName,
      preferredName: members.preferredName,
      town: members.town,
      postcode: members.postcode,
      phone: members.phone,
      consentGiven: members.consentGiven,
      status: members.status,
    })
    .from(members)
    .where(term ? or(ilike(members.fullName, `%${term}%`), ilike(members.preferredName, `%${term}%`)) : undefined)
    .orderBy(asc(members.status), asc(members.fullName))
    .limit(limit);
}
