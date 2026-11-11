/**
 * Independent provably-fair deck verifier (INTERFACES.md §1), so your agent can check every
 * hand it plays without trusting the server or importing the server's code.
 *
 *   seedHash = sha256(serverSeed)                    (committed before entropy is collected)
 *   deckSeed = sha256(serverSeed ‖ entropy[seat0] ‖ entropy[seat1] ‖ …)   (ascending seat order)
 *   stream   = sha256(deckSeed ‖ u32be(0)) ‖ sha256(deckSeed ‖ u32be(1)) ‖ …
 *   deck     = Fisher–Yates over card ids 0..51, i = 51..1, j = uniform(0..i) by rejection
 *              sampling on big-endian u32s (limit = floor(2^32/(i+1))*(i+1)).
 *   deal     = 2 hole cards per seat (ascending seat), then burn+3, burn+1, burn+1.
 *
 * Card ids (engine): id = rankIndex + suitIndex*13, ranks 2..A, suits c,d,h,s.
 */
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const SUITS = ['c', 'd', 'h', 's'];

/** Engine card id (0..51) → "Ah" style. */
export function formatCardId(id: number): string {
  if (!Number.isInteger(id) || id < 0 || id > 51) return '??';
  return `${RANKS[id % 13]}${SUITS[Math.floor(id / 13)]}`;
}

/**
 * Card ids in the public *view* (socket `game:state`, `arena:turn.view`) use the UI suit order;
 * the server maps engine suits c,d,h,s → UI 3,2,1,0. Hidden cards are -1.
 */
export function uiToEngine(ui: number): number {
  return (ui % 13) + [3, 2, 1, 0][Math.floor(ui / 13)]! * 13;
}

export function formatUiCards(ui: number[] | undefined): string[] {
  return (ui ?? []).filter((c) => c >= 0).map((c) => formatCardId(uiToEngine(c)));
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function deriveDeckSeed(serverSeed: Uint8Array, entropies: Uint8Array[]): Uint8Array {
  return sha256(concat([serverSeed, ...entropies]));
}

/** Card ids 0..51 after the deterministic shuffle. */
export function shuffleFromSeed(deckSeed: Uint8Array): number[] {
  const deck = Array.from({ length: 52 }, (_, i) => i);
  let k = 0;
  let block: Uint8Array = new Uint8Array(0);
  let pos = 0;
  const nextByte = () => {
    if (pos >= block.length) {
      const ctr = new Uint8Array(4);
      new DataView(ctr.buffer).setUint32(0, k++ >>> 0, false);
      block = sha256(concat([deckSeed, ctr]));
      pos = 0;
    }
    return block[pos++]!;
  };
  const nextU32 = () => ((nextByte() << 24) | (nextByte() << 16) | (nextByte() << 8) | nextByte()) >>> 0;
  for (let i = 51; i >= 1; i--) {
    const n = i + 1;
    const limit = Math.floor(0x1_0000_0000 / n) * n;
    let r = nextU32();
    while (r >= limit) r = nextU32();
    const j = r % n;
    [deck[i], deck[j]] = [deck[j]!, deck[i]!];
  }
  return deck;
}

/** `GET /hands/:handId` (INTERFACES.md §4). Card ids are engine ids. */
export type HandRecord = {
  handId: string;
  gameId?: string;
  seedHash: string;
  serverSeed?: string;
  entropy?: string[];
  deckSeed?: string;
  seats: Array<{ seat: number; playerId: string; nickname?: string; holeCards: number[] }>;
  community: number[];
  txs?: Record<string, string>;
};

/**
 * Returns a list of problems (empty = the hand was dealt exactly from the committed seed + entropy).
 * `myHole` (engine ids) / `myEntropy` let you also check that the cards YOU were dealt and the
 * entropy YOU contributed are the ones in the record.
 */
export function verifyHand(
  rec: HandRecord,
  mine: { playerId?: string; hole?: number[]; entropy?: string; seedHashSeen?: string } = {},
): string[] {
  const errs: string[] = [];
  if (!rec.serverSeed || !rec.entropy) return ['hand not revealed yet'];
  const seed = hexToBytes(rec.serverSeed);
  if (bytesToHex(sha256(seed)) !== rec.seedHash) errs.push('sha256(serverSeed) != seedHash');
  if (mine.seedHashSeen && mine.seedHashSeen !== rec.seedHash) errs.push('seedHash differs from the one committed during the hand');
  const seats = [...rec.seats].sort((a, b) => a.seat - b.seat);
  if (rec.entropy.length !== seats.length) errs.push('entropy count != seat count');
  const deckSeed = deriveDeckSeed(seed, rec.entropy.map((e) => hexToBytes(e)));
  if (rec.deckSeed && bytesToHex(deckSeed) !== rec.deckSeed) errs.push('deckSeed mismatch');
  const deck = shuffleFromSeed(deckSeed);
  let p = 0;
  seats.forEach((s, idx) => {
    const exp = [deck[p]!, deck[p + 1]!];
    p += 2;
    if (s.holeCards.length && s.holeCards.join() !== exp.join()) errs.push(`seat ${s.seat} hole cards != deck`);
    if (mine.playerId && s.playerId === mine.playerId) {
      if (mine.hole && mine.hole.length === 2 && mine.hole.join() !== exp.join()) errs.push('the cards I was dealt != deck');
      if (mine.entropy && rec.entropy![idx] !== mine.entropy && rec.entropy![idx] !== '00'.repeat(16)) {
        errs.push('my entropy is not in the record');
      }
    }
  });
  const board = [deck[p + 1]!, deck[p + 2]!, deck[p + 3]!, deck[p + 5]!, deck[p + 7]!];
  rec.community.forEach((id, i) => {
    if (board[i] !== id) errs.push(`community[${i}] != deck`);
  });
  return errs;
}
