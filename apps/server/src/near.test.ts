import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { describe, it } from 'node:test';

import { KeyPair, KeyPairSigner } from 'near-api-js';

import {
  LOGIN_MESSAGE,
  LOGIN_RECIPIENT,
  nep413Hash,
  nep413Payload,
  verifyNearProof,
  verifyNep413Signature,
  type NearProof,
} from './near.js';

async function makeProof(overrides: Partial<NearProof> = {}) {
  const kp = KeyPair.fromRandom('ed25519');
  const nonce = new Uint8Array(randomBytes(32));
  const signer = new KeyPairSigner(kp);
  const signed = await signer.signNep413Message('alice.testnet', {
    message: LOGIN_MESSAGE,
    recipient: LOGIN_RECIPIENT,
    nonce,
  });
  const proof: NearProof = {
    accountId: 'alice.testnet',
    publicKey: kp.getPublicKey().toString(),
    signature: Buffer.from(signed.signature).toString('base64'),
    message: LOGIN_MESSAGE,
    recipient: LOGIN_RECIPIENT,
    nonce: Buffer.from(nonce).toString('base64'),
    ...overrides,
  };
  return { kp, nonce, proof };
}

describe('NEP-413 borsh payload', () => {
  it('lays out tag, message, nonce, recipient, callbackUrl', () => {
    const nonce = new Uint8Array(32).fill(7);
    const p = nep413Payload({ message: 'hi', nonce, recipient: 'r' });
    const dv = new DataView(p.buffer);
    assert.equal(dv.getUint32(0, true), 2147484061);
    assert.equal(dv.getUint32(4, true), 2);
    assert.equal(new TextDecoder().decode(p.slice(8, 10)), 'hi');
    assert.deepEqual(p.slice(10, 42), nonce);
    assert.equal(dv.getUint32(42, true), 1);
    assert.equal(new TextDecoder().decode(p.slice(46, 47)), 'r');
    assert.equal(p[47], 0); // None
    assert.equal(p.length, 48);
  });

  it('matches near-api-js signNep413Message hash (cross-implementation)', async () => {
    const { kp, nonce, proof } = await makeProof();
    const hash = nep413Hash({ message: LOGIN_MESSAGE, nonce, recipient: LOGIN_RECIPIENT });
    // near-api-js signs sha256(borsh(...)); its signature must verify over our hash.
    assert.ok(kp.getPublicKey().verify(hash, Buffer.from(proof.signature, 'base64')));
  });

  it('rejects wrong nonce length', () => {
    assert.throws(() => nep413Payload({ message: 'x', nonce: new Uint8Array(31), recipient: 'r' }));
  });
});

describe('verifyNep413Signature / verifyNearProof', () => {
  it('accepts a valid proof', async () => {
    const { proof } = await makeProof();
    assert.equal(verifyNep413Signature(proof), true);
    const res = await verifyNearProof(proof, { checkAccessKey: async () => true });
    assert.deepEqual(res, { ok: true });
  });

  it('rejects tampered nonce / message / key / signature', async () => {
    const { proof } = await makeProof();
    const otherNonce = Buffer.from(randomBytes(32)).toString('base64');
    assert.equal(verifyNep413Signature({ ...proof, nonce: otherNonce }), false);
    assert.equal(verifyNep413Signature({ ...proof, message: 'Sign in to Light Table' }), false);
    assert.equal(
      verifyNep413Signature({ ...proof, publicKey: KeyPair.fromRandom('ed25519').getPublicKey().toString() }),
      false
    );
    const sig = Buffer.from(proof.signature, 'base64');
    sig[0] ^= 1;
    assert.equal(verifyNep413Signature({ ...proof, signature: sig.toString('base64') }), false);
    assert.equal(verifyNep413Signature({ ...proof, signature: 'not-base64!!' }), false);
  });

  it('enforces fixed message/recipient and full-access key', async () => {
    const { proof } = await makeProof();
    const ok = async () => true;
    assert.deepEqual(await verifyNearProof({ ...proof, recipient: 'evil' }, { checkAccessKey: ok }), {
      ok: false,
      reason: 'BadRecipient',
    });
    assert.deepEqual(await verifyNearProof({ ...proof, message: 'x' }, { checkAccessKey: ok }), {
      ok: false,
      reason: 'BadMessage',
    });
    assert.deepEqual(await verifyNearProof(proof, { checkAccessKey: async () => false }), {
      ok: false,
      reason: 'NotFullAccessKey',
    });
  });
});
