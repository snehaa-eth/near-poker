import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildMessages, cleanLine, parseMove, type Snapshot } from './prompt.js';
import { snap } from './test-fixtures.js';


test('prompt contains only own hole cards + public state', () => {
  const [sys, user] = buildMessages(snap());
  assert.match(sys!.content, /Shark/);
  assert.match(sys!.content, /"action":"fold\|check\|call\|raise"/);
  assert.match(user!.content, /Your hole cards: Ah Kd/);
  assert.match(user!.content, /Board: 7c 8d Ts/);
  assert.match(user!.content, /To call: 20/);
  assert.match(user!.content, /Raise-to range: min 40, max 1000/);
  assert.match(user!.content, /Maniac bets 20/);
  // every rank+suit card token in the user prompt is either ours or on the board
  const cards = user!.content.match(/\b[2-9TJQKA][cdhs]\b/g) ?? [];
  for (const c of cards) assert.ok(['Ah', 'Kd', '7c', '8d', 'Ts'].includes(c), `unexpected card ${c}`);
  // the snapshot type has no field for others' hole cards; extra props are not serialized
  const leaky = { ...snap(), others: { Rock: ['Qs', 'Qh'] } } as unknown as Snapshot;
  const [, u2] = buildMessages(leaky);
  assert.doesNotMatch(u2!.content, /Qs|Qh|Rock: /);
});

test('parse: bare JSON', () => {
  assert.deepEqual(parseMove('{"action":"raise","amount":120,"line":"pay up"}'), { action: 'raise', amount: 120, line: 'pay up' });
});

test('parse: JSON inside prose / fences / think block', () => {
  const t = '<think>hmm {"action":"fold"}</think>Sure! ```json\n{"action": "Call", "line": "I smell {fear}"}\n``` ok';
  assert.deepEqual(parseMove(t), { action: 'call', amount: undefined, line: 'I smell {fear}' });
});

test('parse: garbage → null', () => {
  assert.equal(parseMove('I think I will go all in!!'), null);
  assert.equal(parseMove('{"action":"dance"}'), null);
  assert.equal(parseMove('{broken json'), null);
  assert.equal(parseMove(''), null);
});

test('line is cleaned to one line ≤ 80 chars', () => {
  const l = cleanLine('a\nb ' + 'x'.repeat(200));
  assert.ok(l.length <= 80);
  assert.doesNotMatch(l, /\n/);
});
