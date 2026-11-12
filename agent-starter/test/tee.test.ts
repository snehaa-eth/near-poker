/**
 * Receipt tests against the LOCAL mock NEAR AI server (test/mock-nearai.ts). No paid API calls.
 * `independentCheck` below re-implements INTERFACES.md §5.3 checks 1–5 from scratch (node:crypto
 * only, nothing imported from src/) — i.e. what the game server will do with our receipt.
 */
import assert from 'node:assert/strict';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

import { parseReply, Tee, verificationUrl, verifyReceipt, type Receipt } from '../src/tee.js';
import { startMockNearAi, type MockNearAi } from './mock-nearai.js';

function independentCheck(r: Receipt, challenge: string, action: string, amount?: number): string | null {
  // 1
  if (r.signatureKind !== 'provider_tee' || r.signingAlgo !== 'ed25519') return 'check1';
  // 2
  const parts = r.signedText.split(':');
  const responseHash = parts.pop()!;
  const requestHash = parts.pop()!;
  const model = parts.join(':');
  if (!/^[0-9a-f]{64}$/.test(requestHash) || !/^[0-9a-f]{64}$/.test(responseHash) || model !== r.model) return 'check2';
  // 3
  const pk = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(r.signingAddress, 'hex')]), format: 'der', type: 'spki' });
  if (!/^[0-9a-f]{128}$/.test(r.signature) || !verify(null, Buffer.from(r.signedText, 'utf8'), pk, Buffer.from(r.signature, 'hex'))) return 'check3';
  // 4
  if (createHash('sha256').update(Buffer.from(r.responseBody, 'utf8')).digest('hex') !== responseHash) return 'check4-hash';
  const body = JSON.parse(r.responseBody);
  if (body.id !== r.completionId || body.model !== r.model) return 'check4-id/model';
  // 5 — the assistant content contains a JSON object with this turn's challenge + the same action/amount
  const content: string = body.choices[0].message.content;
  const obj = JSON.parse(content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1));
  if (obj.challenge !== challenge || obj.action !== action) return 'check5';
  if (action === 'raise' && obj.amount !== amount) return 'check5-amount';
  return null;
}

const msgs = (challenge: string) => [
  { role: 'system' as const, content: 'reply JSON' },
  { role: 'user' as const, content: `Turn challenge: ${challenge}\nTo call: 10\nLegal actions: fold, call, raise` },
];

describe('TEE receipts (mock NEAR AI)', () => {
  let mock: MockNearAi;
  before(async () => {
    mock = await startMockNearAi();
  });
  after(() => mock.close());

  it('attestation: signer set comes from nonce-bound model attestations', async () => {
    const tee = new Tee({ apiKey: 'test-key', baseUrl: mock.baseUrl });
    const a = await tee.attest();
    assert.equal(a.ok, true);
    assert.deepEqual(a.signers, [mock.signingAddress]);
    const other = new Tee({ apiKey: 'test-key', baseUrl: mock.baseUrl, model: 'anthropic/claude-incognito' });
    const b = await other.attest();
    assert.equal(b.ok, false, 'a model without model attestations (Incognito / gateway-only) is refused');
  });

  it('a rejected API key is reported as "invalid NEARAI_API_KEY", not as a non-TEE model', async () => {
    const tee = new Tee({ apiKey: 'wrong-key', baseUrl: mock.baseUrl });
    const att = await tee.attest();
    assert.equal(att.ok, false);
    assert.equal(att.authError, true);
    assert.match(att.error ?? '', /invalid NEARAI_API_KEY/);
    await assert.rejects(tee.decide(msgs('ab'.repeat(16)), 'ab'.repeat(16)), /invalid NEARAI_API_KEY/);
  });

  it('receipt passes the independent §5.3 checks 1–5 (and the local 1–6)', async () => {
    const tee = new Tee({ apiKey: 'test-key', baseUrl: mock.baseUrl });
    await tee.attest();
    const challenge = '0123456789abcdef0123456789abcdef';
    mock.script.push({ action: 'raise', amount: 40, line: 'Pressure ♠ “on”' });
    const d = await tee.decide(msgs(challenge), challenge);
    // challenge went into the request prompt that the TEE saw…
    const sent = mock.requests.at(-1)!;
    assert.match(sent.json.messages[1].content, new RegExp(`Turn challenge: ${challenge}`));
    assert.deepEqual(sent.json.chat_template_kwargs, { enable_thinking: false });
    assert.deepEqual(sent.json.response_format, { type: 'json_object' });
    // …the exact bytes we hashed are the exact bytes that arrived
    assert.equal(Buffer.from(d.requestBody, 'utf8').equals(sent.raw), true);
    // …and it is in the parsed answer
    assert.equal(d.move?.challenge, challenge);
    assert.equal(d.move?.action, 'raise');
    assert.equal(d.move?.amount, 40);
    assert.equal(independentCheck(d.receipt, challenge, 'raise', 40), null);
    assert.deepEqual(d.check, { ok: true, errors: [] });
    assert.equal(d.receipt.signingAddress, mock.signingAddress);
    // tampering is caught
    assert.equal(independentCheck(d.receipt, 'ff'.repeat(16), 'raise', 40), 'check5');
    assert.equal(independentCheck(d.receipt, challenge, 'raise', 41), 'check5-amount');
    assert.equal(independentCheck({ ...d.receipt, responseBody: d.receipt.responseBody.replace('Pressure', 'Pressur3') }, challenge, 'raise', 40), 'check4-hash');
    assert.equal(verifyReceipt(d.receipt, { challenge, action: 'call' }).ok, false);
    assert.equal(verifyReceipt(d.receipt, { challenge, action: 'raise', amount: 40 }, ['bb'.repeat(32)]).ok, false);
    assert.match(verificationUrl(d.receipt), /^https:\/\/cloud\.near\.ai\/verify\?model=Qwen%2FQwen3\.6-35B-A3B-FP8#receipt=/);
  });

  it('falls back to plain text when response_format is rejected; parses JSON inside prose/<think>', async () => {
    mock.rejectJsonMode = true;
    try {
      const tee = new Tee({ apiKey: 'test-key', baseUrl: mock.baseUrl });
      const challenge = 'ab'.repeat(16);
      const d = await tee.decide(msgs(challenge), challenge);
      assert.equal(mock.requests.at(-1)!.json.response_format, undefined);
      assert.equal(d.move?.action, 'call');
      assert.equal(independentCheck(d.receipt, challenge, 'call'), null);
    } finally {
      mock.rejectJsonMode = false;
    }
    assert.deepEqual(parseReply('<think>hmm {"x":1}</think>Sure: ```json\n{"challenge":"c","action":"fold","line":"bye"}\n```'), {
      challenge: 'c',
      action: 'fold',
      amount: undefined,
      line: 'bye',
    });
    assert.equal(parseReply('no json here'), null);
  });

  it('a reply with the wrong challenge fails the local check', async () => {
    const tee = new Tee({ apiKey: 'test-key', baseUrl: mock.baseUrl });
    const challenge = 'cd'.repeat(16);
    mock.script.push({ action: 'call', wrongChallenge: true });
    const d = await tee.decide(msgs(challenge), challenge);
    assert.notEqual(d.move?.challenge, challenge);
    assert.equal(d.check.ok, false);
  });
});
