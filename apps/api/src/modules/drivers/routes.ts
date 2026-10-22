import { Router } from 'express';
import multer from 'multer';
import { RULES, driverCreateSchema, driverDecisionSchema, driverUpdateSchema, closeAccountSchema, type DriverCreateInput } from '@psebc/shared';
import { query, queryOne, withTx } from '../../db/pool';
import { ah, parse, uuidParam } from '../../lib/http';
import { AppError, badRequest, notFound } from '../../lib/errors';
import { currentUser, requireRole } from '../../middleware/auth';
import { actorFrom, audit } from '../../services/audit';
import { flushSoon, notifyDriver, notifyRole } from '../../services/notify';
import { closeDriverAccount } from '../admin/accounts';
import { driverHome } from '../rides/views';

export const driversRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)),
});

interface DriverRow {
  id: string;
  full_name: string;
  phone: string;
  email: string;
  postcode: string;
  photo_doc_id: string | null;
  dbs_number: string;
  dbs_issue_date: string;
  dbs_renewal_date: string;
  licence_doc_id: string | null;
  insurance_doc_id: string | null;
  insurance_expiry: string;
  vehicle_make_model: string;
  vehicle_colour: string;
  vehicle_reg: string;
  passenger_seats: number;
  vehicle_caps: string[];
  help_caps: string[];
  status: string;
  approved_until: string | null;
  decided_by_name: string | null;
  decided_at: Date | null;
  decision_notes: string;
  lone_working_ack_at: Date | null;
  created_at: Date;
}

const toDto = (d: DriverRow, docs: { id: string; kind: string; filename: string; created_at: Date }[] = [], exclusions: { member_id: string; full_name: string }[] = []) => ({
  id: d.id,
  fullName: d.full_name,
  phone: d.phone,
  email: d.email,
  postcode: d.postcode,
  photoUrl: d.photo_doc_id ? `/api/documents/${d.photo_doc_id}` : null,
  dbsNumber: d.dbs_number,
  dbsIssueDate: d.dbs_issue_date,
  dbsRenewalDate: d.dbs_renewal_date,
  insuranceExpiry: d.insurance_expiry,
  vehicleMakeModel: d.vehicle_make_model,
  vehicleColour: d.vehicle_colour,
  vehicleReg: d.vehicle_reg,
  passengerSeats: d.passenger_seats,
  vehicleCaps: d.vehicle_caps,
  helpCaps: d.help_caps,
  status: d.status,
  approvedUntil: d.approved_until,
  decidedBy: d.decided_by_name,
  decidedAt: d.decided_at,
  decisionNotes: d.decision_notes,
  loneWorkingAcknowledgedAt: d.lone_working_ack_at,
  createdAt: d.created_at,
  documents: docs.map((x) => ({ id: x.id, kind: x.kind, filename: x.filename, uploadedAt: x.created_at, url: `/api/documents/${x.id}` })),
  exclusions: exclusions.map((e) => ({ memberId: e.member_id, name: e.full_name })),
});

/** Earliest of the check expiries — the default "approved until" on F03. */
const earliestExpiry = (d: Pick<DriverRow, 'dbs_renewal_date' | 'insurance_expiry'>) => [d.dbs_renewal_date, d.insurance_expiry].sort()[0];

function renewalDate(input: Pick<DriverCreateInput, 'dbsIssueDate' | 'dbsRenewalDate'>): string {
  if (input.dbsRenewalDate) return input.dbsRenewalDate;
  const d = new Date(`${input.dbsIssueDate}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + RULES.dbsRenewalYears);
  return d.toISOString().slice(0, 10);
}

// ---- Driver's own screens (F06/F07 home, lone-working tick) ---------------

driversRouter.get(
  '/me/home',
  requireRole('driver'),
  ah(async (req, res) => {
    res.json(await driverHome(currentUser(req).driverId!));
  }),
);

/** PRD §9 Lone working: reminded before the first trip, with a tick to confirm. */
driversRouter.post(
  '/me/lone-working',
  requireRole('driver'),
  ah(async (req, res) => {
    const id = currentUser(req).driverId!;
    await query('UPDATE drivers SET lone_working_ack_at = now(), updated_at = now() WHERE id = $1 AND lone_working_ack_at IS NULL', [id]);
    await audit(actorFrom(req), { action: 'driver.lone_working_ack', entityType: 'driver', entityId: id });
    res.json({ ok: true });
  }),
);

// ---- Office / safeguarding -----------------------------------------------

driversRouter.get(
  '/',
  requireRole('admin', 'safeguarding', 'coordinator'),
  ah(async (req, res) => {
    const status = String(req.query.status ?? '');
    const rows = await query<DriverRow>(
      `SELECT * FROM drivers WHERE ($1 = '' OR status::text = $1) ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, full_name`,
      [status],
    );
    const soon = new Date(Date.now() + RULES.expiryReminderDays * 86_400_000).toISOString().slice(0, 10);
    const user = currentUser(req);
    res.json({
      drivers: rows.map((d) => ({
        id: d.id,
        fullName: d.full_name,
        postcode: user.role === 'coordinator' ? undefined : d.postcode,
        phone: d.phone,
        status: d.status,
        approvedUntil: d.approved_until,
        vehicle: `${d.vehicle_colour} ${d.vehicle_make_model}`,
        vehicleCaps: d.vehicle_caps,
        helpCaps: d.help_caps,
        createdAt: d.created_at,
        expiresOn: earliestExpiry(d),
        expiringSoon: d.status === 'approved' && earliestExpiry(d)! <= soon,
        reapproval: d.status === 'pending' && !!d.decided_at,
      })),
    });
  }),
);

/** F02 Driver registration (story 1.2 PSEBC-8, 1.6). Status starts as Pending. */
driversRouter.post(
  '/',
  requireRole('admin'),
  ah(async (req, res) => {
    const input = parse(driverCreateSchema, req.body);
    const status = input.submit ? 'pending' : 'draft';
    const row = await withTx(async (db) => {
      const [d] = await query<{ id: string }>(
        `INSERT INTO drivers (full_name, phone, email, postcode, dbs_number, dbs_issue_date, dbs_renewal_date, insurance_expiry,
                              vehicle_make_model, vehicle_colour, vehicle_reg, passenger_seats, vehicle_caps, help_caps, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
        [
          input.fullName,
          input.phone,
          input.email,
          input.postcode,
          input.dbsNumber,
          input.dbsIssueDate,
          renewalDate(input),
          input.insuranceExpiry,
          input.vehicleMakeModel,
          input.vehicleColour,
          input.vehicleReg,
          input.passengerSeats,
          input.vehicleCaps,
          input.helpCaps,
          status,
          currentUser(req).id,
        ],
        db,
      );
      await audit(actorFrom(req), { action: 'driver.create', entityType: 'driver', entityId: d!.id, details: { status } }, db);
      if (status === 'pending') {
        await notifyRole(db, ['safeguarding'], { kind: 'driver_pending', title: 'Driver waiting for approval', body: `${input.fullName} has been added and is waiting for your decision.`, link: `/safeguarding/approvals/${d!.id}` }, { email: true });
      }
      return d!;
    });
    flushSoon();
    res.status(201).json({ id: row.id, status });
  }),
);

driversRouter.get(
  '/:id',
  requireRole('admin', 'safeguarding'),
  ah(async (req, res) => {
    const id = uuidParam(req);
    const d = await queryOne<DriverRow>('SELECT * FROM drivers WHERE id = $1', [id]);
    if (!d) throw notFound('Driver');
    const docs = await query<{ id: string; kind: string; filename: string; created_at: Date }>('SELECT id, kind, filename, created_at FROM documents WHERE driver_id = $1 ORDER BY created_at DESC', [id]);
    const exclusions = await query<{ member_id: string; full_name: string }>('SELECT e.member_id, m.full_name FROM driver_exclusions e JOIN members m ON m.id = e.member_id WHERE e.driver_id = $1', [id]);
    await audit(actorFrom(req), { action: 'driver.view', entityType: 'driver', entityId: id });
    res.json({ driver: toDto(d, latestPerKind(docs), exclusions), suggestedApprovedUntil: earliestExpiry(d) });
  }),
);

/** Edits by admin. A change to checks, vehicle or help on an approved driver sends them back for re-approval. */
driversRouter.patch(
  '/:id',
  requireRole('admin'),
  ah(async (req, res) => {
    const id = uuidParam(req);
    const input = parse(driverUpdateSchema, req.body);
    const map: Record<string, string> = {
      fullName: 'full_name',
      phone: 'phone',
      email: 'email',
      postcode: 'postcode',
      dbsNumber: 'dbs_number',
      dbsIssueDate: 'dbs_issue_date',
      dbsRenewalDate: 'dbs_renewal_date',
      insuranceExpiry: 'insurance_expiry',
      vehicleMakeModel: 'vehicle_make_model',
      vehicleColour: 'vehicle_colour',
      vehicleReg: 'vehicle_reg',
      passengerSeats: 'passenger_seats',
      vehicleCaps: 'vehicle_caps',
      helpCaps: 'help_caps',
    };
    const reapprovalFields = ['dbsNumber', 'dbsIssueDate', 'dbsRenewalDate', 'insuranceExpiry', 'vehicleMakeModel', 'vehicleReg', 'passengerSeats', 'vehicleCaps', 'helpCaps'];
    const submit = input.submit === true;
    await withTx(async (db) => {
      const before = await queryOne<DriverRow>('SELECT * FROM drivers WHERE id = $1 FOR UPDATE', [id], db);
      if (!before || before.status === 'closed') throw notFound('Driver');
      const same = (a: unknown, b: unknown) => JSON.stringify(Array.isArray(a) ? [...a].sort() : a) === JSON.stringify(Array.isArray(b) ? [...b].sort() : b);
      const values: unknown[] = [id];
      const sets: string[] = [];
      const changed: string[] = [];
      for (const [k, v] of Object.entries(input)) {
        const col = map[k];
        if (!col || v === undefined) continue;
        if (same((before as unknown as Record<string, unknown>)[col], v)) continue;
        values.push(v);
        sets.push(`${col} = $${values.length}`);
        changed.push(k);
      }
      if (changed.includes('dbsIssueDate') && !input.dbsRenewalDate) {
        values.push(renewalDate({ dbsIssueDate: input.dbsIssueDate! }));
        sets.push(`dbs_renewal_date = $${values.length}`);
        changed.push('dbsRenewalDate');
      }
      if (sets.length === 0 && !submit) return;
      const needsReapproval = changed.some((k) => reapprovalFields.includes(k));
      let newStatus = before.status;
      if ((before.status === 'approved' || before.status === 'expired') && needsReapproval) newStatus = 'pending';
      if (before.status === 'draft' && submit) newStatus = 'pending';
      if (sets.length) await db.query(`UPDATE drivers SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, values);
      if (newStatus !== before.status) await db.query(`UPDATE drivers SET status = $2 WHERE id = $1`, [id, newStatus]);
      await audit(actorFrom(req), { action: 'driver.update', entityType: 'driver', entityId: id, details: { fields: changed, status: newStatus } }, db);
      if (newStatus === 'pending' && before.status !== 'pending') {
        await notifyRole(db, ['safeguarding'], { kind: 'driver_pending', title: 'Driver waiting for approval', body: `${before.full_name}’s details changed and need your approval.`, link: `/safeguarding/approvals/${id}` }, { email: true });
      }
    });
    flushSoon();
    res.json({ ok: true });
  }),
);

/** F03 Driver approval (story 1.3 PSEBC-9): only safeguarding can approve or reject; decision, date and approver are logged. */
driversRouter.post(
  '/:id/decision',
  requireRole('safeguarding'),
  ah(async (req, res) => {
    const id = uuidParam(req);
    const input = parse(driverDecisionSchema, req.body);
    const user = currentUser(req);
    await withTx(async (db) => {
      const d = await queryOne<DriverRow>('SELECT * FROM drivers WHERE id = $1 FOR UPDATE', [id], db);
      if (!d) throw notFound('Driver');
      if (!['pending', 'approved', 'rejected', 'expired'].includes(d.status)) throw new AppError(409, 'bad_status', 'This driver can’t be decided on yet');
      if (input.decision === 'approved') {
        const limit = earliestExpiry(d)!;
        if (input.approvedUntil! > limit) throw badRequest(`Approval can’t run past the earliest check expiry (${limit})`, { fields: { approvedUntil: `Must be on or before ${limit}` } });
        if (limit < new Date().toISOString().slice(0, 10)) throw badRequest('A check has already expired. Update the driver’s checks first.');
        if (!d.licence_doc_id || !d.insurance_doc_id) throw badRequest('Upload the driving licence and insurance evidence before approving');
      }
      await db.query(
        `UPDATE drivers SET status = $2, approved_until = $3, decided_by = $4, decided_by_name = $5, decided_at = now(), decision_notes = $6, expiry_reminded_for = NULL, updated_at = now() WHERE id = $1`,
        [id, input.decision, input.decision === 'approved' ? input.approvedUntil : null, user.id, user.fullName, input.notes],
      );
      await db.query('DELETE FROM driver_exclusions WHERE driver_id = $1', [id]);
      for (const memberId of input.excludedMemberIds) {
        await db.query('INSERT INTO driver_exclusions (driver_id, member_id, created_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [id, memberId, user.id]);
      }
      await audit(actorFrom(req), { action: `driver.${input.decision === 'approved' ? 'approve' : 'reject'}`, entityType: 'driver', entityId: id, details: { approvedUntil: input.approvedUntil, exclusions: input.excludedMemberIds.length, notes: input.notes } }, db);
      if (input.decision === 'rejected') {
        // A rejected driver loses any open invites and gives back accepted lifts.
        await db.query(`UPDATE ride_invites SET status = 'withdrawn', responded_at = now() WHERE driver_id = $1 AND status = 'sent'`, [id]);
      }
      await notifyDriver(db, id, {
        kind: 'driver_decision',
        title: input.decision === 'approved' ? 'You’re approved to drive' : 'About your volunteer driver application',
        body: input.decision === 'approved' ? `Thank you. You’re approved until ${input.approvedUntil}. You’ll start getting lift requests that suit your car.` : 'The safeguarding lead will be in touch with you.',
        link: '/driver',
      });
    });
    flushSoon();
    res.json({ ok: true });
  }),
);

/** Evidence upload (licence, insurance) and the photo shown to members. */
driversRouter.post(
  '/:id/documents/:kind',
  requireRole('admin'),
  upload.single('file'),
  ah(async (req, res) => {
    const id = uuidParam(req);
    const kind = req.params.kind as string;
    if (!['photo', 'licence', 'insurance'].includes(kind)) throw notFound('Document type');
    if (!req.file) throw badRequest('Choose a PDF or photo under 5 MB');
    if (kind === 'photo' && !req.file.mimetype.startsWith('image/')) throw badRequest('The photo must be an image');
    const column = { photo: 'photo_doc_id', licence: 'licence_doc_id', insurance: 'insurance_doc_id' }[kind as 'photo'];
    const doc = await withTx(async (db) => {
      const exists = await queryOne('SELECT 1 FROM drivers WHERE id = $1', [id], db);
      if (!exists) throw notFound('Driver');
      const [row] = await query<{ id: string }>(
        `INSERT INTO documents (driver_id, kind, filename, mime_type, size_bytes, data, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [id, kind, req.file!.originalname.slice(0, 120), req.file!.mimetype, req.file!.size, req.file!.buffer, currentUser(req).id],
        db,
      );
      await db.query(`UPDATE drivers SET ${column} = $2, updated_at = now() WHERE id = $1`, [id, row!.id]);
      await audit(actorFrom(req), { action: 'document.upload', entityType: 'driver', entityId: id, details: { kind, documentId: row!.id } }, db);
      return row!;
    });
    res.status(201).json({ id: doc.id, url: `/api/documents/${doc.id}` });
  }),
);

/** F13 for a volunteer driver: login stops, accepted lifts go back to matching. */
driversRouter.post(
  '/:id/close',
  requireRole('admin'),
  ah(async (req, res) => {
    const id = uuidParam(req);
    const { reason } = parse(closeAccountSchema, req.body);
    const result = await closeDriverAccount(id, actorFrom(req), reason);
    flushSoon();
    res.json(result);
  }),
);

function latestPerKind<T extends { kind: string }>(docs: T[]): T[] {
  const seen = new Set<string>();
  return docs.filter((d) => (seen.has(d.kind) ? false : (seen.add(d.kind), true)));
}
