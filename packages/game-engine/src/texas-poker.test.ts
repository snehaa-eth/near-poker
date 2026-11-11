import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  chooseCards,
  createGame,
  declareWinner,
  joinGame,
  placeBet,
  playerShuffle,
  startGame,
  toPublicView,
} from './game.js';
import { getWeightFromIds, toPokerCard } from './texas-poker.js';

describe('texas-poker', () => {
  it('encodes card faces like Solidity toPokerCard', () => {
    const c = toPokerCard(0);
    assert.equal(c.cardType, 'Two');
    assert.equal(c.cardSuit, 'Spade');
    const aceHearts = toPokerCard(12 + 13);
    assert.equal(aceHearts.cardType, 'Ace');
    assert.equal(aceHearts.cardSuit, 'Heart');
  });

  it('ranks royal flush highest', () => {
    // 10,J,Q,K,A of spades: 8,9,10,11,12
    const w = getWeightFromIds([8, 9, 10, 11, 12]);
    assert.equal(w, Number.MAX_SAFE_INTEGER);
  });

  it('ranks four of a kind above full house', () => {
    const quads = getWeightFromIds([0, 13, 26, 39, 1]); // four Twos + Three
    const boat = getWeightFromIds([0, 13, 26, 1, 14]); // three Twos + two Threes
    assert.ok(quads > boat);
    assert.ok(quads >= 900);
    assert.ok(boat >= 800);
  });
});

describe('game flow', () => {
  it('runs create → join → start → shuffle → bet streets → choose → winner', () => {
    let g = createGame({ id: 'p1', nickname: 'Alice' }, 'game_test');
    g = joinGame(g, { id: 'p2', nickname: 'Bob' });
    g = startGame(g);
    assert.equal(g.status, 'shuffling');

    g = playerShuffle(g, 'p1');
    assert.equal(g.status, 'shuffling');
    g = playerShuffle(g, 'p2');
    assert.equal(g.status, 'playing');
    assert.equal(g.round, 'Ante');
    assert.equal(g.players[0]!.holeCards.length, 0);

    // Ante: both bet — hole cards dealt when Ante completes
    g = placeBet(g, 'p1', 10);
    g = placeBet(g, 'p2', 10);
    assert.equal(g.round, 'PreFlop');
    assert.equal(g.players[0]!.holeCards.length, 2);
    assert.equal(g.players[1]!.holeCards.length, 2);

    g = placeBet(g, 'p1', 10);
    g = placeBet(g, 'p2', 10);
    assert.equal(g.round, 'Flop');
    assert.ok(g.communityCards.slice(0, 3).every((c) => c !== null));

    g = placeBet(g, 'p1', 10);
    g = placeBet(g, 'p2', 10);
    assert.equal(g.round, 'Turn');

    g = placeBet(g, 'p1', 10);
    g = placeBet(g, 'p2', 10);
    assert.equal(g.round, 'River');

    g = placeBet(g, 'p1', 10);
    g = placeBet(g, 'p2', 10);
    assert.equal(g.round, 'End');
    assert.ok(g.communityCards.every((c) => c !== null));

    const community = g.communityCards as number[];
    g = chooseCards(g, 'p1', [community[0]!, community[1]!, community[2]!]);
    g = chooseCards(g, 'p2', [community[0]!, community[1]!, community[2]!]);
    g = declareWinner(g);
    assert.ok(g.winnerId);
    assert.equal(g.status, 'ended');

    const view = toPublicView(g, 'p1');
    assert.equal(view.gameEnded, true);
    assert.equal(view.communityCards.filter((c) => c >= 0).length, 5);
  });
});
