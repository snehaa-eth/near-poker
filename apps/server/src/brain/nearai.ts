/**
 * NEAR AI Cloud (TEE inference) client for the bot brain, with response verification.
 * Ported from intent-guard/guard/src/explain.ts — see that file's header for the API facts.
 *
 *  - attest(): once per runner. GET /v1/attestation/report?model&provider=near&signing_algo=ed25519
 *    &nonce=<fresh 32-byte hex>. We record the advertised signing address(es) and check that the
 *    report echoes our nonce. We do NOT verify the Intel TDX quote / NVIDIA evidence locally
 *    (needs a DCAP verifier); feed the stored nonce+report to github.com/nearai/nearai-cloud-verifier.
 *  - decide(): POST /v1/chat/completions (OpenAI-compatible), then
 *    GET /v1/signature/<chat_id>?model&signing_algo=ed25519 and checkSignature():
 *      (a) signed text commits to sha256(exact request bytes) + sha256(exact response bytes)
 *      (b) ed25519 signature over the text verifies against signing_address (hex pubkey)
 *      (c) signer appears in the nonce-bound attestation report fetched by attest()
 *
 * ed25519 verification uses node:crypto (no tweetnacl / @noble/curves dependency needed).
 * The API key only ever goes into the Authorization header; it is never logged.
 */
import { createHash, createPublicKey, randomBytes, verify as edVerify } from 'node:crypto';

import { buildMessages, parseMove, type RawMove, type Snapshot } from './prompt.js';

export const NEARAI_BASE_URL = 'https://cloud-api.near.ai/v1';
export const NEARAI_DEFAULT_MODEL = 'Qwen/Qwen3.6-35B-A3B-FP8';

export type BrainOptions = {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  /** total budget per decision (completion + signature). default 6000 */
  timeoutMs?: number;
  /** budget for attest(). default 10000 */
  attestTimeoutMs?: number;
  /** wait for the signature check before returning (inside the budget). default true */
  awaitSignature?: boolean;
  maxTokens?: number;
  temperature?: number;
};

export type AttestationSummary = {
  ok: boolean;
  model: string;
  nonce: string;
  /** signing addresses of model attestations whose request_nonce echoes our nonce */
  signingAddresses: string[];
  gatewaySigningAddress?: string;
  nonceEcho: boolean;
  modelAttestationCount: number;
  gatewayQuoteSha256?: string;
  error?: string;
};

export type SignatureCheck = {
  signature_kind: string;
  signing_address?: string;
  hashes_match: boolean;
  signature_valid: boolean;
  signer_in_attestation_report: boolean;
  verified_locally: boolean;
  error?: string;
};

export type BrainMove = RawMove & {
  chatId: string;
  model: string;
  verified: boolean;
  signingAddress?: string;
  /** settles with the signature check (already settled if awaitSignature) */
  verification: Promise<SignatureCheck>;
  latencyMs: number;
};

export type Brain = {
  model: string;
  attest(): Promise<AttestationSummary>;
  /** Throws on timeout / HTTP error / unparseable output — callers fall back to rules. */
  decide(input: Snapshot): Promise<BrainMove>;
};

type SignatureResponse = {
  text?: string;
  signature?: string;
  signing_address?: string;
  signing_algo?: string;
  signature_kind?: string;
  error_code?: string;
};
type AttestationEntry = { signing_address?: string; signing_algo?: string; request_nonce?: string; intel_quote?: string };
export type AttestationReport = { gateway_attestation?: AttestationEntry; model_attestations?: AttestationEntry[] };

const sha256Hex = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const normHex = (s: string | undefined) => (s ?? '').toLowerCase().replace(/^0x/, '');
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/** ed25519 verify with a raw 32-byte public key (hex) via node:crypto. */
export function ed25519Verify(message: string, signatureHexOrB64: string, publicKeyHex: string): boolean {
  try {
    const pk = Buffer.from(normHex(publicKeyHex), 'hex');
    const s = normHex(signatureHexOrB64);
    const sig = /^[0-9a-f]+$/.test(s) ? Buffer.from(s, 'hex') : Buffer.from(signatureHexOrB64, 'base64');
    if (pk.length !== 32 || sig.length !== 64) return false;
    const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, pk]), format: 'der', type: 'spki' });
    return edVerify(null, Buffer.from(message, 'utf8'), key, sig);
  } catch {
    return false;
  }
}

export function summarizeReport(report: AttestationReport | undefined, model: string, nonce: string, error?: string): AttestationSummary {
  const models = report?.model_attestations ?? [];
  const echoed = models.filter((a) => a.request_nonce === nonce && normHex(a.signing_address));
  const g = report?.gateway_attestation;
  const gatewayOk = !!g && g.request_nonce === nonce && !!normHex(g.signing_address);
  const signingAddresses = [...new Set(echoed.map((a) => normHex(a.signing_address)))];
  const nonceEcho = echoed.length > 0 || gatewayOk;
  return {
    ok: !error && signingAddresses.length > 0,
    model,
    nonce,
    signingAddresses,
    gatewaySigningAddress: gatewayOk ? normHex(g!.signing_address) : undefined,
    nonceEcho,
    modelAttestationCount: models.length,
    gatewayQuoteSha256: g?.intel_quote ? sha256Hex(g.intel_quote) : undefined,
    error: error ?? (report && signingAddresses.length === 0 ? 'no nonce-bound model signing address in report' : undefined),
  };
}

/** Pure verification step (mirrors explain.ts checkSignature). */
export function checkSignature(
  sig: SignatureResponse,
  model: string,
  requestHash: string,
  responseHash: string,
  report: AttestationReport | undefined,
  nonce: string,
): SignatureCheck {
  const kind = sig.signature_kind ?? 'unknown';
  const expectedText = kind === 'provider_tee' ? `${model}:${requestHash}:${responseHash}` : `${requestHash}:${responseHash}`;
  const hashesMatch = sig.text === expectedText;
  const signatureValid =
    (sig.signing_algo ?? '').toLowerCase() === 'ed25519' &&
    ed25519Verify(sig.text ?? '', sig.signature ?? '', sig.signing_address ?? '');
  const signer = normHex(sig.signing_address);
  let signerInReport = false;
  if (report && signer) {
    if (kind === 'provider_tee') {
      const m = (report.model_attestations ?? []).filter((a) => normHex(a.signing_address) === signer);
      signerInReport = m.length === 1 && m[0]!.request_nonce === nonce;
    } else if (kind === 'gateway') {
      const g = report.gateway_attestation;
      signerInReport = !!g && normHex(g.signing_address) === signer && g.request_nonce === nonce;
    }
  }
  return {
    signature_kind: kind,
    signing_address: sig.signing_address,
    hashes_match: hashesMatch,
    signature_valid: signatureValid,
    signer_in_attestation_report: signerInReport,
    verified_locally: hashesMatch && signatureValid && signerInReport,
  };
}

const failedCheck = (error: string): SignatureCheck => ({
  signature_kind: 'unknown',
  hashes_match: false,
  signature_valid: false,
  signer_in_attestation_report: false,
  verified_locally: false,
  error,
});

export function createBrain(opts: BrainOptions): Brain {
  if (!opts.apiKey) throw new Error('createBrain: apiKey required');
  const model = opts.model ?? NEARAI_DEFAULT_MODEL;
  const baseUrl = (opts.baseUrl ?? NEARAI_BASE_URL).replace(/\/$/, '');
  const doFetch = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 6000;
  const awaitSignature = opts.awaitSignature ?? true;
  const auth = { Authorization: `Bearer ${opts.apiKey}`, Accept: 'application/json' };
  let report: AttestationReport | undefined;
  let nonce = '';
  let jsonModeSupported = true;

  async function attest(): Promise<AttestationSummary> {
    nonce = randomBytes(32).toString('hex');
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), opts.attestTimeoutMs ?? 10_000);
    try {
      const qs = new URLSearchParams({ model, provider: 'near', signing_algo: 'ed25519', nonce });
      const r = await doFetch(`${baseUrl}/attestation/report?${qs}`, {
        headers: { ...auth, 'x-no-aliasing': 'true' },
        signal: ac.signal,
      });
      if (!r.ok) return summarizeReport(undefined, model, nonce, `HTTP ${r.status}`);
      report = (await r.json()) as AttestationReport;
      return summarizeReport(report, model, nonce);
    } catch (e) {
      return summarizeReport(undefined, model, nonce, ac.signal.aborted ? 'timeout' : (e as Error).message);
    } finally {
      clearTimeout(t);
    }
  }

  async function complete(messages: unknown, signal: AbortSignal) {
    const send = async (json: boolean) => {
      const requestBody = JSON.stringify({
        model,
        messages,
        max_tokens: opts.maxTokens ?? 160,
        temperature: opts.temperature ?? 0.7,
        // Qwen3 "thinks" before answering by default; a poker move doesn't need it
        // (≈1 s and ~30 output tokens instead of hundreds).
        chat_template_kwargs: { enable_thinking: false },
        ...(json ? { response_format: { type: 'json_object' } } : {}),
      });
      const res = await doFetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json', 'Accept-Encoding': 'identity', 'x-no-aliasing': 'true' },
        body: requestBody,
        signal,
      });
      return { res, requestBody };
    };
    let { res, requestBody } = await send(jsonModeSupported);
    if (jsonModeSupported && (res.status === 400 || res.status === 422)) {
      jsonModeSupported = false; // response_format rejected → plain text + first-JSON-object parsing
      ({ res, requestBody } = await send(false));
    }
    if (!res.ok) throw new Error(`chat/completions HTTP ${res.status}`);
    const responseText = await res.text();
    return { requestBody, responseText };
  }

  async function fetchSignature(chatId: string, requestHash: string, responseHash: string, signal: AbortSignal): Promise<SignatureCheck> {
    try {
      const qs = new URLSearchParams({ model, signing_algo: 'ed25519' });
      const sr = await doFetch(`${baseUrl}/signature/${encodeURIComponent(chatId)}?${qs}`, { headers: auth, signal });
      if (!sr.ok) return failedCheck(`signature HTTP ${sr.status}`);
      const sig = (await sr.json()) as SignatureResponse;
      if (sig.error_code || !sig.text || !sig.signature) return failedCheck(sig.error_code ?? 'signature unavailable');
      return checkSignature(sig, model, requestHash, responseHash, report, nonce);
    } catch (e) {
      return failedCheck(signal.aborted ? 'signature timeout' : (e as Error).message);
    }
  }

  async function decide(input: Snapshot): Promise<BrainMove> {
    const t0 = Date.now();
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const { requestBody, responseText } = await complete(buildMessages(input), ac.signal);
      const completion = JSON.parse(responseText) as { id?: string; model?: string; choices?: Array<{ message?: { content?: string } }> };
      const move = parseMove(completion.choices?.[0]?.message?.content);
      if (!move) throw new Error('unparseable model output');
      const chatId = completion.id ?? '';
      // Signature check: its own controller so a slow signature never voids an obtained move.
      const sigAc = new AbortController();
      const remaining = Math.max(250, timeoutMs - (Date.now() - t0));
      const sigTimer = setTimeout(() => sigAc.abort(), awaitSignature ? remaining : Math.max(remaining, 5000));
      const verification = (chatId ? fetchSignature(chatId, sha256Hex(requestBody), sha256Hex(responseText), sigAc.signal) : Promise.resolve(failedCheck('no chat id')))
        .finally(() => clearTimeout(sigTimer));
      clearTimeout(timer);
      const base = { ...move, chatId, model: completion.model ?? model, verification };
      if (!awaitSignature) return { ...base, verified: false, latencyMs: Date.now() - t0 };
      const check = await verification;
      return { ...base, verified: check.verified_locally, signingAddress: check.signing_address, latencyMs: Date.now() - t0 };
    } finally {
      clearTimeout(timer);
    }
  }

  return { model, attest, decide };
}
