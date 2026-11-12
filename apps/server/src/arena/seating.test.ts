/**
 * Sit down between hands (INTERFACES.md §5.2): a 4th agent joining while a hand runs is seated at
 * once (arena:seated) but dealt in only from the next hand, with its entropy in the provably-fair
 * deck; a full 6/6 table makes newcomers queue (and open a new table); a leaver frees its seat.
 * In-process server, in-memory Mongo, MemoryLedger, mocked attestation — no network.
 */
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

import { verifyHand } from '@nli/poker-engine';

import { TestAgent, waitFor } from './test-agent.js';
import { MODEL, mockAttestationFetch, teeKey } from './test-helpers.js';

Object.assign(process.env, {
  NEARAI_API_KEY: 'test-key',
  NEARAI_BASE_URL: 'https://mock.nearai.local/v1',
  ARENA_MIN_AGENTS: '2',
  ARENA_FILL_MS: '300',
  ARENA_HAND_GAP_MS: '200',
  ARENA_TURN_MS: '4000',
  ARENA_MIN_CHIPS: '100',
  ENTROPY_TIMEOUT_MS: '1500',
});
delete process.env.CHAIN;

let API = '';
const key = teeKey();
const attest = mockAttestationFetch({ [MODEL]: [key.hex] });
let mongod: MongoMemoryServer;
let server: import('node:http').Server;
let lobby: typeof import('./lobby.js');
let turnsMod: typeof import('./turns.js');
const all: TestAgent[] = [];
const mk = (name: string) => {
  const a = new TestAgent(() => API, `${name}-agent.testnet`, key);
  all.push(a);
  return a;
};

before(async () => {
  mongod = await MongoMemoryServer.create();
  const { connectMongo } = await import('../db.js');
  await connectMongo(mongod.getUri('seating-test'));
  const { setAccessKeyChecker } = await import('../auth.js');
  setAccessKeyChecker(async () => true);
  const { setAttestationFetch } = await import('./attestation.js');
  setAttestationFetch(attest.f);
  lobby = await import('./lobby.js');
  turnsMod = await import('./turns.js');
  const { createAppServer } = await import('../app.js');
  ({ server } = createAppServer('http://localhost:3000'));
  await new Promise<void>((r) => server.listen(0, r));
  API = `http://localhost:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  for (const a of all) a.sock?.close();
  lobby?.resetArenaLobby();
  turnsMod?.resetTurns();
  await new Promise((r) => setTimeout(r, 800)); // let in-flight hand saves settle before Mongo goes away
  lobby?.resetArenaLobby();
  turnsMod?.resetTurns();
  await new Promise((r) => server?.close(r));
  await mongoose.disconnect();
  await mongod?.stop();
});

async function tables(a: TestAgent) {
  return (await a.call('/arena/tables')).json.tables as Array<{
    gameId: string;
    seats: Array<{ playerId: string; nickname: string }>;
    waiting: Array<{ nickname: string; walletAddress: string }>;
    freeSeats: number;
  }>;
}

describe('Arena: sit down between hands', () => {
  const [A, B, C, D, E, F, G, H] = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel'].map(mk) as TestAgent[];
  let table1 = '';

  it('3 agents open a table and play', async () => {
    for (const a of all) {
      await a.login();
      await a.deposit(1);
      await a.connect();
    }
    for (const a of [A, B, C]) await a.call('/arena/join', { model: MODEL });
    await waitFor('3 seated', () => A.gameId && B.gameId && C.gameId);
    table1 = A.gameId!;
    assert.equal(B.gameId, table1);
    assert.equal(C.gameId, table1);
  });

  let joinHand = '';
  it('a 4th agent joining mid-hand is seated now and dealt in from the next hand', async () => {
    let release!: () => void;
    // Freeze the next hand at A's first turn so D provably arrives mid-hand.
    A.hold = new Promise<void>((r) => (release = r));
    const n = A.turns.length;
    const t = await waitFor('A to act in a live hand', () => A.turns.length > n && A.turns.at(-1), 20_000);
    joinHand = t.handId;

    const r = await D.call('/arena/join', { model: MODEL });
    assert.deepEqual(r.json, { gameId: table1 }, 'free seat → seated straight away');
    await waitFor('D arena:seated', () => D.gameId === table1);

    const [tb] = await tables(A);
    assert.equal(tb!.seats.length, 3, 'not dealt into the running hand');
    assert.deepEqual(tb!.waiting.map((w) => w.nickname), ['delta-agent']);
    assert.equal(tb!.freeSeats, 2);
    const { json: view } = await A.call(`/games/${table1}`);
    assert.equal(view.fairness.handId, joinHand);
    assert.ok(!view.players.some((p: { id: string }) => p.id === D.sessionId), 'D not in the current hand');
    assert.deepEqual(view.arenaWaiting.map((w: { nickname: string }) => w.nickname), ['delta-agent'], 'spectators see "joining next hand"');

    A.hold = null;
    release();
  });

  it('the next hand includes the newcomer and verifies (provably fair, 4 entropies)', async () => {
    const handId = await waitFor('a completed hand with D', async () => {
      const v = D.lastView;
      if (!v?.gameEnded || !v.fairness?.revealed || v.fairness.handId === joinHand) return null;
      return v.players.some((p) => p.id === D.sessionId) ? v.fairness.handId : null;
    }, 30_000);
    const { json: rec } = await D.call(`/hands/${handId}`);
    assert.equal(rec.revealed, true);
    assert.equal(rec.seats.length, 4);
    assert.ok(rec.seats.some((s: { playerId: string }) => s.playerId === D.sessionId), 'D in /hands record');
    assert.equal(rec.entropy.length, 4);
    assert.equal(rec.ledgerPlayers.length, 4, 'ledger commit covers the newcomer');
    assert.ok(rec.entropy.every((e: string) => e !== '00'.repeat(16)), 'every agent (incl. D) contributed entropy');
    const seats = [...rec.seats].sort((a: { seat: number }, b: { seat: number }) => a.seat - b.seat);
    const res = verifyHand({
      seedHash: rec.seedHash,
      serverSeed: rec.serverSeed,
      entropy: rec.entropy,
      deckSeed: rec.deckSeed,
      holeCards: seats.map((s: { holeCards: number[] }) => s.holeCards),
      community: rec.community,
    });
    assert.deepEqual(res.errors, []);
    const [tb] = await tables(A);
    assert.equal(tb!.waiting.length, 0);
  });

  it('6/6 → newcomers queue; two queued open a new table', async () => {
    for (const a of [E, F]) assert.deepEqual((await a.call('/arena/join', { model: MODEL })).json, { gameId: table1 });
    const [tb] = await tables(A);
    assert.equal(tb!.freeSeats, 0);
    assert.deepEqual((await G.call('/arena/join', { model: MODEL })).json, { queued: true, position: 1 });
    assert.deepEqual((await H.call('/arena/join', { model: MODEL })).json, { queued: true, position: 2 });
    await waitFor('G+H at a new table', () => G.gameId && G.gameId === H.gameId);
    assert.notEqual(G.gameId, table1);
    assert.equal((await tables(A)).length, 2);
    await waitFor('E+F dealt in', async () => (await tables(A)).find((t) => t.gameId === table1)!.seats.length === 6, 30_000);
  });

  it('a leaver frees its seat for a queued agent', async () => {
    // H leaves → G's table drops below 2 and closes → G re-queues (table 1 is full).
    await H.call('/arena/leave', {});
    await waitFor('G re-queued', () => G.events.includes('queued'), 20_000);
    const { json: st } = await G.call('/arena/status');
    assert.equal(st.queue.length, 1);
    // C leaves table 1 between hands → its seat goes to G.
    await C.call('/arena/leave', {});
    await waitFor('G seated at table 1', () => G.gameId === table1, 30_000);
    await waitFor('G dealt in', async () => {
      const t = (await tables(A)).find((x) => x.gameId === table1)!;
      return t.seats.some((s) => s.playerId === G.sessionId) && !t.seats.some((s) => s.playerId === C.sessionId);
    }, 30_000);
  });
});
