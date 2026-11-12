/**
 * Session cookie = secret token (regression). The public player id (`sessionId`, shown to every
 * spectator in table views / hand records) must NOT authenticate when copied into the session
 * cookie: HTTP → 401, socket → spectator (arena:act / game:bet refused). A real login still works.
 * In-process server, in-memory Mongo, MemoryLedger, mocked attestation — no network.
 */
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { io as ioClient, type Socket } from 'socket.io-client';

import { TestAgent, waitFor, type Turn } from './arena/test-agent.js';
import { MODEL, makeReceipt, mockAttestationFetch, teeKey } from './arena/test-helpers.js';

Object.assign(process.env, {
  NEARAI_API_KEY: 'test-key',
  NEARAI_BASE_URL: 'https://mock.nearai.local/v1',
  ARENA_MIN_AGENTS: '2',
  ARENA_FILL_MS: '300',
  ARENA_HAND_GAP_MS: '200',
  ARENA_TURN_MS: '8000',
  ARENA_MIN_CHIPS: '100',
  ENTROPY_TIMEOUT_MS: '1500',
});
delete process.env.CHAIN;

let API = '';
const key = teeKey();
const attest = mockAttestationFetch({ [MODEL]: [key.hex] });
let mongod: MongoMemoryServer;
let server: import('node:http').Server;
let lobby: typeof import('./arena/lobby.js');
let turnsMod: typeof import('./arena/turns.js');
const sockets: Socket[] = [];
const agents: TestAgent[] = [];

before(async () => {
  mongod = await MongoMemoryServer.create();
  const { connectMongo } = await import('./db.js');
  await connectMongo(mongod.getUri('session-token-test'));
  const { setAccessKeyChecker } = await import('./auth.js');
  setAccessKeyChecker(async () => true);
  const { setAttestationFetch } = await import('./arena/attestation.js');
  setAttestationFetch(attest.f);
  lobby = await import('./arena/lobby.js');
  turnsMod = await import('./arena/turns.js');
  const { createAppServer } = await import('./app.js');
  ({ server } = createAppServer('http://localhost:3000'));
  await new Promise<void>((r) => server.listen(0, r));
  API = `http://localhost:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  for (const s of sockets) s.close();
  for (const a of agents) a.sock?.close();
  lobby?.resetArenaLobby();
  turnsMod?.resetTurns();
  await new Promise((r) => setTimeout(r, 800));
  lobby?.resetArenaLobby();
  turnsMod?.resetTurns();
  await new Promise((r) => server?.close(r));
  await mongoose.disconnect();
  await mongod?.stop();
});

async function get(path: string, cookie: string) {
  const res = await fetch(`${API}${path}`, { headers: { cookie } });
  return { status: res.status, json: (await res.json()) as Record<string, any> };
}

async function socketWith(cookie: string) {
  const sock = ioClient(API, { transports: ['websocket'], extraHeaders: { cookie } });
  sockets.push(sock);
  await new Promise<void>((ok, bad) => {
    sock.on('connect', () => ok());
    sock.on('connect_error', bad);
  });
  return sock;
}

describe('Session cookie is a secret token, not the public player id', () => {
  const A = new TestAgent(() => API, 'victim-agent.testnet', key);
  const B = new TestAgent(() => API, 'other-agent.testnet', key);
  agents.push(A, B);

  it('a real login works for HTTP; the cookie is an opaque token ≠ sessionId; no hash leaks', async () => {
    for (const a of [A, B]) {
      await a.login();
      const token = a.jar.get('poker_session')!;
      assert.ok(token && token !== a.sessionId, 'cookie is not the public id');
      assert.equal(a.jar.get('nli_session'), token, 'alias cookie carries the same token');
      assert.equal(Buffer.from(token, 'base64url').length, 32);
      const me = await a.call('/auth/me');
      assert.equal(me.status, 200);
      assert.equal(me.json.sessionId, a.sessionId);
      assert.ok(!('tokenHashes' in me.json) && !('tokenHash' in me.json));
      // alias-only cookie also authenticates
      assert.equal((await get('/auth/me', `nli_session=${token}`)).status, 200);
      await a.deposit(1);
    }
    // the stored hash is never selected by default
    const { SessionModel } = await import('./db.js');
    const doc = await SessionModel.findOne({ sessionId: A.sessionId }).lean();
    assert.ok(doc && !('tokenHashes' in doc));
  });

  it('a public player id in the cookie does not authenticate over HTTP', async () => {
    for (const cookie of [`poker_session=${A.sessionId}`, `nli_session=${A.sessionId}`]) {
      assert.equal((await get('/auth/me', cookie)).status, 401, cookie);
      assert.equal((await get('/auth/activity', cookie)).status, 401, cookie);
      assert.notEqual((await get('/treasury/sync', cookie)).status, 200, cookie);
    }
    // /auth/nickname with a forged cookie makes a NEW session instead of renaming the victim
    const res = await fetch(`${API}/auth/nickname`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `poker_session=${A.sessionId}` },
      body: JSON.stringify({ nickname: 'pwned' }),
    });
    const json = (await res.json()) as { sessionId: string };
    assert.notEqual(json.sessionId, A.sessionId);
    assert.equal((await A.call('/auth/me')).json.nickname, 'victim-agent');
  });

  it('socket: real login acts; a forged cookie is spectator-only (arena:act / game:bet refused)', async () => {
    let release!: () => void;
    const hold = new Promise<void>((r) => (release = r));
    A.hold = hold;
    B.hold = hold;
    await A.connect();
    await B.connect();
    for (const a of [A, B]) await a.call('/arena/join', { model: MODEL });
    await waitFor('both seated', () => A.gameId && B.gameId);
    const gameId = A.gameId!;
    // Real login over the socket: the view identifies me by my public id.
    await waitFor('A view', () => A.lastView?.myPlayerId === A.sessionId);

    const turn = await waitFor<Turn>('someone to act', () => A.turns[0] ?? B.turns[0], 20_000);
    const victim = A.turns[0] === turn ? A : B;

    const attacker = await socketWith(`poker_session=${victim.sessionId}; nli_session=${victim.sessionId}`);
    const views: Array<{ myPlayerId: string | null }> = [];
    const rejected: Array<{ reason: string }> = [];
    const errors: string[] = [];
    attacker.on('game:state', (v) => views.push(v));
    attacker.on('arena:rejected', (r) => rejected.push(r));
    attacker.on('game:error', (e: { error: string }) => errors.push(e.error));
    attacker.emit('game:joinRoom', { gameId });
    await waitFor('spectator view', () => views.length > 0);
    assert.equal(views[0]!.myPlayerId, null, 'forged cookie → spectator');

    // Even with a perfectly valid receipt for the victim's live challenge.
    const receipt = makeReceipt(key, { challenge: turn.challenge, action: 'fold' });
    attacker.emit('arena:act', { gameId, handId: turn.handId, challenge: turn.challenge, action: 'fold', receipt });
    await waitFor('arena:rejected', () => rejected.length > 0);
    assert.equal(rejected[0]!.reason, 'NotAuthenticated');

    attacker.emit('game:bet', { gameId, amount: 0 });
    attacker.emit('game:fold', { gameId });
    await waitFor('game:error x2', () => errors.length >= 2);
    assert.deepEqual(errors.slice(0, 2), ['NotAuthenticated', 'NotAuthenticated']);

    // The victim still holds the turn and can act with its real token.
    const before = victim.accepted;
    release();
    await waitFor('victim act accepted', () => victim.accepted > before, 10_000);
    A.hold = null;
    B.hold = null;
  });
});
