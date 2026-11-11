/**
 * NEP-413 login + vault calls, fully offline: a mock game server and a mock NEAR JSON-RPC.
 * `serverVerifyNep413` is a verbatim copy of the verification in apps/server/src/near.ts
 * (copied, not imported — the starter must stand alone).
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import { sha256 } from '@noble/hashes/sha256';
import { KeyPair, PublicKey, type KeyPairString } from 'near-api-js';

import { deposit, GameHttp, login, signNep413, vaultBalance, yoctoToChips, type NearProof } from '../src/near.js';

// ─── copy of apps/server/src/near.ts verification ───────────────────────────
const NEP413_TAG = 2147484061;
function u32le(n: number) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}
function borshString(s: string) {
  const bytes = new TextEncoder().encode(s);
  const out = new Uint8Array(4 + bytes.length);
  out.set(u32le(bytes.length));
  out.set(bytes, 4);
  return out;
}
function concat(parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}
function nep413Payload(input: { message: string; nonce: Uint8Array; recipient: string; callbackUrl?: string | null }) {
  const cb = input.callbackUrl == null ? new Uint8Array([0]) : concat([new Uint8Array([1]), borshString(input.callbackUrl)]);
  return concat([u32le(NEP413_TAG), borshString(input.message), input.nonce, borshString(input.recipient), cb]);
}
function serverVerifyNep413(proof: NearProof): boolean {
  try {
    const nonce = new Uint8Array(Buffer.from(proof.nonce, 'base64'));
    if (nonce.length !== 32) return false;
    const sig = new Uint8Array(Buffer.from(proof.signature, 'base64'));
    if (sig.length !== 64) return false;
    const pk = PublicKey.from(proof.publicKey);
    const hash = sha256(nep413Payload({ message: proof.message, nonce, recipient: proof.recipient, callbackUrl: null }));
    return pk.verify(hash, sig);
  } catch {
    return false;
  }
}
// ────────────────────────────────────────────────────────────────────────────

const kp = KeyPair.fromRandom('ed25519');
const KEY = kp.toString() as KeyPairString;
const ACCOUNT = 'my-agent.testnet';

describe('NEP-413', () => {
  it('signature verifies with the server algorithm; tampering fails', () => {
    const nonce = randomBytes(32).toString('base64');
    const proof = signNep413(ACCOUNT, KEY, nonce);
    assert.equal(proof.message, 'Sign in to Dark Table');
    assert.equal(proof.recipient, 'dark-table');
    assert.equal(proof.publicKey, kp.getPublicKey().toString());
    assert.equal(serverVerifyNep413(proof), true);
    assert.equal(serverVerifyNep413({ ...proof, message: 'Sign in to Dark Table!' }), false);
    assert.equal(serverVerifyNep413({ ...proof, nonce: randomBytes(32).toString('base64') }), false);
    assert.equal(serverVerifyNep413({ ...proof, publicKey: KeyPair.fromRandom('ed25519').getPublicKey().toString() }), false);
  });
});

describe('login against a mock game server', () => {
  let server: Server;
  let base = '';
  const issued = new Set<string>();
  before(async () => {
    server = createServer(async (req, res) => {
      if (req.url === '/auth/nonce') {
        const nonce = randomBytes(32).toString('base64');
        issued.add(nonce);
        res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': `nli_login_nonce=${encodeURIComponent(nonce)}; Path=/; HttpOnly` });
        return res.end(JSON.stringify({ nonce, message: 'Sign in to Dark Table', recipient: 'dark-table' }));
      }
      if (req.url === '/auth/profile' && req.method === 'POST') {
        let raw = '';
        for await (const c of req) raw += c;
        const body = JSON.parse(raw);
        const p = body.nearProof as NearProof;
        const ok = p && body.walletAddress === p.accountId && issued.delete(p.nonce) && serverVerifyNep413(p) && /nli_login_nonce=/.test(req.headers.cookie ?? '');
        if (!ok) {
          res.writeHead(401, { 'content-type': 'application/json' });
          return res.end('{"error":"InvalidNearProof"}');
        }
        res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'nli_session=sess-123; Path=/; HttpOnly' });
        return res.end(JSON.stringify({ sessionId: 'sess-123', walletAddress: p.accountId, nickname: 'my-agent', chips: 250 }));
      }
      res.writeHead(404).end('{}');
    });
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(() => new Promise<void>((ok) => server.close(() => ok())));

  it('GET /auth/nonce → sign → POST /auth/profile sets nli_session', async () => {
    const http = new GameHttp(base);
    const s = await login(http, ACCOUNT, KEY);
    assert.equal(s.walletAddress, ACCOUNT);
    assert.equal(http.jar.get('nli_session'), 'sess-123');
    assert.match(http.cookieHeader(), /nli_session=sess-123/);
  });
});

describe('vault calls against a mock NEAR RPC', () => {
  let server: Server;
  let rpcUrl = '';
  const calls: Array<{ method: string; params: any }> = [];
  before(async () => {
    const blockHash = '11111111111111111111111111111111'; // base58 of 32 zero bytes
    server = createServer(async (req, res) => {
      let raw = '';
      for await (const c of req) raw += c;
      const { id, method, params } = JSON.parse(raw);
      calls.push({ method, params });
      const reply = (result: unknown) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id, result }));
      };
      if (method === 'query' && params.request_type === 'call_function') {
        assert.equal(params.method_name, 'balance_of');
        const args = JSON.parse(Buffer.from(params.args_base64, 'base64').toString());
        const v = args.account_id === ACCOUNT ? '"250000000000000000000000"' : '"0"';
        return reply({ result: [...Buffer.from(v)], logs: [], block_height: 1, block_hash: blockHash });
      }
      if (method === 'query' && params.request_type === 'view_access_key') {
        return reply({ nonce: 7, permission: 'FullAccess', block_height: 1, block_hash: blockHash });
      }
      if (method === 'block') {
        return reply({ header: { hash: blockHash, height: 1, timestamp: 0 }, chunks: [] });
      }
      if (method === 'send_tx' || method === 'broadcast_tx_commit') {
        return reply({
          final_execution_status: 'FINAL',
          status: { SuccessValue: '' },
          transaction: { hash: 'TxHashMock', signer_id: ACCOUNT, receiver_id: 'vault.test' },
          transaction_outcome: { id: 'TxHashMock', outcome: { status: { SuccessValue: '' }, logs: [], receipt_ids: [], gas_burnt: 0, tokens_burnt: '0', executor_id: ACCOUNT } },
          receipts_outcome: [],
        });
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32601, message: `mock: ${method}` } }));
    });
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    rpcUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(() => new Promise<void>((ok) => server.close(() => ok())));

  it('vaultBalance reads balance_of → chips', async () => {
    const y = await vaultBalance({ rpcUrl, vaultId: 'vault.test' }, ACCOUNT);
    assert.equal(y, 250n * 10n ** 21n);
    assert.equal(yoctoToChips(y), 250);
  });

  it('deposit signs a payable deposit() function call to the vault', async () => {
    const tx = await deposit({ rpcUrl, vaultId: 'vault.test' }, ACCOUNT, KEY, '0.25');
    assert.equal(tx, 'TxHashMock');
    const sent = calls.find((c) => c.method === 'send_tx' || c.method === 'broadcast_tx_commit');
    assert.ok(sent, 'a transaction was broadcast');
    const b64: string = sent!.params.signed_tx_base64 ?? sent!.params[0];
    const bytes = Buffer.from(b64, 'base64');
    assert.ok(bytes.includes(Buffer.from('vault.test')), 'receiver is the vault');
    assert.ok(bytes.includes(Buffer.from('deposit')), 'method deposit');
    // 0.25 NEAR = 2.5e23 yocto as u128 little-endian
    const amt = Buffer.alloc(16);
    let v = 250000000000000000000000n;
    for (let i = 0; i < 16; i++, v >>= 8n) amt[i] = Number(v & 0xffn);
    assert.ok(bytes.includes(amt), 'attached deposit 0.25 NEAR');
    await assert.rejects(deposit({ rpcUrl, vaultId: 'vault.test' }, ACCOUNT, KEY, '-1'));
  });
});
