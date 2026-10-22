import express from 'express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config/env';
import { getPool } from './db/pool';
import { logger } from './lib/logger';
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
      await getPool().query('SELECT 1');
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  app.use('/api', loadUser);
  app.use('/api/auth', authRouter);
  app.use('/api/members', membersRouter);
  app.use('/api/drivers', driversRouter);
  app.use('/api/rides', ridesRouter);
  app.use('/api/concerns', concernsRouter);
  app.use('/api/safeguarding', signoffRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/documents', documentsRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/office', officeRouter);
  app.use('/api/jobs', jobsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
