import { Router } from 'express';
import { and, eq, sql } from 'drizzle-orm';
import { memberCreateSchema, memberDetailsUpdateSchema, memberNeedsUpdateSchema, closeAccountSchema } from '@psebc/shared';
import { withTx } from '../../db/client';
import { members } from '../../db/schema';
import { ah, parse, uuidParam } from '../../lib/http';
import { pageFrom } from '../../lib/pagination';
import { forbidden, notFound, badRequest } from '../../lib/errors';
import { encryptJson } from '../../lib/crypto';
import { requireAuth, requireRole, currentUser } from '../../middleware/auth';
import { actorFrom, audit } from '../../services/audit';
import { flushSoon } from '../../services/notify';
import { getMember, health, searchMembers, toMemberDto } from './repo';
import { closeMemberAccount } from '../admin/accounts';

export const membersRouter = Router();

/** Office search — church office books for members who don't use the app (story 2.2). */
membersRouter.get(
  '/',
  requireRole('coordinator', 'admin', 'safeguarding'),
  ah(async (req, res) => {
    const page = pageFrom(req);
    const { rows, total } = await searchMembers(String(req.query.q ?? ''), page);
    res.json({ members: rows, pagination: page.meta(total) });
  }),
);

/** F01 Member registration (story 1.1 / PSEBC-7). */
membersRouter.post(
  '/',
  requireRole('admin', 'coordinator'),
  ah(async (req, res) => {
    const input = parse(memberCreateSchema, req.body);
    const user = currentUser(req);
    const sameRep = input.hasRepresentative && input.representativeSameAsEmergency;
    const id = await withTx(async (tx) => {
      const [row] = await tx
        .insert(members)
        .values({
          fullName: input.fullName,
          preferredName: input.preferredName,
          addressLine: input.addressLine,
          town: input.town,
          postcode: input.postcode,
          findingNotes: input.findingNotes,
          phone: input.phone,
          canReceiveSms: input.canReceiveSms,
          contactMethod: input.contactMethod,
          bookedBy: input.bookedBy,
          emergencyName: input.emergencyName,
          emergencyRelationship: input.emergencyRelationship,
          emergencyPhone: input.emergencyPhone,
          hasRepresentative: input.hasRepresentative,
          representativeName: sameRep ? input.emergencyName : input.representativeName,
          representativePhone: sameRep ? input.emergencyPhone : input.representativePhone,
          representativeRole: input.hasRepresentative ? input.representativeRole : '',
          mobilityAids: input.mobilityAids,
          helpNeeded: input.helpNeeded,
          vehicleRequirement: input.vehicleRequirement,
          notesForDriver: input.notesForDriver,
          healthEnc: encryptJson({ flags: input.healthFlags, unwellInstructions: input.unwellInstructions }),
          consentGiven: input.consent,
          consentGivenBy: input.consent ? input.consentGivenBy : null,
          consentRecordedAt: input.consent ? new Date() : null,
          consentRecordedBy: input.consent ? user.id : null,
          createdBy: user.id,
        })
        .returning({ id: members.id });
      await audit(actorFrom(req), { action: 'member.create', entityType: 'member', entityId: row!.id, details: { consent: input.consent } }, tx);
      if (input.consent) {
        await audit(actorFrom(req), { action: 'member.consent_recorded', entityType: 'member', entityId: row!.id, details: { by: input.consentGivenBy } }, tx);
      }
      return row!.id;
    });
    res.status(201).json({ id });
  }),
);

/** Read a profile. Every view of needs is audited (PRD §9). */
membersRouter.get(
  '/:id',
  requireAuth,
  ah(async (req, res) => {
    const id = uuidParam(req);
    const user = currentUser(req);
    const isSelf = user.role === 'member' && user.memberId === id;
    const isOffice = ['coordinator', 'admin', 'safeguarding'].includes(user.role);
    if (!isSelf && !isOffice) throw forbidden();
    const m = await getMember(id);
    if (!m) throw notFound('Member');
    await audit(actorFrom(req), { action: 'member.view_needs', entityType: 'member', entityId: id });
    res.json({ member: toMemberDto(m, { includeHealth: true }) });
  }),
);

/** Contact details (not needs) — office only. Zod has already limited the keys to editable fields. */
membersRouter.patch(
  '/:id',
  requireRole('admin', 'coordinator'),
  ah(async (req, res) => {
    const id = uuidParam(req);
    const input = parse(memberDetailsUpdateSchema, req.body);
    const changes = Object.fromEntries(Object.entries(input).filter(([k, v]) => v !== undefined && k !== 'representativeSameAsEmergency'));
    if (Object.keys(changes).length === 0) throw badRequest('Nothing to change');
    await withTx(async (tx) => {
      const updated = await tx
        .update(members)
        .set({ ...changes, updatedAt: sql`now()` })
        .where(and(eq(members.id, id), eq(members.status, 'active')))
        .returning({ id: members.id });
      if (updated.length === 0) throw notFound('Member');
      await audit(actorFrom(req), { action: 'member.update_details', entityType: 'member', entityId: id, details: { fields: Object.keys(changes) } }, tx);
    });
    res.json({ ok: true });
  }),
);

/**
 * F12 Update member needs (story 1.7). New or changed health information needs fresh consent;
 * if consent is withdrawn the profile can't be used for bookings until it is recorded again.
 */
membersRouter.put(
  '/:id/needs',
  requireRole('admin', 'coordinator'),
  ah(async (req, res) => {
    const id = uuidParam(req);
    const input = parse(memberNeedsUpdateSchema, req.body);
    const user = currentUser(req);
    await withTx(async (tx) => {
      const m = await getMember(id, tx);
      if (!m || m.status !== 'active') throw notFound('Member');
      const before = health(m);
      const healthChanged =
        JSON.stringify([...before.flags].sort()) !== JSON.stringify([...input.healthFlags].sort()) || before.unwellInstructions !== input.unwellInstructions;
      if (healthChanged && !input.consent) throw badRequest('New health information needs fresh consent before it can be saved');
      await tx
        .update(members)
        .set({
          mobilityAids: input.mobilityAids,
          helpNeeded: input.helpNeeded,
          vehicleRequirement: input.vehicleRequirement,
          notesForDriver: input.notesForDriver,
          healthEnc: encryptJson({ flags: input.healthFlags, unwellInstructions: input.unwellInstructions }),
          consentGiven: input.consent,
          consentGivenBy: input.consent ? input.consentGivenBy : null,
          consentRecordedAt: input.consent ? new Date() : null,
          consentRecordedBy: input.consent ? user.id : null,
          needsUpdatedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(eq(members.id, id));
      await audit(
        actorFrom(req),
        {
          action: 'member.update_needs',
          entityType: 'member',
          entityId: id,
          details: { healthChanged, consent: input.consent, mobilityAids: input.mobilityAids, helpNeeded: input.helpNeeded, vehicleRequirement: input.vehicleRequirement },
        },
        tx,
      );
    });
    res.json({ ok: true });
  }),
);

/** F13 Close an account (story 1.5). */
membersRouter.post(
  '/:id/close',
  requireRole('admin'),
  ah(async (req, res) => {
    const id = uuidParam(req);
    const { reason } = parse(closeAccountSchema, req.body);
    const result = await closeMemberAccount(id, actorFrom(req), currentUser(req).id, reason);
    flushSoon();
    res.json(result);
  }),
);
