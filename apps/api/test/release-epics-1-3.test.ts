/**
 * The Epics 1–3 demo release (ENABLED_EPICS=1-3) against a real Postgres database.
 * Checks that onboarding, booking and matching work end to end, and that nothing from
 * Epics 4–7 is reachable — above all, that no member personal data reaches a driver.
 *
 *   TEST_DATABASE_URL=postgresql://psebc:psebc@localhost:5432/psebc_test npm test -w @psebc/api
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { authenticator } from 'otplib';
import type { Express } from 'express';

const DB = process.env.TEST_DATABASE_URL ?? 'postgresql://psebc:psebc@localhost:5432/psebc_test';
process.env.DATABASE_URL = DB;
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-that-is-long-enough-123456';
process.env.DATA_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.RUN_SCHEDULER = 'false';
process.env.NOTIFY_EMAIL_DRIVER = 'none';
process.env.NOTIFY_SMS_DRIVER = 'none';
process.env.ENABLED_EPICS = '1-3';

const { createApp } = await import('../src/app');
const { getDb, closeDb } = await import('../src/db/client');
const { seed } = await import('../src/db/seed');
const jobs = await import('../src/jobs/tasks');
const query = async <T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> => (await getDb().$client.query(text, params)).rows as T[];

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

beforeAll(async () => {
  await query('DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await seed(() => undefined);
  app = createApp();
});

afterAll(async () => {
  await closeDb();
});

describe('Release: Epics 1–3 only (ENABLED_EPICS=1-3)', () => {
  let admin: Agent;
  let safeguarding: Agent;
  let margaret: Agent;
  let david: Agent;
  let rideId: string;

  it('reports what is switched on, without signing in', async () => {
    const res = await request(app).get('/api/release');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      epics: [1, 2, 3],
      features: { tripDetails: false, tripLogging: false, signOff: false, reports: false },
      label: 'Epics 1–3',
    });
  });

  it('Epic 1 still works: safeguarding can see and decide driver approvals', async () => {
    admin = await login('admin@psebc.example');
    safeguarding = await login('mathias@psebc.example');
    margaret = await login('margaret@psebc.example');
    david = await login('david@psebc.example');
    const pending = await safeguarding.get('/api/drivers').query({ status: 'pending' });
    expect(pending.status).toBe(200);
  });

  it('Epics 2–3: member books, approved drivers are invited, first to accept gets the lift', async () => {
    const res = await margaret.post('/api/rides').send({
      pickupAt: inDays(5),
      pickupFromHome: true,
      destination: 'Princes Street Church: Sunday service',
      returnNeeded: false,
      companion: false,
    });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('invites_sent');
    rideId = res.body.id;
    expect((await david.post('/api/drivers/me/lone-working').send()).status).toBe(200);
    expect((await david.post(`/api/rides/${rideId}/accept`).send()).status).toBe(200);
    const [ride] = await query<{ status: string }>('SELECT status FROM rides WHERE id = $1', [rideId]);
    expect(ride!.status).toBe('driver_found');
  });

  it('Epic 4 off: the driver keeps the invite-level view — no member name, address, phone or health', async () => {
    const res = await david.get(`/api/rides/${rideId}`);
    expect(res.status).toBe(200);
    expect(res.body.view).toBe('driver_confirmed');
    expect(res.body.ride.pickupArea).toBe('CF62, Barry');
    expect(res.body.canWithdraw).toBe(true);
    const text = JSON.stringify(res.body);
    for (const secret of ['Margaret', 'Example Road', '+447700900456', 'Ruth', 'Diabetes']) expect(text).not.toContain(secret);
    const viewed = await query(`SELECT 1 FROM audit_log WHERE action = 'member.view_needs' AND details->>'via' = 'driver_trip'`);
    expect(viewed.length).toBe(0);

    const home = await david.get('/api/drivers/me/home');
    expect(home.body.trips[0]).toMatchObject({ id: rideId, memberName: null, pickupArea: 'CF62, Barry', needsLog: false });
  });

  it('Epic 4 off: the member is told a driver said yes, but not who; the office still sees the driver', async () => {
    const mine = await margaret.get(`/api/rides/${rideId}`);
    expect(mine.body.ride.status).toBe('driver_found');
    expect(mine.body.driver).toBeNull();
    expect((await margaret.get('/api/rides')).body.upcoming[0].driverFirstName).toBeNull();
    const [note] = await query<{ body: string }>(`SELECT body FROM notifications WHERE kind = 'driver_found' AND member_id IS NOT NULL AND ride_id = $1 LIMIT 1`, [rideId]);
    expect(note!.body).toMatch(/volunteer driver has said yes/);
    expect(note!.body).not.toContain('AB12 CDE');

    const office = await admin.get(`/api/rides/${rideId}`);
    expect(office.body.driver).toMatchObject({ firstName: 'David' });
  });

  it('Epics 5–7 are not reachable: 404 not_in_release', async () => {
    const off = [
      await david.post(`/api/rides/${rideId}/progress`).send({ event: 'picked_up' }),
      await david.post(`/api/rides/${rideId}/logs/driver`).send({}),
      await margaret.post(`/api/rides/${rideId}/logs/member`).send({}),
      await david.post('/api/concerns').send({}),
      await safeguarding.get('/api/concerns'),
      await safeguarding.get('/api/safeguarding/summary'),
      await safeguarding.get('/api/safeguarding/queue'),
      await admin.get('/api/reports/monthly'),
    ];
    for (const res of off) {
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('not_in_release');
    }
    const [ride] = await query<{ status: string; picked_up_at: Date | null }>('SELECT status, picked_up_at FROM rides WHERE id = $1', [rideId]);
    expect(ride).toMatchObject({ status: 'driver_found', picked_up_at: null });
  });

  it('Epic 3 hand-back still works, and the background jobs run cleanly', async () => {
    expect((await david.post(`/api/rides/${rideId}/withdraw`).send({ note: 'demo' })).status).toBe(200);
    const [ride] = await query<{ status: string }>('SELECT status FROM rides WHERE id = $1', [rideId]);
    expect(['invites_sent', 'unmatched']).toContain(ride!.status);
    const result = await jobs.runAll();
    expect(result.logTimeouts).toBe(0);
  });
});
