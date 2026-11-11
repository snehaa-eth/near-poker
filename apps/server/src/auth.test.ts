import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { describe, it } from 'node:test';

import { consumeLoginNonce, isArenaTestMode, issueLoginNonce } from './auth.js';

const b64 = () => randomBytes(32).toString('base64');

describe('login nonces', () => {
  it('server-issued nonce is single use (near mode)', () => {
    const { nonce } = issueLoginNonce();
    assert.deepEqual(consumeLoginNonce(nonce, { near: true }), { ok: true });
    assert.equal(consumeLoginNonce(nonce, { near: true }).ok, false);
  });

  it('expires after 5 minutes', () => {
    const t0 = Date.now();
    const { nonce } = issueLoginNonce(t0);
    assert.equal(consumeLoginNonce(nonce, { near: true, now: t0 + 5 * 60_000 + 1 }).ok, false);
  });

  it('must match the nonce cookie when present', () => {
    const { nonce } = issueLoginNonce();
    assert.deepEqual(consumeLoginNonce(nonce, { near: true, cookieNonce: b64() }), {
      ok: false,
      reason: 'NonceCookieMismatch',
    });
  });

  it('client-made nonces: rejected on near, accepted once otherwise', () => {
    const n = b64();
    assert.equal(consumeLoginNonce(n, { near: true }).ok, false);
    assert.equal(consumeLoginNonce(n, { near: false }).ok, true);
    assert.deepEqual(consumeLoginNonce(n, { near: false }), { ok: false, reason: 'NonceReused' });
  });

  it('rejects non-32-byte nonces', () => {
    assert.equal(consumeLoginNonce('AAAA', { near: false }).ok, false);
  });
});

describe('ARENA_TEST_MODE guard', () => {
  it('is only on without a chain and with the explicit flag', () => {
    assert.equal(isArenaTestMode({ ARENA_TEST_MODE: '1' }), true);
    assert.equal(isArenaTestMode({ ARENA_TEST_MODE: '1', CHAIN: 'near' }), false);
    assert.equal(isArenaTestMode({ ARENA_TEST_MODE: '1', CHAIN: 'NEAR' }), false);
    assert.equal(isArenaTestMode({}), false);
    assert.equal(isArenaTestMode({ ARENA_TEST_MODE: 'true' }), false);
  });
});
