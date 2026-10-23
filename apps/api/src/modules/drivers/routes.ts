import { Router } from 'express';
import multer from 'multer';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { DRIVER_STATUSES, RULES, driverCreateSchema, driverDecisionSchema, driverUpdateSchema, closeAccountSchema, type DriverCreateInput, type DriverStatus } from '@psebc/shared';
import { db, withTx } from '../../db/client';
import { documents, driverExclusions, drivers, members, rideInvites, type Driver } from '../../db/schema';
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

type DocSummary = { id: string; kind: string; filename: string; createdAt: Date };

const toDto = (d: Driver, docs: DocSummary[] = [], exclusions: { memberId: string; name: string }[] = []) => ({
  id: d.id,
  fullName: d.fullName,
  phone: d.phone,
  email: d.email,
  postcode: d.postcode,
  photoUrl: d.photoDocId ? `/api/documents/${d.photoDocId}` : null,
  dbsNumber: d.dbsNumber,
  dbsIssueDate: d.dbsIssueDate,
  dbsRenewalDate: d.dbsRenewalDate,
  insuranceExpiry: d.insuranceExpiry,
  vehicleMakeModel: d.vehicleMakeModel,
  vehicleColour: d.vehicleColour,
  vehicleReg: d.vehicleReg,
  passengerSeats: d.passengerSeats,
  vehicleCaps: d.vehicleCaps,
  helpCaps: d.helpCaps,
  status: d.status,
  approvedUntil: d.approvedUntil,
  decidedBy: d.decidedByName,
  decidedAt: d.decidedAt,
  decisionNotes: d.decisionNotes,
  loneWorkingAcknowledgedAt: d.loneWorkingAckAt,
  createdAt: d.createdAt,
  documents: docs.map((x) => ({ id: x.id, kind: x.kind, filename: x.filename, uploadedAt: x.createdAt, url: `/api/documents/${x.id}` })),
  exclusions,
});

/** Earliest of the check expiries — the default "approved until" on F03. */
const earliestExpiry = (d: Pick<Driver, 'dbsRenewalDate' | 'insuranceExpiry'>) => [d.dbsRenewalDate, d.insuranceExpiry].sort()[0]!;

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
    await db
      .update(drivers)
      .set({ loneWorkingAckAt: sql`now()`, updatedAt: sql`now()` })
      .where(and(eq(drivers.id, id), isNull(drivers.loneWorkingAckAt)));
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
    const rows = await db
      .select()
      .from(drivers)
      .where(DRIVER_STATUSES.includes(status as DriverStatus) ? eq(drivers.status, status as DriverStatus) : undefined)
      .orderBy(sql`CASE ${drivers.status} WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END`, asc(drivers.fullName));
    const soon = new Date(Date.now() + RULES.expiryReminderDays * 86_400_000).toISOString().slice(0, 10);
    const user = currentUser(req);
    res.json({
      drivers: rows.map((d) => ({
        id: d.id,
        fullName: d.fullName,
        postcode: user.role === 'coordinator' ? undefined : d.postcode,
        phone: d.phone,
        status: d.status,
        approvedUntil: d.approvedUntil,
        vehicle: `${d.vehicleColour} ${d.vehicleMakeModel}`,
        vehicleCaps: d.vehicleCaps,
        helpCaps: d.helpCaps,
        createdAt: d.createdAt,
        expiresOn: earliestExpiry(d),
        expiringSoon: d.status === 'approved' && earliestExpiry(d) <= soon,
        reapproval: d.status === 'pending' && !!d.decidedAt,
      })),
    });
  }),
);

/** F02 Driver registration (story 1.2 PSEBC-8, 1.6). Status starts as Pending. */
driversRouter.post(
  '/',
  requireRole('admin'),
  ah(async (req, res) => {
    const { submit, ...input } = parse(driverCreateSchema, req.body);
    const status = submit ? 'pending' : 'draft';
    const id = await withTx(async (tx) => {
      const [d] = await tx
        .insert(drivers)
        .values({ ...input, dbsRenewalDate: renewalDate(input), status, createdBy: currentUser(req).id })
        .returning({ id: drivers.id });
      await audit(actorFrom(req), { action: 'driver.create', entityType: 'driver', entityId: d!.id, details: { status } }, tx);
      if (status === 'pending') {
        await notifyRole(tx, ['safeguarding'], { kind: 'driver_pending', title: 'Driver waiting for approval', body: `${input.fullName} has been added and is waiting for your decision.`, link: `/safeguarding/approvals/${d!.id}` }, { email: true });
      }
      return d!.id;
    });
    flushSoon();
    res.status(201).json({ id, status });
  }),
);

driversRouter.get(
  '/:id',
  requireRole('admin', 'safeguarding'),
  ah(async (req, res) => {
    const id = uuidParam(req);
    const [d] = await db.select().from(drivers).where(eq(drivers.id, id));
    if (!d) throw notFound('Driver');
    const docs = await db
      .select({ id: documents.id, kind: documents.kind, filename: documents.filename, createdAt: documents.createdAt })
      .from(documents)
      .where(eq(documents.driverId, id))
      .orderBy(desc(documents.createdAt));
    const exclusions = await db
      .select({ memberId: driverExclusions.memberId, name: members.fullName })
      .from(driverExclusions)
      .innerJoin(members, eq(members.id, driverExclusions.memberId))
      .where(eq(driverExclusions.driverId, id));
    await audit(actorFrom(req), { action: 'driver.view', entityType: 'driver', entityId: id });
    res.json({ driver: toDto(d, latestPerKind(docs), exclusions), suggestedApprovedUntil: earliestExpiry(d) });
  }),
);

const REAPPROVAL_FIELDS = ['dbsNumber', 'dbsIssueDate', 'dbsRenewalDate', 'insuranceExpiry', 'vehicleMakeModel', 'vehicleReg', 'passengerSeats', 'vehicleCaps', 'helpCaps'] as const;

/** Edits by admin. A real change to checks, vehicle or help on an approved driver sends them back for re-approval. */
driversRouter.patch(
  '/:id',
  requireRole('admin'),
  ah(async (req, res) => {
    const id = uuidParam(req);
    const { submit, ...input } = parse(driverUpdateSchema, req.body);
    await withTx(async (tx) => {
      const [before] = await tx.select().from(drivers).where(eq(drivers.id, id)).for('update');
      if (!before || before.status === 'closed') throw notFound('Driver');
      const same = (a: unknown, b: unknown) => JSON.stringify(Array.isArray(a) ? [...a].sort() : a) === JSON.stringify(Array.isArray(b) ? [...b].sort() : b);
      const changes: Partial<typeof drivers.$inferInsert> = {};
      for (const [k, v] of Object.entries(input) as [keyof typeof input, unknown][]) {
        if (v === undefined || same(before[k], v)) continue;
        (changes as Record<string, unknown>)[k] = v;
      }
      if (changes.dbsIssueDate && !input.dbsRenewalDate) changes.dbsRenewalDate = renewalDate({ dbsIssueDate: changes.dbsIssueDate });
      const changed = Object.keys(changes);
      if (changed.length === 0 && !submit) return;

      let status = before.status;
      if ((status === 'approved' || status === 'expired') && changed.some((k) => (REAPPROVAL_FIELDS as readonly string[]).includes(k))) status = 'pending';
      if (status === 'draft' && submit) status = 'pending';
      await tx
        .update(drivers)
        .set({ ...changes, status, updatedAt: sql`now()` })
        .where(eq(drivers.id, id));
      await audit(actorFrom(req), { action: 'driver.update', entityType: 'driver', entityId: id, details: { fields: changed, status } }, tx);
      if (status === 'pending' && before.status !== 'pending') {
        await notifyRole(tx, ['safeguarding'], { kind: 'driver_pending', title: 'Driver waiting for approval', body: `${before.fullName}’s details changed and need your approval.`, link: `/safeguarding/approvals/${id}` }, { email: true });
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
    await withTx(async (tx) => {
      const [d] = await tx.select().from(drivers).where(eq(drivers.id, id)).for('update');
      if (!d) throw notFound('Driver');
      if (!['pending', 'approved', 'rejected', 'expired'].includes(d.status)) throw new AppError(409, 'bad_status', 'This driver can’t be decided on yet');
      if (input.decision === 'approved') {
        const limit = earliestExpiry(d);
        if (input.approvedUntil! > limit) throw badRequest(`Approval can’t run past the earliest check expiry (${limit})`, { fields: { approvedUntil: `Must be on or before ${limit}` } });
        if (limit < new Date().toISOString().slice(0, 10)) throw badRequest('A check has already expired. Update the driver’s checks first.');
        if (!d.licenceDocId || !d.insuranceDocId) throw badRequest('Upload the driving licence and insurance evidence before approving');
      }
      await tx
        .update(drivers)
        .set({
          status: input.decision,
          approvedUntil: input.decision === 'approved' ? input.approvedUntil! : null,
          decidedBy: user.id,
          decidedByName: user.fullName,
          decidedAt: sql`now()`,
          decisionNotes: input.notes,
          expiryRemindedFor: null,
          updatedAt: sql`now()`,
        })
        .where(eq(drivers.id, id));
      await tx.delete(driverExclusions).where(eq(driverExclusions.driverId, id));
      if (input.excludedMemberIds.length) {
        await tx
          .insert(driverExclusions)
          .values(input.excludedMemberIds.map((memberId) => ({ driverId: id, memberId, createdBy: user.id })))
          .onConflictDoNothing();
      }
      await audit(
        actorFrom(req),
        { action: `driver.${input.decision === 'approved' ? 'approve' : 'reject'}`, entityType: 'driver', entityId: id, details: { approvedUntil: input.approvedUntil, exclusions: input.excludedMemberIds.length, notes: input.notes } },
        tx,
      );
      if (input.decision === 'rejected') {
        await tx
          .update(rideInvites)
          .set({ status: 'withdrawn', respondedAt: sql`now()` })
          .where(and(eq(rideInvites.driverId, id), eq(rideInvites.status, 'sent')));
      }
      await notifyDriver(tx, id, {
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

const DOC_COLUMN = { photo: 'photoDocId', licence: 'licenceDocId', insurance: 'insuranceDocId' } as const;

/** Evidence upload (licence, insurance) and the photo shown to members. */
driversRouter.post(
  '/:id/documents/:kind',
  requireRole('admin'),
  upload.single('file'),
  ah(async (req, res) => {
    const id = uuidParam(req);
    const kind = req.params.kind as keyof typeof DOC_COLUMN;
    if (!(kind in DOC_COLUMN)) throw notFound('Document type');
    const file = req.file;
    if (!file) throw badRequest('Choose a PDF or photo under 5 MB');
    if (kind === 'photo' && !file.mimetype.startsWith('image/')) throw badRequest('The photo must be an image');
    const docId = await withTx(async (tx) => {
      const [exists] = await tx.select({ id: drivers.id }).from(drivers).where(eq(drivers.id, id));
      if (!exists) throw notFound('Driver');
      const [row] = await tx
        .insert(documents)
        .values({ driverId: id, kind, filename: file.originalname.slice(0, 120), mimeType: file.mimetype, sizeBytes: file.size, data: file.buffer, uploadedBy: currentUser(req).id })
        .returning({ id: documents.id });
      await tx
        .update(drivers)
        .set({ [DOC_COLUMN[kind]]: row!.id, updatedAt: sql`now()` })
        .where(eq(drivers.id, id));
      await audit(actorFrom(req), { action: 'document.upload', entityType: 'driver', entityId: id, details: { kind, documentId: row!.id } }, tx);
      return row!.id;
    });
    res.status(201).json({ id: docId, url: `/api/documents/${docId}` });
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
