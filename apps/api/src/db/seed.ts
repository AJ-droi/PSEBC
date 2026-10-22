import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'node:url';
import { encryptJson } from '../lib/crypto';
import { closePool, query, withTx } from './pool';
import { migrate } from './migrate';

/**
 * Pilot/demo data matching the personas in the PRD (Margaret, David, Grace, Mathias).
 * Refuses to run in production unless --force is passed.
 */
export async function seed(log: (m: string) => void = console.log) {
  if (process.env.NODE_ENV === 'production' && !process.argv.includes('--force')) {
    throw new Error('Refusing to seed in production without --force');
  }
  await migrate(log);
  const password = process.env.SEED_PASSWORD ?? 'ChangeMe-2026!';
  const hash = await bcrypt.hash(password, 10);
  const existing = await query<{ n: number }>('SELECT count(*) AS n FROM users');
  if ((existing[0]?.n ?? 0) > 0) {
    log('database already has users — skipping seed');
    return;
  }

  await withTx(async (db) => {
    const ins = async (sql: string, params: unknown[]) => (await db.query<{ id: string }>(sql, params)).rows[0]!.id;

    const member = (p: {
      name: string;
      preferred: string;
      addr: string;
      town: string;
      pc: string;
      phone: string;
      aids: string[];
      help: string[];
      vehicle: string;
      health: string[];
      unwell: string;
      contact: string;
      bookedBy: string;
    }) =>
      ins(
        `INSERT INTO members (full_name, preferred_name, address_line, town, postcode, finding_notes, phone, can_receive_sms, contact_method, booked_by,
           emergency_name, emergency_relationship, emergency_phone, has_representative, representative_name, representative_phone, representative_role,
           mobility_aids, help_needed, vehicle_requirement, health_enc, consent_given, consent_given_by, consent_recorded_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8,$9,'Ruth Evans','Son or daughter','07700 900123',true,'Ruth Evans','07700 900123','Helps me with my arrangements',
                 $10,$11,$12,$13,true,'member',now()) RETURNING id`,
        [p.name, p.preferred, p.addr, p.town, p.pc, 'Use the side door. Ring twice.', p.phone, p.contact, p.bookedBy, p.aids, p.help, p.vehicle, encryptJson({ flags: p.health, unwellInstructions: p.unwell })],
      );

    const margaret = await member({ name: 'Margaret Evans', preferred: 'Margaret', addr: '12 Example Road', town: 'Barry', pc: 'CF62 0XX', phone: '07700 900456', aids: ['walking_frame'], help: ['door', 'car'], vehicle: 'easy_access', health: ['diabetes'], unwell: 'Sit me down and call my daughter Ruth on 07700 900123.', contact: 'text', bookedBy: 'self' });
    await member({ name: 'Albert Price', preferred: 'Albert', addr: '4 Harbour View', town: 'Penarth', pc: 'CF64 1AA', phone: '07700 900222', aids: ['folding_wheelchair'], help: ['door', 'car'], vehicle: 'folding_wheelchair', health: [], unwell: '', contact: 'family', bookedBy: 'family' });
    await member({ name: 'Edna Hughes', preferred: 'Edna', addr: '9 Chapel Lane', town: 'Barry', pc: 'CF63 2BB', phone: '01446 700333', aids: ['walking_stick'], help: ['door'], vehicle: 'any', health: ['hearing_sight'], unwell: 'Call the church office.', contact: 'office', bookedBy: 'office' });

    const driver = async (p: { name: string; email: string; phone: string; pc: string; car: string; colour: string; reg: string; seats: number; caps: string[]; help: string[]; status: string }) => {
      const id = await ins(
        `INSERT INTO drivers (full_name, phone, email, postcode, dbs_number, dbs_issue_date, dbs_renewal_date, insurance_expiry, vehicle_make_model, vehicle_colour, vehicle_reg,
                              passenger_seats, vehicle_caps, help_caps, status, approved_until, decided_by_name, decided_at, lone_working_ack_at)
         VALUES ($1,$2,$3,$4,'001234567890','2024-03-14','2027-03-14', (current_date + interval '400 days')::date, $5,$6,$7,$8,$9,$10,$11::driver_status,
                 CASE WHEN $11::text = 'approved' THEN (current_date + interval '400 days')::date END,
                 CASE WHEN $11::text = 'approved' THEN 'Mathias' END, CASE WHEN $11::text = 'approved' THEN now() END, NULL) RETURNING id`,
        [p.name, p.phone, p.email, p.pc, p.car, p.colour, p.reg, p.seats, p.caps, p.help, p.status],
      );
      const pdf = Buffer.from('%PDF-1.4\n% placeholder evidence for demo data\n%%EOF\n');
      for (const kind of ['licence', 'insurance'] as const) {
        const doc = await ins(`INSERT INTO documents (driver_id, kind, filename, mime_type, size_bytes, data) VALUES ($1,$2,$3,'application/pdf',$4,$5) RETURNING id`, [id, kind, `${kind}-demo.pdf`, pdf.length, pdf]);
        await db.query(`UPDATE drivers SET ${kind}_doc_id = $2 WHERE id = $1`, [id, doc]);
      }
      return id;
    };
    const david = await driver({ name: 'David Thomas', email: 'david@example.org', phone: '07700 900789', pc: 'CF62 7AB', car: 'Toyota Corolla Estate', colour: 'Silver', reg: 'AB12 CDE', seats: 4, caps: ['folding_wheelchair', 'walking_frame', 'easy_access', 'carer'], help: ['door', 'car', 'wheelchair_boot'], status: 'approved' });
    const peter = await driver({ name: 'Peter Morgan', email: 'peter@example.org', phone: '07700 900790', pc: 'CF63 4CD', car: 'Honda Jazz', colour: 'Blue', reg: 'CD34 EFG', seats: 3, caps: ['walking_frame', 'easy_access'], help: ['door', 'car'], status: 'approved' });
    const helen = await driver({ name: 'Helen Price', email: 'helen@example.org', phone: '07700 900791', pc: 'CF64 5EF', car: 'Ford Focus', colour: 'Red', reg: 'EF56 GHI', seats: 4, caps: ['walking_frame'], help: ['door'], status: 'pending' });

    const user = (email: string, name: string, role: string, extra: { member?: string; driver?: string; phone?: string } = {}) =>
      ins(`INSERT INTO users (email, full_name, role, password_hash, member_id, driver_id, phone) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [email, name, role, hash, extra.member ?? null, extra.driver ?? null, extra.phone ?? null]);

    await user('admin@psebc.example', 'Church Admin', 'admin');
    await user('mathias@psebc.example', 'Mathias', 'safeguarding');
    await user('grace@psebc.example', 'Grace', 'coordinator');
    await user('margaret@psebc.example', 'Margaret Evans', 'member', { member: margaret, phone: '07700 900456' });
    await user('david@psebc.example', 'David Thomas', 'driver', { driver: david, phone: '07700 900789' });
    await user('peter@psebc.example', 'Peter Morgan', 'driver', { driver: peter, phone: '07700 900790' });
    await user('helen@psebc.example', 'Helen Price', 'driver', { driver: helen, phone: '07700 900791' });
  });

  log(`seeded demo users (password: ${password}) — admin@, mathias@, grace@, margaret@, david@, peter@, helen@psebc.example`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  seed()
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => closePool());
}
