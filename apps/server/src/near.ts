/**
 * NEAR helpers for the server: chain mode flag, vault balance view, NEP-413
 * login-proof verification (https://github.com/near/NEPs/blob/master/neps/nep-0413.md).
 *
 * Chips are backed by the `table-vault` contract when CHAIN=near:
 *   1 chip = 10^21 yoctoNEAR (0.001 NEAR) — see INTERFACES.md §3.
 */
import { JsonRpcProvider, PublicKey } from 'near-api-js';
import { sha256 } from '@noble/hashes/sha256';

export const YOCTO_PER_CHIP = 10n ** 21n;
export const CHIPS_PER_NEAR = 1000;

export const LOGIN_MESSAGE = 'Sign in to Dark Table';
export const LOGIN_RECIPIENT = 'dark-table';
/** NEP-413 tag: 2^31 + 413. */
export const NEP413_TAG = 2147484061;

export function isNearChain(env: NodeJS.ProcessEnv = process.env) {
  return (env.CHAIN ?? '').toLowerCase() === 'near';
}

export function rpcUrl(env: NodeJS.ProcessEnv = process.env) {
  return env.NEAR_RPC_URL?.trim() || 'https://test.rpc.fastnear.com';
}

let provider: JsonRpcProvider | null = null;
export function getProvider(): JsonRpcProvider {
  if (!provider) provider = new JsonRpcProvider({ url: rpcUrl() });
  return provider;
}

export function yoctoToChips(yocto: bigint): number {
  return Number(yocto / YOCTO_PER_CHIP);
}

/** `balance_of({account_id})` on VAULT_ID, in yocto. */
export async function viewVaultBalance(accountId: string): Promise<bigint> {
  const vaultId = process.env.VAULT_ID?.trim();
  if (!vaultId) throw new Error('VAULT_ID is not configured');
  const raw = await getProvider().callFunction<string>({
    contractId: vaultId,
    method: 'balance_of',
    args: { account_id: accountId },
  });
  if (raw === undefined || raw === null) return 0n;
  return BigInt(String(raw));
}

// ─── NEP-413 ────────────────────────────────────────────────────────────────

export type NearProof = {
  accountId: string;
  publicKey: string;
  /** base64 ed25519 signature */
  signature: string;
  message: string;
  recipient: string;
  /** base64 of 32 bytes */
  nonce: string;
};

function u32le(n: number) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}

function borshString(s: string) {
  const bytes = new TextEncoder().encode(s);
  const out = new Uint8Array(4 + bytes.length);
  out.set(u32le(bytes.length));
  out.set(bytes, 4);
  return out;
}

function concat(parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** borsh(u32 tag) ‖ borsh({message, nonce:[u8;32], recipient, callbackUrl: Option<string>}). */
export function nep413Payload(input: {
  message: string;
  nonce: Uint8Array;
  recipient: string;
  callbackUrl?: string | null;
}): Uint8Array {
  if (input.nonce.length !== 32) throw new Error('nonce must be 32 bytes');
  const cb =
    input.callbackUrl == null
      ? new Uint8Array([0])
      : concat([new Uint8Array([1]), borshString(input.callbackUrl)]);
  return concat([
    u32le(NEP413_TAG),
    borshString(input.message),
    input.nonce,
    borshString(input.recipient),
    cb,
  ]);
}

export function nep413Hash(input: Parameters<typeof nep413Payload>[0]) {
  return sha256(nep413Payload(input));
}

export function decodeBase64(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, 'base64'));
}

/** Pure signature check (no RPC). Returns false on any malformed input. */
export function verifyNep413Signature(proof: NearProof, callbackUrl?: string | null): boolean {
  try {
    const nonce = decodeBase64(proof.nonce);
    if (nonce.length !== 32) return false;
    const sig = decodeBase64(proof.signature);
    if (sig.length !== 64) return false;
    const pk = PublicKey.from(proof.publicKey);
    const hash = nep413Hash({
      message: proof.message,
      nonce,
      recipient: proof.recipient,
      callbackUrl: callbackUrl ?? null,
    });
    return pk.verify(hash, sig);
  } catch {
    return false;
  }
}

export type AccessKeyChecker = (accountId: string, publicKey: string) => Promise<boolean>;

/** RPC `view_access_key`: true iff publicKey is a FullAccess key of accountId. */
export const rpcIsFullAccessKey: AccessKeyChecker = async (accountId, publicKey) => {
  try {
    const key = await getProvider().viewAccessKey({ accountId, publicKey });
    return key.permission === 'FullAccess';
  } catch {
    return false;
  }
};

export function parseNearProof(raw: unknown): NearProof | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const fields = ['accountId', 'publicKey', 'signature', 'message', 'recipient', 'nonce'] as const;
  for (const f of fields) {
    if (typeof r[f] !== 'string' || (r[f] as string).length === 0 || (r[f] as string).length > 512) {
      return null;
    }
  }
  return {
    accountId: (r.accountId as string).trim(),
    publicKey: r.publicKey as string,
    signature: r.signature as string,
    message: r.message as string,
    recipient: r.recipient as string,
    nonce: r.nonce as string,
  };
}

/**
 * Full NEP-413 check: fixed message/recipient, signature over the borsh hash,
 * and publicKey is a FullAccess key of accountId on chain. Nonce freshness is
 * the caller's job (see auth.ts nonce store).
 */
export async function verifyNearProof(
  proof: NearProof,
  opts: { checkAccessKey?: AccessKeyChecker } = {}
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (proof.message !== LOGIN_MESSAGE) return { ok: false, reason: 'BadMessage' };
  if (proof.recipient !== LOGIN_RECIPIENT) return { ok: false, reason: 'BadRecipient' };
  if (!verifyNep413Signature(proof)) return { ok: false, reason: 'BadSignature' };
  const check = opts.checkAccessKey ?? rpcIsFullAccessKey;
  if (!(await check(proof.accountId, proof.publicKey))) {
    return { ok: false, reason: 'NotFullAccessKey' };
  }
  return { ok: true };
}
