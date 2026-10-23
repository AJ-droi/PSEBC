import bcrypt from 'bcryptjs';
import { count, eq } from 'drizzle-orm';
import { fileURLToPath } from 'node:url';
import { normaliseUkPhone } from '@psebc/shared';
import { encryptJson } from '../lib/crypto';
import { closeDb, db, withTx } from './client';
import { migrate } from './migrate';
import { documents, drivers, members, users } from './schema';

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
  const passwordHash = await bcrypt.hash(password, 10);
  const [existing] = await db.select({ n: count() }).from(users);
  if ((existing?.n ?? 0) > 0) {
    log('database already has users — skipping seed');
    return;
  }

  /** Seed data goes in the same +44 form the forms produce. */
  const uk = (n: string) => normaliseUkPhone(n)!;
  const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

  await withTx(async (tx) => {
    const member = async (p: { name: string; preferred: string; addr: string; town: string; pc: string; phone: string; aids: string[]; help: string[]; vehicle: string; health: string[]; unwell: string; contact: string; bookedBy: string }) => {
      const [row] = await tx
        .insert(members)
        .values({
          fullName: p.name,
          preferredName: p.preferred,
          addressLine: p.addr,
          town: p.town,
          postcode: p.pc,
          findingNotes: 'Use the side door. Ring twice.',
          phone: uk(p.phone),
          contactMethod: p.contact,
          bookedBy: p.bookedBy,
          emergencyName: 'Ruth Evans',
          emergencyRelationship: 'Son or daughter',
          emergencyPhone: uk('07700 900123'),
          hasRepresentative: true,
          representativeName: 'Ruth Evans',
          representativePhone: uk('07700 900123'),
          representativeRole: 'Helps me with my arrangements',
          mobilityAids: p.aids,
          helpNeeded: p.help,
          vehicleRequirement: p.vehicle,
          healthEnc: encryptJson({ flags: p.health, unwellInstructions: p.unwell }),
          consentGiven: true,
          consentGivenBy: 'member',
          consentRecordedAt: new Date(),
        })
        .returning({ id: members.id });
      return row!.id;
    };

    const margaret = await member({ name: 'Margaret Evans', preferred: 'Margaret', addr: '12 Example Road', town: 'Barry', pc: 'CF62 0XX', phone: '07700 900456', aids: ['walking_frame'], help: ['door', 'car'], vehicle: 'easy_access', health: ['diabetes'], unwell: 'Sit me down and call my daughter Ruth on 07700 900123.', contact: 'text', bookedBy: 'self' });
    await member({ name: 'Albert Price', preferred: 'Albert', addr: '4 Harbour View', town: 'Penarth', pc: 'CF64 1AA', phone: '07700 900222', aids: ['folding_wheelchair'], help: ['door', 'car'], vehicle: 'folding_wheelchair', health: [], unwell: '', contact: 'family', bookedBy: 'family' });
    await member({ name: 'Edna Hughes', preferred: 'Edna', addr: '9 Chapel Lane', town: 'Barry', pc: 'CF63 2BB', phone: '01446 700333', aids: ['walking_stick'], help: ['door'], vehicle: 'any', health: ['hearing_sight'], unwell: 'Call the church office.', contact: 'office', bookedBy: 'office' });

    const driver = async (p: { name: string; email: string; phone: string; pc: string; car: string; colour: string; reg: string; seats: number; caps: string[]; help: string[]; status: 'approved' | 'pending' }) => {
      const approved = p.status === 'approved';
      const [row] = await tx
        .insert(drivers)
        .values({
          fullName: p.name,
          phone: uk(p.phone),
          email: p.email,
          postcode: p.pc,
          dbsNumber: '001234567890',
          dbsIssueDate: '2024-03-14',
          dbsRenewalDate: '2027-03-14',
          insuranceExpiry: inDays(400),
          vehicleMakeModel: p.car,
          vehicleColour: p.colour,
          vehicleReg: p.reg,
          passengerSeats: p.seats,
          vehicleCaps: p.caps,
          helpCaps: p.help,
          status: p.status,
          approvedUntil: approved ? inDays(400) : null,
          decidedByName: approved ? 'Mathias' : null,
          decidedAt: approved ? new Date() : null,
        })
        .returning({ id: drivers.id });
      const id = row!.id;
      const pdf = Buffer.from('%PDF-1.4\n% placeholder evidence for demo data\n%%EOF\n');
      for (const kind of ['licence', 'insurance'] as const) {
        const [doc] = await tx
          .insert(documents)
          .values({ driverId: id, kind, filename: `${kind}-demo.pdf`, mimeType: 'application/pdf', sizeBytes: pdf.length, data: pdf })
          .returning({ id: documents.id });
        await tx
          .update(drivers)
          .set(kind === 'licence' ? { licenceDocId: doc!.id } : { insuranceDocId: doc!.id })
          .where(eq(drivers.id, id));
      }
      return id;
    };
    const david = await driver({ name: 'David Thomas', email: 'david@example.org', phone: '07700 900789', pc: 'CF62 7AB', car: 'Toyota Corolla Estate', colour: 'Silver', reg: 'AB12 CDE', seats: 4, caps: ['folding_wheelchair', 'walking_frame', 'easy_access', 'carer'], help: ['door', 'car', 'wheelchair_boot'], status: 'approved' });
    const peter = await driver({ name: 'Peter Morgan', email: 'peter@example.org', phone: '07700 900790', pc: 'CF63 4CD', car: 'Honda Jazz', colour: 'Blue', reg: 'CD34 EFG', seats: 3, caps: ['walking_frame', 'easy_access'], help: ['door', 'car'], status: 'approved' });
    const helen = await driver({ name: 'Helen Price', email: 'helen@example.org', phone: '07700 900791', pc: 'CF64 5EF', car: 'Ford Focus', colour: 'Red', reg: 'EF56 GHI', seats: 4, caps: ['walking_frame'], help: ['door'], status: 'pending' });

    await tx.insert(users).values([
      { email: 'admin@psebc.example', fullName: 'Church Admin', role: 'admin', passwordHash },
      { email: 'mathias@psebc.example', fullName: 'Mathias', role: 'safeguarding', passwordHash },
      { email: 'grace@psebc.example', fullName: 'Grace', role: 'coordinator', passwordHash },
      { email: 'margaret@psebc.example', fullName: 'Margaret Evans', role: 'member', passwordHash, memberId: margaret, phone: uk('07700 900456') },
      { email: 'david@psebc.example', fullName: 'David Thomas', role: 'driver', passwordHash, driverId: david, phone: uk('07700 900789') },
      { email: 'peter@psebc.example', fullName: 'Peter Morgan', role: 'driver', passwordHash, driverId: peter, phone: uk('07700 900790') },
      { email: 'helen@psebc.example', fullName: 'Helen Price', role: 'driver', passwordHash, driverId: helen, phone: uk('07700 900791') },
    ]);
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
    .finally(() => closeDb());
}
