import type { Request } from 'express';
import { db, type Executor } from '../db/client';
import { auditLog } from '../db/schema';
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

export async function audit(actor: Actor, entry: AuditEntry, tx: Executor = db): Promise<void> {
  await tx.insert(auditLog).values({
    actorId: actor.id,
    actorRole: actor.role,
    actorName: actor.name,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    details: entry.details ?? {},
    ip: actor.ip ?? null,
  });
}
