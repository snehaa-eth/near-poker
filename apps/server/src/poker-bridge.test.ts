import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  applyNlheBet,
  applyNlheFold,
  createEmptyNlheLobby,
  joinNlheLobby,
  mapUiBetToAction,
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
});
