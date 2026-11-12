/**
 * Scheduled arena events (INTERFACES.md §5.6): admin create, register/unregister guards, go-live
 * (queued / connected / already-playing registrants → dedicated event tables), event leaderboard,
 * end (tables finish their hand and close, standings frozen) and restart recovery.
 * The scheduler is driven with explicit clock values via tickEvents(now). No network.
 */
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

import { TestAgent, adminCookie, waitFor } from './test-agent.js';
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
delete process.env.ADMIN_PASSWORD;

let API = '';
const key = teeKey();
const attest = mockAttestationFetch({ [MODEL]: [key.hex] });
let mongod: MongoMemoryServer;
let server: import('node:http').Server;
let lobby: typeof import('./lobby.js');
let events: typeof import('./events.js');
let db: typeof import('../db.js');
let turnsMod: typeof import('./turns.js');
const all: TestAgent[] = [];
const mk = (name: string) => {
  const a = new TestAgent(() => API, `${name}-agent.testnet`, key);
  all.push(a);
  return a;
};

before(async () => {
  mongod = await MongoMemoryServer.create();
  db = await import('../db.js');
  await db.connectMongo(mongod.getUri('events-test'));
  const { setAccessKeyChecker } = await import('../auth.js');
  setAccessKeyChecker(async () => true);
  const { setAttestationFetch } = await import('./attestation.js');
  setAttestationFetch(attest.f);
  lobby = await import('./lobby.js');
  events = await import('./events.js');
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

async function post(path: string, body: unknown, cookie = '') {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, any> };
}
const get = async (path: string) => (await fetch(`${API}${path}`)).json() as Promise<Record<string, any>>;

describe('Scheduled arena events', () => {
  const [A, B, C, D, Poor] = ['alpha', 'bravo', 'charlie', 'delta', 'poor'].map(mk) as TestAgent[];
  const startsAt = new Date(Date.now() + 10 * 60_000);
  let eventId = '';
  let admin = '';

  it('admin creates an event (slug id); anyone can list and read it', async () => {
    const denied = await post('/admin/events', { name: 'Friday Night Arena', startsAt: startsAt.toISOString() });
    assert.equal(denied.status, 401);
    admin = await adminCookie(API);
    const bad = await post('/admin/events', { name: 'x', startsAt: 'nope' }, admin);
    assert.equal(bad.status, 400);
    const r = await post(
      '/admin/events',
      { name: 'Friday Night Arena', startsAt: startsAt.toISOString(), durationMin: 45, prize: '50 NEAR' },
      admin
    );
    assert.equal(r.status, 201, JSON.stringify(r.json));
    eventId = r.json.event.eventId;
    assert.equal(eventId, 'friday-night-arena');
    assert.equal(r.json.event.maxAgents, 24);
    assert.equal(r.json.event.status, 'scheduled');
    const dup = await post('/admin/events', { name: 'Friday Night Arena', startsAt: startsAt.toISOString() }, admin);
    assert.equal(dup.json.event.eventId, 'friday-night-arena-2');

    const list = await get('/events');
    assert.ok(list.events.some((e: { eventId: string }) => e.eventId === eventId));
    const detail = await get(`/events/${eventId}`);
    assert.equal(detail.name, 'Friday Night Arena');
    assert.equal(detail.durationMin, 45);
    assert.equal(detail.endsAt, new Date(startsAt.getTime() + 45 * 60_000).toISOString());
    assert.deepEqual(detail.registrations, []);
    assert.equal((await fetch(`${API}/events/nope`)).status, 404);
  });

  it('registration: NEAR session + min chips, idempotent, unregister, capacity', async () => {
    for (const a of all) await a.login();
    for (const a of [A, B, C, D]) await a.deposit(1);
    const guest = new TestAgent(() => API, 'guest', key);
    assert.equal((await guest.call(`/events/${eventId}/register`, {})).status, 401);
    const poor = await Poor.call(`/events/${eventId}/register`, {});
    assert.equal(poor.status, 400);
    assert.match(poor.json.error, /InsufficientChips/);
    const unattested = await A.call(`/events/${eventId}/register`, { model: 'gateway/only' });
    assert.match(unattested.json.error, /ModelNotAttested/);

    for (const a of [A, B, C]) {
      const r = await a.call(`/events/${eventId}/register`, { model: MODEL });
      assert.equal(r.status, 200, JSON.stringify(r.json));
    }
    assert.equal((await A.call(`/events/${eventId}/register`, { model: MODEL })).json.already, true);
    assert.equal((await C.call(`/events/${eventId}/unregister`, {})).json.removed, true);
    assert.equal((await C.call(`/events/${eventId}/register`, { model: MODEL })).status, 200);
    const detail = (await A.call(`/events/${eventId}`)).json;
    assert.deepEqual(detail.registrations.map((r: { nickname: string }) => r.nickname), ['alpha-agent', 'bravo-agent', 'charlie-agent']);
    assert.equal(detail.registrations[0].model, MODEL);
    assert.equal(detail.registrations[0].sessionId, undefined, 'no session ids leak');
    assert.deepEqual(detail.me, { registered: true });

    const small = await post('/admin/events', { name: 'Tiny Cup', startsAt: new Date(startsAt.getTime() + 86_400_000).toISOString(), maxAgents: 2 }, admin);
    await A.call(`/events/${small.json.event.eventId}/register`, {});
    await B.call(`/events/${small.json.event.eventId}/register`, {});
    const full = await C.call(`/events/${small.json.event.eventId}/register`, {});
    assert.equal(full.status, 409);
    assert.match(full.json.error, /EventFull/);
  });

  let eventTable = '';
  it('at startsAt: queued, connected and already-playing registrants move to event tables', async () => {
    for (const a of [A, B, C, D]) await a.connect();
    // Before the event: A and D play in the open arena; C sits down there for the next hand.
    A.hold = new Promise(() => {}); // keep that hand live while the event starts
    await A.call('/arena/join', { model: MODEL });
    await D.call('/arena/join', { model: MODEL });
    await waitFor('A+D table', () => A.gameId && A.gameId === D.gameId);
    const openTable = A.gameId!;
    await waitFor('hand live', () => A.turns.length > 0 || D.turns.length > 0, 20_000);
    assert.deepEqual((await C.call('/arena/join', { model: MODEL })).json, { gameId: openTable });
    // B is only connected (not in the arena).

    await events.tickEvents(startsAt.getTime());
    const ev = await waitFor('event table with B and C', async () => {
      const d = await get(`/events/${eventId}`);
      return d.tables.length === 1 && d.tables[0].seats.length === 2 ? d : null;
    });
    assert.equal(ev.status, 'live');
    eventTable = ev.tables[0].gameId;
    assert.notEqual(eventTable, openTable);
    assert.deepEqual(ev.tables[0].seats.map((s: { nickname: string }) => s.nickname).sort(), ['bravo-agent', 'charlie-agent']);
    assert.equal(ev.tables[0].eventId, eventId);
    assert.deepEqual(ev.gameIds, [eventTable]);
    const g = await db.GameModel.findOne({ gameId: eventTable }).lean();
    assert.equal(g?.eventId, eventId);
    assert.equal(g?.arena, true);

    // registration is closed once the event started
    assert.equal((await D.call(`/events/${eventId}/register`, {})).status, 409);

    // A finishes its open-arena hand, then moves to the event table; D (not registered) stays behind.
    A.hold = null;
    await waitFor('A at the event table', () => A.gameId === eventTable, 30_000);
    await waitFor('D re-queued (open table closed)', () => D.events.includes('closed'), 30_000);
    assert.notEqual(D.gameId, eventTable);
  });

  it('agents registered for a live event get event tables from /arena/join', async () => {
    // B leaves the event table, then re-joins: routed back to the event (not the open arena).
    await B.call('/arena/leave', {});
    await waitFor('B left', () => B.events.includes('left'), 30_000);
    const r = await B.call('/arena/join', { model: MODEL });
    assert.deepEqual(r.json, { gameId: eventTable });
  });

  it('event leaderboard counts only event hands', async () => {
    await waitFor('A and B dealt in at the event table', async () => {
      const d = await get(`/events/${eventId}`);
      const seats = (d.tables[0]?.seats ?? []).map((s: { nickname: string }) => s.nickname);
      return seats.includes('alpha-agent') && seats.includes('bravo-agent');
    }, 30_000);
    const lb = await waitFor('event hands of all 3 agents', async () => {
      const d = await get(`/events/${eventId}`);
      return d.leaderboard.length >= 3 ? d.leaderboard : null;
    }, 30_000);
    const names = lb.map((e: { nickname: string }) => e.nickname);
    assert.ok(!names.includes('delta-agent'));
    assert.equal(lb.reduce((s: number, e: { netChips: number }) => s + e.netChips, 0), 0, 'zero-sum');
  });

  it('at the end: no new hands, tables close after the hand, standings freeze', async () => {
    const end = startsAt.getTime() + 45 * 60_000;
    await events.tickEvents(end);
    assert.equal((await get(`/events/${eventId}`)).status, 'ended');
    await waitFor('event table closed', () => A.events.includes('closed') && C.events.includes('closed'), 30_000);
    const closed = await db.GameModel.findOne({ gameId: eventTable }).lean();
    assert.equal(closed?.status, 'ended');
    // Back in the open arena (with D): not on the event's table any more.
    await waitFor('A re-seated in the open arena', () => A.gameId && A.gameId !== eventTable, 30_000);

    await events.tickEvents(end + 5000);
    const final = await get(`/events/${eventId}`);
    assert.equal(final.final, true);
    assert.equal(final.leaderboard.length, 3);
    assert.equal(final.tables.length, 0);
    const before = JSON.stringify(final.leaderboard);
    await new Promise((r) => setTimeout(r, 1500)); // open-arena hands keep going…
    assert.equal(JSON.stringify((await get(`/events/${eventId}`)).leaderboard), before, '…but the event standings are frozen');
    const list = await get('/events');
    assert.equal(list.events.find((e: { eventId: string }) => e.eventId === eventId).status, 'ended');
  });

  it('a live event survives a restart (lobby state rebuilt from Mongo)', async () => {
    const s = new Date(Date.now() + 60_000);
    const r = await post('/admin/events', { name: 'Restart Cup', startsAt: s.toISOString() }, admin);
    const id = r.json.event.eventId;
    await events.tickEvents(s.getTime());
    assert.equal(lobby.isEventLiveInLobby(id), true);
    lobby.resetArenaLobby(); // simulate a restart: in-memory lobby gone
    assert.equal(lobby.isEventLiveInLobby(id), false);
    await events.tickEvents(s.getTime() + 1000);
    assert.equal(lobby.isEventLiveInLobby(id), true);
  });
});
