import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';

import { checkSignature, createBrain, ed25519Verify } from './nearai.js';
import { snap } from './test-fixtures.js';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const MODEL = 'Qwen/Qwen3.6-35B-A3B-FP8';

function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const x = publicKey.export({ format: 'jwk' }).x!;
  const hex = Buffer.from(x, 'base64url').toString('hex');
  return { hex, signHex: (text: string) => sign(null, Buffer.from(text, 'utf8'), privateKey).toString('hex') };
}

/** Mock NEAR AI Cloud: attestation report bound to the request nonce, completion, signature. */
function mockCloud(kp: ReturnType<typeof keypair>, opts: { content?: string; tamper?: 'sig' | 'response' | 'signer' | 'nonce'; rejectJsonMode?: boolean } = {}) {
  const calls: string[] = [];
  let nonce = '';
  let reqBody = '';
  const respBody = JSON.stringify({ id: 'chatcmpl-1', model: MODEL, choices: [{ message: { content: opts.content ?? '{"action":"call","line":"I see you"}' } }] });
  const f = (async (url: string, init?: RequestInit) => {
    calls.push(url);
    const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
    assert.equal(auth, 'Bearer test-key');
    if (url.includes('/attestation/report')) {
      nonce = new URL(url).searchParams.get('nonce')!;
      assert.match(nonce, /^[0-9a-f]{64}$/);
      return Response.json({
        gateway_attestation: { signing_address: 'aa', request_nonce: nonce, intel_quote: 'q' },
        model_attestations: [{ signing_address: kp.hex, signing_algo: 'ed25519', request_nonce: opts.tamper === 'nonce' ? 'ff'.repeat(32) : nonce }],
      });
    }
    if (url.endsWith('/chat/completions')) {
      reqBody = init!.body as string;
      if (opts.rejectJsonMode && JSON.parse(reqBody).response_format) return new Response('bad param', { status: 400 });
      return new Response(respBody, { status: 200 });
    }
    if (url.includes('/signature/chatcmpl-1')) {
      const text = `${MODEL}:${sha(reqBody)}:${sha(opts.tamper === 'response' ? respBody + ' ' : respBody)}`;
      let signature = kp.signHex(text);
      if (opts.tamper === 'sig') signature = (signature[0] === '0' ? '1' : '0') + signature.slice(1);
      const signer = opts.tamper === 'signer' ? keypair() : kp;
      if (opts.tamper === 'signer') signature = signer.signHex(text);
      return Response.json({ text, signature, signing_address: signer.hex, signing_algo: 'ed25519', signature_kind: 'provider_tee' });
    }
    throw new Error('unexpected ' + url);
  }) as unknown as typeof fetch;
  return { f, calls, getNonce: () => nonce };
}

test('ed25519Verify with a locally generated key', () => {
  const kp = keypair();
  const sig = kp.signHex('hello');
  assert.equal(ed25519Verify('hello', sig, kp.hex), true);
  assert.equal(ed25519Verify('hello!', sig, kp.hex), false);
  assert.equal(ed25519Verify('hello', sig, keypair().hex), false);
  assert.equal(ed25519Verify('hello', Buffer.from(sig, 'hex').toString('base64'), '0x' + kp.hex), true);
  assert.equal(ed25519Verify('hello', 'zz', kp.hex), false);
});

test('attest + decide → verified move', async () => {
  const kp = keypair();
  const m = mockCloud(kp);
  const brain = createBrain({ apiKey: 'test-key', model: MODEL, fetch: m.f });
  const a = await brain.attest();
  assert.equal(a.ok, true);
  assert.equal(a.nonceEcho, true);
  assert.deepEqual(a.signingAddresses, [kp.hex]);
  assert.equal(a.nonce, m.getNonce());
  const d = await brain.decide(snap());
  assert.deepEqual([d.action, d.line, d.chatId, d.verified, d.signingAddress], ['call', 'I see you', 'chatcmpl-1', true, kp.hex]);
  const req = m.calls.find((u) => u.endsWith('/chat/completions'));
  assert.ok(req);
});

for (const tamper of ['sig', 'response', 'signer', 'nonce'] as const) {
  test(`tampered ${tamper} → not verified`, async () => {
    const kp = keypair();
    const brain = createBrain({ apiKey: 'test-key', model: MODEL, fetch: mockCloud(kp, { tamper }).f });
    const a = await brain.attest();
    if (tamper === 'nonce') assert.equal(a.ok, false);
    const d = await brain.decide(snap());
    assert.equal(d.verified, false);
    const c = await d.verification;
    if (tamper === 'sig') assert.equal(c.signature_valid, false);
    if (tamper === 'response') assert.equal(c.hashes_match, false);
    if (tamper === 'signer' || tamper === 'nonce') assert.equal(c.signer_in_attestation_report, false);
  });
}

test('no attestation → signature valid but not verified', async () => {
  const kp = keypair();
  const brain = createBrain({ apiKey: 'test-key', model: MODEL, fetch: mockCloud(kp).f });
  const d = await brain.decide(snap()); // attest() never called
  const c = await d.verification;
  assert.equal(c.signature_valid, true);
  assert.equal(c.hashes_match, true);
  assert.equal(d.verified, false);
});

test('response_format rejected → retried without it, still parsed', async () => {
  const kp = keypair();
  const m = mockCloud(kp, { rejectJsonMode: true, content: 'Okay: {"action":"fold","line":"not today"} done' });
  const brain = createBrain({ apiKey: 'test-key', model: MODEL, fetch: m.f });
  await brain.attest();
  const d = await brain.decide(snap());
  assert.equal(d.action, 'fold');
  assert.equal(d.verified, true); // signature binds the retried (exact) request body
  assert.equal(m.calls.filter((u) => u.endsWith('/chat/completions')).length, 2);
});

test('checkSignature gateway kind', () => {
  const kp = keypair();
  const text = `${'a'.repeat(64)}:${'b'.repeat(64)}`;
  const r = checkSignature(
    { text, signature: kp.signHex(text), signing_address: kp.hex, signing_algo: 'ed25519', signature_kind: 'gateway' },
    MODEL, 'a'.repeat(64), 'b'.repeat(64),
    { gateway_attestation: { signing_address: kp.hex, request_nonce: 'n' } }, 'n',
  );
  assert.equal(r.verified_locally, true);
});

test('createBrain requires a key', () => {
  assert.throws(() => createBrain({ apiKey: '' }));
});
