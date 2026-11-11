import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { findChallengeObject, receiptUrl, verifyReceipt } from './receipt.js';
import { MODEL, makeReceipt, sha, teeKey } from './test-helpers.js';

const key = teeKey();
const challenge = 'a1'.repeat(16);

function reason(r: ReturnType<typeof verifyReceipt>) {
  return r.ok ? 'ok' : r.reason;
}

describe('verifyReceipt — happy paths', () => {
  it('accepts a valid call receipt', () => {
    const receipt = makeReceipt(key, { challenge, action: 'call' });
    const r = verifyReceipt({ receipt, challenge, action: 'call' });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.responseHash, sha(receipt.responseBody));
      assert.equal(r.decision.action, 'call');
    }
  });

  it('accepts a raise with the bound amount, uppercase hex and 0x prefixes', () => {
    const receipt = makeReceipt(key, { challenge, action: 'raise', amount: 40 });
    const r = verifyReceipt({
      receipt: { ...receipt, signingAddress: '0x' + receipt.signingAddress.toUpperCase(), signature: receipt.signature.toUpperCase() },
      challenge,
      action: 'raise',
      amount: 40,
    });
    assert.equal(reason(r), 'ok');
  });

  it('finds the decision among other JSON-ish text and nested objects', () => {
    const content = `<think>{"challenge":"nope","action":"fold"}</think> final: {"challenge":"${challenge}","action":"check","meta":{"x":"}"}}`;
    const receipt = makeReceipt(key, { challenge, action: 'check' }, { content });
    assert.equal(reason(verifyReceipt({ receipt, challenge, action: 'check' })), 'ok');
  });

  it('allows a response body without a model field (model is bound by signedText)', () => {
    const receipt = makeReceipt(key, { challenge, action: 'fold' }, { bodyModel: null });
    assert.equal(reason(verifyReceipt({ receipt, challenge, action: 'fold' })), 'ok');
  });

  it('check 6 (pure): signer must be in the attested set', () => {
    const receipt = makeReceipt(key, { challenge, action: 'fold' });
    assert.equal(reason(verifyReceipt({ receipt, challenge, action: 'fold', attestation: { signingAddresses: [key.hex.toUpperCase()] } })), 'ok');
    assert.equal(
      reason(verifyReceipt({ receipt, challenge, action: 'fold', attestation: { signingAddresses: [teeKey().hex] } })),
      'SignerNotAttested'
    );
    assert.equal(reason(verifyReceipt({ receipt, challenge, action: 'fold', attestation: { signingAddresses: [] } })), 'SignerNotAttested');
  });
});

describe('verifyReceipt — every failure', () => {
  const good = makeReceipt(key, { challenge, action: 'call' });
  const v = (receipt: unknown, over: Partial<{ challenge: string; action: 'fold' | 'check' | 'call' | 'raise'; amount: number }> = {}) =>
    reason(verifyReceipt({ receipt, challenge, action: 'call', ...over }));

  it('malformed receipts', () => {
    assert.equal(v(null), 'BadReceipt');
    assert.equal(v('x'), 'BadReceipt');
    assert.equal(v([]), 'BadReceipt');
    assert.equal(v({ ...good, responseBody: undefined }), 'BadReceipt');
    assert.equal(v({ ...good, signature: 5 }), 'BadReceipt');
    assert.equal(v({ ...good, completionId: '' }), 'BadReceipt');
  });

  it('1. kind and algo', () => {
    assert.equal(v({ ...good, signatureKind: 'gateway' }), 'BadSignatureKind');
    assert.equal(v({ ...good, signingAlgo: 'ecdsa' }), 'BadSigningAlgo');
  });

  it('2. signedText format and model', () => {
    const [, rq, rs] = good.signedText.split(/:(?=[0-9a-f]{64})/);
    assert.equal(v({ ...good, signedText: `${rq}:${rs}` }), 'BadSignedText');
    assert.equal(v({ ...good, signedText: 'just-text' }), 'BadSignedText');
    assert.equal(v({ ...good, signedText: good.signedText.toUpperCase() }), 'BadSignedText');
    // gateway-style text "<req>:<resp>" signed by the key: no model prefix → BadSignedText
    const gw = `${sha('a')}:${sha('b')}`;
    assert.equal(v({ ...good, signedText: gw, signature: key.signHex(gw) }), 'BadSignedText');
    // receipt.model differs from the signed model
    assert.equal(v({ ...good, model: 'other/model' }), 'ModelMismatch');
  });

  it('3. signature', () => {
    const flip = (good.signature[0] === '0' ? '1' : '0') + good.signature.slice(1);
    assert.equal(v({ ...good, signature: flip }), 'BadSignature');
    assert.equal(v({ ...good, signature: good.signature.slice(2) }), 'BadSignature');
    assert.equal(v({ ...good, signature: Buffer.from(good.signature, 'hex').toString('base64') }), 'BadSignature');
    assert.equal(v({ ...good, signingAddress: teeKey().hex }), 'BadSignature');
    assert.equal(v({ ...good, signingAddress: 'zz' }), 'BadSignature');
    // a different key signing the same text, claiming the original signer
    assert.equal(v({ ...good, signature: teeKey().signHex(good.signedText) }), 'BadSignature');
  });

  it('4. response body: hash, id, model', () => {
    assert.equal(v({ ...good, responseBody: good.responseBody + ' ' }), 'ResponseHashMismatch');
    const swapped = good.responseBody.replace('call', 'fold');
    assert.equal(v({ ...good, responseBody: swapped }), 'ResponseHashMismatch');
    assert.equal(v({ ...good, completionId: 'chatcmpl-other' }), 'CompletionIdMismatch');
    // correctly signed, but not JSON
    const nj = 'not json';
    const t1 = `${MODEL}:${sha('req')}:${sha(nj)}`;
    assert.equal(v({ ...good, responseBody: nj, signedText: t1, signature: key.signHex(t1) }), 'BadResponseBody');
    // correctly signed body claiming another model
    const r2 = makeReceipt(key, { challenge, action: 'call' }, { bodyModel: 'evil/model' });
    assert.equal(v(r2), 'ModelMismatch');
    // correctly signed body without choices
    const body = JSON.stringify({ id: good.completionId, model: MODEL });
    const t3 = `${MODEL}:${sha('req')}:${sha(body)}`;
    assert.equal(v({ ...good, responseBody: body, signedText: t3, signature: key.signHex(t3) }), 'BadResponseBody');
  });

  it('5. challenge / action / amount binding', () => {
    assert.equal(v(good, { challenge: 'b2'.repeat(16) }), 'ChallengeNotInResponse');
    assert.equal(v(good, { action: 'fold' }), 'ActionMismatch');
    assert.equal(v(good, { action: 'raise', amount: 40 }), 'ActionMismatch');
    const raise = makeReceipt(key, { challenge, action: 'raise', amount: 40 });
    assert.equal(v(raise, { action: 'raise', amount: 80 }), 'AmountMismatch');
    const noAmt = makeReceipt(key, { challenge, action: 'raise' });
    assert.equal(v(noAmt, { action: 'raise', amount: 40 }), 'AmountMismatch');
    const prose = makeReceipt(key, { challenge, action: 'call' }, { content: `I call. challenge ${challenge}` });
    assert.equal(v(prose), 'ChallengeNotInResponse');
  });

  it('tamper: replaying a receipt for another turn fails the challenge binding', () => {
    const other = 'c3'.repeat(16);
    assert.equal(v(good, { challenge: other }), 'ChallengeNotInResponse');
  });
});

describe('helpers', () => {
  it('findChallengeObject ignores broken JSON', () => {
    assert.equal(findChallengeObject('{bad {"challenge":"x"', 'x'), null);
    assert.deepEqual(findChallengeObject('a {"challenge":"X","action":"fold"} b', 'x'), { challenge: 'X', action: 'fold' });
  });

  it('receiptUrl encodes base64url JSON without responseBody', () => {
    const r = makeReceipt(key, { challenge, action: 'call' });
    const url = receiptUrl({ ...r, verifiedAt: '2026-11-11T00:00:00.000Z' });
    assert.ok(url.startsWith(`https://cloud.near.ai/verify?model=${encodeURIComponent(MODEL)}#receipt=`));
    const json = JSON.parse(Buffer.from(url.split('#receipt=')[1]!, 'base64url').toString('utf8'));
    assert.deepEqual(Object.keys(json), ['completionId', 'model', 'signatureKind', 'signingAlgo', 'signingAddress', 'signedText', 'signature', 'verifiedAt']);
    assert.equal(json.signature, r.signature);
  });
});
