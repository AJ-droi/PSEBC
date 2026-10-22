import cron from 'node-cron';
import { logger } from '../lib/logger';
import { flushOutbox } from '../services/notify';
import { runAll } from './tasks';

/** In-process scheduler. On serverless hosting, disable it and call POST /api/jobs/run from a cron instead. */
export function startScheduler(): void {
  cron.schedule('* * * * *', () => {
    flushOutbox().catch((err) => logger.warn({ err }, 'outbox flush failed'));
  });
  cron.schedule('*/10 * * * *', () => {
    runAll().catch((err) => logger.error({ err }, 'scheduled jobs failed'));
  });
  logger.info('scheduler started');
}
