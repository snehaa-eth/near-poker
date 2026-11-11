/**
 * Browser-side copy of the provably-fair deck derivation (INTERFACES §1).
 * Deliberately NOT imported from packages/poker-engine so the verifier is an
 * independent implementation of the spec.
 */
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, concatBytes, hexToBytes } from '@noble/hashes/utils';

/** Engine card ids: id = rankIndex + suitIndex * 13, RANKS 2..14, SUITS c,d,h,s. */
const RANK_LABELS = [
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  'T',
  'J',
  'Q',
  'K',
  'A',
];
const SUIT_LABELS = ['c', 'd', 'h', 's'];
const SUIT_SYMBOLS: Record<string, string> = { c: '♣', d: '♦', h: '♥', s: '♠' };

export function engineCardLabel(id: number): string {
  if (!Number.isInteger(id) || id < 0 || id > 51) return '??';
  return `${RANK_LABELS[id % 13]}${SUIT_SYMBOLS[SUIT_LABELS[Math.floor(id / 13)]!]}`;
}

/**
 * Engine id → UI asset id (mirrors apps/server/src/poker-bridge.ts pokerIdToUiId).
 * UI suits: 0=SPADE,1=HEART,2=DIAMOND,3=CLUB; engine: 0=c,1=d,2=h,3=s.
 */
export function engineIdToUiId(id: number): number {
  const rank = id % 13;
  const uiSuit = [3, 2, 1, 0][Math.floor(id / 13)] ?? 0;
  return rank + uiSuit * 13;
}

/** Inverse of engineIdToUiId (the suit map is its own inverse). */
export function uiIdToEngineId(id: number): number {
  return engineIdToUiId(id);
}

function normHex(hex: string): string {
  const h = hex.trim().toLowerCase().replace(/^0x/, '');
  if (!/^([0-9a-f]{2})*$/.test(h)) throw new Error(`Invalid hex: ${hex}`);
  return h;
}

export function sha256Hex(hex: string): string {
  return bytesToHex(sha256(hexToBytes(normHex(hex))));
}

/** deckSeed = sha256(serverSeed ‖ entropy[seat0] ‖ entropy[seat1] ‖ …) */
export function computeDeckSeed(
  serverSeedHex: string,
  entropiesHex: string[]
): Uint8Array {
  const parts = [serverSeedHex, ...entropiesHex].map((h) =>
    hexToBytes(normHex(h))
  );
  return sha256(concatBytes(...parts));
}

/** Byte stream block_k = sha256(deckSeed ‖ u32be(k)), read as big-endian u32s. */
function u32Stream(deckSeed: Uint8Array) {
  let k = 0;
  let block: Uint8Array = new Uint8Array(0);
  let offset = 0;
  const refill = () => {
    const ctr = new Uint8Array(4);
    new DataView(ctr.buffer).setUint32(0, k, false);
    k += 1;
    block = sha256(concatBytes(deckSeed, ctr));
    offset = 0;
  };
  return () => {
    // 32-byte blocks hold exactly 8 u32s, so reads never straddle blocks.
    if (offset + 4 > block.length) refill();
    const v = new DataView(
      block.buffer,
      block.byteOffset + offset,
      4
    ).getUint32(0, false);
    offset += 4;
    return v;
  };
}

/** Fisher–Yates with rejection sampling; returns engine card ids 0..51. */
export function shuffleFromSeed(deckSeed: Uint8Array): number[] {
  const deck = Array.from({ length: 52 }, (_, i) => i);
  const nextU32 = u32Stream(deckSeed);
  for (let i = 51; i >= 1; i--) {
    const n = i + 1;
    const limit = Math.floor(2 ** 32 / n) * n;
    let r = nextU32();
    while (r >= limit) r = nextU32();
    const j = r % n;
    [deck[i], deck[j]] = [deck[j]!, deck[i]!];
  }
  return deck;
}

/**
 * Deal order mirrors packages/poker-engine/src/engine.ts:
 * dealHoleCards → 2 consecutive cards per player in seat order;
 * dealCommunity → burn 1, flop 3; burn 1, turn 1; burn 1, river 1.
 */
export function dealFromDeck(deck: number[], playerCount: number) {
  const hole: number[][] = [];
  let p = 0;
  for (let i = 0; i < playerCount; i++) {
    hole.push([deck[p]!, deck[p + 1]!]);
    p += 2;
  }
  const community: number[] = [];
  p += 1;
  community.push(deck[p]!, deck[p + 1]!, deck[p + 2]!);
  p += 3;
  p += 1;
  community.push(deck[p]!);
  p += 1;
  p += 1;
  community.push(deck[p]!);
  return { hole, community };
}

/** INTERFACES §1 test vector. */
export const TEST_VECTOR = {
  serverSeed: Array.from({ length: 32 }, (_, i) =>
    i.toString(16).padStart(2, '0')
  ).join(''),
  entropy: ['aa'.repeat(16), 'bb'.repeat(16)],
  seedHash: '630dcd2966c4336691125448bbb25b4ff412a49c732db2c8abc1b8581bd710dd',
  deckSeed: 'a75212b041f3bad423cf5b163091aa974e48b4e10eba71968acfcb1234392924',
  deck: '48,14,25,31,13,36,12,30,41,0,28,49,39,18,33,22,11,24,21,35,38,6,45,23,20,3,7,5,47,27,34,43,8,46,16,19,50,9,26,29,1,17,32,15,10,4,40,37,51,44,42,2',
} as const;

/** Checks this verifier against the spec's test vector before trusting it. */
export function selfTest(): boolean {
  try {
    const v = TEST_VECTOR;
    const ds = computeDeckSeed(v.serverSeed, [...v.entropy]);
    return (
      sha256Hex(v.serverSeed) === v.seedHash &&
      bytesToHex(ds) === v.deckSeed &&
      shuffleFromSeed(ds).join(',') === v.deck
    );
  } catch {
    return false;
  }
}

export { bytesToHex };
