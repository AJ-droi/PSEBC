import { and, asc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import { pushEnabled } from '../config/env';
import { deliverPush } from './push';
import { PermanentSendError, emailSenderFor, smsSenderFor } from './senders';
import { renderEmail } from './email-template';
import { db, type Executor } from '../db/client';
import { drivers, members, notifications, users } from '../db/schema';
import { logger } from '../lib/logger';

/**
 * Notifications (PRD "Should have": invite, acceptance, reminder, cancellation).
 *
 * Every message is written to the `notifications` table inside the same
 * transaction as the change that caused it (an outbox). In-app messages are
 * visible at once; email/SMS rows are delivered by `flushOutbox`, which runs
 * straight after the request and every minute from the scheduler, so delivery
 * happens well within the 5-minute target (PRD §10).
 *
 * Email rule: every notification and alert is also emailed to every person it
 * is sent to (logins, drivers, members, representatives and office staff given a
 * call task). Addresses are de-duplicated per message, so nobody gets the same
 * email twice when they appear in more than one role.
 */

export interface Message {
  kind: string;
  title: string;
  body: string;
  link?: string;
  rideId?: string | null;
}

type Channel = 'in_app' | 'email' | 'sms' | 'phone_task' | 'push';
type Role = (typeof users.$inferSelect)['role'];
const activeUser = eq(users.status, 'active');

/** Email addresses already queued for the message being sent. */
type EmailedSet = Set<string>;

/** In-app + email (always) + SMS (optional) to specific logins. */
export async function notifyUsers(tx: Executor, userIds: string[], msg: Message, opts: { sms?: boolean } = {}): Promise<void> {
  await toUsers(tx, userIds, msg, opts, new Set());
}

/** Everyone in a role (e.g. all coordinators, the safeguarding lead and delegates). */
export async function notifyRole(tx: Executor, roles: Role[], msg: Message, opts: { sms?: boolean } = {}): Promise<void> {
  const rows = await tx.select({ id: users.id }).from(users).where(and(inArray(users.role, roles), activeUser));
  await notifyUsers(
    tx,
    rows.map((r) => r.id),
    msg,
    opts,
  );
}

/**
 * The driver's login(s): in-app, email and a text so they see invites quickly.
 * A driver with no active login is emailed at the address on their driver record,
 * so one person always gets exactly one email per message.
 */
export async function notifyDriver(tx: Executor, driverId: string, msg: Message): Promise<void> {
  const emailed: EmailedSet = new Set();
  const logins = await tx.select({ id: users.id }).from(users).where(and(eq(users.driverId, driverId), activeUser));
  await toUsers(
    tx,
    logins.map((r) => r.id),
    msg,
    { sms: true },
    emailed,
  );
  if (logins.length > 0) return;
  const [d] = await tx
    .select({ email: drivers.email })
    .from(drivers)
    .where(and(eq(drivers.id, driverId), isNull(drivers.closedAt)));
  if (d) await queueEmail(tx, emailed, d.email, msg, {});
}

/**
 * A member is told in the way they asked for on F01 screen 2. Members who don't use
 * the app get a text, or — if they prefer a call — a phone task for the church office (story 2.2).
 * On top of that, every message is emailed to the member (their login, or the address on
 * their profile if they have no login) and to their representative when one is on file;
 * call tasks are emailed to the office staff.
 */
export async function notifyMember(tx: Executor, memberId: string, msg: Message): Promise<void> {
  const [m] = await tx
    .select({
      phone: members.phone,
      email: members.email,
      canReceiveSms: members.canReceiveSms,
      contactMethod: members.contactMethod,
      preferredName: members.preferredName,
      hasRepresentative: members.hasRepresentative,
      representativePhone: members.representativePhone,
      representativeEmail: members.representativeEmail,
    })
    .from(members)
    .where(eq(members.id, memberId));
  if (!m) return;
  const emailed: EmailedSet = new Set();
  const logins = await tx.select({ id: users.id, email: users.email }).from(users).where(and(eq(users.memberId, memberId), activeUser));
  for (const u of logins) {
    await insert(tx, { userId: u.id, channel: 'in_app', ...msg });
    await queueEmail(tx, emailed, u.email, msg, { userId: u.id });
  }
  if (logins.length === 0) await queueEmail(tx, emailed, m.email, msg, { memberId });
  if (m.hasRepresentative) await queueEmail(tx, emailed, m.representativeEmail, msg, { memberId });

  if (m.contactMethod === 'text' && m.canReceiveSms) {
    await insert(tx, { memberId, channel: 'sms', to: m.phone, ...msg });
  } else if (m.contactMethod === 'family' && m.representativePhone) {
    await insert(tx, { memberId, channel: 'sms', to: m.representativePhone, ...msg });
  } else {
    // Phone call or "through the church office": create a call task for coordinators, and email it to them.
    const office = await tx.select({ id: users.id, email: users.email }).from(users).where(and(inArray(users.role, ['coordinator', 'admin']), activeUser));
    const task = { ...msg, title: `Please call ${m.preferredName}: ${msg.title}` };
    for (const c of office) {
      await insert(tx, { userId: c.id, memberId, channel: 'phone_task', ...task });
      await queueEmail(tx, emailed, c.email, task, { userId: c.id, memberId });
    }
  }
}

async function toUsers(tx: Executor, userIds: string[], msg: Message, opts: { sms?: boolean }, emailed: EmailedSet): Promise<void> {
  if (userIds.length === 0) return;
  const rows = await tx.select({ id: users.id, email: users.email, phone: users.phone }).from(users).where(and(inArray(users.id, userIds), activeUser));
  for (const u of rows) {
    await insert(tx, { userId: u.id, channel: 'in_app', ...msg });
    await queueEmail(tx, emailed, u.email, msg, { userId: u.id });
    if (opts.sms && u.phone) await insert(tx, { userId: u.id, channel: 'sms', to: u.phone, ...msg });
  }
}

/** Queue one email, skipping blanks and addresses this message has already gone to. */
async function queueEmail(tx: Executor, emailed: EmailedSet, address: string | null | undefined, msg: Message, ids: { userId?: string; memberId?: string }): Promise<void> {
  const to = address?.trim().toLowerCase();
  if (!to || !to.includes('@') || emailed.has(to)) return;
  emailed.add(to);
  await insert(tx, { ...ids, channel: 'email', to, ...msg });
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
  // Every in-app message to a login also becomes a phone/desktop alert (if alerts are configured).
  if ((n.channel === 'in_app' || n.channel === 'phone_task') && n.userId && pushEnabled()) {
    await tx.insert(notifications).values({ userId: n.userId, channel: 'push', kind: n.channel === 'phone_task' ? 'phone_task' : n.kind, title: n.title, body: '', link: n.link ?? null, rideId: n.rideId ?? null });
  }
}

// ---------------------------------------------------------------------------
// Delivery (adapters live in ./senders)
// ---------------------------------------------------------------------------

let flushing = false;

/** Deliver pending email/SMS rows. Safe to call concurrently (skips if already running). */
export async function flushOutbox(limit = 100): Promise<number> {
  if (flushing) return 0;
  flushing = true;
  let sent = 0;
  try {
    const pending = await db
      .select({
        id: notifications.id,
        channel: notifications.channel,
        to: notifications.toAddress,
        title: notifications.title,
        body: notifications.body,
        userId: notifications.userId,
        kind: notifications.kind,
        link: notifications.link,
      })
      .from(notifications)
      .where(and(eq(notifications.delivered, false), inArray(notifications.channel, ['email', 'sms', 'push']), lt(notifications.attempts, 5)))
      .orderBy(asc(notifications.createdAt))
      .limit(limit);
    for (const n of pending) {
      try {
        if (n.channel === 'push') {
          if (n.userId) await deliverPush(n.userId, n.kind, n.link);
        } else if (n.channel === 'email') {
          const sender = emailSenderFor();
          if (sender) await sender.send({ id: n.id, channel: 'email', to: n.to ?? '', ...renderEmail({ title: n.title, body: n.body, link: n.link }) });
        } else {
          const sender = smsSenderFor();
          if (sender) await sender.send({ id: n.id, channel: 'sms', to: n.to ?? '', subject: n.title, text: n.body });
        }
        await db.update(notifications).set({ delivered: true, attempts: sql`${notifications.attempts} + 1` }).where(eq(notifications.id, n.id));
        sent++;
      } catch (err) {
        await db
          .update(notifications)
          // A permanent failure (e.g. invalid address) uses up the retries at once so it isn't sent again.
          .set({ attempts: err instanceof PermanentSendError ? 5 : sql`${notifications.attempts} + 1`, lastError: String((err as Error).message).slice(0, 300) })
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
