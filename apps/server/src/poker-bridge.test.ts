import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  bytesToHex,
  dealOrderFromDeck,
  hexToBytes,
  shuffleFromSeed,
  verifyHand,
} from '@nli/poker-engine';

import { deckSeedFor, newServerSeed } from './fairness.js';
import { MemoryLedger } from './ledger.js';
import {
  applyNlheBet,
  applyNlheFold,
  createEmptyNlheLobby,
  joinNlheLobby,
  mapUiBetToAction,
  nextHandPlayerOrder,
  pokerIdToUiId,
  startNlheHand,
  toNlhePublicView,
} from './poker-bridge.js';

describe('poker-bridge', () => {
  it('maps poker suit ids to UI SPADE/HEART/DIAMOND/CLUB layout', () => {
    // poker 0 = 2c → UI club = suit 3 → id 3*13+0 = 39
    assert.equal(pokerIdToUiId(0), 39);
    // poker 13 = 2d → UI diamond suit 2 → 26
    assert.equal(pokerIdToUiId(13), 26);
    // poker 26 = 2h → UI heart suit 1 → 13
    assert.equal(pokerIdToUiId(26), 13);
    // poker 39 = 2s → UI spade suit 0 → 0
    assert.equal(pokerIdToUiId(39), 0);
  });

  it('runs a fold win via NLHE engine', () => {
    let g = createEmptyNlheLobby({ name: 'Test', minChips: 100 });
    g = joinNlheLobby(g, { id: 'a', nickname: 'Alice' });
    g = joinNlheLobby(g, { id: 'b', nickname: 'Bob' });
    g = startNlheHand(g, { a: 1000, b: 1000 });
    assert.ok(g.nlhe);
    assert.equal(g.status, 'playing');

    const actorId = g.nlhe!.players.find((p) => p.seat === g.nlhe!.toAct)!.id;
    g = applyNlheFold(g, actorId);
    // May still be in progress if more players need to act — HU fold ends hand
    assert.equal(g.nlhe!.street, 'complete');
    assert.ok(g.winnerId);
    assert.notEqual(g.winnerId, actorId);

    const view = toNlhePublicView(g, g.winnerId);
    assert.equal(view.gameEnded, true);
    assert.ok(view.stacksByPlayerId[g.winnerId!]! > 1000);
  });

  it('names the winning hand only when the hand ends at showdown', () => {
    let g = createEmptyNlheLobby({ name: 'Test', minChips: 100 });
    g = joinNlheLobby(g, { id: 'a', nickname: 'Alice' });
    g = joinNlheLobby(g, { id: 'b', nickname: 'Bob' });
    g = startNlheHand(g, { a: 1000, b: 1000 });
    // Everyone checks / calls down to the river.
    for (let i = 0; i < 20 && g.nlhe!.street !== 'complete'; i++) {
      const t = g.nlhe!;
      const actor = t.players.find((p) => p.seat === t.toAct)!;
      g = applyNlheBet(g, actor.id, t.currentBet > actor.bet ? t.currentBet : 0);
    }
    assert.equal(g.nlhe!.street, 'complete');
    const view = toNlhePublicView(g, null);
    assert.equal(view.gameEnded, true);
    assert.equal(typeof view.winningHand, 'string');
    assert.ok(view.winningHand!.length > 0);

    let f = createEmptyNlheLobby({ name: 'Test', minChips: 100 });
    f = joinNlheLobby(f, { id: 'a', nickname: 'Alice' });
    f = joinNlheLobby(f, { id: 'b', nickname: 'Bob' });
    f = startNlheHand(f, { a: 1000, b: 1000 });
    f = applyNlheFold(f, f.nlhe!.players.find((p) => p.seat === f.nlhe!.toAct)!.id);
    assert.equal(toNlhePublicView(f, null).winningHand, undefined);
  });

  it('maps check / call / raise from UI amounts', () => {
    let g = createEmptyNlheLobby({ name: 'Test', minChips: 100 });
    g = joinNlheLobby(g, { id: 'a', nickname: 'Alice' });
    g = joinNlheLobby(g, { id: 'b', nickname: 'Bob' });
    g = startNlheHand(g, { a: 1000, b: 1000 });
    const table = g.nlhe!;
    const actor = table.players.find((p) => p.seat === table.toAct)!;
    const toCall = table.currentBet - actor.bet;
    if (toCall > 0) {
      const action = mapUiBetToAction(table, actor.id, table.currentBet);
      assert.equal(action.type, 'call');
      g = applyNlheBet(g, actor.id, table.currentBet);
    }
    assert.ok(g.nlhe);
  });

  it('deals from the provably-fair deck seed and hides secrets until complete', () => {
    let g = createEmptyNlheLobby({ name: 'Test', minChips: 100 });
    g = joinNlheLobby(g, { id: 'a', nickname: 'Alice' });
    g = joinNlheLobby(g, { id: 'b', nickname: 'Bob' });
    g = joinNlheLobby(g, { id: 'c', nickname: 'Cat' });
    const order = nextHandPlayerOrder(g);
    const { serverSeed, seedHash } = newServerSeed();
    const entropy = ['11'.repeat(16), '00'.repeat(16), 'ff'.repeat(16)];
    const deckSeed = deckSeedFor(serverSeed, entropy);
    g = startNlheHand(g, { a: 1000, b: 1000, c: 1000 }, deckSeed);
    assert.deepEqual(g.nlhe!.players.map((p) => p.id), order);

    const exp = dealOrderFromDeck(shuffleFromSeed(deckSeed), 3);
    g.nlhe!.players.forEach((p, i) => {
      assert.deepEqual(p.holeCards.map((c) => c.id), exp.holeCards[i]!.map((c) => c.id));
    });

    g = {
      ...g,
      fairness: {
        handId: 'h1', seedHash, serverSeed, entropy, deckSeed: bytesToHex(deckSeed),
        playerIds: order, ledgerPlayers: order, startStacks: {}, revealed: false,
      },
    };
    let view = toNlhePublicView(g, null);
    assert.equal(view.fairness?.seedHash, seedHash);
    assert.equal(view.fairness?.revealed, undefined);
    assert.ok(!JSON.stringify(view).includes(serverSeed), 'serverSeed leaked pre-reveal');
    assert.ok(!JSON.stringify(view).includes(bytesToHex(deckSeed)), 'deckSeed leaked pre-reveal');

    // even if flagged revealed, nothing is exposed while the hand is live
    view = toNlhePublicView({ ...g, fairness: { ...g.fairness!, revealed: true } }, null);
    assert.equal(view.fairness?.revealed, undefined);

    // play out: everyone folds to the big blind
    while (g.nlhe!.street !== 'complete') {
      const actor = g.nlhe!.players.find((p) => p.seat === g.nlhe!.toAct)!;
      g = applyNlheFold(g, actor.id);
    }
    view = toNlhePublicView({ ...g, fairness: { ...g.fairness!, revealed: true } }, null);
    assert.equal(view.fairness?.revealed?.serverSeed, serverSeed);

    const rec = {
      seedHash,
      serverSeed,
      entropy,
      holeCards: g.nlhe!.players.map((p) => p.holeCards.map((c) => c.id)),
      community: g.nlhe!.community.map((c) => c.id),
    };
    assert.equal(verifyHand(rec).ok, true);
    // tamper: flip one bit of one revealed byte → verification fails
    const bad = hexToBytes(serverSeed);
    bad[0] ^= 0x80;
    assert.equal(verifyHand({ ...rec, serverSeed: bytesToHex(bad) }).ok, false);
    const badEntropy = [...entropy];
    badEntropy[1] = '01' + '00'.repeat(15);
    assert.equal(verifyHand({ ...rec, entropy: badEntropy }).ok, false);
  });

  it('MemoryLedger enforces commit → reveal → settle invariants', async () => {
    const l = new MemoryLedger();
    const { serverSeed, seedHash } = newServerSeed();
    await l.commit('h', seedHash, ['a', 'b']);
    await assert.rejects(l.settle('h', { a: 5, b: -5 }), /not revealed/);
    await assert.rejects(l.reveal('h', '00'.repeat(32), ['00'.repeat(16), '00'.repeat(16)]), /seed hash/);
    await l.reveal('h', serverSeed, ['aa'.repeat(16), 'bb'.repeat(16)]);
    assert.equal(l.hands.get('h')!.deckSeed, bytesToHex(deckSeedFor(serverSeed, ['aa'.repeat(16), 'bb'.repeat(16)])));
    await assert.rejects(l.settle('h', { a: 5, b: -4 }), /sum/);
    await l.settle('h', { a: 5, b: -5 });
  });
});
