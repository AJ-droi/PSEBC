/**
 * Story 3.4 Driver calendar (PSEBC-20) and story 2.6 Recurring bookings (PSEBC-16),
 * end to end against a real Postgres database, with the current Epics 1–3 release switched on.
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
const { ukDate, addIsoDays } = await import('@psebc/shared');
const query = async <T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> => (await getDb().$client.query(text, params)).rows as T[];

let app: Express;
type Agent = ReturnType<typeof request.agent>;
const PASSWORD = 'ChangeMe-2026!';
/** A time `d` days from now, in UTC. 09:45Z is the same calendar day in London all year. */
const inDays = (d: number, h = 9, m = 45) => {
  const t = new Date();
  t.setUTCDate(t.getUTCDate() + d);
  t.setUTCHours(h, m, 0, 0);
  return t.toISOString();
};
const dayOf = (iso: string) => ukDate(new Date(iso));
const today = () => ukDate(new Date());

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

const lift = (over: Record<string, unknown> = {}) => ({
  pickupFromHome: true,
  destination: 'Princes Street Church: Sunday service',
  returnNeeded: true,
  companion: false,
  ...over,
});
const single = (d: number, over: Record<string, unknown> = {}) => lift({ pickupAt: inDays(d), returnAt: inDays(d, 12, 30), ...over });
const days = (...ds: number[]) => ds.map((d) => ({ pickupAt: inDays(d), returnAt: inDays(d, 12, 30) }));

const ids: Record<string, string> = {};
const invitesFor = (rideId: string) =>
  query<{ email: string; status: string }>(
    `SELECT u.email, i.status FROM ride_invites i JOIN users u ON u.driver_id = i.driver_id WHERE i.ride_id = $1 ORDER BY u.email`,
    [rideId],
  );
const rideRow = (id: string) => query<{ status: string; series_id: string | null; booked_by_role: string }>(`SELECT status, series_id, booked_by_role FROM rides WHERE id = $1`, [id]).then((r) => r[0]!);

beforeAll(async () => {
  await query('DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await seed(() => undefined);
  app = createApp();
  for (const r of await query<{ email: string; driver_id: string | null; member_id: string | null }>(`SELECT email, driver_id, member_id FROM users`)) {
    ids[r.email] = r.driver_id ?? r.member_id ?? '';
  }
  const [edna] = await query<{ id: string }>(`SELECT id FROM members WHERE preferred_name = 'Edna'`);
  ids.edna = edna!.id;
});

afterAll(async () => {
  await closeDb();
});

describe('PSEBC-20 (3.4): driver calendar', () => {
  let margaret: Agent;
  let david: Agent;
  let peter: Agent;
  let coordinator: Agent;

  it('a driver marks days off and sees them on their calendar', async () => {
    margaret = await login('margaret@psebc.example');
    david = await login('david@psebc.example');
    peter = await login('peter@psebc.example');
    coordinator = await login('grace@psebc.example');
    await david.post('/api/drivers/me/lone-working').send();

    const from = today();
    const to = addIsoDays(from, 55);
    const off = dayOf(inDays(10));
    const put = await david.put('/api/drivers/me/calendar').send({ from, to, daysOff: [off] });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    expect(put.body.daysOff).toEqual([off]);

    const get = await david.get(`/api/drivers/me/calendar?from=${from}&to=${to}`);
    expect(get.status).toBe(200);
    expect(get.body).toMatchObject({ from, to, daysOff: [off], booked: [] });
    const [audit] = await query<{ details: { added: string[] } }>(`SELECT details FROM audit_log WHERE action = 'driver.calendar_update' ORDER BY id DESC LIMIT 1`);
    expect(audit!.details.added).toEqual([off]);
  });

  it('matching never invites a driver on a day they booked out (rule 6)', async () => {
    const res = await margaret.post('/api/rides').send(single(10));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(await invitesFor(res.body.id)).toEqual([{ email: 'peter@psebc.example', status: 'sent' }]);
    const [m] = await query<{ details: { rejected: { reason: string }[] } }>(`SELECT details FROM audit_log WHERE action = 'ride.match' AND entity_id = $1`, [res.body.id]);
    expect(m!.details.rejected.map((r) => r.reason)).toContain('day_off');
    await margaret.post(`/api/rides/${res.body.id}/cancel`).send({ reason: 'plans_changed' });
  });

  it('members see how many suitable drivers are free each day — a count, never who', async () => {
    const from = dayOf(inDays(9));
    const to = dayOf(inDays(11));
    const res = await margaret.get(`/api/rides/availability?from=${from}&to=${to}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.days).toEqual([
      { date: from, driversFree: 2 },
      { date: dayOf(inDays(10)), driversFree: 1 },
      { date: to, driversFree: 2 },
    ]);
    expect(JSON.stringify(res.body)).not.toMatch(/David|Peter|driverId/);

    // The office asks for a named member; a member can only ever see their own.
    const office = await coordinator.get(`/api/rides/availability?memberId=${ids.edna}&from=${from}&to=${to}`);
    expect(office.status).toBe(200);
    expect(office.body.days).toHaveLength(3);
    const sneaky = await margaret.get(`/api/rides/availability?memberId=${ids.edna}&from=${from}&to=${to}`);
    expect(sneaky.body.days[1].driversFree).toBe(1); // still Margaret's own figures — memberId is ignored for members
  });

  it('booking a day out withdraws a waiting invite; when nobody is left the lift goes to the coordinator', async () => {
    const res = await margaret.post('/api/rides').send(single(12));
    const rideId = res.body.id as string;
    expect((await invitesFor(rideId)).map((i) => i.status)).toEqual(['sent', 'sent']);

    const from = today();
    const to = addIsoDays(from, 55);
    const day = dayOf(inDays(12));
    const p = await peter.put('/api/drivers/me/calendar').send({ from, to, daysOff: [day] });
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    expect(p.body.withdrawnInvites).toBe(1);
    expect(await invitesFor(rideId)).toEqual([
      { email: 'david@psebc.example', status: 'sent' },
      { email: 'peter@psebc.example', status: 'withdrawn' },
    ]);
    expect((await rideRow(rideId)).status).toBe('invites_sent');

    const d = await david.put('/api/drivers/me/calendar').send({ from, to, daysOff: [dayOf(inDays(10)), day] });
    expect(d.status).toBe(200);
    expect((await rideRow(rideId)).status).toBe('unmatched');
    const [flag] = await query<{ n: number }>(`SELECT count(*)::int AS n FROM notifications WHERE ride_id = $1 AND kind = 'unmatched'`, [rideId]);
    expect(flag!.n).toBeGreaterThan(0);

    // Freeing the day again doesn't re-invite by itself; the coordinator can re-send invites (story 3.3).
    await david.put('/api/drivers/me/calendar').send({ from, to, daysOff: [dayOf(inDays(10))] });
    await peter.put('/api/drivers/me/calendar').send({ from, to, daysOff: [] });
    const resend = await coordinator.post(`/api/rides/${rideId}/resend-invites`).send();
    expect(resend.body.status).toBe('invites_sent');
    await margaret.post(`/api/rides/${rideId}/cancel`).send({ reason: 'plans_changed' });
  });

  it('a driver can’t book out a day they already have a lift; they hand it back first', async () => {
    const res = await margaret.post('/api/rides').send(single(14));
    const rideId = res.body.id as string;
    expect((await david.post(`/api/rides/${rideId}/accept`).send()).status).toBe(200);

    const from = today();
    const to = addIsoDays(from, 55);
    const day = dayOf(inDays(14));
    const cal = await david.get(`/api/drivers/me/calendar?from=${from}&to=${to}`);
    expect(cal.body.booked).toEqual([day]);

    const clash = await david.put('/api/drivers/me/calendar').send({ from, to, daysOff: [day] });
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe('booked_that_day');
    expect(clash.body.error.details.days).toEqual([day]);

    expect((await david.post(`/api/rides/${rideId}/withdraw`).send({ note: 'Away that weekend' })).status).toBe(200);
    expect((await david.put('/api/drivers/me/calendar').send({ from, to, daysOff: [dayOf(inDays(10)), day] })).status).toBe(200);
    await margaret.post(`/api/rides/${rideId}/cancel`).send({ reason: 'plans_changed' });
  });

  it('the office can see a driver’s days off; only the driver can change them; checks on the dates', async () => {
    const from = today();
    const to = addIsoDays(from, 55);
    const office = await coordinator.get(`/api/drivers/${ids['david@psebc.example']}/calendar?from=${from}&to=${to}`);
    expect(office.status).toBe(200);
    expect(office.body.daysOff).toContain(dayOf(inDays(10)));

    expect((await margaret.get(`/api/drivers/me/calendar?from=${from}&to=${to}`)).status).toBe(403);
    expect((await coordinator.put('/api/drivers/me/calendar').send({ from, to, daysOff: [] })).status).toBe(403);
    expect((await margaret.get(`/api/drivers/${ids['david@psebc.example']}/calendar?from=${from}&to=${to}`)).status).toBe(403);

    const past = await david.put('/api/drivers/me/calendar').send({ from: addIsoDays(from, -3), to, daysOff: [] });
    expect(past.status).toBe(400);
    const tooLong = await david.put('/api/drivers/me/calendar').send({ from, to: addIsoDays(from, 200), daysOff: [] });
    expect(tooLong.status).toBe(422);
    const outside = await david.put('/api/drivers/me/calendar').send({ from, to: addIsoDays(from, 7), daysOff: [addIsoDays(from, 9)] });
    expect(outside.status).toBe(422);
  });
});

describe('PSEBC-16 (2.6): recurring bookings', () => {
  let margaret: Agent;
  let david: Agent;
  let coordinator: Agent;
  let series: { seriesId: string; rides: { id: string; status: string; invited: number }[] };

  it('a member books the same lift on several days in one go; each day is its own request', async () => {
    margaret = await login('margaret@psebc.example');
    david = await login('david@psebc.example');
    coordinator = await login('grace@psebc.example');

    const res = await margaret.post('/api/rides/series').send(lift({ occurrences: days(21, 28, 35) }));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    series = res.body;
    expect(series.rides).toHaveLength(3);
    for (const r of series.rides) {
      expect(r.status).toBe('invites_sent');
      expect(r.invited).toBe(2);
      expect((await rideRow(r.id)).series_id).toBe(series.seriesId);
    }
    // One confirmation for the whole booking, not three.
    const sent = await query<{ title: string }>(
      `SELECT n.title FROM notifications n JOIN users u ON u.id = n.user_id WHERE u.email = 'margaret@psebc.example' AND n.kind = 'booked' AND n.channel = 'in_app' AND n.ride_id = ANY($1::uuid[])`,
      [series.rides.map((r) => r.id)],
    );
    expect(sent).toEqual([{ title: '3 lifts booked' }]);
  });

  it('each lift shows where it sits in the repeat booking', async () => {
    const view = await margaret.get(`/api/rides/${series.rides[1]!.id}`);
    expect(view.status).toBe(200);
    expect(view.body.series).toMatchObject({ id: series.seriesId, position: 2, total: 3, cancellableFromHere: 2 });
    const home = await margaret.get('/api/rides');
    expect(home.body.upcoming.filter((r: { seriesId: string | null }) => r.seriesId === series.seriesId)).toHaveLength(3);
  });

  it('a driver can say yes to one day without taking the others', async () => {
    expect((await david.post(`/api/rides/${series.rides[0]!.id}/accept`).send()).status).toBe(200);
    expect((await rideRow(series.rides[0]!.id)).status).toBe('driver_found');
    expect((await rideRow(series.rides[1]!.id)).status).toBe('invites_sent');
  });

  it('cancelling “this and later lifts” cancels the rest of the series and tells the drivers', async () => {
    const res = await margaret.post(`/api/rides/${series.rides[1]!.id}/cancel`).send({ reason: 'unwell', scope: 'series' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.cancelled).toBe(2);
    expect((await rideRow(series.rides[0]!.id)).status).toBe('driver_found');
    expect((await rideRow(series.rides[1]!.id)).status).toBe('cancelled');
    expect((await rideRow(series.rides[2]!.id)).status).toBe('cancelled');
    expect((await invitesFor(series.rides[2]!.id)).every((i) => i.status === 'withdrawn')).toBe(true);
    const [office] = await query<{ n: number }>(`SELECT count(*)::int AS n FROM notifications WHERE ride_id = $1 AND title = 'Repeat lifts cancelled by member'`, [series.rides[1]!.id]);
    expect(office!.n).toBeGreaterThan(0);

    // Cancelling just one lift is still the default.
    const one = await margaret.post(`/api/rides/${series.rides[0]!.id}/cancel`).send({ reason: 'unwell' });
    expect(one.status).toBe(200);
    expect(one.body.cancelled).toBeUndefined();
  });

  it('“this and later lifts” is refused for a lift that isn’t in a series', async () => {
    const res = await margaret.post('/api/rides').send(single(40));
    const r = await margaret.post(`/api/rides/${res.body.id}/cancel`).send({ reason: 'unwell', scope: 'series' });
    expect(r.status).toBe(400);
  });

  it('the church office books repeat lifts for a member; the booker is recorded on every day (with 2.2)', async () => {
    const res = await coordinator.post('/api/rides/series').send(lift({ memberId: ids.edna, returnNeeded: false, occurrences: days(22, 29).map((o) => ({ ...o, returnAt: null })) }));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    for (const r of res.body.rides) expect(await rideRow(r.id)).toMatchObject({ booked_by_role: 'coordinator', series_id: res.body.seriesId });
    // A member can only book for themself.
    const other = await margaret.post('/api/rides/series').send(lift({ memberId: ids.edna, occurrences: days(23, 30) }));
    expect(other.status).toBe(201);
    expect(await query(`SELECT 1 FROM rides WHERE series_id = $1 AND member_id = $2`, [other.body.seriesId, ids.edna])).toHaveLength(0);
  });

  it('checks the days: no duplicates, up to 12, not too soon, not past 8 weeks', async () => {
    expect((await margaret.post('/api/rides/series').send(lift({ occurrences: days(24, 24) }))).status).toBe(422);
    expect((await margaret.post('/api/rides/series').send(lift({ occurrences: days(...Array.from({ length: 13 }, (_, i) => 2 + i)) }))).status).toBe(422);
    const soon = [{ pickupAt: new Date(Date.now() + 10 * 60_000).toISOString(), returnAt: inDays(1, 12, 30) }, ...days(24)];
    expect((await margaret.post('/api/rides/series').send(lift({ occurrences: soon }))).status).toBe(400);
    expect((await margaret.post('/api/rides/series').send(lift({ occurrences: days(24, 70) }))).status).toBe(400);
  });

  it('all days are booked or none are (no consent → nothing created)', async () => {
    await query(`UPDATE members SET consent_given = false WHERE id = $1`, [ids.edna]);
    const before = await query<{ n: number }>(`SELECT count(*)::int AS n FROM rides`);
    const res = await coordinator.post('/api/rides/series').send(lift({ memberId: ids.edna, occurrences: days(25, 32) }));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('no_consent');
    expect(await query<{ n: number }>(`SELECT count(*)::int AS n FROM rides`)).toEqual(before);
    await query(`UPDATE members SET consent_given = true WHERE id = $1`, [ids.edna]);
  });
});
