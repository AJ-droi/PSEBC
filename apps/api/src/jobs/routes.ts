import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { env } from '../config/env';
import { ah } from '../lib/http';
import { forbidden } from '../lib/errors';
import { runAll } from './tasks';

export const jobsRouter = Router();

/** For hosts without a long-running process: an external cron calls this with the shared secret. */
jobsRouter.post(
  '/run',
  ah(async (req, res) => {
    const secret = env().JOBS_SECRET;
    const given = String(req.headers['x-jobs-secret'] ?? '');
    if (!secret || given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) throw forbidden();
    res.json(await runAll());
  }),
);
