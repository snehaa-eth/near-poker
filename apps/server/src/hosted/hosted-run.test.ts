/**
 * Hosted agents end to end, fully offline: in-process game server (in-memory Mongo, MemoryLedger,
 * ARENA_TEST_MODE=1, CHAIN unset) + the agent-starter mock of NEAR AI Cloud as a child process.
 * Agents are created over HTTP, then run by the runner as real `tsx agent-starter/src/index.ts play`
 * children and play hands. No paid API, no testnet.
 */
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

import { REPO_ROOT } from './config.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor<T>(what: string, fn: () => Promise<T | undefined | null | false>, timeoutMs: number): Promise<T> {
  const end = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < end) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) {
      last = e;
    }
    await sleep(300);
  }
  throw new Error(`timeout waiting for ${what}${last ? ` (${(last as Error).message})` : ''}`);
}

let mongod: MongoMemoryServer;
let server: Server;
let mock: ChildProcess;
let API = '';
const tmp = mkdtempSync(join(tmpdir(), 'hosted-run-'));

async function call(path: string, init: { method?: string; body?: unknown; token?: string } = {}) {
  const res = await fetch(`${API}${path}`, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers: { 'content-type': 'application/json', ...(init.token ? { 'x-owner-token': init.token } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const ct = res.headers.get('content-type') ?? '';
  return { status: res.status, json: ct.includes('json') ? ((await res.json()) as any) : null, res };
}

before(async () => {
  const urlFile = join(tmp, 'mock-url');
  mock = spawn(join(REPO_ROOT, 'agent-starter/node_modules/.bin/tsx'), ['test/run-mock.ts', urlFile], {
    cwd: join(REPO_ROOT, 'agent-starter'),
    stdio: 'ignore',
    detached: true,
  });
  await waitFor('mock NEAR AI', async () => existsSync(urlFile) && readFileSync(urlFile, 'utf8').startsWith('http'), 30_000);
  const mockUrl = readFileSync(urlFile, 'utf8').trim();

  delete process.env.CHAIN;
  Object.assign(process.env, {
    NEARAI_API_KEY: 'test-key',
    NEARAI_BASE_URL: mockUrl,
    ARENA_TEST_MODE: '1',
    ARENA_MIN_AGENTS: '2',
    ARENA_FILL_MS: '300',
    ARENA_HAND_GAP_MS: '200',
    ARENA_TURN_MS: '20000',
    ENTROPY_TIMEOUT_MS: '1500',
    HOSTED_SECRET: randomBytes(32).toString('hex'),
    HOSTED_RATE_PER_HOUR: '3',
    HOSTED_RESUME: '0',
  });
  mongod = await MongoMemoryServer.create();
  const { connectMongo } = await import('../db.js');
  await connectMongo(mongod.getUri('hosted-run'));
  const { createAppServer } = await import('../app.js');
  ({ server } = createAppServer('http://localhost:3000'));
  await new Promise<void>((r) => server.listen(0, r));
  API = `http://localhost:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  const { killAll } = await import('./runner.js');
  killAll();
  try {
    process.kill(-mock.pid!, 'SIGKILL');
  } catch {
    /* gone */
  }
  (await import('../arena/lobby.js')).resetArenaLobby();
  (await import('../arena/turns.js')).resetTurns();
  await new Promise((r) => server.close(r));
  await mongoose.disconnect();
  await mongod.stop();
  rmSync(tmp, { recursive: true, force: true });
});

describe('hosted agents (off-chain test path)', () => {
  const base = { persona: 'shark', nearAiKey: 'test-key' };
  const owners: Record<string, { id: string; token: string; wallet: string }> = {};

  it('config says enabled in ARENA_TEST_MODE', async () => {
    const r = await call('/hosted-agents/config');
    assert.equal(r.status, 200);
    assert.equal(r.json.enabled, true);
    assert.equal(r.json.chain, 'local');
    assert.ok(r.json.personas.some((p: { id: string }) => p.id === 'calculator'));
  });

  it('validates input (name, persona, custom text, key, non-TEE model)', async () => {
    assert.equal((await call('/hosted-agents', { body: { ...base, name: 'A b' } })).status, 400);
    assert.equal((await call('/hosted-agents', { body: { ...base, name: 'okname', persona: 'wizard' } })).status, 400);
    assert.equal((await call('/hosted-agents', { body: { ...base, name: 'okname', persona: 'custom', customPrompt: 'x'.repeat(601) } })).status, 400);
    assert.equal((await call('/hosted-agents', { body: { ...base, name: 'okname', nearAiKey: '' } })).status, 400);
    const m = await call('/hosted-agents', { body: { ...base, name: 'okname', model: 'anthropic/claude-incognito' } });
    assert.equal(m.status, 400);
    assert.match(m.json.error, /ModelNotAttested/);
  });

  it('creates agents (keypair + off-chain chips), token shown once, secrets never public', async () => {
    for (const [name, maxCalls, persona] of [
      ['budget-bot', 6, 'rock'],
      ['long-bot', 200, 'custom'],
    ] as const) {
      const r = await call('/hosted-agents', {
        body: { ...base, name, maxCalls, persona, customPrompt: persona === 'custom' ? 'Secret style: always talk like a pirate.' : undefined },
      });
      assert.equal(r.status, 201, JSON.stringify(r.json));
      assert.equal(r.json.walletAddress, `${name}.hosted.local`);
      assert.match(r.json.manageUrl, new RegExp(`^/agents/${r.json.agentId}\\?token=`));
      owners[name] = { id: r.json.agentId, token: r.json.ownerToken, wallet: r.json.walletAddress };
    }
    assert.equal((await call('/hosted-agents', { body: { ...base, name: 'long-bot' } })).status, 409);

    const pub = await call(`/hosted-agents/${owners['long-bot']!.id}`);
    assert.equal(pub.status, 200);
    assert.equal(pub.json.personaLabel, 'Custom');
    const s = JSON.stringify(pub.json);
    for (const leak of ['pirate', 'test-key', 'encrypted', 'ownerToken', 'ed25519:']) assert.ok(!s.includes(leak), leak);
    const list = JSON.stringify((await call('/hosted-agents')).json);
    for (const leak of ['pirate', 'test-key', 'encrypted', 'ed25519:']) assert.ok(!list.includes(leak), leak);

    assert.equal((await call(`/hosted-agents/${owners['long-bot']!.id}`, { token: 'x'.repeat(43) })).status, 403);
    const own = await call(`/hosted-agents/${owners['long-bot']!.id}`, { token: owners['long-bot']!.token });
    assert.equal(own.json.owner, true);
    assert.equal(own.json.chips, 1000);
    assert.match(own.json.customPrompt, /pirate/);
    assert.equal((await call(`/hosted-agents/${owners['long-bot']!.id}/play`, { body: {}, token: 'wrong-token-wrong-token' })).status, 403);
  });

  it('rate limits creation per IP', async () => {
    assert.equal((await call('/hosted-agents', { body: { ...base, name: 'third-bot' } })).status, 201);
    const r = await call('/hosted-agents', { body: { ...base, name: 'fourth-bot' } });
    assert.equal(r.status, 429);
  });

  it('runs agent-starter children that play the arena; budget exhaustion → idle "budget used"', async () => {
    const b = owners['budget-bot']!;
    const l = owners['long-bot']!;
    for (const o of [b, l]) {
      const r = await call(`/hosted-agents/${o.id}/play`, { body: {}, token: o.token });
      assert.equal(r.status, 200, JSON.stringify(r.json));
    }
    await waitFor(
      'a seated hosted agent',
      async () => (await call(`/hosted-agents/${l.id}`)).json.state === 'playing',
      60_000
    );
    const done = await waitFor(
      'budget-bot to use its budget',
      async () => {
        const v = (await call(`/hosted-agents/${b.id}`, { token: b.token })).json;
        return v.state === 'idle' && v.statusDetail === 'budget used' ? v : null;
      },
      120_000
    );
    assert.ok(done.lastRun.hands >= 1, JSON.stringify(done.lastRun));
    assert.ok(done.logs.some((x: string) => /fair ✅/.test(x)), done.logs.join('\n'));
    const stats = await waitFor('arena stats', async () => {
      const v = (await call(`/hosted-agents/${b.id}`)).json;
      return v.stats.hands >= 1 && v.stats.movesVerified >= 1 ? v.stats : null;
    }, 20_000);
    assert.ok(stats.hands >= 1);
    const ownLogs = JSON.stringify(done.logs);
    assert.ok(!ownLogs.includes('test-key'));
    assert.ok(!/ed25519:[1-9A-HJ-NP-Za-km-z]{32,}/.test(ownLogs));

    // stop the other one (force: it may be waiting alone in the queue)
    assert.equal((await call(`/hosted-agents/${l.id}/stop`, { body: { force: true }, token: l.token })).status, 200);
    await waitFor('long-bot stopped', async () => (await call(`/hosted-agents/${l.id}`)).json.state === 'idle', 20_000);
  });

  it('edit personality, download (no API key by default), delete keeps the wallet downloadable', async () => {
    const l = owners['long-bot']!;
    const e = await call(`/hosted-agents/${l.id}`, { method: 'PATCH', body: { persona: 'calculator' }, token: l.token });
    assert.equal(e.status, 200);
    assert.equal(e.json.persona, 'calculator');
    assert.equal(e.json.customPrompt, '');

    const d = await call(`/hosted-agents/${l.id}/download`, { body: {}, token: l.token });
    assert.equal(d.status, 200);
    assert.equal(d.res.headers.get('content-type'), 'application/gzip');
    const { gunzipSync } = await import('node:zlib');
    const tar = gunzipSync(Buffer.from(await d.res.arrayBuffer())).toString('latin1');
    assert.ok(tar.includes('AGENT_ACCOUNT=long-bot.hosted.local'));
    assert.ok(!tar.includes('NEARAI_API_KEY=test-key'));
    assert.ok(tar.includes('mathematical'));

    assert.equal((await call(`/hosted-agents/${l.id}/download`, { body: {} })).status, 403);
    assert.equal((await call(`/hosted-agents/${l.id}`, { method: 'DELETE', token: l.token })).status, 200);
    assert.equal((await call(`/hosted-agents/${l.id}`)).status, 404);
    const again = await call(`/hosted-agents/${l.id}/download`, { body: { includeApiKey: true }, token: l.token });
    assert.equal(again.status, 200);
    const tar2 = gunzipSync(Buffer.from(await again.res.arrayBuffer())).toString('latin1');
    assert.ok(tar2.includes('NEARAI_API_KEY=test-key'));
  });
});
