import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate as drizzleMigrate } from 'drizzle-orm/node-postgres/migrator';
import { closeDb, getDb } from './client';

/** Apply pending Drizzle migrations (./drizzle). Runs on API start and via `npm run db:migrate`. */
export async function migrate(log: (m: string) => void = console.log): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const folder = [join(here, 'drizzle'), join(here, '../../drizzle'), join(here, '../drizzle')].find((d) => existsSync(join(d, 'meta')));
  if (!folder) throw new Error('drizzle migrations folder not found');
  await drizzleMigrate(getDb(), { migrationsFolder: folder });
  log('migrations up to date');
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  migrate()
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => closeDb());
}
