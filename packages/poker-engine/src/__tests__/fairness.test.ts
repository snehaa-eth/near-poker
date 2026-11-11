import { describe, expect, it } from 'vitest';

import {
  bytesToHex,
  dealOrderFromDeck,
  deriveDeckSeed,
  hexToBytes,
  sha256Hex,
  shuffleFromSeed,
  verifyHand,
} from '../fairness.js';
import { applyAction, createTable, startHand } from '../engine.js';

const TV_SERVER_SEED = new Uint8Array(Array.from({ length: 32 }, (_, i) => i));
const TV_ENTROPY = [new Uint8Array(16).fill(0xaa), new Uint8Array(16).fill(0xbb)];
const TV_SEED_HASH = '630dcd2966c4336691125448bbb25b4ff412a49c732db2c8abc1b8581bd710dd';
const TV_DECK_SEED = 'a75212b041f3bad423cf5b163091aa974e48b4e10eba71968acfcb1234392924';
const TV_DECK =
  '48,14,25,31,13,36,12,30,41,0,28,49,39,18,33,22,11,24,21,35,38,6,45,23,20,3,7,5,47,27,34,43,8,46,16,19,50,9,26,29,1,17,32,15,10,4,40,37,51,44,42,2';

function seedOf(n: number): Uint8Array {
  const b = new Uint8Array(32);
  new DataView(b.buffer).setUint32(0, n);
  return b;
}

describe('provably fair deck', () => {
  it('matches the INTERFACES.md test vector', () => {
    expect(sha256Hex(TV_SERVER_SEED)).toBe(TV_SEED_HASH);
    const ds = deriveDeckSeed(TV_SERVER_SEED, TV_ENTROPY);
    expect(bytesToHex(ds)).toBe(TV_DECK_SEED);
    expect(shuffleFromSeed(ds).map((c) => c.id).join(',')).toBe(TV_DECK);
  });

  it('is deterministic', () => {
    const s = hexToBytes(TV_DECK_SEED);
    expect(shuffleFromSeed(s)).toEqual(shuffleFromSeed(s));
  });

  it('produces a valid permutation of 52 cards', () => {
    for (let n = 0; n < 50; n++) {
      const ids = shuffleFromSeed(seedOf(n)).map((c) => c.id);
      expect(ids).toHaveLength(52);
      expect([...ids].sort((a, b) => a - b)).toEqual(Array.from({ length: 52 }, (_, i) => i));
    }
  });

  it('different seeds give different decks', () => {
    const a = shuffleFromSeed(seedOf(1)).map((c) => c.id).join();
    const b = shuffleFromSeed(seedOf(2)).map((c) => c.id).join();
    expect(a).not.toBe(b);
    // entropy order matters
    const d1 = deriveDeckSeed(TV_SERVER_SEED, TV_ENTROPY);
    const d2 = deriveDeckSeed(TV_SERVER_SEED, [...TV_ENTROPY].reverse());
    expect(bytesToHex(d1)).not.toBe(bytesToHex(d2));
  });

  it('is roughly uniform (first card position)', () => {
    const N = 10400;
    const counts = new Array(52).fill(0);
    for (let n = 0; n < N; n++) counts[shuffleFromSeed(seedOf(n))[0]!.id]++;
    const expected = N / 52; // 200
    // chi-square with 51 dof; p=0.001 critical ≈ 87
    const chi = counts.reduce((s, c) => s + (c - expected) ** 2 / expected, 0);
    expect(chi).toBeLessThan(87);
    expect(Math.min(...counts)).toBeGreaterThan(0);
  });

  it('startHand with deckSeed deals in documented order and verifies', () => {
    const ds = deriveDeckSeed(TV_SERVER_SEED, TV_ENTROPY);
    let t = createTable(
      [
        { id: 'a', stack: 1000 },
        { id: 'b', stack: 1000 },
        { id: 'c', stack: 1000 },
      ],
      { smallBlind: 5, bigBlind: 10 }
    );
    t = startHand(t, { rotateButton: false, deckSeed: ds });
    const exp = dealOrderFromDeck(shuffleFromSeed(ds), 3);
    t.players.forEach((p, i) => {
      expect(p.holeCards.map((c) => c.id)).toEqual(exp.holeCards[i]!.map((c) => c.id));
    });
    // play check/call down to showdown and compare the board
    let guard = 0;
    while (t.street !== 'complete' && guard++ < 50) {
      const actor = t.players.find((p) => p.seat === t.toAct)!;
      const owe = t.currentBet - actor.bet;
      t = applyAction(t, actor.id, { type: owe > 0 ? 'call' : 'check' });
    }
    expect(t.community.map((c) => c.id)).toEqual(exp.community.map((c) => c.id));

    const rec = {
      seedHash: TV_SEED_HASH,
      serverSeed: bytesToHex(TV_SERVER_SEED),
      entropy: ['aa'.repeat(16), 'bb'.repeat(16)],
      holeCards: t.players.map((p) => p.holeCards.map((c) => c.id)),
      community: t.community.map((c) => c.id),
      deckSeed: TV_DECK_SEED,
    };
    expect(verifyHand(rec).ok).toBe(true);

    // tamper: flip one byte of the revealed serverSeed → fails
    const bad = hexToBytes(rec.serverSeed);
    bad[5] ^= 0x01;
    expect(verifyHand({ ...rec, serverSeed: bytesToHex(bad) }).ok).toBe(false);
    // tamper: flip entropy byte → deck/deal mismatch
    const r2 = verifyHand({ ...rec, entropy: ['ab' + 'aa'.repeat(15), rec.entropy[1]!], deckSeed: undefined });
    expect(r2.ok).toBe(false);
    // tamper: swap a hole card
    const hc = rec.holeCards.map((h) => [...h]);
    hc[0] = [hc[1]![0]!, hc[0]![1]!];
    expect(verifyHand({ ...rec, holeCards: hc }).ok).toBe(false);
  });
});

