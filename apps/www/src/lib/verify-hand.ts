/**
 * The browser-side hand check (shared by /verify/[handId], the home-page receipt and anything
 * else that wants to stamp a hand VERIFIED). Pure functions over a HandRecord: no network.
 */
import type { HandRecord } from './api';
import { MOCK_AGENTS } from './arena';
import {
  bytesToHex,
  computeDeckSeed,
  dealFromDeck,
  engineCardLabel,
  selfTest,
  sha256Hex,
  shuffleFromSeed,
  uiIdToEngineId,
} from './fairness';
import { errorHandler } from './utils';

export type CheckStatus = 'pass' | 'fail' | 'pending';

export type Check = { label: string; status: CheckStatus; detail?: string };

/**
 * Demo hand served locally at /verify/demo: six seats (the same demo agents as
 * the arena preview), one entropy per seat, all derived in the browser.
 */
export function demoRecord(): HandRecord {
  const serverSeed = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, '0')).join('');
  const entropy = MOCK_AGENTS.map((_, i) => ((i * 37 + 0xaa) % 256).toString(16).padStart(2, '0').repeat(16));
  const deck = shuffleFromSeed(computeDeckSeed(serverSeed, entropy));
  const dealt = dealFromDeck(deck, MOCK_AGENTS.length);
  return {
    handId: 'demo',
    gameId: 'demo',
    seedHash: sha256Hex(serverSeed),
    serverSeed,
    entropy,
    seats: MOCK_AGENTS.map((a, i) => ({
      seat: i,
      playerId: a.walletAddress,
      nickname: a.nickname,
      holeCards: dealt.hole[i]!,
    })),
    community: dealt.community,
    txs: {},
    cardIds: 'engine',
  };
}

function sameCards(expected: number[], actual: number[]) {
  return (
    expected.length === actual.length &&
    expected.every((c, i) => c === actual[i])
  );
}

export function isUiSpace(record: HandRecord) {
  return (record.cardIds ?? record.cardIdSpace) === 'ui';
}

export function verifyHand(record: HandRecord) {
  const checks: Check[] = [];
  const selfOk = selfTest();
  checks.push({
    label: 'Verifier self-check',
    status: selfOk ? 'pass' : 'fail',
    detail: selfOk
      ? 'This browser reproduces the published test vector (seed hash, deck seed, deck order)'
      : 'This browser’s implementation does not reproduce the spec vector',
  });
  const toEngine = (ids: number[]) =>
    isUiSpace(record) ? ids.map(uiIdToEngineId) : ids;
  const seats = [...record.seats].sort((a, b) => a.seat - b.seat);

  if (!record.serverSeed || !record.entropy) {
    checks.push({
      label: 'Shuffle secret revealed',
      status: 'pending',
      detail: 'The server reveals its secret seed after the hand ends. Check back in a moment.',
    });
    return {
      checks,
      deckSeedHex: null as string | null,
      deck: null as number[] | null,
    };
  }

  let seedHashOk = false;
  try {
    const recomputed = sha256Hex(record.serverSeed);
    seedHashOk = recomputed === record.seedHash.toLowerCase();
    checks.push({
      label: 'Shuffle matches what was locked before the deal',
      status: seedHashOk ? 'pass' : 'fail',
      detail: seedHashOk ? 'sha256(serverSeed) equals the committed seedHash' : `recomputed ${recomputed}`,
    });
  } catch (error) {
    checks.push({
      label: 'serverSeed is valid hex',
      status: 'fail',
      detail: errorHandler(error),
    });
    return { checks, deckSeedHex: null, deck: null };
  }

  const entropyOk = record.entropy.length === seats.length;
  checks.push({
    label: 'Every agent added randomness',
    status: entropyOk ? 'pass' : 'fail',
    detail: `${record.entropy.length} entropy contributions · ${seats.length} seats`,
  });

  let deckSeed: Uint8Array;
  try {
    deckSeed = computeDeckSeed(record.serverSeed, record.entropy);
  } catch (error) {
    checks.push({
      label: 'Entropy is valid hex',
      status: 'fail',
      detail: errorHandler(error),
    });
    return { checks, deckSeedHex: null, deck: null };
  }
  const deckSeedHex = bytesToHex(deckSeed);
  if (record.deckSeed) {
    const ok = record.deckSeed.toLowerCase() === deckSeedHex;
    checks.push({
      label: 'Deck seed matches the record (sha256 of seed + entropies)',
      status: ok ? 'pass' : 'fail',
    });
  }

  const deck = shuffleFromSeed(deckSeed);
  const dealt = dealFromDeck(deck, seats.length);

  seats.forEach((s, i) => {
    const actual = toEngine(s.holeCards ?? []);
    const expected = dealt.hole[i] ?? [];
    if (actual.length === 0 || actual.some((c) => c < 0)) {
      checks.push({
        label: `${s.nickname}’s cards (seat ${s.seat})`,
        status: 'pending',
        detail: `Mucked / hidden · deck says ${expected.map(engineCardLabel).join(' ')}`,
      });
      return;
    }
    const ok = sameCards(expected, actual);
    checks.push({
      label: `${s.nickname}’s cards (seat ${s.seat})`,
      status: ok ? 'pass' : 'fail',
      detail: ok
        ? actual.map(engineCardLabel).join(' ')
        : `dealt ${actual.map(engineCardLabel).join(' ')} · deck says ${expected
            .map(engineCardLabel)
            .join(' ')}`,
    });
  });

  const community = toEngine(record.community ?? []);
  const expectedBoard = dealt.community.slice(0, community.length);
  const boardOk = sameCards(expectedBoard, community);
  checks.push({
    label: `Community cards (${community.length}/5 dealt)`,
    status: community.length === 0 ? 'pending' : boardOk ? 'pass' : 'fail',
    detail:
      community.length === 0
        ? 'No board dealt (hand ended preflop)'
        : boardOk
          ? community.map(engineCardLabel).join(' ')
          : `dealt ${community.map(engineCardLabel).join(' ')} · deck says ${expectedBoard
              .map(engineCardLabel)
              .join(' ')}`,
  });

  if (record.errors && record.errors.length > 0) {
    checks.push({
      label: 'Server’s own check reported a problem',
      status: 'fail',
      detail: record.errors.join(' · '),
    });
  }

  return { checks, deckSeedHex, deck };
}

export function txList(
  txs: HandRecord['txs']
): Array<{ label: string; hash: string }> {
  if (!txs) return [];
  if (Array.isArray(txs)) {
    return txs
      .filter(Boolean)
      .map((hash, i) => ({ label: `tx ${i + 1}`, hash }));
  }
  return Object.entries(txs)
    .filter(
      (e): e is [string, string] => typeof e[1] === 'string' && e[1].length > 0
    )
    .map(([label, hash]) => ({ label, hash }));
}


export type HandVerdict = 'verified' | 'rejected' | 'pending';

export function verdictOf(checks: Check[]): HandVerdict {
  if (checks.some((c) => c.status === 'fail')) return 'rejected';
  return checks.every((c) => c.status === 'pass') ? 'verified' : 'pending';
}
