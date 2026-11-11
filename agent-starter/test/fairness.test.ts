import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

import { deriveDeckSeed, shuffleFromSeed, verifyHand, type HandRecord } from '../src/fairness.js';

const serverSeedHex = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, '0')).join('');
const entropy = ['aa'.repeat(16), 'bb'.repeat(16)];

describe('provably fair deck (INTERFACES.md §1 test vector)', () => {
  it('matches seedHash, deckSeed and shuffled deck', () => {
    const seed = hexToBytes(serverSeedHex);
    assert.equal(bytesToHex(sha256(seed)), '630dcd2966c4336691125448bbb25b4ff412a49c732db2c8abc1b8581bd710dd');
    const deckSeed = deriveDeckSeed(seed, entropy.map(hexToBytes));
    assert.equal(bytesToHex(deckSeed), 'a75212b041f3bad423cf5b163091aa974e48b4e10eba71968acfcb1234392924');
    assert.equal(
      shuffleFromSeed(deckSeed).join(','),
      '48,14,25,31,13,36,12,30,41,0,28,49,39,18,33,22,11,24,21,35,38,6,45,23,20,3,7,5,47,27,34,43,8,46,16,19,50,9,26,29,1,17,32,15,10,4,40,37,51,44,42,2',
    );
  });

  it('verifyHand accepts an honest record and flags tampering', () => {
    const deck = shuffleFromSeed(deriveDeckSeed(hexToBytes(serverSeedHex), entropy.map(hexToBytes)));
    const rec: HandRecord = {
      handId: 'h1',
      seedHash: '630dcd2966c4336691125448bbb25b4ff412a49c732db2c8abc1b8581bd710dd',
      serverSeed: serverSeedHex,
      entropy,
      deckSeed: 'a75212b041f3bad423cf5b163091aa974e48b4e10eba71968acfcb1234392924',
      seats: [
        { seat: 0, playerId: 'a', holeCards: [deck[0]!, deck[1]!] },
        { seat: 1, playerId: 'me', holeCards: [deck[2]!, deck[3]!] },
      ],
      community: [deck[5]!, deck[6]!, deck[7]!, deck[9]!, deck[11]!],
    };
    assert.deepEqual(verifyHand(rec, { playerId: 'me', hole: [deck[2]!, deck[3]!], entropy: 'bb'.repeat(16) }), []);
    assert.ok(verifyHand({ ...rec, community: [deck[4]!, ...rec.community.slice(1)] }).length > 0);
    assert.ok(verifyHand(rec, { playerId: 'me', hole: [deck[0]!, deck[1]!] }).includes('the cards I was dealt != deck'));
    assert.ok(verifyHand(rec, { playerId: 'me', entropy: 'cc'.repeat(16) }).includes('my entropy is not in the record'));
    assert.deepEqual(verifyHand({ ...rec, serverSeed: undefined }), ['hand not revealed yet']);
  });
});
