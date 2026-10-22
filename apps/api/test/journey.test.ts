/**
 * End-to-end journey test against a real Postgres database.
 * Each `it` names the PRD story / Jira key whose acceptance criteria it checks.
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

const { createApp } = await import('../src/app');
const { getPool, closePool, query } = await import('../src/db/pool');
const { seed } = await import('../src/db/seed');
const jobs = await import('../src/jobs/tasks');

let app: Express;
type Agent = ReturnType<typeof request.agent>;
const PASSWORD = 'ChangeMe-2026!';
const inDays = (d: number, h = 9, m = 45) => {
  const t = new Date();
  t.setUTCDate(t.getUTCDate() + d);
  t.setUTCHours(h, m, 0, 0);
  return t.toISOString();
};

async function login(email: string) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email, password: PASSWORD });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  if (res.body.next === 'mfa_setup') {
    const setup = await agent.post('/api/auth/mfa/setup').send();
    expect(setup.status).toBe(200);
    const v = await agent.post('/api/auth/mfa/verify').send({ code: authenticator.generate(setup.body.secret) });
    expect(v.status).toBe(200);
  }
  return agent;
}

const memberPayload = (over: Record<string, unknown> = {}) => ({
  fullName: 'Joan Morris',
  preferredName: 'Joan',
  addressLine: '3 Station Road',
  town: 'Barry',
  postcode: 'CF62 8AA',
  findingNotes: '',
  phone: '07700 900555',
  canReceiveSms: true,
  contactMethod: 'text',
  bookedBy: 'self',
  emergencyName: 'Tom Morris',
  emergencyRelationship: 'Son or daughter',
  emergencyPhone: '07700 900556',
  hasRepresentative: false,
  mobilityAids: ['walking_stick'],
  helpNeeded: ['door'],
  vehicleRequirement: 'any',
  healthFlags: ['memory'],
  unwellInstructions: 'Call Tom',
  consent: false,
  ...over,
});

const ridePayload = (over: Record<string, unknown> = {}) => ({
  pickupAt: inDays(5),
  pickupFromHome: true,
  destination: 'Princes Street Church: Sunday service',
  returnNeeded: true,
  returnAt: inDays(5, 12, 30),
  companion: false,
  ...over,
});

beforeAll(async () => {
  await getPool().query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await seed(() => undefined);
  app = createApp();
});

afterAll(async () => {
  await closePool();
});

describe('PSEBC journey', () => {
  let admin: Agent;
  let safeguarding: Agent;
  let coordinator: Agent;
  let margaret: Agent;
  let david: Agent;
  let peter: Agent;
  let helen: Agent;
  let joanId: string;
  let newDriverId: string;
  let rideId: string;

  it('requires MFA for admin and safeguarding (PRD §10 security)', async () => {
    const agent = request.agent(app);
    const res = await agent.post('/api/auth/login').send({ email: 'admin@psebc.example', password: PASSWORD });
    expect(res.body.next).toBe('mfa_setup');
    const blocked = await agent.get('/api/members');
    expect(blocked.status).toBe(403);

    admin = await login('admin@psebc.example');
    safeguarding = await login('mathias@psebc.example');
    coordinator = await login('grace@psebc.example');
    margaret = await login('margaret@psebc.example');
    david = await login('david@psebc.example');
    peter = await login('peter@psebc.example');
    helen = await login('helen@psebc.example');
    expect((await admin.get('/api/members')).status).toBe(200);
  });

  it('PSEBC-7 (1.1): admin adds a member; profile unusable until consent recorded', async () => {
    const res = await admin.post('/api/members').send(memberPayload());
    expect(res.status).toBe(201);
    joanId = res.body.id;
    const blocked = await coordinator.post('/api/rides').send(ridePayload({ memberId: joanId }));
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('no_consent');

    // Bad input gets plain-English field errors
    const bad = await admin.post('/api/members').send(memberPayload({ postcode: 'nope' }));
    expect(bad.status).toBe(422);
    expect(bad.body.error.details.fields.postcode).toMatch(/postcode/i);

    // Health is encrypted at rest
    const [row] = await query<{ health_enc: string }>('SELECT health_enc FROM members WHERE id = $1', [joanId]);
    expect(row!.health_enc).toMatch(/^v1\./);
    expect(row!.health_enc).not.toContain('memory');
  });

  it('PSEBC-7 / 1.7: updating needs with new health info requires fresh consent', async () => {
    const needs = { mobilityAids: ['walking_stick'], helpNeeded: ['door'], vehicleRequirement: 'any', notesForDriver: '', healthFlags: ['memory', 'diabetes'], unwellInstructions: 'Call Tom', consent: false };
    expect((await coordinator.put(`/api/members/${joanId}/needs`).send(needs)).status).toBe(400);
    expect((await coordinator.put(`/api/members/${joanId}/needs`).send({ ...needs, consent: true })).status).toBe(200);
    const audit = await query(`SELECT 1 FROM audit_log WHERE action = 'member.update_needs' AND entity_id = $1`, [joanId]);
    expect(audit.length).toBe(1);
  });

  it('PSEBC-8 (1.2): admin adds a driver with checks; status starts as Pending', async () => {
    const res = await admin.post('/api/drivers').send({
      fullName: 'Samuel Owen',
      phone: '07700 900800',
      email: 'samuel@example.org',
      postcode: 'CF62 9ZZ',
      dbsNumber: '009876543210',
      dbsIssueDate: '2025-01-10',
      insuranceExpiry: inDays(200).slice(0, 10),
      vehicleMakeModel: 'Skoda Octavia',
      vehicleColour: 'Grey',
      vehicleReg: 'GH78 JKL',
      passengerSeats: 4,
      vehicleCaps: ['walking_frame', 'easy_access', 'carer'],
      helpCaps: ['door', 'car'],
    });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('pending');
    newDriverId = res.body.id;
    const notified = await query(`SELECT 1 FROM notifications n JOIN users u ON u.id = n.user_id WHERE u.role = 'safeguarding' AND n.kind = 'driver_pending'`);
    expect(notified.length).toBeGreaterThan(0);
  });

  it('PSEBC-9 (1.3): only safeguarding can approve; decision, date and approver logged', async () => {
    const body = { decision: 'approved', approvedUntil: inDays(150).slice(0, 10), excludedMemberIds: [] };
    expect((await admin.post(`/api/drivers/${newDriverId}/decision`).send(body)).status).toBe(403);
    expect((await coordinator.post(`/api/drivers/${newDriverId}/decision`).send(body)).status).toBe(403);
    // evidence must be uploaded first
    expect((await safeguarding.post(`/api/drivers/${newDriverId}/decision`).send(body)).status).toBe(400);
    for (const kind of ['licence', 'insurance']) {
      const up = await admin.post(`/api/drivers/${newDriverId}/documents/${kind}`).attach('file', Buffer.from('%PDF-1.4 test'), { filename: `${kind}.pdf`, contentType: 'application/pdf' });
      expect(up.status).toBe(201);
    }
    // can't approve past earliest expiry
    expect((await safeguarding.post(`/api/drivers/${newDriverId}/decision`).send({ ...body, approvedUntil: inDays(400).slice(0, 10) })).status).toBe(400);
    const ok = await safeguarding.post(`/api/drivers/${newDriverId}/decision`).send(body);
    expect(ok.status).toBe(200);
    const [d] = await query<{ status: string; decided_by_name: string; decided_at: Date }>('SELECT status, decided_by_name, decided_at FROM drivers WHERE id = $1', [newDriverId]);
    expect(d).toMatchObject({ status: 'approved', decided_by_name: 'Mathias' });
    expect(d!.decided_at).toBeTruthy();
    const audit = await query(`SELECT 1 FROM audit_log WHERE action = 'driver.approve' AND entity_id = $1`, [newDriverId]);
    expect(audit.length).toBe(1);
  });

  it('PSEBC-12 (2.1) + PSEBC-17/18: member requests; every eligible approved driver is invited, pending never', async () => {
    const res = await margaret.post('/api/rides').send(ridePayload());
    expect(res.status).toBe(201);
    rideId = res.body.id;
    expect(res.body.status).toBe('invites_sent');
    const invites = await query<{ full_name: string }>('SELECT d.full_name FROM ride_invites i JOIN drivers d ON d.id = i.driver_id WHERE i.ride_id = $1 ORDER BY 1', [rideId]);
    expect(invites.map((i) => i.full_name)).toEqual(['David Thomas', 'Peter Morgan', 'Samuel Owen']);
    // Helen is pending: no invite, can't see the ride
    expect((await helen.get(`/api/rides/${rideId}`)).status).toBe(403);
  });

  it('PSEBC-18 (3.2): invite shows area and needs summary only', async () => {
    const res = await david.get(`/api/rides/${rideId}`);
    expect(res.status).toBe(200);
    expect(res.body.view).toBe('invite');
    expect(res.body.ride.pickupArea).toBe('CF62, Barry');
    expect(res.body.needs).toContain('Walking frame or rollator');
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('Margaret');
    expect(text).not.toContain('Example Road');
    expect(text).not.toContain('Diabetes');
  });

  it('PSEBC-18: decline asks for a reason; first acceptance wins; lone-working tick required', async () => {
    expect((await peter.post(`/api/rides/${rideId}/decline`).send({})).status).toBe(422);
    expect((await david.post(`/api/rides/${rideId}/accept`).send()).status).toBe(409); // lone working not ticked
    expect((await david.post('/api/drivers/me/lone-working').send()).status).toBe(200);
    expect((await peter.post('/api/drivers/me/lone-working').send()).status).toBe(200);
    const results = await Promise.all([david.post(`/api/rides/${rideId}/accept`).send(), peter.post(`/api/rides/${rideId}/accept`).send()]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);
    const winner = results[0]!.status === 200 ? 'David Thomas' : 'Peter Morgan';
    const [ride] = await query<{ status: string; full_name: string }>('SELECT r.status, d.full_name FROM rides r JOIN drivers d ON d.id = r.driver_id WHERE r.id = $1', [rideId]);
    expect(ride).toMatchObject({ status: 'driver_found', full_name: winner });
    const open = await query(`SELECT 1 FROM ride_invites WHERE ride_id = $1 AND status = 'sent'`, [rideId]);
    expect(open.length).toBe(0); // other invites withdrawn
    if (winner === 'Peter Morgan') {
      // keep the rest of the test deterministic: Peter hands it back, David accepts
      await peter.post(`/api/rides/${rideId}/withdraw`).send({ note: 'test' });
      await query(`UPDATE ride_invites SET status = 'sent' WHERE ride_id = $1 AND driver_id = (SELECT id FROM drivers WHERE full_name = 'David Thomas')`, [rideId]);
      expect((await david.post(`/api/rides/${rideId}/accept`).send()).status).toBe(200);
    }
  });

  it('PSEBC-21 (4.1): member sees driver first name, vehicle and contact route', async () => {
    const res = await margaret.get(`/api/rides/${rideId}`);
    expect(res.body.driver).toMatchObject({ firstName: 'David', vehicle: { makeModel: 'Toyota Corolla Estate', colour: 'Silver', registration: 'AB12 CDE' } });
    expect(res.body.driverKnows).toContain('Help to and from the front door');
  });

  it('PSEBC-22 (4.2): after acceptance driver sees name, address, phone, emergency contact and consented health notes — and it is audited', async () => {
    const res = await david.get(`/api/rides/${rideId}`);
    expect(res.body.view).toBe('driver_trip');
    expect(res.body.member).toMatchObject({ preferredName: 'Margaret', phone: '07700 900456', emergencyName: 'Ruth Evans' });
    expect(res.body.ride.pickupAddress).toContain('12 Example Road');
    expect(res.body.member.healthNotes).toEqual(['Diabetes: may need a snack or drink']);
    const audit = await query(`SELECT 1 FROM audit_log WHERE action = 'member.view_needs' AND details->>'via' = 'driver_trip'`);
    expect(audit.length).toBeGreaterThan(0);
  });

  it('PSEBC-13 (2.2): coordinator books for a member; booker recorded; member gets text or phone confirmation', async () => {
    const [edna] = await query<{ id: string }>(`SELECT id FROM members WHERE preferred_name = 'Edna'`);
    const res = await coordinator.post('/api/rides').send(ridePayload({ memberId: edna!.id, pickupAt: inDays(6, 10, 0), returnAt: inDays(6, 12, 0) }));
    expect(res.status).toBe(201);
    const [ride] = await query<{ booked_by_role: string }>('SELECT booked_by_role FROM rides WHERE id = $1', [res.body.id]);
    expect(ride!.booked_by_role).toBe('coordinator');
    const task = await query(`SELECT 1 FROM notifications WHERE channel = 'phone_task' AND ride_id = $1`, [res.body.id]);
    expect(task.length).toBeGreaterThan(0); // Edna prefers the church office to call

    const margaretRide = await query(`SELECT 1 FROM notifications WHERE channel = 'sms' AND ride_id = $1`, [rideId]);
    expect(margaretRide.length).toBeGreaterThan(0); // Margaret prefers text
  });

  it('PSEBC-19 / §8: a request no driver can take goes straight to the coordinator', async () => {
    const [albert] = await query<{ id: string }>(`SELECT id FROM members WHERE preferred_name = 'Albert'`);
    // Albert needs folding wheelchair space — only David fits, and David is busy at that time.
    const res = await coordinator.post('/api/rides').send(ridePayload({ memberId: albert!.id, pickupAt: inDays(5, 10, 0), returnAt: inDays(5, 12, 0) }));
    expect(res.body.status).toBe('unmatched');
    const overview = await coordinator.get('/api/office/overview').query({ from: inDays(4, 0, 0) });
    expect(overview.body.attention.some((a: { type: string; rideId: string }) => a.type === 'no_driver' && a.rideId === res.body.id)).toBe(true);
  });

  it('PSEBC-19 (3.3): flags to coordinator after 24h with no acceptance', async () => {
    const r = await margaret.post('/api/rides').send(ridePayload({ pickupAt: inDays(9), returnAt: null, returnNeeded: false }));
    expect(r.body.status).toBe('invites_sent');
    const flagged = await jobs.flagUnmatched(new Date(Date.now() + 25 * 3_600_000));
    expect(flagged).toBeGreaterThanOrEqual(1);
    const [row] = await query<{ status: string; unmatched_flagged_at: Date }>('SELECT status, unmatched_flagged_at FROM rides WHERE id = $1', [r.body.id]);
    expect(row!.status).toBe('unmatched');
    expect(row!.unmatched_flagged_at).toBeTruthy();
  });

  it('PSEBC-14 / PSEBC-15 (2.3, 2.4): cancel with reason notifies driver; rebook copies details', async () => {
    const r = await margaret.post('/api/rides').send(ridePayload({ pickupAt: inDays(12), returnAt: inDays(12, 12, 30) }));
    await david.post(`/api/rides/${r.body.id}/accept`).send();
    expect((await margaret.post(`/api/rides/${r.body.id}/cancel`).send({})).status).toBe(422); // reason captured
    const c = await margaret.post(`/api/rides/${r.body.id}/cancel`).send({ reason: 'unwell', part: 'both' });
    expect(c.status).toBe(200);
    const notified = await query(`SELECT 1 FROM notifications n JOIN users u ON u.id = n.user_id WHERE u.email = 'david@psebc.example' AND n.kind = 'cancelled' AND n.channel = 'in_app' AND n.ride_id = $1`, [r.body.id]);
    expect(notified.length).toBe(1);
    const rb = await margaret.post(`/api/rides/${r.body.id}/rebook`).send({ pickupAt: inDays(19), returnAt: inDays(19, 12, 30) });
    expect(rb.status).toBe(201);
    const [copy] = await query<{ destination: string; rebooked_from_id: string; return_needed: boolean }>('SELECT destination, rebooked_from_id, return_needed FROM rides WHERE id = $1', [rb.body.id]);
    expect(copy).toMatchObject({ destination: 'Princes Street Church: Sunday service', rebooked_from_id: r.body.id, return_needed: true });
  });

  it('PSEBC-24 (5.1): driver records pickup and drop-off with timestamps; not-at-pickup alerts the office', async () => {
    expect((await david.post(`/api/rides/${rideId}/progress`).send({ event: 'dropped_off' })).status).toBe(400);
    expect((await david.post(`/api/rides/${rideId}/progress`).send({ event: 'not_at_pickup' })).status).toBe(200);
    const alert = await query(`SELECT 1 FROM notifications n JOIN users u ON u.id = n.user_id WHERE u.role = 'coordinator' AND n.kind = 'not_at_pickup'`);
    expect(alert.length).toBeGreaterThan(0);
    expect((await david.post(`/api/rides/${rideId}/progress`).send({ event: 'picked_up' })).status).toBe(200);
    expect((await david.post(`/api/rides/${rideId}/progress`).send({ event: 'dropped_off' })).status).toBe(200);
    const [r] = await query<{ status: string; picked_up_at: Date; dropped_off_at: Date }>('SELECT status, picked_up_at, dropped_off_at FROM rides WHERE id = $1', [rideId]);
    expect(r!.status).toBe('completed');
    expect(r!.picked_up_at).toBeTruthy();
    expect(r!.dropped_off_at).toBeTruthy();
  });

  it('PSEBC-25 / PSEBC-28 (5.2, 6.2): driver log with "anything to report" → concern reaches safeguarding immediately, safeguarding only', async () => {
    const log = await david.post(`/api/rides/${rideId}/logs/driver`).send({ wentAsPlanned: true, anythingToReport: true, needsChanged: false });
    expect(log.body.openConcern).toBe(true);
    const concern = await david.post('/api/concerns').send({
      rideId,
      occurredWhen: '10:05 am',
      occurredWhere: 'Church car park',
      kinds: ['unwell'],
      description: 'Margaret felt shaky getting out of the car. She had a biscuit and felt better.',
      actionTaken: 'Sat her down',
      anyoneHurt: false,
      emergencyServicesCalled: false,
      familyTold: 'yes',
    });
    expect(concern.status).toBe(201);
    const notified = await query(`SELECT channel FROM notifications n JOIN users u ON u.id = n.user_id WHERE u.role = 'safeguarding' AND n.kind = 'concern'`);
    expect(notified.map((n) => n.channel).sort()).toEqual(['email', 'in_app']); // + sms when the lead has a phone on file
    expect((await coordinator.get('/api/concerns')).status).toBe(403);
    expect((await admin.get('/api/concerns')).status).toBe(403);
    expect((await safeguarding.get('/api/concerns')).body.concerns.length).toBe(1);
  });

  it('PSEBC-26 / PSEBC-29 (5.3, 6.3): member logs on time, felt safe, optional rating; both logs → Logged', async () => {
    const res = await margaret.post(`/api/rides/${rideId}/logs/member`).send({ onTime: 'yes', feltSafe: true, rating: 5, callbackRequested: true });
    expect(res.status).toBe(201);
    const [r] = await query<{ status: string }>('SELECT status FROM rides WHERE id = $1', [rideId]);
    expect(r!.status).toBe('logged');
    const callback = await query(`SELECT 1 FROM notifications WHERE kind = 'callback'`);
    expect(callback.length).toBeGreaterThan(0);
  });

  it('PSEBC-27 / PSEBC-28 (6.1, 6.2): cannot sign off until the concern is reviewed; sign-off records name and date', async () => {
    const queue = await safeguarding.get('/api/safeguarding/queue');
    const item = queue.body.trips.find((t: { id: string }) => t.id === rideId);
    expect(item).toMatchObject({ ready: true, openConcerns: 1 });
    const blocked = await safeguarding.post(`/api/safeguarding/trips/${rideId}/signoff`).send({ outcome: 'follow_up' });
    expect(blocked.status).toBe(409);
    expect((await admin.post(`/api/safeguarding/trips/${rideId}/signoff`).send({})).status).toBe(403);
    const trip = await safeguarding.get(`/api/safeguarding/trips/${rideId}`);
    await safeguarding.post(`/api/concerns/${trip.body.concerns[0].id}/review`).send({ outcome: 'follow_up', notes: 'Called daughter' });
    const ok = await safeguarding.post(`/api/safeguarding/trips/${rideId}/signoff`).send({ outcome: 'follow_up', notes: 'Margaret will carry a snack' });
    expect(ok.status).toBe(200);
    const [r] = await query<{ status: string; signed_off_by_name: string; signed_off_at: Date }>('SELECT status, signed_off_by_name, signed_off_at FROM rides WHERE id = $1', [rideId]);
    expect(r).toMatchObject({ status: 'signed_off', signed_off_by_name: 'Mathias' });
  });

  it('PSEBC-23 (4.3): after sign-off the driver keeps only the trip record', async () => {
    const res = await david.get(`/api/rides/${rideId}`);
    expect(res.body.view).toBe('driver_record');
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('Margaret');
    expect(text).not.toContain('Example Road');
    expect(text).not.toContain('07700 900456');
  });

  it('PSEBC-27 (6.1): ready for sign-off 72 hours after completion if a log is missing (missing log noted)', async () => {
    const r = await margaret.post('/api/rides').send(ridePayload({ pickupAt: inDays(15), returnAt: null, returnNeeded: false }));
    await david.post(`/api/rides/${r.body.id}/accept`).send();
    await david.post(`/api/rides/${r.body.id}/progress`).send({ event: 'picked_up' });
    await david.post(`/api/rides/${r.body.id}/progress`).send({ event: 'dropped_off' });
    await david.post(`/api/rides/${r.body.id}/logs/driver`).send({ wentAsPlanned: true, anythingToReport: false, needsChanged: false });
    expect(await jobs.applyLogTimeout(new Date(Date.now() + 71 * 3_600_000))).toBe(0);
    expect(await jobs.applyLogTimeout(new Date(Date.now() + 73 * 3_600_000))).toBe(1);
    const [row] = await query<{ status: string; missing_log_note: string }>('SELECT status, missing_log_note FROM rides WHERE id = $1', [r.body.id]);
    expect(row).toMatchObject({ status: 'logged', missing_log_note: 'Member log missing (72 hours passed)' });
  });

  it('PSEBC-26 (5.3): "No" to feeling safe tells safeguarding the same day', async () => {
    const r = await margaret.post('/api/rides').send(ridePayload({ pickupAt: inDays(16), returnAt: null, returnNeeded: false }));
    await david.post(`/api/rides/${r.body.id}/accept`).send();
    await david.post(`/api/rides/${r.body.id}/progress`).send({ event: 'picked_up' });
    await david.post(`/api/rides/${r.body.id}/progress`).send({ event: 'dropped_off' });
    const res = await coordinator.post(`/api/rides/${r.body.id}/logs/member`).send({ onTime: 'bit_late', feltSafe: false });
    expect(res.body.openConcern).toBe(true);
    const n = await query(`SELECT 1 FROM notifications WHERE kind = 'felt_unsafe' AND ride_id = $1`, [r.body.id]);
    expect(n.length).toBeGreaterThan(0);
  });

  it('PSEBC-10 (1.4): reminder 30 days before expiry; on expiry status becomes Expired automatically', async () => {
    await query(`UPDATE drivers SET insurance_expiry = current_date + 20 WHERE id = $1`, [newDriverId]);
    const first = await jobs.checkDriverExpiry();
    expect(first.reminded).toBe(1);
    expect((await jobs.checkDriverExpiry()).reminded).toBe(0); // not repeated
    const later = await jobs.checkDriverExpiry(new Date(Date.now() + 22 * 86_400_000));
    expect(later.expired).toBeGreaterThanOrEqual(1);
    const [d] = await query<{ status: string }>('SELECT status FROM drivers WHERE id = $1', [newDriverId]);
    expect(d!.status).toBe('expired');
  });

  it('PSEBC-11 (1.5): closing an account stops login immediately, cancels future lifts, sets deletion date', async () => {
    const before = await margaret.get('/api/auth/me');
    expect(before.status).toBe(200);
    const [m] = await query<{ id: string }>(`SELECT id FROM members WHERE preferred_name = 'Margaret'`);
    expect((await coordinator.post(`/api/members/${m!.id}/close`).send({})).status).toBe(403);
    const res = await admin.post(`/api/members/${m!.id}/close`).send({ reason: 'Moved away' });
    expect(res.status).toBe(200);
    expect(res.body.cancelledRides).toBeGreaterThan(0);
    expect((await margaret.get('/api/auth/me')).status).toBe(401); // existing session ends at once
    expect((await request(app).post('/api/auth/login').send({ email: 'margaret@psebc.example', password: PASSWORD })).status).toBe(401);
    const [row] = await query<{ delete_after: Date }>('SELECT delete_after FROM members WHERE id = $1', [m!.id]);
    const months = (row!.delete_after.getTime() - Date.now()) / (30 * 86_400_000);
    expect(months).toBeGreaterThan(11);
    expect(months).toBeLessThan(13);
  });

  it('Role-based access: members cannot see other members or unassigned drivers', async () => {
    const other = await login('peter@psebc.example');
    const [edna] = await query<{ id: string }>(`SELECT id FROM members WHERE preferred_name = 'Edna'`);
    expect((await other.get(`/api/members/${edna!.id}`)).status).toBe(403);
    expect((await other.get('/api/drivers')).status).toBe(403);
    expect((await coordinator.get(`/api/drivers/${newDriverId}`)).status).toBe(403);
  });

  it('Audit trail is append-only', async () => {
    await expect(query('DELETE FROM audit_log')).rejects.toThrow(/append-only/);
    await expect(query(`UPDATE audit_log SET action = 'x'`)).rejects.toThrow(/append-only/);
  });

  it('7.1 reports: monthly figures without health information, CSV download, admin and safeguarding only', async () => {
    const month = inDays(5).slice(0, 7);
    expect((await coordinator.get('/api/reports/monthly').query({ month })).status).toBe(403);
    const res = await admin.get('/api/reports/monthly').query({ month });
    expect(res.status).toBe(200);
    expect(res.body.summary).toHaveProperty('tripsCompleted');
    expect(JSON.stringify(res.body)).not.toMatch(/diabetes|Diabetes|memory/);
    expect(res.body.memberUsage).toBeNull(); // names hidden until the DPIA covers them
    const csv = await safeguarding.get('/api/reports/monthly.csv').query({ month });
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain('tripsCompleted');
  });
});
