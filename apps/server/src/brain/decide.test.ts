import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decideMove, legalize, legalizeRules, type Move } from './decide.js';
import { createBrain } from './nearai.js';
import { snap } from './test-fixtures.js';

const rules = (): Move => ({ kind: 'call', amount: 20, line: 'call' });

test('legalize: check / call / fold semantics', () => {
  assert.deepEqual(legalize({ action: 'call' }, snap()), { kind: 'call', amount: 20, line: '' });
  assert.equal(legalize({ action: 'check' }, snap()), null); // facing a bet
  assert.deepEqual(legalize({ action: 'check' }, snap({ highestBet: 0, minRaise: 10 })), { kind: 'check', amount: 0, line: '' });
  assert.deepEqual(legalize({ action: 'call' }, snap({ highestBet: 0 })), { kind: 'check', amount: 0, line: '' });
  assert.deepEqual(legalize({ action: 'fold' }, snap()), { kind: 'fold', amount: 0, line: '' });
});

test('legalize: raise-to clamped to [highestBet+minRaise, chipsInPot+stack]', () => {
  assert.equal(legalize({ action: 'raise', amount: 25 }, snap())!.amount, 40); // below min raise-to
  assert.equal(legalize({ action: 'raise', amount: 5000 }, snap())!.amount, 1000); // above all-in
  assert.equal(legalize({ action: 'raise', amount: 90 }, snap())!.amount, 90);
  assert.equal(legalize({ action: 'raise', amount: 5000 }, snap({ chipsInPot: 10, stack: 500 }))!.amount, 510);
  assert.equal(legalize({ action: 'raise' }, snap()), null); // no amount
  assert.equal(legalize({ action: 'raise', amount: 100 }, snap({ stack: 15 })), null); // can't cover the call
  assert.deepEqual(legalize({ action: 'all-in' }, snap()), { kind: 'raise', amount: 1000, line: '' });
});

test('legalize: BB option (live bet, nothing to call) → check unless all-in', () => {
  const bb = snap({ street: 'PreFlop', board: [], highestBet: 10, chipsInPot: 10, minRaise: 10, stack: 990 });
  assert.deepEqual(legalize({ action: 'raise', amount: 38 }, bb), { kind: 'check', amount: 0, line: '' });
  assert.deepEqual(legalize({ action: 'raise', amount: 1000 }, bb), { kind: 'raise', amount: 1000, line: '' });
  // the old bots-6 rule raise that produced IllegalBet:38
  assert.deepEqual(legalizeRules({ kind: 'raise', amount: 38, line: 'pressure' }, bb), { kind: 'check', amount: 0, line: 'pressure' });
});

test('decideMove: no brain → rules', async () => {
  const d = await decideMove(null, snap(), rules);
  assert.equal(d.source, 'rules');
  assert.equal(d.kind, 'call');
});

const completionFetch = (content: string) =>
  (async (url: string) => {
    if (url.endsWith('/chat/completions')) {
      return new Response(JSON.stringify({ id: 'c1', model: 'm', choices: [{ message: { content } }] }), { status: 200 });
    }
    return new Response('{}', { status: 404 }); // signature unavailable
  }) as unknown as typeof fetch;

test('decideMove: valid LLM JSON → llm move (unverified when signature missing)', async () => {
  const brain = createBrain({ apiKey: 'k', fetch: completionFetch('{"action":"raise","amount":75,"line":"you sure?"}') });
  const d = await decideMove(brain, snap(), rules);
  assert.equal(d.source, 'llm');
  assert.deepEqual([d.kind, d.amount, d.line, d.verified], ['raise', 75, 'you sure?', false]);
});

test('decideMove: garbage output → rules', async () => {
  const brain = createBrain({ apiKey: 'k', fetch: completionFetch('I fold. Or call? whatever') });
  const d = await decideMove(brain, snap(), rules);
  assert.equal(d.source, 'rules');
  assert.match(d.fallbackReason!, /unparseable/);
});

test('decideMove: illegal LLM move (check facing bet) → rules', async () => {
  const brain = createBrain({ apiKey: 'k', fetch: completionFetch('{"action":"check","line":"hmm"}') });
  const d = await decideMove(brain, snap(), rules);
  assert.equal(d.source, 'rules');
  assert.match(d.fallbackReason!, /illegal/);
});

test('decideMove: timeout → rules', async () => {
  const hang = ((_u: string, init?: RequestInit) =>
    new Promise<Response>((_r, rej) => init?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))))) as unknown as typeof fetch;
  const brain = createBrain({ apiKey: 'k', fetch: hang, timeoutMs: 50 });
  const t0 = Date.now();
  const d = await decideMove(brain, snap(), rules);
  assert.equal(d.source, 'rules');
  assert.equal(d.fallbackReason, 'timeout');
  assert.ok(Date.now() - t0 < 1000);
});

test('decideMove: HTTP 500 → rules', async () => {
  const brain = createBrain({ apiKey: 'k', fetch: (async () => new Response('x', { status: 500 })) as unknown as typeof fetch });
  const d = await decideMove(brain, snap(), rules);
  assert.equal(d.source, 'rules');
});
