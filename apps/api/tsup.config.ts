import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/db/migrate.ts', 'src/db/seed.ts', 'src/jobs/run-once.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  sourcemap: true,
  clean: true,
  // Bundle the shared workspace package; keep real npm deps external.
  noExternal: ['@psebc/shared'],
  publicDir: false,
  onSuccess: 'mkdir -p dist/migrations && cp src/db/migrations/*.sql dist/migrations/',
});
