/**
 * Rule: every notification and alert is also emailed to everyone it concerns.
 *
 *   TEST_DATABASE_URL=postgresql://psebc:psebc@localhost:5432/psebc_test npm test -w @psebc/api
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { authenticator } from 'otplib';
import type { Express } from 'express';

const DB = process.env.TEST_DATABASE_URL ?? 'postgresql://psebc:psebc@localhost:5432/psebc_test';
process.env.DATABASE_URL = DB;
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-that-is-long-enough-123456';
process.env.DATA_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.RUN_SCHEDULER = 'false';
process.env.WEB_ORIGIN = 'https://lifts.example.org';
process.env.NOTIFY_EMAIL_DRIVER = 'console';
process.env.NOTIFY_SMS_DRIVER = 'none';
process.env.VAPID_PUBLIC_KEY = '';
process.env.VAPID_PRIVATE_KEY = '';
process.env.ENABLED_EPICS = 'all';
(await import('../src/config/env')).resetEnvCache();

const { createApp } = await import('../src/app');
const { getDb, closeDb, withTx } = await import('../src/db/client');
const query = async <T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> => (await getDb().$client.query(text, params)).rows as T[];
const { seed } = await import('../src/db/seed');
const { flushOutbox, notifyDriver, notifyMember, notifyUsers } = await import('../src/services/notify');
const envModule = await import('../src/config/env');
const { renderEmail } = await import('../src/services/email-template');
const sent: { to: string; subject: string; text: string; html?: string }[] = [];
const senders = await import('../src/services/senders');
senders.setSenders({
  email: {
    async send(m) {
      sent.push({ to: m.to, subject: m.subject, text: m.text, html: m.html });
    },
  },
  sms: null,
});

let app: Express;
type Agent = ReturnType<typeof request.agent>;
const PASSWORD = 'ChangeMe-2026!';
const inDays = (d: number, h = 9, m = 45) => {
  const t = new Date();
  t.setUTCDate(t.getUTCDate() + d);
  t.setUTCHours(h, m, 0, 0);
  return t.toISOString();
};

async function login(email: string): Promise<Agent> {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email, password: PASSWORD });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  if (res.body.next === 'mfa_setup') {
    const setup = await agent.post('/api/auth/mfa/setup').send();
    await agent.post('/api/auth/mfa/verify').send({ code: authenticator.generate(setup.body.secret) });
  }
  return agent;
}

const emailsFor = (where: string, params: unknown[] = []) => query<{ to_address: string }>(`SELECT to_address FROM notifications WHERE channel = 'email' AND ${where} ORDER BY to_address`, params);

beforeAll(async () => {
  await query('DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await seed(() => undefined);
  app = createApp();
});

afterAll(async () => {
  await closeDb();
});

describe('Every notification and alert is emailed to the people involved', () => {
  let coordinator: Agent;
  let margaret: Agent;
  let david: Agent;
  let rideId: string;

  it('office can record an optional email for a member and their representative', async () => {
    coordinator = await login('grace@psebc.example');
    const base = {
      fullName: 'Joan Morris',
      preferredName: 'Joan',
      addressLine: '3 Station Road',
      town: 'Barry',
      postcode: 'CF62 8AA',
      phone: '07700 900555',
      canReceiveSms: true,
      contactMethod: 'text',
      bookedBy: 'self',
      emergencyName: 'Tom Morris',
      emergencyRelationship: 'Son or daughter',
      emergencyPhone: '07700 900556',
      hasRepresentative: true,
      representativeSameAsEmergency: true,
      representativeRole: 'Helps me with my arrangements',
      mobilityAids: [],
      helpNeeded: [],
      vehicleRequirement: 'any',
      healthFlags: [],
      unwellInstructions: '',
      consent: true,
    };
    expect((await coordinator.post('/api/members').send({ ...base, email: 'not-an-email' })).status).toBe(422);
    const res = await coordinator.post('/api/members').send({
      ...base,
      email: ' Joan@Example.ORG ',
      representativeEmail: 'tom@example.org',
    });
    expect(res.status).toBe(201);
    const [m] = await query<{ email: string; representative_email: string }>('SELECT email, representative_email FROM members WHERE id = $1', [res.body.id]);
    expect(m).toEqual({
      email: 'joan@example.org',
      representative_email: 'tom@example.org',
    });
    expect((await coordinator.post('/api/members').send({ ...base, fullName: 'No Email' })).status).toBe(201); // still optional
  });

  it('booking for a member who prefers a call: the member, their representative and the office staff given the call task are all emailed', async () => {
    const [edna] = await query<{ id: string }>(`SELECT id FROM members WHERE preferred_name = 'Edna'`);
    const res = await coordinator.post('/api/rides').send({
      memberId: edna!.id,
      pickupAt: inDays(6, 10, 0),
      pickupFromHome: true,
      destination: 'Princes Street Church: Sunday service',
      returnNeeded: false,
      companion: false,
    });
    expect(res.status).toBe(201);
    const booked = await emailsFor(`ride_id = $1 AND kind = 'booked'`, [res.body.id]);
    expect(booked.map((e) => e.to_address)).toEqual(['admin@psebc.example', 'edna@example.org', 'grace@psebc.example', 'ruth@example.org']);
    const [task] = await query<{ title: string }>(`SELECT title FROM notifications WHERE channel = 'email' AND to_address = 'grace@psebc.example' AND kind = 'booked' AND ride_id = $1`, [res.body.id]);
    expect(task!.title).toMatch(/^Please call Edna/);
  });

  it('member books: invited drivers are emailed once each, at their login address', async () => {
    margaret = await login('margaret@psebc.example');
    const res = await margaret.post('/api/rides').send({
      pickupAt: inDays(5),
      pickupFromHome: true,
      destination: 'Princes Street Church: Sunday service',
      returnNeeded: false,
      companion: false,
    });
    expect(res.status).toBe(201);
    rideId = res.body.id;
    const invites = await emailsFor(`ride_id = $1 AND kind = 'invite'`, [rideId]);
    const logins = await query<{ email: string }>(`SELECT u.email FROM ride_invites i JOIN users u ON u.driver_id = i.driver_id WHERE i.ride_id = $1 ORDER BY u.email`, [rideId]);
    expect(invites.map((e) => e.to_address)).toEqual(logins.map((l) => l.email));
    expect(invites.some((e) => e.to_address.endsWith('@example.org'))).toBe(false); // not doubled up at the driver-record address
  });

  it('driver accepts: the member (login) and their representative are emailed', async () => {
    david = await login('david@psebc.example');
    expect((await david.post('/api/drivers/me/lone-working').send()).status).toBe(200);
    expect((await david.post(`/api/rides/${rideId}/accept`).send()).status).toBe(200);
    const found = await emailsFor(`ride_id = $1 AND kind = 'driver_found'`, [rideId]);
    expect(found.map((e) => e.to_address)).toEqual(['margaret@psebc.example', 'ruth@example.org']);
  });

  it('safeguarding alerts are emailed', async () => {
    const res = await david.post('/api/concerns').send({
      rideId,
      occurredWhen: '10:05 am',
      occurredWhere: 'Church car park',
      kinds: ['unwell'],
      description: 'Felt shaky getting out of the car.',
      actionTaken: 'Sat her down',
      anyoneHurt: false,
      emergencyServicesCalled: false,
      familyTold: 'yes',
    });
    expect(res.status).toBe(201);
    expect((await emailsFor(`kind = 'concern' AND ride_id = $1`, [rideId])).map((e) => e.to_address)).toEqual(['mathias@psebc.example']);
  });

  it('a driver without an active login is emailed at the address on their driver record', async () => {
    const [helen] = await query<{ driver_id: string }>(`SELECT driver_id FROM users WHERE email = 'helen@psebc.example'`);
    await query(`UPDATE users SET status = 'closed' WHERE email = 'helen@psebc.example'`);
    await withTx((tx) =>
      notifyDriver(tx, helen!.driver_id, {
        kind: 'driver_decision',
        title: 'Update about your application',
        body: 'Test',
      }),
    );
    expect((await emailsFor(`kind = 'driver_decision'`)).map((e) => e.to_address)).toEqual(['helen@example.org']);
  });

  it('nobody gets the same email twice when they appear in more than one role', async () => {
    const [m] = await query<{ id: string }>(`SELECT id FROM members WHERE preferred_name = 'Margaret'`);
    await query(`UPDATE members SET representative_email = 'MARGARET@psebc.example' WHERE id = $1`, [m!.id]);
    await withTx((tx) =>
      notifyMember(tx, m!.id, {
        kind: 'dedupe_check',
        title: 'Dedupe',
        body: 'Test',
      }),
    );
    expect((await emailsFor(`kind = 'dedupe_check'`)).map((e) => e.to_address)).toEqual(['margaret@psebc.example']);
  });

  it('invariant: every in-app notification and call task has a matching email to the same person', async () => {
    const missing = await query(
      `SELECT n.kind, n.title, u.email FROM notifications n JOIN users u ON u.id = n.user_id
        WHERE n.channel IN ('in_app', 'phone_task')
          AND NOT EXISTS (SELECT 1 FROM notifications e WHERE e.channel = 'email' AND e.to_address = lower(u.email)
                          AND e.kind = n.kind AND e.title = n.title AND e.ride_id IS NOT DISTINCT FROM n.ride_id)`,
    );
    expect(missing).toEqual([]);
    const [{ n }] = (await query<{ n: number }>(`SELECT count(*)::int AS n FROM notifications WHERE channel = 'in_app'`)) as [{ n: number }];
    expect(n).toBeGreaterThan(5);
  });

  it('the outbox sends each email with plain-text and HTML parts linking back into the app', async () => {
    for (let i = 0; i < 20; i++) if ((await flushOutbox(500)) === 0) break;
    const [left] = await query<{ n: number }>(`SELECT count(*)::int AS n FROM notifications WHERE channel = 'email' AND delivered = false`);
    expect(left!.n).toBe(0);
    const toDavid = sent.find((s) => s.to === 'david@psebc.example' && s.subject.startsWith('New lift request') && s.text.includes(rideId));
    expect(toDavid).toBeTruthy();
    expect(toDavid!.subject).toBe('New lift request · PSEBC Lifts');
    expect(toDavid!.text).toContain(`https://lifts.example.org/driver/invites/${rideId}`);
    expect(toDavid!.html).toContain(`href="https://lifts.example.org/driver/invites/${rideId}"`);
  });

  it('email content is escaped', () => {
    const e = renderEmail({
      title: 'URGENT: <b>hi</b>',
      body: 'a & "b"',
      link: '/x',
    });
    expect(e.html).toContain('&lt;b&gt;hi&lt;/b&gt;');
    expect(e.html).toContain('a &amp; &quot;b&quot;');
    expect(e.html).not.toContain('<b>hi</b>');
    expect(e.html).toContain('#b3261e'); // urgent banner colour
  });
});

describe('Resend email driver (NOTIFY_EMAIL_DRIVER=resend)', () => {
  const fetchMock = vi.fn();
  let graceId: string;
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const queue = async (title: string) => {
    await withTx((tx) => notifyUsers(tx, [graceId], { kind: 'resend_check', title, body: 'Body', link: '/office' }));
    const [row] = await query<{ id: string }>(`SELECT id FROM notifications WHERE channel = 'email' AND title = $1`, [title]);
    return row!.id;
  };
  const row = async (id: string) => (await query<{ delivered: boolean; attempts: number; last_error: string | null }>('SELECT delivered, attempts, last_error FROM notifications WHERE id = $1', [id]))[0]!;

  beforeAll(async () => {
    process.env.NOTIFY_EMAIL_DRIVER = 'resend';
    process.env.RESEND_API_KEY = 're_test_123';
    process.env.EMAIL_FROM = 'PSEBC Lifts <lifts@psebc.org.uk>';
    process.env.EMAIL_REPLY_TO = 'office@psebc.org.uk';
    envModule.resetEnvCache();
    senders.setSenders(null); // use the configured driver, not the test recorder
    vi.stubGlobal('fetch', fetchMock);
    [{ id: graceId }] = (await query<{ id: string }>(`SELECT id FROM users WHERE email = 'grace@psebc.example'`)) as [{ id: string }];
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('sends through the Resend API with the notification id as the idempotency key', async () => {
    fetchMock.mockReset().mockResolvedValue(reply(200, { id: 'email_1' }));
    const id = await queue('Resend OK');
    await flushOutbox(500);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    expect(init.headers.authorization).toBe('Bearer re_test_123');
    expect(init.headers['idempotency-key']).toBe(`psebc-notification/${id}`);
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ from: 'PSEBC Lifts <lifts@psebc.org.uk>', to: ['grace@psebc.example'], subject: 'Resend OK · PSEBC Lifts', reply_to: 'office@psebc.org.uk' });
    expect(body.text).toContain('https://lifts.example.org/office');
    expect(body.html).toContain('href="https://lifts.example.org/office"');
    expect(await row(id)).toMatchObject({ delivered: true, attempts: 1 });
  });

  it('a rejected email (e.g. unverified domain) is not retried', async () => {
    fetchMock.mockReset().mockResolvedValue(reply(403, { statusCode: 403, name: 'validation_error', message: 'The domain is not verified.' }));
    const id = await queue('Resend rejected');
    await flushOutbox(500);
    expect(await row(id)).toMatchObject({ delivered: false, attempts: 5, last_error: 'resend 403 validation_error: The domain is not verified.' });
    await flushOutbox(500);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rate limits and outages are retried, with the same idempotency key', async () => {
    fetchMock.mockReset().mockResolvedValueOnce(reply(429, { name: 'rate_limit_exceeded', message: 'Too many requests' })).mockRejectedValueOnce(new Error('socket hang up')).mockResolvedValue(reply(200, { id: 'email_2' }));
    const id = await queue('Resend retry');
    await flushOutbox(500);
    expect(await row(id)).toMatchObject({ delivered: false, attempts: 1 });
    expect((await row(id)).last_error).toMatch(/^resend 429/);
    await flushOutbox(500);
    expect((await row(id)).last_error).toMatch(/unreachable: socket hang up/);
    await flushOutbox(500);
    expect(await row(id)).toMatchObject({ delivered: true, attempts: 3 });
    const keys = fetchMock.mock.calls.map((c) => (c[1] as { headers: Record<string, string> }).headers['idempotency-key']);
    expect(new Set(keys)).toEqual(new Set([`psebc-notification/${id}`]));
  });

  it('refuses to start without an API key or with the placeholder sender address', () => {
    const check = (over: Record<string, string>) => {
      const saved = { ...process.env };
      Object.assign(process.env, over);
      envModule.resetEnvCache();
      try {
        return (() => {
          try {
            envModule.env();
            return 'ok';
          } catch (e) {
            return (e as Error).message;
          }
        })();
      } finally {
        process.env = saved;
        envModule.resetEnvCache();
      }
    };
    expect(check({ RESEND_API_KEY: '' })).toMatch(/RESEND_API_KEY is required/);
    expect(check({ EMAIL_FROM: 'PSEBC Lifts <no-reply@example.org>' })).toMatch(/EMAIL_FROM/);
    expect(check({})).toBe('ok');
  });
});
