#!/usr/bin/env node
/**
 * Runs the API and the web app together, for hosting both on ONE service (e.g. a single free Render web service).
 *
 *   npm run build && npm start
 *
 * - The web app listens on $PORT (set by the host; 3000 locally).
 * - The API listens on a private port taken from API_URL (default http://localhost:4000) — the same
 *   address the web app's /api proxy was built with, so the two always agree.
 * - If either stops, the other is stopped and this exits non-zero, so the host restarts the whole service
 *   rather than leaving it half-running. SIGTERM/SIGINT from the host are passed on for a clean shutdown.
 *
 * For two separate services (render.yaml Blueprint), use `npm start -w @psebc/api` and `npm start -w @psebc/web`.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fail = (msg) => {
  console.error(`start-all: ${msg}`);
  process.exit(1);
};

const webPort = process.env.PORT || '3000';
const apiUrl = new URL(process.env.API_URL || 'http://localhost:4000');
if (!['localhost', '127.0.0.1'].includes(apiUrl.hostname)) {
  fail(`API_URL is ${apiUrl.origin}. When both apps run in one service it must be a localhost address, e.g. http://localhost:4000`);
}
const apiPort = apiUrl.port || '80';
if (apiPort === webPort) {
  fail(`the web app (PORT=${webPort}) and the API (from API_URL) would both use port ${webPort}. Remove the PORT setting or change API_URL, then rebuild.`);
}

// Run node directly (not via npm) so the free instance's memory goes to the apps, not to extra npm processes.
const nextBin = createRequire(join(root, 'apps/web/package.json')).resolve('next/dist/bin/next');
const apps = [
  { name: 'api', cwd: join(root, 'apps/api'), args: ['dist/index.js'], env: { PORT: apiPort } },
  { name: 'web', cwd: join(root, 'apps/web'), args: [nextBin, 'start', '-p', webPort], env: { PORT: webPort } },
];

console.log(`start-all: web on :${webPort}, API on :${apiPort}`);
let stopping = false;
const children = apps.map((app) => {
  const child = spawn(process.execPath, app.args, { cwd: app.cwd, env: { ...process.env, ...app.env }, stdio: 'inherit' });
  child.on('exit', (code, signal) => {
    if (stopping) return;
    console.error(`start-all: ${app.name} stopped (${signal ?? `exit ${code}`}); stopping the other app too.`);
    shutdown('SIGTERM', 1);
  });
  return child;
});

function shutdown(signal, exitCode) {
  stopping = true;
  for (const c of children) if (c.exitCode === null && c.signalCode === null) c.kill(signal);
  // Give them a moment to close connections, then go.
  setTimeout(() => process.exit(exitCode), 5000).unref();
  Promise.all(children.map((c) => (c.exitCode !== null || c.signalCode !== null ? null : new Promise((r) => c.once('exit', r))))).then(() => process.exit(exitCode));
}
process.on('SIGTERM', () => shutdown('SIGTERM', 0));
process.on('SIGINT', () => shutdown('SIGINT', 0));
