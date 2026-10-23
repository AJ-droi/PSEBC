import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { env } from '../config/env';
import * as schema from './schema';

// Return DATE columns as 'YYYY-MM-DD' strings, counts as numbers.
pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));

export type Db = NodePgDatabase<typeof schema> & { $client: pg.Pool };
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** Anything that can run a query: the database or an open transaction. */
export type Executor = Db | Tx;

let pool: pg.Pool | null = null;
let instance: Db | null = null;

/** The Drizzle client (created on first use so env is read after it is loaded). */
export function getDb(): Db {
  if (!instance) {
    const url = env().DATABASE_URL;
    const isLocal = /localhost|127\.0\.0\.1/.test(url);
    pool = new pg.Pool({
      connectionString: url,
      // Neon requires TLS; local Postgres usually has none.
      ssl: isLocal ? undefined : { rejectUnauthorized: true },
      max: 10,
      idleTimeoutMillis: 30_000,
    });
    instance = drizzle(pool, { schema });
  }
  return instance;
}

/** Proxy so modules can `import { db }` and still get lazy creation. */
export const db = new Proxy({} as Db, {
  get: (_t, prop) => Reflect.get(getDb() as object, prop, getDb()),
});

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    instance = null;
  }
}

/** Run fn in a transaction; Drizzle rolls back if it throws. */
export function withTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return getDb().transaction(fn);
}
