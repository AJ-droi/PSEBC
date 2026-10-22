import { env } from '../config/env';
import { getPool, query, type Queryable } from '../db/pool';
import { logger } from '../lib/logger';

/**
 * Notifications (PRD "Should have": invite, acceptance, reminder, cancellation).
 *
 * Every message is written to the `notifications` table inside the same
 * transaction as the change that caused it (an outbox). In-app messages are
 * visible at once; email/SMS rows are delivered by `flushOutbox`, which runs
 * straight after the request and every minute from the scheduler, so delivery
 * happens well within the 5-minute target (PRD §10).
 */

export interface Message {
  kind: string;
  title: string;
  body: string;
  link?: string;
  rideId?: string | null;
}

/** In-app + email/SMS to specific logins. */
export async function notifyUsers(db: Queryable, userIds: string[], msg: Message, opts: { sms?: boolean; email?: boolean } = {}): Promise<void> {
  if (userIds.length === 0) return;
  const users = await query<{ id: string; email: string; phone: string | null }>(
    `SELECT id, email, phone FROM users WHERE id = ANY($1::uuid[]) AND status = 'active'`,
    [userIds],
    db,
  );
  for (const u of users) {
    await insert(db, { userId: u.id, channel: 'in_app', ...msg });
    if (opts.email) await insert(db, { userId: u.id, channel: 'email', to: u.email, ...msg });
    if (opts.sms && u.phone) await insert(db, { userId: u.id, channel: 'sms', to: u.phone, ...msg });
  }
}

/** Everyone in a role (e.g. all coordinators, the safeguarding lead and delegates). */
export async function notifyRole(db: Queryable, roles: string[], msg: Message, opts: { email?: boolean; sms?: boolean } = {}): Promise<void> {
  const rows = await query<{ id: string }>(`SELECT id FROM users WHERE role::text = ANY($1) AND status = 'active'`, [roles], db);
  await notifyUsers(
    db,
    rows.map((r) => r.id),
    msg,
    opts,
  );
}

/** The driver's login(s): in-app and a text so they see invites quickly. */
export async function notifyDriver(db: Queryable, driverId: string, msg: Message): Promise<void> {
  const rows = await query<{ id: string }>(`SELECT id FROM users WHERE driver_id = $1 AND status = 'active'`, [driverId], db);
  await notifyUsers(
    db,
    rows.map((r) => r.id),
    msg,
    { sms: true },
  );
}

/**
 * A member is told in the way they asked for on F01 screen 2. Members who don't use
 * the app get a text, or — if they prefer a call — a phone task for the church office (story 2.2).
 */
export async function notifyMember(db: Queryable, memberId: string, msg: Message): Promise<void> {
  const [m] = await query<{ phone: string; can_receive_sms: boolean; contact_method: string; preferred_name: string; representative_phone: string }>(
    `SELECT phone, can_receive_sms, contact_method, preferred_name, representative_phone FROM members WHERE id = $1`,
    [memberId],
    db,
  );
  if (!m) return;
  const logins = await query<{ id: string }>(`SELECT id FROM users WHERE member_id = $1 AND status = 'active'`, [memberId], db);
  for (const u of logins) await insert(db, { userId: u.id, channel: 'in_app', ...msg });

  if (m.contact_method === 'text' && m.can_receive_sms) {
    await insert(db, { memberId, channel: 'sms', to: m.phone, ...msg });
  } else if (m.contact_method === 'family' && m.representative_phone) {
    await insert(db, { memberId, channel: 'sms', to: m.representative_phone, ...msg });
  } else {
    // Phone call or "through the church office": create a call task for coordinators.
    const coordinators = await query<{ id: string }>(`SELECT id FROM users WHERE role IN ('coordinator', 'admin') AND status = 'active'`, [], db);
    for (const c of coordinators) {
      await insert(db, {
        userId: c.id,
        memberId,
        channel: 'phone_task',
        ...msg,
        title: `Please call ${m.preferred_name}: ${msg.title}`,
      });
    }
  }
}

async function insert(
  db: Queryable,
  n: Message & { userId?: string; memberId?: string; channel: 'in_app' | 'email' | 'sms' | 'phone_task'; to?: string },
): Promise<void> {
  await db.query(
    `INSERT INTO notifications (user_id, member_id, channel, to_address, kind, title, body, link, ride_id, delivered)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [n.userId ?? null, n.memberId ?? null, n.channel, n.to ?? null, n.kind, n.title, n.body, n.link ?? null, n.rideId ?? null, n.channel === 'in_app' || n.channel === 'phone_task'],
  );
}

// ---------------------------------------------------------------------------
// Delivery adapters
// ---------------------------------------------------------------------------

export interface Sender {
  send(channel: 'email' | 'sms', to: string, title: string, body: string): Promise<void>;
}

const consoleSender: Sender = {
  async send(channel, to, title) {
    // Never log message bodies: they may contain names and times.
    logger.info({ channel, to: to.replace(/.(?=.{3})/g, '•'), title }, 'notification (console driver)');
  },
};

const webhookSender: Sender = {
  async send(channel, to, title, body) {
    const url = env().NOTIFY_WEBHOOK_URL;
    if (!url) throw new Error('NOTIFY_WEBHOOK_URL is not set');
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ channel, to, subject: title, body }),
    });
    if (!res.ok) throw new Error(`webhook responded ${res.status}`);
  },
};

function senderFor(channel: 'email' | 'sms'): Sender | null {
  const driver = channel === 'email' ? env().NOTIFY_EMAIL_DRIVER : env().NOTIFY_SMS_DRIVER;
  if (driver === 'none') return null;
  return driver === 'webhook' ? webhookSender : consoleSender;
}

let flushing = false;

/** Deliver pending email/SMS rows. Safe to call concurrently (skips if already running). */
export async function flushOutbox(limit = 50): Promise<number> {
  if (flushing) return 0;
  flushing = true;
  let sent = 0;
  try {
    const pending = await query<{ id: string; channel: 'email' | 'sms'; to_address: string; title: string; body: string }>(
      `SELECT id, channel, to_address, title, body FROM notifications
        WHERE delivered = false AND channel IN ('email', 'sms') AND attempts < 5
        ORDER BY created_at LIMIT $1`,
      [limit],
    );
    for (const n of pending) {
      const sender = senderFor(n.channel);
      try {
        if (sender) await sender.send(n.channel, n.to_address, n.title, n.body);
        await getPool().query(`UPDATE notifications SET delivered = true, attempts = attempts + 1 WHERE id = $1`, [n.id]);
        sent++;
      } catch (err) {
        await getPool().query(`UPDATE notifications SET attempts = attempts + 1, last_error = $2 WHERE id = $1`, [n.id, String((err as Error).message).slice(0, 300)]);
      }
    }
  } finally {
    flushing = false;
  }
  return sent;
}

export function flushSoon(): void {
  setImmediate(() => {
    flushOutbox().catch((err) => logger.warn({ err }, 'outbox flush failed'));
  });
}
