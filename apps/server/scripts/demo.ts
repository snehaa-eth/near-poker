/**
 * One-command demo: starts a throwaway game server (in-memory DB, no chain, no keys),
 * seats 6 bots, plays HANDS hands, verifies every hand's commit–reveal deck independently,
 * then shuts everything down. Exit code 0 only if every hand verified.
 *
 *   pnpm demo                 # from the repo root (20 hands)
 *   HANDS=50 pnpm demo
 *   NEARAI_API_KEY=… AI=1 pnpm demo   # bots think with NEAR AI Cloud (TEE) instead of rules
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = join(HERE, '..');
const PORT = process.env.DEMO_PORT ?? '4199';
const API = `http://localhost:${PORT}`;

async function waitForServer(timeoutMs = 120_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      await fetch(API);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`server did not start on ${API}`);
}

async function main() {
  console.log(`▶ starting a local game server on ${API} (in-memory DB, no chain)…`);
  const env = { ...process.env, PORT, MONGODB_URI: 'memory', CORS_ORIGIN: 'http://localhost:3000' };
  delete env.CHAIN; // the demo never touches a blockchain
  const server = spawn('npx', ['tsx', 'src/index.ts'], { cwd: SERVER_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let serverLog = '';
  server.stdout.on('data', (d) => (serverLog += d));
  server.stderr.on('data', (d) => (serverLog += d));

  const stop = () => {
    if (!server.killed) server.kill('SIGTERM');
  };
  process.on('SIGINT', () => {
    stop();
    process.exit(130);
  });

  try {
    await waitForServer();
    const bots = spawn('npx', ['tsx', 'scripts/bots-6.ts'], {
      cwd: SERVER_DIR,
      stdio: 'inherit',
      env: {
        ...process.env,
        API_URL: API,
        HANDS: process.env.HANDS ?? '20',
        STEP_MS: process.env.STEP_MS ?? '20',
        START_DELAY_MS: '0',
        ...(process.env.NEARAI_API_KEY && process.env.AI === '1' ? {} : { FAST: '1' }),
      },
    });
    const code: number = await new Promise((r) => bots.on('exit', (c) => r(c ?? 1)));
    stop();
    if (code !== 0) {
      console.error(`\n✗ demo failed (bots exit ${code}). Last server output:\n${serverLog.slice(-2000)}`);
    }
    process.exit(code);
  } catch (e) {
    stop();
    console.error('✗', e instanceof Error ? e.message : e, `\n${serverLog.slice(-2000)}`);
    process.exit(1);
  }
}

void main();
