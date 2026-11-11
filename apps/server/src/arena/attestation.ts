/**
 * Model attestation signer sets (INTERFACES.md §5.3 check 6).
 *
 * GET {base}/attestation/report?model&nonce=<fresh 32-byte hex>&signing_algo=ed25519 — parsed
 * exactly like brain/nearai.ts attest(): only `model_attestations[]` entries that echo our nonce
 * and carry a non-empty `signing_address` count. Gateway-only / Incognito models have none →
 * every receipt for them is rejected.
 *
 * Cache per model for `ttlMs`. A signer that is not in a fresh-enough set triggers ONE refetch
 * (at most every `minRefetchMs` per model, so a flood of bogus receipts can't hammer the API).
 * The API key is used only for this GET (no completions) and never logged.
 */
import { randomBytes } from 'node:crypto';

import { summarizeReport, type AttestationReport } from '../brain/nearai.js';
import { getArenaConfig } from './config.js';
import { normHex } from './receipt.js';

export type AttestationFetchResult =
  | { ok: true; signers: string[] }
  | { ok: false; error: string };

export type AttestationCacheOptions = {
  apiKey: string | null;
  baseUrl: string;
  fetch?: typeof fetch;
  ttlMs: number;
  minRefetchMs?: number;
  timeoutMs?: number;
  now?: () => number;
};

type Entry = { signers: Set<string>; fetchedAt: number; error?: string };

export type SignerCheck =
  | { ok: true; refetched: boolean }
  | { ok: false; reason: 'SignerNotAttested' | 'ModelNotAttested' | 'AttestationUnavailable'; detail?: string };

export class AttestationCache {
  private entries = new Map<string, Entry>();
  private inflight = new Map<string, Promise<Entry>>();
  /** Number of report fetches performed (tests / metrics). */
  fetchCount = 0;

  constructor(readonly opts: AttestationCacheOptions) {}

  private now() {
    return (this.opts.now ?? Date.now)();
  }

  /** One attestation report fetch with a fresh nonce; nonce echo enforced. */
  async fetchSigners(model: string): Promise<AttestationFetchResult> {
    if (!this.opts.apiKey) return { ok: false, error: 'NEARAI_API_KEY not configured' };
    const doFetch = this.opts.fetch ?? fetch;
    const nonce = randomBytes(32).toString('hex');
    const qs = new URLSearchParams({ model, provider: 'near', signing_algo: 'ed25519', nonce });
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.opts.timeoutMs ?? 10_000);
    this.fetchCount += 1;
    try {
      const res = await doFetch(`${this.opts.baseUrl.replace(/\/$/, '')}/attestation/report?${qs}`, {
        headers: { Authorization: `Bearer ${this.opts.apiKey}`, Accept: 'application/json', 'x-no-aliasing': 'true' },
        signal: ac.signal,
      });
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      const report = (await res.json()) as AttestationReport;
      const summary = summarizeReport(report, model, nonce);
      // summarizeReport keeps only nonce-echoing model attestations with a signing address.
      return { ok: true, signers: summary.signingAddresses.map(normHex) };
    } catch (e) {
      return { ok: false, error: ac.signal.aborted ? 'timeout' : (e as Error).message };
    } finally {
      clearTimeout(timer);
    }
  }

  private async refresh(model: string): Promise<Entry> {
    const running = this.inflight.get(model);
    if (running) return running;
    const p = (async () => {
      const r = await this.fetchSigners(model);
      const prev = this.entries.get(model);
      const entry: Entry = r.ok
        ? { signers: new Set(r.signers), fetchedAt: this.now() }
        : // keep the last good set on a transient error, but remember the failure time
          { signers: prev?.signers ?? new Set(), fetchedAt: this.now(), error: r.error };
      this.entries.set(model, entry);
      return entry;
    })().finally(() => this.inflight.delete(model));
    this.inflight.set(model, p);
    return p;
  }

  /** Signer set for `model` (fetches when missing or older than ttl). */
  async getSigners(model: string): Promise<{ signers: string[]; error?: string }> {
    let e = this.entries.get(model);
    if (!e || this.now() - e.fetchedAt >= this.opts.ttlMs) e = await this.refresh(model);
    return { signers: [...e.signers], ...(e.error ? { error: e.error } : {}) };
  }

  /** §5.3 check 6 with "refetch once on a miss". */
  async checkSigner(model: string, signingAddress: string): Promise<SignerCheck> {
    const addr = normHex(signingAddress);
    let e = this.entries.get(model);
    let refetched = false;
    if (!e || this.now() - e.fetchedAt >= this.opts.ttlMs) {
      e = await this.refresh(model);
      refetched = true;
    }
    if (e.signers.has(addr)) return { ok: true, refetched };
    if (!refetched && this.now() - e.fetchedAt >= (this.opts.minRefetchMs ?? 0)) {
      e = await this.refresh(model);
      refetched = true;
      if (e.signers.has(addr)) return { ok: true, refetched };
    }
    if (e.signers.size === 0) {
      return e.error
        ? { ok: false, reason: 'AttestationUnavailable', detail: e.error }
        : { ok: false, reason: 'ModelNotAttested', detail: 'no model attestation (gateway-only / unknown model)' };
    }
    return { ok: false, reason: 'SignerNotAttested' };
  }

  clear() {
    this.entries.clear();
  }
}

// ─── process-wide instance (configured from env; tests inject fetch) ─────────

let instance: AttestationCache | null = null;
let injectedFetch: typeof fetch | undefined;

/** Tests: route attestation fetches to a mock and reset the cache. */
export function setAttestationFetch(f: typeof fetch | undefined) {
  injectedFetch = f;
  instance = null;
}

export function getAttestationCache(): AttestationCache {
  const cfg = getArenaConfig();
  if (
    !instance ||
    instance.opts.apiKey !== cfg.nearaiApiKey ||
    instance.opts.baseUrl !== cfg.nearaiBaseUrl
  ) {
    instance = new AttestationCache({
      apiKey: cfg.nearaiApiKey,
      baseUrl: cfg.nearaiBaseUrl,
      fetch: injectedFetch,
      ttlMs: cfg.attestTtlMs,
      minRefetchMs: cfg.attestMinRefetchMs,
    });
  }
  return instance;
}
