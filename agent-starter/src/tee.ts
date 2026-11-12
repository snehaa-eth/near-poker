/**
 * NEAR AI Cloud (Confidential-TEE inference) client that produces arena move receipts.
 * INTERFACES.md §5.3.
 *
 *   1. POST {base}/chat/completions with the turn challenge in the prompt. The request body is
 *      serialized ONCE and those exact bytes are sent, so sha256(requestBody) is the requestHash
 *      the TEE signs. The response is read ONCE as raw bytes; `responseBody` is exactly those
 *      bytes decoded as UTF-8 (BOM kept), so sha256(utf8(responseBody)) is the responseHash.
 *   2. GET {base}/signature/<completion id>?model=…&signing_algo=ed25519
 *        → { text: "<model>:<requestHash>:<responseHash>", signature, signing_address, signing_algo }
 *   3. Verify locally (same checks the server runs) and build the receipt:
 *      { completionId, model, signatureKind:'provider_tee', signingAlgo:'ed25519',
 *        signingAddress, signedText, signature, responseBody }
 *   4. GET {base}/attestation/report?model=…&nonce=<fresh 32-byte hex>&signing_algo=ed25519 once at
 *      start-up: the signer must be a MODEL attestation signer (a TEE-hosted model), not a gateway.
 *
 * Cost: one completion (~600 prompt tokens, ≤160 output tokens) per call. Signature + attestation
 * fetches are not billed as completions. The API key only goes into the Authorization header.
 */
import { createHash, createPublicKey, randomBytes, verify as edVerify } from 'node:crypto';

export const NEARAI_BASE_URL = 'https://cloud-api.near.ai/v1';
export const NEARAI_DEFAULT_MODEL = 'Qwen/Qwen3.6-35B-A3B-FP8';

export type Receipt = {
  completionId: string;
  model: string;
  signatureKind: 'provider_tee';
  signingAlgo: 'ed25519';
  signingAddress: string; // 64-hex ed25519 public key
  signedText: string; // `${model}:${requestHash}:${responseHash}`
  signature: string; // 128-hex (64 bytes)
  responseBody: string; // exact raw JSON body of /v1/chat/completions
};

export type ReplyMove = { challenge: string; action: string; amount?: number; line: string };

export type TeeOptions = {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  fetch?: typeof fetch;
  /** budget per completion+signature, default 20000 (the server gives 30000 per turn) */
  timeoutMs?: number;
  maxTokens?: number;
  temperature?: number;
  /** signature may lag the completion by a moment; retries on 404, default 5 x 400ms */
  signatureRetries?: number;
  signatureRetryMs?: number;
};

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export type Decision = {
  move: ReplyMove | null; // null = model output had no usable JSON
  content: string;
  receipt: Receipt;
  requestBody: string;
  check: ReceiptCheck;
  latencyMs: number;
};

export const sha256Hex = (s: string | Uint8Array) => createHash('sha256').update(s).digest('hex');
const normHex = (s: string | undefined) => (s ?? '').trim().toLowerCase().replace(/^0x/, '');
const HEX64 = /^[0-9a-f]{64}$/;
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/** Signature from the API can be hex (with or without 0x) or base64 → 128-hex. */
export function normalizeSignature(sig: string): string {
  const h = normHex(sig);
  if (/^[0-9a-f]{128}$/.test(h)) return h;
  const b = Buffer.from(sig, 'base64');
  return b.length === 64 ? b.toString('hex') : h;
}

export function ed25519VerifyHex(message: string, signatureHex: string, publicKeyHex: string): boolean {
  try {
    const pk = Buffer.from(normHex(publicKeyHex), 'hex');
    const sig = Buffer.from(normHex(signatureHex), 'hex');
    if (pk.length !== 32 || sig.length !== 64) return false;
    const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, pk]), format: 'der', type: 'spki' });
    return edVerify(null, Buffer.from(message, 'utf8'), key, sig);
  } catch {
    return false;
  }
}

// ─── reply parsing ──────────────────────────────────────────────────────────

/** First balanced, parseable {...} in free text (string-aware). */
export function firstJsonObject(text: string): string | null {
  for (let start = text.indexOf('{'); start >= 0; start = text.indexOf('{', start + 1)) {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) {
        const cand = text.slice(start, i + 1);
        try {
          JSON.parse(cand);
          return cand;
        } catch {
          break;
        }
      }
    }
  }
  return null;
}

/** Parses the model reply. Strips Qwen <think> blocks and ```json fences. Does NOT normalize the action. */
export function parseReply(content: string | null | undefined): ReplyMove | null {
  if (!content) return null;
  const json = firstJsonObject(content.replace(/<think>[\s\S]*?<\/think>/gi, ''));
  if (!json) return null;
  const o = JSON.parse(json) as Record<string, unknown>;
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const action = typeof o.action === 'string' ? o.action : '';
  if (!action) return null;
  const amount = typeof o.amount === 'number' && Number.isFinite(o.amount) ? o.amount : undefined;
  const line = typeof o.line === 'string' ? o.line.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 80) : '';
  return { challenge: typeof o.challenge === 'string' ? o.challenge : '', action, amount, line };
}

// ─── receipt verification (mirrors the server's §5.3 checks 1–6) ────────────

export type ReceiptCheck = { ok: boolean; errors: string[] };

export function verifyReceipt(
  r: Receipt,
  expected: { challenge: string; action: string; amount?: number },
  attestedSigners?: string[],
): ReceiptCheck {
  const errors: string[] = [];
  // 1
  if (r.signatureKind !== 'provider_tee') errors.push('signatureKind != provider_tee');
  if (r.signingAlgo !== 'ed25519') errors.push('signingAlgo != ed25519');
  // 2
  const m = /^(.+):([0-9a-f]{64}):([0-9a-f]{64})$/.exec(r.signedText);
  if (!m || m[1] !== r.model) errors.push('signedText is not `${model}:${requestHash}:${responseHash}`');
  // 3
  if (!ed25519VerifyHex(r.signedText, r.signature, r.signingAddress)) errors.push('ed25519 signature does not verify');
  // 4
  if (m && sha256Hex(Buffer.from(r.responseBody, 'utf8')) !== m[3]) errors.push('sha256(responseBody) != responseHash');
  let body: { id?: string; model?: string; choices?: Array<{ message?: { content?: string } }> } = {};
  try {
    body = JSON.parse(r.responseBody);
  } catch {
    errors.push('responseBody is not JSON');
  }
  if (body.id !== r.completionId) errors.push('responseBody.id != completionId');
  if (body.model !== r.model) errors.push('responseBody.model != model');
  // 5
  const reply = parseReply(body.choices?.[0]?.message?.content);
  if (!reply) errors.push('no JSON object in the assistant reply');
  else {
    if (reply.challenge !== expected.challenge) errors.push('reply challenge != turn challenge');
    if (reply.action !== expected.action) errors.push('reply action != action');
    if (expected.action === 'raise' && reply.amount !== expected.amount) errors.push('reply amount != amount');
  }
  // 6
  if (attestedSigners && !attestedSigners.includes(normHex(r.signingAddress))) {
    errors.push('signingAddress is not a model-attestation signer');
  }
  return { ok: errors.length === 0, errors };
}

/** NEAR AI Verification Center link (INTERFACES.md §5.4). Paste it in a browser to check the TEE evidence. */
export function verificationUrl(r: Receipt, verifiedAt = new Date().toISOString()): string {
  const { responseBody: _omit, ...rest } = r;
  const b64 = Buffer.from(JSON.stringify({ ...rest, verifiedAt })).toString('base64url');
  return `https://cloud.near.ai/verify?model=${encodeURIComponent(r.model)}#receipt=${b64}`;
}

// ─── client ─────────────────────────────────────────────────────────────────

type SignatureResponse = { text?: string; signature?: string; signing_address?: string; signing_algo?: string; signature_kind?: string; error_code?: string };
type AttestationReport = { model_attestations?: Array<{ signing_address?: string; request_nonce?: string }> };

export class Tee {
  readonly model: string;
  readonly baseUrl: string;
  private readonly doFetch: typeof fetch;
  private jsonMode = true;
  /** model-attestation signers seen in a nonce-bound report */
  signers: string[] = [];
  /** completions requested (billable calls) */
  calls = 0;

  constructor(private readonly opts: TeeOptions) {
    if (!opts.apiKey) throw new Error('NEARAI_API_KEY is required');
    this.model = opts.model || NEARAI_DEFAULT_MODEL;
    this.baseUrl = (opts.baseUrl || NEARAI_BASE_URL).replace(/\/$/, '');
    this.doFetch = opts.fetch ?? fetch;
  }

  private get auth() {
    return { Authorization: `Bearer ${this.opts.apiKey}`, Accept: 'application/json' };
  }

  /** Fetch the model attestation report with a fresh nonce and record its signer set. Not a completion. */
  async attest(): Promise<{ ok: boolean; signers: string[]; nonce: string; error?: string; authError?: boolean }> {
    const nonce = randomBytes(32).toString('hex');
    try {
      const qs = new URLSearchParams({ model: this.model, nonce, signing_algo: 'ed25519' });
      const r = await this.doFetch(`${this.baseUrl}/attestation/report?${qs}`, {
        headers: { ...this.auth, 'x-no-aliasing': 'true' },
        signal: AbortSignal.timeout(15_000),
      });
      if (r.status === 401 || r.status === 403) {
        return { ok: false, signers: [], nonce, error: `HTTP ${r.status}: invalid NEARAI_API_KEY (check the key at https://cloud.near.ai)`, authError: true };
      }
      if (!r.ok) return { ok: false, signers: [], nonce, error: `HTTP ${r.status}` };
      const rep = (await r.json()) as AttestationReport;
      const signers = [
        ...new Set(
          (rep.model_attestations ?? []).filter((a) => a.request_nonce === nonce && normHex(a.signing_address)).map((a) => normHex(a.signing_address)),
        ),
      ];
      this.signers = signers;
      return signers.length
        ? { ok: true, signers, nonce }
        : { ok: false, signers, nonce, error: 'no nonce-bound model attestation (gateway-only / Incognito model?)' };
    } catch (e) {
      return { ok: false, signers: [], nonce, error: (e as Error).message };
    }
  }

  private async complete(messages: ChatMessage[], signal: AbortSignal) {
    const send = async (json: boolean) => {
      const requestBody = JSON.stringify({
        model: this.model,
        messages,
        max_tokens: this.opts.maxTokens ?? 160,
        temperature: this.opts.temperature ?? 0.6,
        chat_template_kwargs: { enable_thinking: false }, // Qwen3: no hidden reasoning, fewer tokens
        ...(json ? { response_format: { type: 'json_object' } } : {}),
      });
      this.calls += 1;
      const res = await this.doFetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { ...this.auth, 'Content-Type': 'application/json', 'Accept-Encoding': 'identity', 'x-no-aliasing': 'true' },
        body: requestBody,
        signal,
      });
      return { res, requestBody };
    };
    let { res, requestBody } = await send(this.jsonMode);
    if (this.jsonMode && (res.status === 400 || res.status === 422)) {
      this.jsonMode = false; // response_format not supported → plain text, JSON extracted from content
      await res.arrayBuffer().catch(() => undefined);
      ({ res, requestBody } = await send(false));
    }
    const bytes = new Uint8Array(await res.arrayBuffer()); // read the body ONCE, keep exact bytes
    if (res.status === 401 || res.status === 403) throw new Error(`chat/completions HTTP ${res.status}: invalid NEARAI_API_KEY (or no credit left)`);
    if (!res.ok) throw new Error(`chat/completions HTTP ${res.status}: ${Buffer.from(bytes).toString('utf8').slice(0, 200)}`);
    const responseBody = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    if (sha256Hex(Buffer.from(responseBody, 'utf8')) !== sha256Hex(bytes)) throw new Error('response body is not round-trippable UTF-8');
    return { requestBody, responseBody, responseHash: sha256Hex(bytes) };
  }

  private async signature(id: string, signal: AbortSignal): Promise<SignatureResponse> {
    const qs = new URLSearchParams({ model: this.model, signing_algo: 'ed25519' });
    const tries = this.opts.signatureRetries ?? 5;
    for (let i = 0; ; i++) {
      const r = await this.doFetch(`${this.baseUrl}/signature/${encodeURIComponent(id)}?${qs}`, { headers: this.auth, signal });
      if (r.ok) {
        const s = (await r.json()) as SignatureResponse;
        if (!s.error_code && s.text && s.signature) return s;
        if (i >= tries) throw new Error(`signature unavailable: ${s.error_code ?? 'empty'}`);
      } else if (i >= tries || (r.status !== 404 && r.status < 500)) {
        throw new Error(`signature HTTP ${r.status}`);
      }
      await new Promise((ok) => setTimeout(ok, this.opts.signatureRetryMs ?? 400));
    }
  }

  /** One TEE completion → parsed move + receipt (+ local verification against `challenge`). */
  async decide(messages: ChatMessage[], challenge: string): Promise<Decision> {
    const t0 = Date.now();
    const signal = AbortSignal.timeout(this.opts.timeoutMs ?? 20_000);
    const { requestBody, responseBody, responseHash } = await this.complete(messages, signal);
    const body = JSON.parse(responseBody) as { id?: string; model?: string; choices?: Array<{ message?: { content?: string } }> };
    if (!body.id) throw new Error('completion has no id');
    const content = body.choices?.[0]?.message?.content ?? '';
    const sig = await this.signature(body.id, signal);
    if (sig.signature_kind && sig.signature_kind !== 'provider_tee') throw new Error(`signature_kind ${sig.signature_kind} is not a TEE model signature`);
    if ((sig.signing_algo ?? 'ed25519').toLowerCase() !== 'ed25519') throw new Error(`signing_algo ${sig.signing_algo}`);
    const text = sig.text!;
    const m = /^(.+):([0-9a-f]{64}):([0-9a-f]{64})$/.exec(text);
    if (!m) throw new Error(`unexpected signed text format: ${text.slice(0, 120)}`);
    if (m[2] !== sha256Hex(requestBody)) throw new Error('signed requestHash != sha256(request body we sent)');
    if (m[3] !== responseHash) throw new Error('signed responseHash != sha256(response body we received)');
    const receipt: Receipt = {
      completionId: body.id,
      model: m[1]!,
      signatureKind: 'provider_tee',
      signingAlgo: 'ed25519',
      signingAddress: normHex(sig.signing_address),
      signedText: text,
      signature: normalizeSignature(sig.signature!),
      responseBody,
    };
    if (!HEX64.test(receipt.signingAddress)) throw new Error('signing_address is not a 64-hex ed25519 key');
    const move = parseReply(content);
    const check = move
      ? verifyReceipt(receipt, { challenge, action: move.action, amount: move.amount }, this.signers.length ? this.signers : undefined)
      : { ok: false, errors: ['no JSON object in the assistant reply'] };
    return { move, content, receipt, requestBody, check, latencyMs: Date.now() - t0 };
  }
}
