import express from 'express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { pinoHttp } from 'pino-http';
import { env } from './config/env';
import { sql } from 'drizzle-orm';
import { db } from './db/client';
import { logger } from './lib/logger';
import { release, requireFeature } from './lib/release';
import { errorHandler, notFoundHandler } from './middleware/error';
import { loadUser } from './middleware/auth';
import { authRouter } from './modules/auth/routes';
import { membersRouter } from './modules/members/routes';
import { driversRouter } from './modules/drivers/routes';
import { ridesRouter } from './modules/rides/routes';
import { concernsRouter } from './modules/concerns/routes';
import { signoffRouter } from './modules/signoff/routes';
import { reportsRouter } from './modules/reports/routes';
import { notificationsRouter } from './modules/notifications/routes';
import { documentsRouter } from './modules/documents/routes';
import { adminRouter } from './modules/admin/routes';
import { officeRouter } from './modules/office/routes';
import { jobsRouter } from './jobs/routes';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet());
  app.use(cors({ origin: env().WEB_ORIGIN.split(','), credentials: true }));
  app.use(compression());
  app.use(express.json({ limit: '200kb' }));
  app.use(cookieParser());
  if (env().NODE_ENV !== 'test') app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/api/health' } }));

  // Personal data must not sit in shared caches.
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.get('/api/health', async (_req, res) => {
    try {
      await db.execute(sql`SELECT 1`);
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  // Which epics this deployment has switched on, so the web app can hide what isn't live. Public, no personal data.
  app.get('/api/release', (_req, res) => {
    res.json(release());
  });

  app.use('/api', loadUser);
  // Fair-use limit per signed-in person (or per IP when signed out): stops a stuck tab or
  // a script from flooding the API. Generous for normal use — screens poll every 20–60 s.
  app.use(
    '/api',
    rateLimit({
      windowMs: 60_000,
      limit: (req) => (req.user ? 300 : 60),
      keyGenerator: (req) => req.user?.id ?? `ip:${req.ip}`,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      skip: () => env().NODE_ENV === 'test',
      message: { error: { code: 'rate_limited', message: 'Too many requests. Please wait a moment and try again.' } },
    }),
  );
  app.use('/api/auth', authRouter);
  app.use('/api/members', membersRouter);
  app.use('/api/drivers', driversRouter);
  app.use('/api/rides', ridesRouter);
  app.use('/api/concerns', requireFeature('tripLogging'), concernsRouter); // Epic 5 (5.2/5.3)
  app.use('/api/safeguarding', requireFeature('signOff'), signoffRouter); // Epic 6
  app.use('/api/reports', requireFeature('reports'), reportsRouter); // Epic 7
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/documents', documentsRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/office', officeRouter);
  app.use('/api/jobs', jobsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
