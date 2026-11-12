/**
 * Test-only mock arena agent (shared by seating.test.ts / events.test.ts): NEP-413 login with a
 * throwaway key, off-chain deposit, socket.io, entropy answers and locally signed "TEE" receipts.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { KeyPair, KeyPairSigner } from 'near-api-js';
import { io as ioClient, type Socket } from 'socket.io-client';

import { makeReceipt, type TeeKey } from './test-helpers.js';

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function waitFor<T>(what: string, fn: () => T | undefined | null | false | Promise<T | undefined | null | false>, timeoutMs = 20_000): Promise<T> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await sleep(25);
  }
  throw new Error(`timeout waiting for ${what}`);
}

export type View = {
  gameId: string;
  arena?: boolean;
  highestBet: number;
  minRaise: number;
  gameEnded: boolean;
  myPlayerId: string | null;
  players: Array<{ id: string; nickname: string; chipsInPot: number; holeCards: number[] }>;
  arenaWaiting?: Array<{ nickname: string; walletAddress: string | null; model?: string }>;
  fairness?: { handId: string; seedHash: string; revealed?: unknown };
};
export type Turn = { gameId: string; handId: string; challenge: string; deadlineMs: number; view: View };

export class TestAgent {
  jar = new Map<string, string>();
  sock!: Socket;
  sessionId = '';
  gameId: string | null = null;
  events: string[] = [];
  turns: Turn[] = [];
  accepted = 0;
  lastView: View | null = null;
  /** Hold turns (keeps the current hand live) until released. */
  hold: Promise<void> | null = null;

  constructor(
    readonly api: () => string,
    readonly account: string,
    readonly key: TeeKey
  ) {}

  get nickname() {
    return this.account.split('.')[0]!;
  }

  cookie() {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  async call(path: string, body?: unknown) {
    const res = await fetch(`${this.api()}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', cookie: this.cookie() },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';');
      const i = kv!.indexOf('=');
      this.jar.set(kv!.slice(0, i), kv!.slice(i + 1));
    }
    return { status: res.status, json: (await res.json()) as Record<string, any> };
  }

  async login() {
    const { json: n } = await this.call('/auth/nonce');
    const kp = KeyPair.fromRandom('ed25519');
    const signed = await new KeyPairSigner(kp).signNep413Message(this.account, {
      message: n.message,
      recipient: n.recipient,
      nonce: new Uint8Array(Buffer.from(n.nonce, 'base64')),
    });
    const { status, json } = await this.call('/auth/profile', {
      walletAddress: this.account,
      nickname: this.nickname,
      nearProof: {
        accountId: this.account,
        publicKey: kp.getPublicKey().toString(),
        signature: Buffer.from(signed.signature).toString('base64'),
        message: n.message,
        recipient: n.recipient,
        nonce: n.nonce,
      },
    });
    assert.equal(status, 200, JSON.stringify(json));
    this.sessionId = json.sessionId;
  }

  async deposit(nearAmount = 1) {
    assert.equal((await this.call('/treasury/deposit', { nearAmount })).status, 200);
  }

  async connect() {
    this.sock = ioClient(this.api(), { transports: ['websocket'], extraHeaders: { cookie: this.cookie() } });
    await new Promise<void>((ok, bad) => {
      this.sock.on('connect', () => ok());
      this.sock.on('connect_error', bad);
    });
    this.sock.on('game:entropyRequest', ({ gameId, handId }) => {
      this.sock.emit('game:entropy', { gameId, handId, entropy: randomBytes(16).toString('hex') });
    });
    this.sock.on('arena:seated', ({ gameId }) => {
      this.events.push('seated');
      this.gameId = gameId;
      this.sock.emit('game:joinRoom', { gameId });
    });
    for (const ev of ['arena:left', 'arena:closed', 'arena:queued']) this.sock.on(ev, () => this.events.push(ev.slice(6)));
    this.sock.on('game:state', (v: View) => {
      if (v.gameId === this.gameId) this.lastView = v;
    });
    this.sock.on('arena:accepted', () => (this.accepted += 1));
    this.sock.on('arena:turn', (t: Turn) => void this.onTurn(t));
  }

  async onTurn(t: Turn) {
    this.turns.push(t);
    if (this.hold) await this.hold;
    const me = t.view.players.find((p) => p.id === t.view.myPlayerId)!;
    const d = t.view.highestBet - me.chipsInPot > 0 ? { action: 'call' } : { action: 'check' };
    const receipt = makeReceipt(this.key, { challenge: t.challenge, ...d });
    this.sock.emit('arena:act', { gameId: t.gameId, handId: t.handId, challenge: t.challenge, ...d, receipt });
  }
}

/** Admin cookie jar for POST /admin/events. */
export async function adminCookie(api: string, password = process.env.ADMIN_PASSWORD ?? 'admin123') {
  const res = await fetch(`${api}/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  assert.equal(res.status, 200);
  return res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}
