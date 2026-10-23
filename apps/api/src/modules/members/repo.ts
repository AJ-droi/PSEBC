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

/** Office member search, one page at a time (default 20 per page). */
export async function searchMembers(q: string, page: { limit: number; offset: number }) {
  const term = q.trim();
  const where = term ? or(ilike(members.fullName, `%${term}%`), ilike(members.preferredName, `%${term}%`)) : undefined;
  const rows = await db
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
    .where(where)
    .orderBy(asc(members.status), asc(members.fullName), asc(members.id))
    .limit(page.limit)
    .offset(page.offset);
  const total = await db.$count(members, where);
  return { rows, total };
}
