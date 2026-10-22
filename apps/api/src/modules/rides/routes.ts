import { Router } from 'express';
import {
  declineSchema,
  driverLogSchema,
  memberLogSchema,
  rideCancelSchema,
  rideRebookSchema,
  rideRequestSchema,
  tripProgressSchema,
} from '@psebc/shared';
import { z } from 'zod';
import { ah, parse, uuidParam } from '../../lib/http';
import { forbidden } from '../../lib/errors';
import { currentUser, requireAuth, requireRole } from '../../middleware/auth';
import { actorFrom } from '../../services/audit';
import { flushSoon } from '../../services/notify';
import * as svc from './service';
import { memberRides, rideView } from './views';

export const ridesRouter = Router();

/** Member home "Your lifts" (and the office looking at one member). */
ridesRouter.get(
  '/',
  requireAuth,
  ah(async (req, res) => {
    const user = currentUser(req);
    const memberId = user.role === 'member' ? user.memberId : String(req.query.memberId ?? '');
    if (!memberId) throw forbidden();
    svc.assertCanActForMember(user, memberId);
    res.json(await memberRides(memberId));
  }),
);

ridesRouter.post(
  '/',
  requireRole('member', 'coordinator', 'admin'),
  ah(async (req, res) => {
    const input = parse(rideRequestSchema, req.body);
    const result = await svc.requestRide(currentUser(req), actorFrom(req), input);
    flushSoon();
    res.status(201).json(result);
  }),
);

ridesRouter.get(
  '/:id',
  requireAuth,
  ah(async (req, res) => {
    res.json(await rideView(currentUser(req), actorFrom(req), uuidParam(req)));
  }),
);

ridesRouter.post(
  '/:id/cancel',
  requireRole('member', 'coordinator', 'admin'),
  ah(async (req, res) => {
    const input = parse(rideCancelSchema, req.body);
    const result = await svc.cancelRide(currentUser(req), actorFrom(req), uuidParam(req), input.reason, input.part, input.note);
    flushSoon();
    res.json(result);
  }),
);

ridesRouter.post(
  '/:id/rebook',
  requireRole('member', 'coordinator', 'admin'),
  ah(async (req, res) => {
    const input = parse(rideRebookSchema, req.body);
    const result = await svc.rebookRide(currentUser(req), actorFrom(req), uuidParam(req), input.pickupAt, input.returnAt);
    flushSoon();
    res.status(201).json(result);
  }),
);

ridesRouter.post(
  '/:id/resend-invites',
  requireRole('coordinator', 'admin'),
  ah(async (req, res) => {
    const result = await svc.resendInvites(actorFrom(req), uuidParam(req));
    flushSoon();
    res.json(result);
  }),
);

// ---- Driver actions -------------------------------------------------------

ridesRouter.post(
  '/:id/accept',
  requireRole('driver'),
  ah(async (req, res) => {
    const result = await svc.acceptInvite(currentUser(req), actorFrom(req), uuidParam(req));
    flushSoon();
    res.json(result);
  }),
);

ridesRouter.post(
  '/:id/decline',
  requireRole('driver'),
  ah(async (req, res) => {
    const input = parse(declineSchema, req.body);
    const result = await svc.declineInvite(currentUser(req), actorFrom(req), uuidParam(req), input.reason, input.note);
    flushSoon();
    res.json(result);
  }),
);

ridesRouter.post(
  '/:id/withdraw',
  requireRole('driver'),
  ah(async (req, res) => {
    const { note } = parse(z.object({ note: z.string().max(300).default('') }), req.body);
    const result = await svc.driverWithdraw(currentUser(req), actorFrom(req), uuidParam(req), note);
    flushSoon();
    res.json(result);
  }),
);

ridesRouter.post(
  '/:id/progress',
  requireRole('driver'),
  ah(async (req, res) => {
    const { event } = parse(tripProgressSchema, req.body);
    const result = await svc.recordProgress(currentUser(req), actorFrom(req), uuidParam(req), event);
    flushSoon();
    res.json(result);
  }),
);

ridesRouter.post(
  '/:id/logs/driver',
  requireRole('driver'),
  ah(async (req, res) => {
    const input = parse(driverLogSchema, req.body);
    res.status(201).json(await svc.submitDriverLog(currentUser(req), actorFrom(req), uuidParam(req), input));
    flushSoon();
  }),
);

ridesRouter.post(
  '/:id/logs/member',
  requireRole('member', 'coordinator', 'admin'),
  ah(async (req, res) => {
    const input = parse(memberLogSchema, req.body);
    res.status(201).json(await svc.submitMemberLog(currentUser(req), actorFrom(req), uuidParam(req), input));
    flushSoon();
  }),
);
