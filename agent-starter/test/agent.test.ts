/**
 * Arena loop with a fake socket + fake game API + the LOCAL mock NEAR AI. No network beyond 127.0.0.1.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

import { hexToBytes } from '@noble/hashes/utils';

import { ArenaAgent, type ArenaAct, type Turn, type View } from '../src/agent.js';
import { deriveDeckSeed, shuffleFromSeed, uiToEngine, type HandRecord } from '../src/fairness.js';
import { Tee } from '../src/tee.js';
import { startMockNearAi, type MockNearAi } from './mock-nearai.js';

class FakeSocket {
  handlers = new Map<string, Array<(p: any) => void>>();
  emitted: Array<{ event: string; payload: any }> = [];
  closed = false;
  on(event: string, fn: (p: any) => void) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), fn]);
  }
  emit(event: string, payload?: unknown) {
    this.emitted.push({ event, payload });
  }
  close() {
    this.closed = true;
  }
  fire(event: string, payload: unknown) {
    for (const fn of this.handlers.get(event) ?? []) fn(payload);
  }
  acts(): ArenaAct[] {
    return this.emitted.filter((e) => e.event === 'arena:act').map((e) => e.payload);
  }
}

async function waitFor(cond: () => boolean, ms = 5000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('waitFor timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
}

const SERVER_SEED = '42'.repeat(32);
const OTHER_ENTROPY = '11'.repeat(16);

function setup(mock: MockNearAi, maxLlmCalls: number) {
  const socket = new FakeSocket();
  const posted: string[] = [];
  let myEntropy = '00'.repeat(16);
  const deck = () => shuffleFromSeed(deriveDeckSeed(hexToBytes(SERVER_SEED), [hexToBytes(OTHER_ENTROPY), hexToBytes(myEntropy)]));
  const api = async (path: string, body?: unknown): Promise<any> => {
    posted.push(path);
    if (path === '/arena/join') return { gameId: 'g1' };
    if (path === '/arena/leave') return { ok: true };
    if (path.startsWith('/hands/')) {
      const d = deck();
      const rec: HandRecord = {
        handId: 'h1',
        seedHash: createHash('sha256').update(Buffer.from(SERVER_SEED, 'hex')).digest('hex'),
        serverSeed: SERVER_SEED,
        entropy: [OTHER_ENTROPY, myEntropy],
        seats: [
          { seat: 0, playerId: 'opp', holeCards: [d[0]!, d[1]!] },
          { seat: 1, playerId: 'me', holeCards: [d[2]!, d[3]!] },
        ],
        community: [d[5]!, d[6]!, d[7]!, d[9]!, d[11]!],
      };
      return rec;
    }
    throw new Error(`unexpected ${path} ${JSON.stringify(body)}`);
  };
  const tee = new Tee({ apiKey: 'test-key', baseUrl: mock.baseUrl });
  const logs: string[] = [];
  const agent = new ArenaAgent({ api: api as any, socket, tee, maxLlmCalls, log: (s) => logs.push(s), revealRetryMs: 10 });
  const view = (over: Partial<View> = {}): View => {
    const d = deck();
    return {
      gameId: 'g1',
      status: 'playing',
      round: 'PreFlop',
      roundLabel: 'PreFlop',
      players: [
        { id: 'opp', nickname: 'Opp', seat: 0, chipsInPot: 20, folded: false, holeCards: [-1, -1] },
        { id: 'me', nickname: 'Me', seat: 1, chipsInPot: 10, folded: false, holeCards: [uiToEngine(d[2]!), uiToEngine(d[3]!)] },
      ],
      communityCards: [],
      pot: 30,
      highestBet: 20,
      minRaise: 10,
      dealerSeat: 0,
      stacksByPlayerId: { opp: 480, me: 490 },
      gameEnded: false,
      myPlayerId: 'me',
      fairness: { handId: 'h1', seedHash: createHash('sha256').update(Buffer.from(SERVER_SEED, 'hex')).digest('hex') },
      ...over,
    };
  };
  const turn = (n: number): Turn => ({ gameId: 'g1', handId: 'h1', challenge: n.toString(16).padStart(32, '0'), deadlineMs: 30_000, view: view() });
  const entropyFromSocket = () => {
    const e = socket.emitted.find((x) => x.event === 'game:entropy');
    if (e) myEntropy = e.payload.entropy;
  };
  return { socket, posted, agent, view, turn, logs, entropyFromSocket };
}

describe('ArenaAgent', () => {
  let mock: MockNearAi;
  before(async () => {
    mock = await startMockNearAi();
  });
  after(() => mock.close());

  it('answers entropy, acts with receipts, re-asks once on an illegal reply, and MAX_LLM_CALLS stops it', async () => {
    mock.completions = 0;
    const { socket, posted, agent, view, turn, entropyFromSocket } = setup(mock, 4); // leave reserve = 1
    await agent.start();
    assert.ok(socket.emitted.some((e) => e.event === 'game:joinRoom' && e.payload.gameId === 'g1'));

    socket.fire('game:entropyRequest', { gameId: 'g1', handId: 'h1' });
    const ent = socket.emitted.find((e) => e.event === 'game:entropy')!;
    assert.match(ent.payload.entropy, /^[0-9a-f]{32}$/);
    entropyFromSocket();
    socket.fire('game:state', view());

    // turn 1: plain call (1 call)
    socket.fire('arena:turn', turn(1));
    await waitFor(() => socket.acts().length === 1);
    const a1 = socket.acts()[0]!;
    assert.equal(a1.action, 'call');
    assert.equal(a1.challenge, turn(1).challenge);
    assert.equal(a1.receipt.signatureKind, 'provider_tee');
    assert.ok(a1.receipt.responseBody.includes(turn(1).challenge));

    // turn 2: model says "check" facing a bet → re-ask → raise (2 more calls = 3, budget left 1 → leave)
    mock.script.push({ action: 'check' }, { action: 'raise', amount: 60 });
    socket.fire('arena:turn', turn(2));
    await waitFor(() => socket.acts().length === 2);
    assert.deepEqual([socket.acts()[1]!.action, socket.acts()[1]!.amount], ['raise', 60]);
    await waitFor(() => posted.includes('/arena/leave'));
    assert.equal(agent.leaving, true);

    // turn 3: uses the reserve (4th call)
    socket.fire('arena:turn', turn(3));
    await waitFor(() => socket.acts().length === 3);

    // turn 4: budget exhausted → no LLM call, no move
    socket.fire('arena:turn', turn(4));
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(socket.acts().length, 3);
    assert.equal(mock.completions, 4);
    assert.equal(agent.llmCalls, 4);

    // hand ends → fairness verified → agent stops
    socket.fire('game:state', view({ gameEnded: true, status: 'waiting', winnerNickname: 'Me' }));
    const s = await agent.done;
    assert.equal(s.llmCalls, 4);
    assert.equal(s.movesSent, 3);
    assert.equal(s.hands, 1);
    assert.equal(s.handsVerified, 1, 'hand re-derived from serverSeed + entropy');
    assert.equal(s.handsFailed, 0);
    assert.match(s.reason, /budget/);
    assert.equal(socket.closed, true);
    assert.equal(posted.filter((p) => p === '/arena/leave').length, 1);
  });

  it('retries once after arena:rejected, then gives up', async () => {
    mock.completions = 0;
    const { socket, agent, turn } = setup(mock, 40);
    await agent.start();
    socket.fire('arena:turn', turn(9));
    await waitFor(() => socket.acts().length === 1);
    await new Promise((r) => setTimeout(r, 20));
    socket.fire('arena:rejected', { reason: 'IllegalMove' });
    await waitFor(() => socket.acts().length === 2);
    assert.equal(socket.acts()[1]!.challenge, turn(9).challenge);
    assert.notEqual(socket.acts()[1]!.receipt.completionId, socket.acts()[0]!.receipt.completionId);
    assert.match(mock.requests.at(-1)!.json.messages[1].content, /rejected your previous move: IllegalMove/);
    await new Promise((r) => setTimeout(r, 20));
    socket.fire('arena:rejected', { reason: 'IllegalMove' });
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(socket.acts().length, 2);
    assert.equal(agent.rejections, 2);
    agent.stop('test done');
  });

  it('refuses to start with a budget too small to play', async () => {
    const { agent, posted } = setup(mock, 0);
    await agent.start();
    const s = await agent.done;
    assert.match(s.reason, /too small/);
    assert.equal(posted.includes('/arena/join'), false);
  });

  it('EVENT_ID: registers, waits for the event to go live without LLM calls, then joins', async () => {
    mock.completions = 0;
    const socket = new FakeSocket();
    const calls: Array<{ path: string; body?: any }> = [];
    let status: 'scheduled' | 'live' | 'ended' = 'scheduled';
    const api = async (path: string, body?: unknown): Promise<any> => {
      calls.push({ path, body });
      if (path === '/events/friday-night-arena/register') return { registered: true };
      if (path === '/events/friday-night-arena') {
        return { eventId: 'friday-night-arena', name: 'Friday Night Arena', status, startsAt: new Date(Date.now() + 1000).toISOString(), me: { registered: true } };
      }
      if (path === '/arena/join') return { gameId: 'ev1' };
      throw new Error(`unexpected ${path}`);
    };
    const tee = new Tee({ apiKey: 'test-key', baseUrl: mock.baseUrl });
    const logs: string[] = [];
    const agent = new ArenaAgent({ api: api as any, socket, tee, maxLlmCalls: 10, eventId: 'friday-night-arena', eventPollMs: 20, log: (s) => logs.push(s) });
    const started = agent.start();
    await waitFor(() => calls.filter((c) => c.path === '/events/friday-night-arena').length >= 2);
    assert.equal(calls[0]!.path, '/events/friday-night-arena/register');
    assert.equal(calls[0]!.body.model, tee.model);
    assert.ok(!calls.some((c) => c.path === '/arena/join'), 'no join before the start');
    status = 'live';
    await started;
    assert.ok(socket.emitted.some((e) => e.event === 'game:joinRoom' && e.payload.gameId === 'ev1'));
    assert.equal(mock.completions, 0);
    assert.ok(logs.some((l) => /starts in/.test(l)));
    agent.stop('test done');

    // An event that already ended → the agent stops instead of playing.
    status = 'ended';
    const late = new ArenaAgent({ api: api as any, socket: new FakeSocket(), tee, maxLlmCalls: 10, eventId: 'friday-night-arena', eventPollMs: 20, log: () => {} });
    await late.start();
    assert.match((await late.done).reason, /has ended/);
  });
});
