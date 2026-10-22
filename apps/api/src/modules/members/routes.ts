import { Router } from 'express';
import { memberCreateSchema, memberDetailsUpdateSchema, memberNeedsUpdateSchema, closeAccountSchema } from '@psebc/shared';
import { withTx, query } from '../../db/pool';
import { ah, parse, uuidParam } from '../../lib/http';
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
    const rows = await searchMembers(String(req.query.q ?? ''));
    res.json({
      members: rows.map((r) => ({
        id: r.id,
        fullName: r.full_name,
        preferredName: r.preferred_name,
        town: r.town,
        postcode: r.postcode,
        phone: r.phone,
        consentGiven: r.consent_given,
        status: r.status,
      })),
    });
  }),
);

/** F01 Member registration (story 1.1 / PSEBC-7). */
membersRouter.post(
  '/',
  requireRole('admin', 'coordinator'),
  ah(async (req, res) => {
    const input = parse(memberCreateSchema, req.body);
    const user = currentUser(req);
    const consentAt = input.consent ? new Date() : null;
    const member = await withTx(async (db) => {
      const [row] = await query<{ id: string }>(
        `INSERT INTO members (
           full_name, preferred_name, address_line, town, postcode, finding_notes, phone,
           can_receive_sms, contact_method, booked_by,
           emergency_name, emergency_relationship, emergency_phone,
           has_representative, representative_name, representative_phone, representative_role,
           mobility_aids, help_needed, vehicle_requirement, notes_for_driver,
           health_enc, consent_given, consent_given_by, consent_recorded_at, consent_recorded_by, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
         RETURNING id`,
        [
          input.fullName,
          input.preferredName,
          input.addressLine,
          input.town,
          input.postcode,
          input.findingNotes,
          input.phone,
          input.canReceiveSms,
          input.contactMethod,
          input.bookedBy,
          input.emergencyName,
          input.emergencyRelationship,
          input.emergencyPhone,
          input.hasRepresentative,
          input.hasRepresentative && input.representativeSameAsEmergency ? input.emergencyName : input.representativeName,
          input.hasRepresentative && input.representativeSameAsEmergency ? input.emergencyPhone : input.representativePhone,
          input.hasRepresentative ? input.representativeRole : '',
          input.mobilityAids,
          input.helpNeeded,
          input.vehicleRequirement,
          input.notesForDriver,
          encryptJson({ flags: input.healthFlags, unwellInstructions: input.unwellInstructions }),
          input.consent,
          input.consent ? input.consentGivenBy : null,
          consentAt,
          input.consent ? user.id : null,
          user.id,
        ],
        db,
      );
      await audit(actorFrom(req), { action: 'member.create', entityType: 'member', entityId: row!.id, details: { consent: input.consent } }, db);
      if (input.consent) {
        await audit(actorFrom(req), { action: 'member.consent_recorded', entityType: 'member', entityId: row!.id, details: { by: input.consentGivenBy } }, db);
      }
      return row!;
    });
    res.status(201).json({ id: member.id });
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

/** Contact details (not needs) — office only. */
membersRouter.patch(
  '/:id',
  requireRole('admin', 'coordinator'),
  ah(async (req, res) => {
    const id = uuidParam(req);
    const input = parse(memberDetailsUpdateSchema, req.body);
    const columns: Record<string, string> = {
      fullName: 'full_name',
      preferredName: 'preferred_name',
      addressLine: 'address_line',
      town: 'town',
      postcode: 'postcode',
      findingNotes: 'finding_notes',
      phone: 'phone',
      canReceiveSms: 'can_receive_sms',
      contactMethod: 'contact_method',
      bookedBy: 'booked_by',
      emergencyName: 'emergency_name',
      emergencyRelationship: 'emergency_relationship',
      emergencyPhone: 'emergency_phone',
      hasRepresentative: 'has_representative',
      representativeName: 'representative_name',
      representativePhone: 'representative_phone',
      representativeRole: 'representative_role',
    };
    const sets: string[] = [];
    const values: unknown[] = [id];
    for (const [k, v] of Object.entries(input)) {
      const col = columns[k];
      if (!col || v === undefined) continue;
      values.push(v);
      sets.push(`${col} = $${values.length}`);
    }
    if (sets.length === 0) throw badRequest('Nothing to change');
    await withTx(async (db) => {
      const r = await db.query(`UPDATE members SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 AND status = 'active'`, values);
      if (r.rowCount === 0) throw notFound('Member');
      await audit(actorFrom(req), { action: 'member.update_details', entityType: 'member', entityId: id, details: { fields: Object.keys(input) } }, db);
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
    await withTx(async (db) => {
      const m = await getMember(id, db);
      if (!m || m.status !== 'active') throw notFound('Member');
      const before = health(m);
      const healthChanged =
        JSON.stringify([...before.flags].sort()) !== JSON.stringify([...input.healthFlags].sort()) ||
        before.unwellInstructions !== input.unwellInstructions;
      if (healthChanged && !input.consent) {
        throw badRequest('New health information needs fresh consent before it can be saved');
      }
      await db.query(
        `UPDATE members SET mobility_aids = $2, help_needed = $3, vehicle_requirement = $4, notes_for_driver = $5,
                health_enc = $6, consent_given = $7, consent_given_by = $8,
                consent_recorded_at = CASE WHEN $7 THEN now() ELSE NULL END,
                consent_recorded_by = CASE WHEN $7 THEN $9::uuid ELSE NULL END,
                needs_updated_at = now(), updated_at = now()
          WHERE id = $1`,
        [
          id,
          input.mobilityAids,
          input.helpNeeded,
          input.vehicleRequirement,
          input.notesForDriver,
          encryptJson({ flags: input.healthFlags, unwellInstructions: input.unwellInstructions }),
          input.consent,
          input.consent ? input.consentGivenBy : null,
          user.id,
        ],
      );
      await audit(
        actorFrom(req),
        {
          action: 'member.update_needs',
          entityType: 'member',
          entityId: id,
          details: { healthChanged, consent: input.consent, mobilityAids: input.mobilityAids, helpNeeded: input.helpNeeded, vehicleRequirement: input.vehicleRequirement },
        },
        db,
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
