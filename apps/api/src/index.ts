import { env } from './config/env';
import { createApp } from './app';
import { migrate } from './db/migrate';
import { closePool } from './db/pool';
import { logger } from './lib/logger';
import { startScheduler } from './jobs/scheduler';

async function main() {
  const config = env();
  await migrate((m) => logger.info(m));
  const server = createApp().listen(config.PORT, () => logger.info(`PSEBC Lifts API on :${config.PORT}`));
  if (config.RUN_SCHEDULER) startScheduler();

  const shutdown = () => {
    logger.info('shutting down');
    server.close(() => {
      closePool().finally(() => process.exit(0));
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});
