/**
 * Throwaway local stack for the browser e2e test. Everything is free and offline:
 *
 *   mock NEAR AI  agent-starter/test/run-mock.ts   (stand-in for NEAR AI Cloud, API key `test-key`)
 *   game server   apps/server/src/index.ts  :4310  (MONGODB_URI=memory, CHAIN unset → MemoryLedger,
 *                                                  ARENA_TEST_MODE=1 → no RPC access-key lookup at login)
 *   web app       apps/www `next dev`        :3310  (NEXT_DIST_DIR=.next-e2e, so it never touches
 *                                                  the .next of a dev server already running on :3000)
 *   agents        agent-starter/src/index.ts play  × 3, throwaway ed25519 keys, off-chain chips
 *
 * Children get an explicit, minimal environment (no .env files are loaded), so no real key or
 * chain setting can leak in.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const ROOT = resolve(__dirname, '..');
export const API_PORT = Number(process.env.E2E_API_PORT ?? 4310);
export const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3310);
export const API = `http://localhost:${API_PORT}`;
export const WEB = `http://localhost:${WEB_PORT}`;
export const LOG_DIR = join(ROOT, 'e2e', '.logs');
export const STATE_FILE = join(LOG_DIR, 'stack.json');
/** Time between arena hands: long enough for the browser to see the end-of-hand state. */
export const HAND_GAP_MS = 4000;

export type StackState = { mockUrl: string; pids: number[] };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Minimal env for children: nothing from the caller's shell except what node/tsx need. */
export function baseEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const keep = ['PATH', 'HOME', 'TMPDIR', 'LANG', 'USER', 'SHELL'];
  const env: NodeJS.ProcessEnv = {};
  for (const k of keep) if (process.env[k]) env[k] = process.env[k];
  return { ...env, ...extra };
}

/** Spawn in its own process group (so `next dev` workers die with it), logging to e2e/.logs/<name>.log. */
export function start(name: string, cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): ChildProcess {
  mkdirSync(LOG_DIR, { recursive: true });
  const log = createWriteStream(join(LOG_DIR, `${name}.log`));
  const child = spawn(cmd, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout!.pipe(log);
  child.stderr!.pipe(log);
  return child;
}

export async function killGroup(pid: number | undefined, graceMs = 5000) {
  if (!pid) return;
  const alive = () => {
    try {
      process.kill(-pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    return;
  }
  const end = Date.now() + graceMs;
  while (alive() && Date.now() < end) await sleep(100);
  if (alive()) {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      /* gone */
    }
  }
}

export async function waitFor(what: string, fn: () => Promise<boolean>, timeoutMs: number, child?: ChildProcess) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (child && child.exitCode !== null) throw new Error(`${what}: process exited with ${child.exitCode} (see e2e/.logs)`);
    try {
      if (await fn()) return;
    } catch {
      /* not yet */
    }
    await sleep(300);
  }
  throw new Error(`timed out waiting for ${what} (see e2e/.logs)`);
}

export async function portFree(port: number) {
  try {
    await fetch(`http://localhost:${port}`, { signal: AbortSignal.timeout(1000) });
    return false;
  } catch {
    return true;
  }
}

const tsx = (dir: string) => join(ROOT, dir, 'node_modules', '.bin', 'tsx');

export async function startMock(): Promise<{ child: ChildProcess; url: string }> {
  const file = join(LOG_DIR, 'mock-url.txt');
  mkdirSync(LOG_DIR, { recursive: true });
  rmSync(file, { force: true });
  const child = start('mock-nearai', tsx('agent-starter'), ['test/run-mock.ts', file], join(ROOT, 'agent-starter'), baseEnv({}));
  await waitFor('mock NEAR AI', async () => existsSync(file) && readFileSync(file, 'utf8').startsWith('http'), 30_000, child);
  return { child, url: readFileSync(file, 'utf8').trim() };
}

export async function startServer(mockUrl: string): Promise<ChildProcess> {
  const child = start(
    'server',
    tsx('apps/server'),
    ['src/index.ts'],
    join(ROOT, 'apps/server'),
    baseEnv({
      PORT: String(API_PORT),
      MONGODB_URI: 'memory',
      CORS_ORIGIN: WEB,
      NEARAI_API_KEY: 'test-key',
      NEARAI_BASE_URL: mockUrl,
      ARENA_TEST_MODE: '1',
      ARENA_FILL_MS: '2000',
      ARENA_HAND_GAP_MS: String(HAND_GAP_MS),
      ARENA_TURN_MS: '15000',
    }),
  );
  await waitFor('game server', async () => (await fetch(`${API}/health`)).ok, 90_000, child);
  return child;
}

export async function startWeb(): Promise<ChildProcess> {
  const child = start(
    'web',
    join(ROOT, 'apps/www/node_modules/.bin/next'),
    ['dev', '-p', String(WEB_PORT)],
    join(ROOT, 'apps/www'),
    baseEnv({
      NEXT_PUBLIC_API_URL: API,
      NEXT_PUBLIC_WS_URL: API,
      NEXT_PUBLIC_NEAR_NETWORK: 'testnet',
      NEXT_DIST_DIR: '.next-e2e',
      NEXT_TELEMETRY_DISABLED: '1',
    }),
  );
  await waitFor('web app', async () => (await fetch(WEB)).status < 500, 150_000, child);
  // Compile the pages the test visits up front so it doesn't wait on next dev.
  for (const path of ['/arena', '/leaderboard', '/game/warmup', '/verify/warmup']) {
    await fetch(`${WEB}${path}`, { signal: AbortSignal.timeout(120_000) }).catch(() => undefined);
  }
  return child;
}

// ─── agents ─────────────────────────────────────────────────────────────────

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58(buf: Buffer): string {
  let n = BigInt(`0x${buf.toString('hex') || '0'}`);
  let s = '';
  while (n > 0n) {
    s = B58[Number(n % 58n)] + s;
    n /= 58n;
  }
  for (const b of buf) {
    if (b !== 0) break;
    s = `1${s}`;
  }
  return s;
}

/** Throwaway NEAR-style ed25519 key: "ed25519:<base58(seed ‖ pub)>". Never funded, never on chain. */
export function throwawayKey(): string {
  const { privateKey } = generateKeyPairSync('ed25519');
  const jwk = privateKey.export({ format: 'jwk' });
  const seed = Buffer.from(jwk.d!, 'base64url');
  const pub = Buffer.from(jwk.x!, 'base64url');
  return `ed25519:${base58(Buffer.concat([seed, pub]))}`;
}

export type TestAgent = { account: string; nickname: string; key: string; child?: ChildProcess };

export function makeAgents(nicknames: string[]): TestAgent[] {
  const run = randomBytes(3).toString('hex');
  return nicknames.map((nickname, i) => ({
    account: `e2e-${run}-${i}.testnet`,
    nickname,
    key: throwawayKey(),
  }));
}

/**
 * Off-chain chips (CHAIN unset): create the account's profile and credit 1000 chips via
 * /treasury/deposit, exactly like the server's demo bots. The agent's own NEP-413 login then
 * lands on this same session (sessions are keyed by NEAR account id).
 */
export async function fundAgent(agent: TestAgent) {
  const prof = await fetch(`${API}/auth/profile`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ walletAddress: agent.account, nickname: agent.nickname }),
  });
  if (!prof.ok) throw new Error(`profile ${agent.account}: ${prof.status} ${await prof.text()}`);
  const cookie = prof.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  const dep = await fetch(`${API}/treasury/deposit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ nearAmount: 1 }),
  });
  if (!dep.ok) throw new Error(`deposit ${agent.account}: ${dep.status} ${await dep.text()}`);
}

/** The real starter kit CLI (`npm start` = tsx src/index.ts play) against the mock NEAR AI. */
export function startAgent(agent: TestAgent, mockUrl: string): ChildProcess {
  agent.child = start(
    `agent-${agent.nickname}`,
    tsx('agent-starter'),
    ['src/index.ts', 'play'],
    join(ROOT, 'agent-starter'),
    baseEnv({
      AGENT_ACCOUNT: agent.account,
      AGENT_PRIVATE_KEY: agent.key,
      AGENT_NICKNAME: agent.nickname,
      GAME_SERVER: API,
      NEARAI_API_KEY: 'test-key',
      NEARAI_BASE_URL: mockUrl,
      MAX_LLM_CALLS: '500',
    }),
  );
  return agent.child;
}

/** Ctrl-C the agent: like a user pressing Ctrl-C, it POSTs /arena/leave and leaves after the hand. */
export function interruptAgent(agent: TestAgent) {
  const pid = agent.child?.pid;
  if (!pid || agent.child!.exitCode !== null) return;
  try {
    process.kill(pid, 'SIGINT'); // the tsx parent relays it to the agent process
  } catch {
    /* already gone */
  }
}
