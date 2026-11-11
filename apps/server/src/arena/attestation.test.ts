import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AttestationCache } from './attestation.js';
import { getArenaConfig } from './config.js';
import { MODEL, mockAttestationFetch, teeKey } from './test-helpers.js';

function cache(signers: Record<string, string[]>, opts: { badNonce?: boolean; status?: number; ttlMs?: number; minRefetchMs?: number } = {}) {
  let t = 1_000_000;
  const mock = mockAttestationFetch(signers, opts);
  const c = new AttestationCache({
    apiKey: 'test-key',
    baseUrl: 'https://mock.local/v1',
    fetch: mock.f,
    ttlMs: opts.ttlMs ?? 600_000,
    minRefetchMs: opts.minRefetchMs ?? 0,
    now: () => t,
  });
  return { c, mock, advance: (ms: number) => (t += ms) };
}

describe('AttestationCache', () => {
  it('fetches once and caches per model for the TTL', async () => {
    const k = teeKey();
    const { c, mock, advance } = cache({ [MODEL]: [k.hex] }, { ttlMs: 1000 });
    assert.deepEqual(await c.checkSigner(MODEL, k.hex), { ok: true, refetched: true });
    assert.deepEqual(await c.checkSigner(MODEL, '0x' + k.hex.toUpperCase()), { ok: true, refetched: false });
    assert.equal(mock.calls.length, 1);
    const u = new URL(mock.calls[0]!);
    assert.equal(u.searchParams.get('model'), MODEL);
    assert.equal(u.searchParams.get('signing_algo'), 'ed25519');
    assert.match(u.searchParams.get('nonce')!, /^[0-9a-f]{64}$/);
    advance(1000);
    await c.checkSigner(MODEL, k.hex);
    assert.equal(mock.calls.length, 2);
    assert.notEqual(new URL(mock.calls[1]!).searchParams.get('nonce'), u.searchParams.get('nonce'), 'fresh nonce');
  });

  it('refetches once on a miss, then rejects', async () => {
    const k = teeKey();
    const signers = { [MODEL]: [k.hex] };
    const { c, mock } = cache(signers);
    await c.checkSigner(MODEL, k.hex);
    const rotated = teeKey();
    signers[MODEL] = [k.hex, rotated.hex]; // the provider rotated in a new TEE key
    assert.deepEqual(await c.checkSigner(MODEL, rotated.hex), { ok: true, refetched: true });
    assert.equal(mock.calls.length, 2);
    const r = await c.checkSigner(MODEL, teeKey().hex);
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.reason, 'SignerNotAttested');
    assert.equal(mock.calls.length, 3, 'exactly one refetch for the miss');
  });

  it('rate-limits miss refetches per model', async () => {
    const k = teeKey();
    const { c, mock, advance } = cache({ [MODEL]: [k.hex] }, { minRefetchMs: 5000 });
    await c.checkSigner(MODEL, k.hex);
    for (let i = 0; i < 5; i++) await c.checkSigner(MODEL, teeKey().hex);
    assert.equal(mock.calls.length, 1);
    advance(5000);
    await c.checkSigner(MODEL, teeKey().hex);
    assert.equal(mock.calls.length, 2);
  });

  it('gateway-only model (no model attestations) → ModelNotAttested', async () => {
    const { c } = cache({});
    const r = await c.checkSigner('gateway/only', teeKey().hex);
    assert.equal(!r.ok && r.reason, 'ModelNotAttested');
  });

  it('report that does not echo our nonce yields no signers', async () => {
    const k = teeKey();
    const { c } = cache({ [MODEL]: [k.hex] }, { badNonce: true });
    const r = await c.checkSigner(MODEL, k.hex);
    assert.equal(!r.ok && r.reason, 'ModelNotAttested');
  });

  it('HTTP error → AttestationUnavailable; missing key never calls fetch', async () => {
    const { c } = cache({ [MODEL]: ['aa'.repeat(32)] }, { status: 500 });
    const r = await c.checkSigner(MODEL, 'aa'.repeat(32));
    assert.equal(!r.ok && r.reason, 'AttestationUnavailable');
    let called = false;
    const noKey = new AttestationCache({
      apiKey: null,
      baseUrl: 'https://mock.local/v1',
      ttlMs: 1000,
      fetch: (async () => {
        called = true;
        throw new Error('no');
      }) as unknown as typeof fetch,
    });
    const r2 = await noKey.checkSigner(MODEL, 'aa'.repeat(32));
    assert.equal(!r2.ok && r2.reason, 'AttestationUnavailable');
    assert.equal(called, false);
  });

  it('concurrent checks share one fetch', async () => {
    const k = teeKey();
    const { c, mock } = cache({ [MODEL]: [k.hex] });
    await Promise.all([c.checkSigner(MODEL, k.hex), c.checkSigner(MODEL, k.hex), c.getSigners(MODEL)]);
    assert.equal(mock.calls.length, 1);
  });
});

describe('arena config', () => {
  it('defaults per INTERFACES §5', () => {
    const c = getArenaConfig({});
    assert.deepEqual(
      [c.minAgents, c.fillMs, c.handGapMs, c.turnMs, c.minChips, c.attestTtlMs, c.nearaiBaseUrl, c.nearaiApiKey],
      [2, 15000, 4000, 30000, 100, 600000, 'https://cloud-api.near.ai/v1', null]
    );
    assert.equal(getArenaConfig({ ARENA_MIN_AGENTS: '1' }).minAgents, 2);
    assert.equal(getArenaConfig({ ARENA_TURN_MS: 'abc' }).turnMs, 30000);
  });
});
