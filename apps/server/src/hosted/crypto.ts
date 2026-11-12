/**
 * Secrets at rest + owner tokens.
 *
 *  - encryptSecret/decryptSecret: AES-256-GCM, key = HOSTED_SECRET (32-byte hex). Output
 *    "v1:<iv b64url>:<tag b64url>:<ciphertext b64url>". A fresh 12-byte IV per value.
 *  - Owner token: 32 random bytes (base64url), shown once. Only sha256(token) is stored;
 *    comparison is constant-time.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { isNearChain } from '../near.js';

let devKey: Buffer | null = null;

/** HOSTED_SECRET as a 32-byte key. Near mode: required. Otherwise a per-process key is generated once. */
export function secretKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const hex = env.HOSTED_SECRET?.trim();
  if (hex) {
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error('HOSTED_SECRET must be 32 bytes of hex (64 hex chars)');
    return Buffer.from(hex, 'hex');
  }
  if (isNearChain(env)) throw new Error('HOSTED_SECRET is required when CHAIN=near');
  if (!devKey) {
    devKey = randomBytes(32);
    console.warn(
      '[hosted] HOSTED_SECRET not set: using a random per-process key (dev only). Hosted agents created now cannot be decrypted after a restart.'
    );
  }
  return devKey;
}

export function encryptSecret(plain: string, key: Buffer = secretKey()): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join(':');
}

export function decryptSecret(blob: string, key: Buffer = secretKey()): string {
  const [v, iv, tag, ct] = blob.split(':');
  if (v !== 'v1' || !iv || !tag || ct === undefined) throw new Error('bad secret format');
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
}

export const sha256Hex = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

export function newOwnerToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: sha256Hex(token) };
}

/** Constant-time check of a presented token against the stored sha256 hex. */
export function checkOwnerToken(presented: unknown, storedHash: string): boolean {
  if (typeof presented !== 'string' || presented.length < 16 || presented.length > 128) return false;
  const a = Buffer.from(sha256Hex(presented), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
