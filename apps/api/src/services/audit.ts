import type { Request } from 'express';
import { getPool, type Queryable } from '../db/pool';
import type { SessionUser } from '../middleware/auth';

/**
 * Audit trail (PRD §9): every view and change of a member's needs, every driver
 * approval decision and every incident is written here with user and time.
 */
export interface AuditEntry {
  action: string;
  entityType: 'member' | 'driver' | 'ride' | 'concern' | 'user' | 'document' | 'report' | 'system';
  entityId?: string | null;
  details?: Record<string, unknown>;
}

export interface Actor {
  id: string | null;
  role: string;
  name: string;
  ip?: string | null;
}

export const SYSTEM_ACTOR: Actor = { id: null, role: 'system', name: 'PSEBC Lifts (automatic)' };

export function actorFrom(req: Request): Actor {
  const u = req.user as SessionUser | undefined;
  return u ? { id: u.id, role: u.role, name: u.fullName, ip: req.ip ?? null } : { id: null, role: 'anonymous', name: 'Anonymous', ip: req.ip ?? null };
}

export async function audit(actor: Actor, entry: AuditEntry, db: Queryable = getPool()): Promise<void> {
  await db.query(
    `INSERT INTO audit_log (actor_id, actor_role, actor_name, action, entity_type, entity_id, details, ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [actor.id, actor.role, actor.name, entry.action, entry.entityType, entry.entityId ?? null, JSON.stringify(entry.details ?? {}), actor.ip ?? null],
  );
}
