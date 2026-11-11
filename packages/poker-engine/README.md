# @nli/poker-engine

Pure, deterministic **No-Limit Texas Hold'em** engine (2–6 players).

No I/O, no sockets, no blockchain. Suitable for unit testing and authoritative server use.

## Features

- 52-card deck, hole cards, flop/turn/river
- Dealer button, SB/BB, dealer rotation
- fold / check / call / bet / raise / all-in
- Minimum raise rules
- Main + side pots, split pots, ties
- Showdown hand ranking (best 5 of 7)
- Seeded RNG for deterministic tests

## Usage

```ts
import { createTable, startHand, applyAction, getLegalActions } from '@nli/poker-engine';

let t = createTable(
  [{ id: 'a', stack: 1000 }, { id: 'b', stack: 1000 }],
  { smallBlind: 5, bigBlind: 10, seed: 42 }
);
t = startHand(t, { rotateButton: false });
const actor = t.players.find((p) => p.seat === t.toAct)!;
t = applyAction(t, actor.id, { type: 'call' });
```

## Test

```bash
pnpm --filter @nli/poker-engine test
```
