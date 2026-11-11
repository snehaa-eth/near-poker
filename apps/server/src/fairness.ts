/**
 * Server-side helpers for the provably-fair deck (INTERFACES.md §1).
 * Entropy collection is pluggable so game-store does not depend on socket.io.
 */
import { randomBytes } from 'node:crypto';

import { bytesToHex, deriveDeckSeed, hexToBytes, sha256Hex } from '@nli/poker-engine';

export const ENTROPY_TIMEOUT_MS = Number(process.env.ENTROPY_TIMEOUT_MS ?? 3000);
export const ZERO_ENTROPY = '00'.repeat(16);

/** 16 bytes as exactly 32 lowercase/uppercase hex chars. */
export function isValidEntropy(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-fA-F]{32}$/.test(v);
}

export type EntropyCollector = (req: {
  gameId: string;
  handId: string;
  playerIds: string[];
  timeoutMs: number;
}) => Promise<Record<string, string>>;

/** Default: nobody answers (tests / no socket server) → all zeros. */
let collector: EntropyCollector = async () => ({});

export function setEntropyCollector(fn: EntropyCollector) {
  collector = fn;
}

export async function collectEntropy(
  gameId: string,
  handId: string,
  playerIds: string[],
  timeoutMs = ENTROPY_TIMEOUT_MS
): Promise<string[]> {
  let got: Record<string, string> = {};
  try {
    got = await collector({ gameId, handId, playerIds, timeoutMs });
  } catch (error) {
    console.error(`[fairness] entropy collection failed for ${handId}:`, error);
  }
  return playerIds.map((id) =>
    isValidEntropy(got[id]) ? got[id]!.toLowerCase() : ZERO_ENTROPY
  );
}

export function newServerSeed(): { serverSeed: string; seedHash: string } {
  const seed = new Uint8Array(randomBytes(32));
  return { serverSeed: bytesToHex(seed), seedHash: sha256Hex(seed) };
}

export function deckSeedFor(serverSeedHex: string, entropyHex: string[]): Uint8Array {
  return deriveDeckSeed(
    hexToBytes(serverSeedHex),
    entropyHex.map((e) => hexToBytes(e))
  );
}
