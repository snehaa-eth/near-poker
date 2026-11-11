/**
 * TEE move receipt verification (INTERFACES.md §5.3 checks 1–5, plus an optional pure
 * check 6 when the caller passes the attested signer set for the model).
 *
 * Pure: no network, no clock. The attestation fetch/cache lives in attestation.ts.
 */
import { createHash } from 'node:crypto';

import { ed25519Verify } from '../brain/nearai.js';

export type ArenaAction = 'fold' | 'check' | 'call' | 'raise';
export const ARENA_ACTIONS: readonly ArenaAction[] = ['fold', 'check', 'call', 'raise'];

export type MoveReceipt = {
  completionId: string;
  model: string;
  signatureKind: 'provider_tee';
  signingAlgo: 'ed25519';
  /** 64-hex ed25519 public key */
  signingAddress: string;
  signedText: string;
  /** hex, 64 bytes */
  signature: string;
  /** exact raw JSON body of the /v1/chat/completions response */
  responseBody: string;
};

export type ReceiptRejectReason =
  | 'BadReceipt'
  | 'BadSignatureKind'
  | 'BadSigningAlgo'
  | 'BadSignedText'
  | 'ModelMismatch'
  | 'BadSignature'
  | 'ResponseHashMismatch'
  | 'BadResponseBody'
  | 'CompletionIdMismatch'
  | 'ChallengeNotInResponse'
  | 'ActionMismatch'
  | 'AmountMismatch'
  | 'SignerNotAttested';

export type VerifyReceiptInput = {
  receipt: unknown;
  challenge: string;
  action: ArenaAction;
  amount?: number;
  /** Optional §5.3 check 6: attested model signer set (64-hex, any case). */
  attestation?: { signingAddresses: readonly string[] };
};

export type VerifyReceiptResult =
  | {
      ok: true;
      receipt: MoveReceipt;
      requestHash: string;
      responseHash: string;
      /** The JSON object from the model's reply that carries the challenge. */
      decision: Record<string, unknown>;
    }
  | { ok: false; reason: ReceiptRejectReason; detail?: string };

const HEX64 = /^[0-9a-f]{64}$/;
const sha256Hex = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
export const normHex = (s: string) => s.trim().toLowerCase().replace(/^0x/, '');

const fail = (reason: ReceiptRejectReason, detail?: string): VerifyReceiptResult => ({
  ok: false,
  reason,
  ...(detail ? { detail } : {}),
});

function isNonEmptyString(v: unknown, max = 1 << 20): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= max;
}

/** Structural parse of an untrusted receipt. */
export function parseReceipt(raw: unknown): MoveReceipt | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const fields = ['completionId', 'model', 'signatureKind', 'signingAlgo', 'signingAddress', 'signedText', 'signature'];
  for (const f of fields) if (!isNonEmptyString(r[f], 4096)) return null;
  // Body of one chat completion; 256 KiB is plenty for a poker decision.
  if (!isNonEmptyString(r.responseBody, 256 * 1024)) return null;
  return {
    completionId: r.completionId as string,
    model: r.model as string,
    signatureKind: r.signatureKind as 'provider_tee',
    signingAlgo: r.signingAlgo as 'ed25519',
    signingAddress: r.signingAddress as string,
    signedText: r.signedText as string,
    signature: r.signature as string,
    responseBody: r.responseBody as string,
  };
}

/** Every balanced top-level `{…}` substring (string-aware), in order. */
export function jsonObjectCandidates(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      if (depth > 0) inStr = true;
    } else if (c === '{') {
      if (depth === 0) start = i;
      depth += 1;
    } else if (c === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        out.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return out;
}

/** First JSON object in `content` whose `"challenge"` equals `challenge`. */
export function findChallengeObject(content: string, challenge: string): Record<string, unknown> | null {
  for (const cand of jsonObjectCandidates(content)) {
    try {
      const obj = JSON.parse(cand) as unknown;
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        const o = obj as Record<string, unknown>;
        if (typeof o.challenge === 'string' && o.challenge.trim().toLowerCase() === challenge.toLowerCase()) return o;
      }
    } catch {
      // not JSON — keep scanning
    }
  }
  return null;
}

export function verifyReceipt(input: VerifyReceiptInput): VerifyReceiptResult {
  const receipt = parseReceipt(input.receipt);
  if (!receipt) return fail('BadReceipt', 'missing or non-string receipt fields');

  // 1. kind + algo
  if (receipt.signatureKind !== 'provider_tee') return fail('BadSignatureKind', String(receipt.signatureKind));
  if (receipt.signingAlgo !== 'ed25519') return fail('BadSigningAlgo', String(receipt.signingAlgo));

  // 2. signedText = `${model}:${requestHash}:${responseHash}`
  const parts = receipt.signedText.split(':');
  if (parts.length < 3) return fail('BadSignedText');
  const responseHash = parts.pop()!;
  const requestHash = parts.pop()!;
  const signedModel = parts.join(':');
  if (!HEX64.test(requestHash) || !HEX64.test(responseHash)) return fail('BadSignedText', 'hashes must be 64 lowercase hex');
  if (signedModel !== receipt.model) return fail('ModelMismatch', 'signedText model != receipt.model');

  // 3. ed25519 over UTF-8 signedText with signingAddress
  const addr = normHex(receipt.signingAddress);
  const sig = normHex(receipt.signature);
  if (!HEX64.test(addr)) return fail('BadSignature', 'signingAddress must be a 64-hex ed25519 key');
  if (!/^[0-9a-f]{128}$/.test(sig)) return fail('BadSignature', 'signature must be 64 bytes hex');
  if (!ed25519Verify(receipt.signedText, sig, addr)) return fail('BadSignature');

  // 4. response body binds hash, id and model
  if (sha256Hex(receipt.responseBody) !== responseHash) return fail('ResponseHashMismatch');
  let body: { id?: unknown; model?: unknown; choices?: Array<{ message?: { content?: unknown } }> };
  try {
    body = JSON.parse(receipt.responseBody);
  } catch {
    return fail('BadResponseBody', 'not JSON');
  }
  if (!body || typeof body !== 'object') return fail('BadResponseBody');
  if (body.id !== receipt.completionId) return fail('CompletionIdMismatch');
  // The TEE-signed model is in signedText (check 2); the body's model, when present, must agree.
  if (body.model !== undefined && body.model !== receipt.model) return fail('ModelMismatch', 'response body model differs');

  // 5. the assistant's decision carries this turn's challenge, action and amount
  const content = Array.isArray(body.choices) ? body.choices[0]?.message?.content : undefined;
  if (typeof content !== 'string') return fail('BadResponseBody', 'no choices[0].message.content');
  const decision = findChallengeObject(content, input.challenge);
  if (!decision) return fail('ChallengeNotInResponse');
  const said = typeof decision.action === 'string' ? decision.action.trim().toLowerCase() : '';
  if (said !== input.action) return fail('ActionMismatch', `reply says ${JSON.stringify(decision.action)}`);
  if (input.action === 'raise') {
    const amt = Number(decision.amount);
    if (!Number.isFinite(amt) || amt !== input.amount) return fail('AmountMismatch');
  }

  // 6. (optional, pure) signer is in the model attestation set
  if (input.attestation) {
    const set = new Set(input.attestation.signingAddresses.map(normHex));
    if (!set.has(addr)) return fail('SignerNotAttested');
  }

  return { ok: true, receipt, requestHash, responseHash, decision };
}

/** INTERFACES §5.4 NEAR AI Verification Center link (no responseBody). */
export function receiptUrl(r: {
  completionId: string;
  model: string;
  signatureKind: string;
  signingAlgo: string;
  signingAddress: string;
  signedText: string;
  signature: string;
  verifiedAt: string;
}): string {
  const json = JSON.stringify({
    completionId: r.completionId,
    model: r.model,
    signatureKind: r.signatureKind,
    signingAlgo: r.signingAlgo,
    signingAddress: r.signingAddress,
    signedText: r.signedText,
    signature: r.signature,
    verifiedAt: r.verifiedAt,
  });
  return `https://cloud.near.ai/verify?model=${encodeURIComponent(r.model)}#receipt=${Buffer.from(json, 'utf8').toString('base64url')}`;
}
