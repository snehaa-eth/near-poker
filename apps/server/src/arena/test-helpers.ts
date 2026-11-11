/** Test-only helpers: local ed25519 "TEE" keys, mock completions/receipts, mock attestation API. */
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';

import type { MoveReceipt } from './receipt.js';

export const MODEL = 'Qwen/Qwen3.6-35B-A3B-FP8';
export const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

export type TeeKey = { hex: string; signHex: (text: string) => string };

export function teeKey(): TeeKey {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const hex = Buffer.from(publicKey.export({ format: 'jwk' }).x!, 'base64url').toString('hex');
  return { hex, signHex: (text) => sign(null, Buffer.from(text, 'utf8'), privateKey).toString('hex') };
}

export type Decision = { challenge: string; action: string; amount?: number; [k: string]: unknown };

/** Build a receipt the way the starter kit does (mock completion body + signature). */
export function makeReceipt(
  key: TeeKey,
  decision: Decision,
  opts: { model?: string; id?: string; content?: string; bodyModel?: string | null } = {}
): MoveReceipt {
  const model = opts.model ?? MODEL;
  const id = opts.id ?? `chatcmpl-${randomBytes(8).toString('hex')}`;
  const requestBody = JSON.stringify({ model, messages: [{ role: 'user', content: `secret prompt ${decision.challenge}` }] });
  const body: Record<string, unknown> = {
    id,
    object: 'chat.completion',
    choices: [{ index: 0, message: { role: 'assistant', content: opts.content ?? `Thinking... ${JSON.stringify(decision)}` } }],
  };
  if (opts.bodyModel !== null) body.model = opts.bodyModel ?? model;
  const responseBody = JSON.stringify(body);
  const signedText = `${model}:${sha(requestBody)}:${sha(responseBody)}`;
  return {
    completionId: id,
    model,
    signatureKind: 'provider_tee',
    signingAlgo: 'ed25519',
    signingAddress: key.hex,
    signedText,
    signature: key.signHex(signedText),
    responseBody,
  };
}

/**
 * Mock GET /attestation/report: `signers[model]` = model attestation signing addresses
 * (empty / absent → gateway-only). Echoes the request nonce unless `badNonce`.
 */
export function mockAttestationFetch(signers: Record<string, string[]>, opts: { badNonce?: boolean; status?: number } = {}) {
  const calls: string[] = [];
  const f = (async (url: string | URL) => {
    const u = new URL(String(url));
    calls.push(u.toString());
    if (!u.pathname.endsWith('/attestation/report')) throw new Error(`unexpected mock call ${u}`);
    if (opts.status) return new Response('nope', { status: opts.status });
    const nonce = u.searchParams.get('nonce')!;
    const model = u.searchParams.get('model')!;
    return Response.json({
      gateway_attestation: { signing_address: 'ab'.repeat(32), request_nonce: nonce, intel_quote: 'q' },
      model_attestations: (signers[model] ?? []).map((a) => ({
        signing_address: a,
        signing_algo: 'ed25519',
        request_nonce: opts.badNonce ? 'ff'.repeat(32) : nonce,
      })),
    });
  }) as unknown as typeof fetch;
  return { f, calls };
}
