/**
 * Provably-fair deck derivation (see INTERFACES.md §1).
 *
 *   deckSeed = sha256(serverSeed ‖ entropy[seat0] ‖ entropy[seat1] ‖ …)
 *   stream   = sha256(deckSeed ‖ u32be(0)) ‖ sha256(deckSeed ‖ u32be(1)) ‖ …
 *   deck     = Fisher–Yates over createOrderedDeck(), i = 51..1,
 *              j = uniform(0..i) by rejection sampling on big-endian u32s.
 */
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

import { createOrderedDeck } from './cards.js';
import type { Card } from './types.js';

export { bytesToHex, hexToBytes };

export function sha256Bytes(data: Uint8Array): Uint8Array {
  return sha256(data);
}

export function sha256Hex(data: Uint8Array): string {
  return bytesToHex(sha256(data));
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(len);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** deckSeed = sha256(serverSeed ‖ entropies[0] ‖ entropies[1] ‖ …). */
export function deriveDeckSeed(
  serverSeed: Uint8Array,
  entropies: Uint8Array[]
): Uint8Array {
  return sha256(concatBytes([serverSeed, ...entropies]));
}

/** Deterministic byte stream: block_k = sha256(deckSeed ‖ u32be(k)). */
function makeU32Stream(deckSeed: Uint8Array): () => number {
  const input = new Uint8Array(deckSeed.length + 4);
  input.set(deckSeed, 0);
  let k = 0;
  let block: Uint8Array = new Uint8Array(0);
  let pos = 0;
  const nextBlock = () => {
    const view = new DataView(input.buffer);
    view.setUint32(deckSeed.length, k >>> 0, false);
    k++;
    block = sha256(input);
    pos = 0;
  };
  const nextByte = () => {
    if (pos >= block.length) nextBlock();
    return block[pos++]!;
  };
  return () =>
    ((nextByte() << 24) | (nextByte() << 16) | (nextByte() << 8) | nextByte()) >>> 0;
}

/** Shuffle the ordered deck (ids 0..51) deterministically from a 32-byte deck seed. */
export function shuffleFromSeed(deckSeed: Uint8Array): Card[] {
  const deck = createOrderedDeck();
  const nextU32 = makeU32Stream(deckSeed);
  const TWO32 = 0x1_0000_0000;
  for (let i = deck.length - 1; i >= 1; i--) {
    const n = i + 1;
    const limit = Math.floor(TWO32 / n) * n;
    let r = nextU32();
    while (r >= limit) r = nextU32();
    const j = r % n;
    [deck[i], deck[j]] = [deck[j]!, deck[i]!];
  }
  return deck;
}

/**
 * The engine's deal order from a deck: 2 hole cards to each player in
 * table order (players[0] gets deck[0..1], players[1] deck[2..3], …), then
 * burn + 3 flop, burn + turn, burn + river.
 */
export function dealOrderFromDeck(
  deck: Card[],
  playerCount: number
): { holeCards: Card[][]; community: Card[] } {
  const holeCards: Card[][] = [];
  let p = 0;
  for (let i = 0; i < playerCount; i++) {
    holeCards.push([deck[p]!, deck[p + 1]!]);
    p += 2;
  }
  const community: Card[] = [];
  p += 1; // burn
  community.push(deck[p]!, deck[p + 1]!, deck[p + 2]!);
  p += 3;
  p += 1; // burn
  community.push(deck[p]!);
  p += 1;
  p += 1; // burn
  community.push(deck[p]!);
  return { holeCards, community };
}

export interface FairnessRecord {
  seedHash: string;
  serverSeed: string;
  /** Hex entropy per seated player, ascending seat order. */
  entropy: string[];
  /** Hole card ids per player in table (seat) order. */
  holeCards: number[][];
  /** Community card ids actually dealt (prefix of 5). */
  community: number[];
  deckSeed?: string;
}

/** Recompute and check a revealed hand. Returns list of problems (empty = fair). */
export function verifyHand(rec: FairnessRecord): { ok: boolean; errors: string[]; deckSeed: string } {
  const errors: string[] = [];
  let deckSeedHex = '';
  try {
    const seed = hexToBytes(rec.serverSeed);
    if (sha256Hex(seed) !== rec.seedHash.toLowerCase()) errors.push('seedHash mismatch');
    const deckSeed = deriveDeckSeed(
      seed,
      rec.entropy.map((e) => hexToBytes(e))
    );
    deckSeedHex = bytesToHex(deckSeed);
    if (rec.deckSeed && rec.deckSeed.toLowerCase() !== deckSeedHex) errors.push('deckSeed mismatch');
    const expected = dealOrderFromDeck(shuffleFromSeed(deckSeed), rec.holeCards.length);
    rec.holeCards.forEach((cards, i) => {
      const exp = expected.holeCards[i]!.map((c) => c.id);
      if (cards.length !== 2 || cards[0] !== exp[0] || cards[1] !== exp[1]) {
        errors.push(`hole cards mismatch at position ${i}`);
      }
    });
    if (rec.community.length > 5) errors.push('too many community cards');
    rec.community.forEach((id, i) => {
      if (expected.community[i]!.id !== id) errors.push(`community mismatch at ${i}`);
    });
  } catch (e) {
    errors.push(`invalid input: ${(e as Error).message}`);
  }
  return { ok: errors.length === 0, errors, deckSeed: deckSeedHex };
}
