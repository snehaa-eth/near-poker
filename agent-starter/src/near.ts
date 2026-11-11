/**
 * NEAR side of the agent: key loading, NEP-413 login to the game server, vault deposit/balance.
 *
 *  - Identity = a NEAR testnet account you control (full-access key). INTERFACES.md §5.1.
 *  - Login    = NEP-413 signature of {message:'Sign in to Dark Table', recipient:'dark-table', nonce}
 *               (nonce from GET /auth/nonce) → POST /auth/profile → session cookie `nli_session`.
 *  - Bankroll = your own `deposit()` into the table-vault contract; 1 chip = 10^21 yocto (0.001 NEAR).
 *
 * The private key never leaves this process: it signs the login payload and the deposit tx locally.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { sha256 } from '@noble/hashes/sha256';
import { Account, JsonRpcProvider, KeyPair, actions, nearToYocto, teraToGas, type KeyPairString } from 'near-api-js';

export const LOGIN_MESSAGE = 'Sign in to Dark Table';
export const LOGIN_RECIPIENT = 'dark-table';
/** NEP-413 prefix tag: 2^31 + 413. */
export const NEP413_TAG = 2147484061;
export const YOCTO_PER_CHIP = 10n ** 21n;

// ─── keys ───────────────────────────────────────────────────────────────────

/**
 * AGENT_PRIVATE_KEY ("ed25519:…") wins; otherwise ~/.near-credentials/<network>/<accountId>.json
 * (written by `near account create-account … save-to-legacy-keychain` / near-cli).
 */
export function loadKey(accountId: string, env: NodeJS.ProcessEnv = process.env): KeyPairString {
  const fromEnv = env.AGENT_PRIVATE_KEY?.trim();
  if (fromEnv) return fromEnv as KeyPairString;
  const network = env.NEAR_NETWORK?.trim() || 'testnet';
  const file = join(env.NEAR_CREDENTIALS_DIR?.trim() || join(homedir(), '.near-credentials'), network, `${accountId}.json`);
  if (!existsSync(file)) {
    throw new Error(`no key for ${accountId}: set AGENT_PRIVATE_KEY or create ${file}`);
  }
  const j = JSON.parse(readFileSync(file, 'utf8')) as { private_key?: string; secret_key?: string };
  const k = j.private_key ?? j.secret_key;
  if (!k) throw new Error(`${file} has no private_key`);
  return k as KeyPairString;
}

// ─── NEP-413 ────────────────────────────────────────────────────────────────

export type NearProof = {
  accountId: string;
  publicKey: string; // "ed25519:<base58>"
  signature: string; // base64, 64 bytes
  message: string;
  recipient: string;
  nonce: string; // base64, 32 bytes
};

const u32le = (n: number) => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
};
const borshString = (s: string) => {
  const bytes = new TextEncoder().encode(s);
  const out = new Uint8Array(4 + bytes.length);
  out.set(u32le(bytes.length));
  out.set(bytes, 4);
  return out;
};
const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

/** borsh(u32 tag) ‖ borsh({message: string, nonce: [u8;32], recipient: string, callbackUrl: Option<string> = None}). */
export function nep413Payload(message: string, nonce: Uint8Array, recipient: string): Uint8Array {
  if (nonce.length !== 32) throw new Error('NEP-413 nonce must be 32 bytes');
  return concat([u32le(NEP413_TAG), borshString(message), nonce, borshString(recipient), new Uint8Array([0])]);
}

/** Sign sha256(payload) with the account's ed25519 key. */
export function signNep413(
  accountId: string,
  key: KeyPairString,
  nonceB64: string,
  message = LOGIN_MESSAGE,
  recipient = LOGIN_RECIPIENT,
): NearProof {
  const nonce = new Uint8Array(Buffer.from(nonceB64, 'base64'));
  const kp = KeyPair.fromString(key);
  const { signature } = kp.sign(sha256(nep413Payload(message, nonce, recipient)));
  return {
    accountId,
    publicKey: kp.getPublicKey().toString(),
    signature: Buffer.from(signature).toString('base64'),
    message,
    recipient,
    nonce: nonceB64,
  };
}

// ─── game server HTTP (cookie jar) ──────────────────────────────────────────

export type Api = <T = Record<string, unknown>>(path: string, body?: unknown) => Promise<T>;

export class GameHttp {
  readonly jar = new Map<string, string>();
  constructor(
    readonly baseUrl: string,
    private readonly doFetch: typeof fetch = fetch,
  ) {}

  cookieHeader(): string {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  api: Api = async <T>(path: string, body?: unknown): Promise<T> => {
    const res = await this.doFetch(`${this.baseUrl.replace(/\/$/, '')}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', cookie: this.cookieHeader() },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const line of res.headers.getSetCookie?.() ?? []) {
      const [pair] = line.split(';');
      const i = pair!.indexOf('=');
      if (i > 0) this.jar.set(pair!.slice(0, i).trim(), pair!.slice(i + 1).trim());
    }
    const json = (await res.json().catch(() => ({}))) as T;
    if (!res.ok) throw new Error(`${path} HTTP ${res.status} ${JSON.stringify(json)}`);
    return json;
  };
}

/** GET /auth/nonce → NEP-413 sign → POST /auth/profile. Leaves `nli_session` in the jar. */
export async function login(http: GameHttp, accountId: string, key: KeyPairString, nickname?: string) {
  const n = await http.api<{ nonce: string; message?: string; recipient?: string }>('/auth/nonce');
  if (n.message && n.message !== LOGIN_MESSAGE) throw new Error(`unexpected login message "${n.message}"`);
  if (n.recipient && n.recipient !== LOGIN_RECIPIENT) throw new Error(`unexpected login recipient "${n.recipient}"`);
  const nearProof = signNep413(accountId, key, n.nonce);
  const session = await http.api<Record<string, unknown>>('/auth/profile', {
    walletAddress: accountId,
    ...(nickname ? { nickname } : {}),
    nearProof,
  });
  if (!http.jar.has('nli_session')) throw new Error('login succeeded but no nli_session cookie was set');
  return session;
}

// ─── vault ──────────────────────────────────────────────────────────────────

export type ChainConfig = { rpcUrl: string; vaultId: string };

export function chainConfig(env: NodeJS.ProcessEnv = process.env): ChainConfig {
  return {
    rpcUrl: env.NEAR_RPC_URL?.trim() || 'https://test.rpc.fastnear.com',
    vaultId: env.VAULT_ID?.trim() || 'vault.dark-table-390f55.testnet',
  };
}

/** `balance_of({account_id})` in yocto (view call, no key needed). */
export async function vaultBalance(cfg: ChainConfig, accountId: string): Promise<bigint> {
  const p = new JsonRpcProvider({ url: cfg.rpcUrl });
  const raw = await p.callFunction({ contractId: cfg.vaultId, method: 'balance_of', args: { account_id: accountId } });
  return raw === undefined || raw === null ? 0n : BigInt(String(raw));
}

export const yoctoToChips = (y: bigint) => Number(y / YOCTO_PER_CHIP);

/** Attach `nearAmount` NEAR to `table-vault.deposit()` (payable). Returns the tx hash. */
export async function deposit(cfg: ChainConfig, accountId: string, key: KeyPairString, nearAmount: string): Promise<string> {
  if (!/^\d+(\.\d{1,24})?$/.test(nearAmount) || Number(nearAmount) <= 0) throw new Error(`bad amount "${nearAmount}"`);
  const p = new JsonRpcProvider({ url: cfg.rpcUrl });
  const account = new Account(accountId, p, key);
  const r = (await account.signAndSendTransaction({
    receiverId: cfg.vaultId,
    actions: [actions.functionCall('deposit', {}, teraToGas('30'), nearToYocto(nearAmount as `${number}`))],
  })) as { transaction?: { hash?: string }; transaction_outcome?: { id?: string } };
  return r.transaction?.hash ?? r.transaction_outcome?.id ?? '?';
}
