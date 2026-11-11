import type { Snapshot } from './prompt.js';

export const snap = (over: Partial<Snapshot> = {}): Snapshot => ({
  persona: 'Shark',
  hole: ['Ah', 'Kd'],
  board: ['7c', '8d', 'Ts'],
  street: 'Flop',
  pot: 60,
  highestBet: 20,
  chipsInPot: 0,
  minRaise: 20,
  stack: 1000,
  seat: 2,
  dealerSeat: 0,
  numPlayers: 6,
  activePlayers: 3,
  recent: ['Maniac raises to 30', 'Rock folds', 'Maniac bets 20'],
  ...over,
});
