import { and, asc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import { env } from '../config/env';
import { db, type Executor } from '../db/client';
import { members, notifications, users } from '../db/schema';
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

type Channel = 'in_app' | 'email' | 'sms' | 'phone_task';
const activeUser = eq(users.status, 'active');

/** In-app + email/SMS to specific logins. */
export async function notifyUsers(tx: Executor, userIds: string[], msg: Message, opts: { sms?: boolean; email?: boolean } = {}): Promise<void> {
  if (userIds.length === 0) return;
  const rows = await tx.select({ id: users.id, email: users.email, phone: users.phone }).from(users).where(and(inArray(users.id, userIds), activeUser));
  for (const u of rows) {
    await insert(tx, { userId: u.id, channel: 'in_app', ...msg });
    if (opts.email) await insert(tx, { userId: u.id, channel: 'email', to: u.email, ...msg });
    if (opts.sms && u.phone) await insert(tx, { userId: u.id, channel: 'sms', to: u.phone, ...msg });
  }
}

/** Everyone in a role (e.g. all coordinators, the safeguarding lead and delegates). */
export async function notifyRole(tx: Executor, roles: (typeof users.$inferSelect.role)[], msg: Message, opts: { email?: boolean; sms?: boolean } = {}): Promise<void> {
  const rows = await tx.select({ id: users.id }).from(users).where(and(inArray(users.role, roles), activeUser));
  await notifyUsers(
    tx,
    rows.map((r) => r.id),
    msg,
    opts,
  );
}

/** The driver's login(s): in-app and a text so they see invites quickly. */
export async function notifyDriver(tx: Executor, driverId: string, msg: Message): Promise<void> {
  const rows = await tx.select({ id: users.id }).from(users).where(and(eq(users.driverId, driverId), activeUser));
  await notifyUsers(
    tx,
    rows.map((r) => r.id),
    msg,
    { sms: true },
  );
}

/**
 * A member is told in the way they asked for on F01 screen 2. Members who don't use
 * the app get a text, or — if they prefer a call — a phone task for the church office (story 2.2).
 */
export async function notifyMember(tx: Executor, memberId: string, msg: Message): Promise<void> {
  const [m] = await tx
    .select({ phone: members.phone, canReceiveSms: members.canReceiveSms, contactMethod: members.contactMethod, preferredName: members.preferredName, representativePhone: members.representativePhone })
    .from(members)
    .where(eq(members.id, memberId));
  if (!m) return;
  const logins = await tx.select({ id: users.id }).from(users).where(and(eq(users.memberId, memberId), activeUser));
  for (const u of logins) await insert(tx, { userId: u.id, channel: 'in_app', ...msg });

  if (m.contactMethod === 'text' && m.canReceiveSms) {
    await insert(tx, { memberId, channel: 'sms', to: m.phone, ...msg });
  } else if (m.contactMethod === 'family' && m.representativePhone) {
    await insert(tx, { memberId, channel: 'sms', to: m.representativePhone, ...msg });
  } else {
    // Phone call or "through the church office": create a call task for coordinators.
    const office = await tx.select({ id: users.id }).from(users).where(and(inArray(users.role, ['coordinator', 'admin']), activeUser));
    for (const c of office) {
      await insert(tx, { userId: c.id, memberId, channel: 'phone_task', ...msg, title: `Please call ${m.preferredName}: ${msg.title}` });
    }
  }
}

async function insert(tx: Executor, n: Message & { userId?: string; memberId?: string; channel: Channel; to?: string }): Promise<void> {
  await tx.insert(notifications).values({
    userId: n.userId ?? null,
    memberId: n.memberId ?? null,
    channel: n.channel,
    toAddress: n.to ?? null,
    kind: n.kind,
    title: n.title,
    body: n.body,
    link: n.link ?? null,
    rideId: n.rideId ?? null,
    delivered: n.channel === 'in_app' || n.channel === 'phone_task',
  });
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
    const pending = await db
      .select({ id: notifications.id, channel: notifications.channel, to: notifications.toAddress, title: notifications.title, body: notifications.body })
      .from(notifications)
      .where(and(eq(notifications.delivered, false), or(eq(notifications.channel, 'email'), eq(notifications.channel, 'sms')), lt(notifications.attempts, 5)))
      .orderBy(asc(notifications.createdAt))
      .limit(limit);
    for (const n of pending) {
      const channel = n.channel as 'email' | 'sms';
      const sender = senderFor(channel);
      try {
        if (sender) await sender.send(channel, n.to ?? '', n.title, n.body);
        await db.update(notifications).set({ delivered: true, attempts: sql`${notifications.attempts} + 1` }).where(eq(notifications.id, n.id));
        sent++;
      } catch (err) {
        await db
          .update(notifications)
          .set({ attempts: sql`${notifications.attempts} + 1`, lastError: String((err as Error).message).slice(0, 300) })
          .where(eq(notifications.id, n.id));
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
