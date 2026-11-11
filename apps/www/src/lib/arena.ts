import type {
  ArenaLeaderboardEntry,
  ArenaMoveRecord,
  ArenaTable,
  PublicGameView,
} from './api';
import { NEAR_NETWORK } from './near/rpc';

export const AGENTS_MD_URL =
  'https://github.com/snehaa-eth/near-poker/blob/main/AGENTS.md';

export const AGENT_STARTER_URL =
  'https://github.com/snehaa-eth/near-poker/tree/main/agent-starter';

/** Seconds an arena agent has to answer `arena:turn` (ARENA_TURN_MS default). */
export const ARENA_TURN_SECONDS = 30;

export function accountUrl(accountId: string) {
  return NEAR_NETWORK === 'mainnet'
    ? `https://nearblocks.io/address/${accountId}`
    : `https://testnet.nearblocks.io/address/${accountId}`;
}

/** "deepseek-ai/DeepSeek-V3.1" → "DeepSeek-V3.1", clipped for chips. */
export function shortModel(model: string, max = 18) {
  const tail = model.split('/').pop() || model;
  return tail.length > max ? `${tail.slice(0, max - 1)}…` : tail;
}

function base64url(text: string) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  bytes.forEach((b) => {
    bin += String.fromCharCode(b);
  });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * NEAR AI Verification Center link for one accepted move (INTERFACES §5.4).
 * The Center re-checks the signature and the Intel TDX + NVIDIA GPU evidence
 * in the viewer's browser.
 */
export function receiptUrl(
  move: Pick<
    ArenaMoveRecord,
    | 'completionId'
    | 'model'
    | 'signingAddress'
    | 'signedText'
    | 'signature'
    | 'verifiedAt'
  >
) {
  const receipt = {
    completionId: move.completionId,
    model: move.model,
    signatureKind: 'provider_tee',
    signingAlgo: 'ed25519',
    signingAddress: move.signingAddress,
    signedText: move.signedText,
    signature: move.signature,
    verifiedAt: move.verifiedAt,
  };
  return `https://cloud.near.ai/verify?model=${encodeURIComponent(
    move.model
  )}#receipt=${base64url(JSON.stringify(receipt))}`;
}

/* ------------------------------------------------------------------ */
/* Mock fixtures (?mock=1) so pages render before the server endpoints */
/* ------------------------------------------------------------------ */

const hex = (seed: number, bytes: number) =>
  Array.from({ length: bytes }, (_, i) =>
    ((seed * 31 + i * 17) % 256).toString(16).padStart(2, '0')
  ).join('');

const MOCK_AGENTS = [
  {
    walletAddress: 'shark-agent.testnet',
    nickname: 'Shark',
    model: 'deepseek-ai/DeepSeek-V3.1',
  },
  {
    walletAddress: 'qwen-grinder.testnet',
    nickname: 'Grinder',
    model: 'Qwen/Qwen3-30B-A3B-Instruct-2507',
  },
  {
    walletAddress: 'gpt-oss-bluff.testnet',
    nickname: 'Bluffington',
    model: 'openai/gpt-oss-120b',
  },
  {
    walletAddress: 'glm-nit.testnet',
    nickname: 'Nit',
    model: 'zai-org/GLM-4.6',
  },
  {
    walletAddress: 'fox-agent.testnet',
    nickname: 'Fox',
    model: 'Qwen/Qwen3.6-35B-A3B-FP8',
  },
  {
    walletAddress: 'owl-agent.testnet',
    nickname: 'Owl',
    model: 'Qwen/Qwen3.6-35B-A3B-FP8',
  },
] as const;

export const MOCK_GAME_ID = 'mock-arena-1';

export function mockMove(
  i: number,
  action: string,
  amount?: number
): ArenaMoveRecord {
  const a = MOCK_AGENTS[i % MOCK_AGENTS.length]!;
  return {
    handId: 'demo',
    gameId: MOCK_GAME_ID,
    playerId: a.walletAddress,
    nickname: a.nickname,
    action,
    amount: amount ?? null,
    challenge: hex(i + 1, 16),
    completionId: `chatcmpl-${hex(i + 7, 8)}`,
    model: a.model,
    signingAddress: hex(i + 3, 32),
    signedText: `${a.model}:${hex(i + 11, 32)}:${hex(i + 13, 32)}`,
    signature: hex(i + 5, 64),
    verifiedAt: new Date(Date.UTC(2026, 10, 11, 12, 0, i * 7)).toISOString(),
  };
}

export const mockArenaTables = (): ArenaTable[] => [
  {
    gameId: MOCK_GAME_ID,
    name: 'Arena #1',
    status: 'playing',
    handsPlayed: 42,
    seats: MOCK_AGENTS.slice(0, 3).map((a, i) => ({
      seat: i,
      playerId: a.walletAddress,
      nickname: a.nickname,
      walletAddress: a.walletAddress,
      model: a.model,
    })),
  },
  {
    gameId: 'mock-arena-2',
    name: 'Arena #2',
    status: 'waiting',
    handsPlayed: 0,
    seats: 2,
  },
];

export const mockArenaLeaderboard = (): ArenaLeaderboardEntry[] =>
  MOCK_AGENTS.map((a, i) => ({
    ...a,
    hands: [128, 97, 64, 55, 41, 23][i]!,
    netChips: [1840, 912, 312, -220, -655, -1497][i]!,
    movesVerified: [512, 401, 266, 190, 144, 88][i]!,
    lastSeen: new Date(Date.UTC(2026, 10, 11, 12, i)).toISOString(),
  }));

export const mockArenaMoves = (): ArenaMoveRecord[] => [
  mockMove(3, 'raise', 40),
  mockMove(4, 'call', 40),
  mockMove(5, 'fold'),
  mockMove(0, 'call', 40),
  mockMove(1, 'call', 40),
  mockMove(2, 'fold'),
  mockMove(0, 'check'),
  mockMove(1, 'raise', 120),
  mockMove(3, 'call', 120),
  mockMove(4, 'fold'),
  mockMove(0, 'call', 120),
];

export function mockArenaView(gameId: string): PublicGameView {
  // UI card ids are unique 0..51 (rank = id%13, suit = floor(id/13); A=12).
  // Board: 4♥ Q♣ K♣ A♠ K♥ — hole cards must not repeat those.
  const board = [15, 49, 50, 12, 24]; // 4H, QC, KC, AS, KH
  const foldedSeats = new Set([2, 5]);
  const players = MOCK_AGENTS.map((a, i) => {
    const last = mockMove(i, foldedSeats.has(i) ? 'fold' : 'call', 40);
    return {
      id: a.walletAddress,
      nickname: a.nickname,
      seat: i,
      chipsInPot: foldedSeats.has(i) ? 20 : 120,
      folded: foldedSeats.has(i),
      shuffled: true,
      // Shark: 2♣ A♦ · Grinder: Q♠ 6♠ — distinct from the board
      holeCards: i === 0 ? [39, 38] : i === 1 ? [10, 4] : [-1, -1],
      chosenCommunity: [],
      weight: 0,
      agent: {
        model: a.model,
        movesVerified: [512, 401, 266, 190, 144, 88][i]!,
        lastReceiptUrl: receiptUrl(last),
      },
    };
  });
  return {
    gameId,
    name: 'Arena #4591',
    joinCode: '',
    minChips: 100,
    maxPlayers: 6,
    status: 'playing',
    round: 'River',
    roundLabel: 'River',
    street: 'river',
    players,
    communityCards: board,
    pot: 3251,
    highestBet: 120,
    minRaise: 40,
    dealerSeat: 0,
    stacksByPlayerId: Object.fromEntries(
      players.map((p, i) => [p.id, [2400, 1800, 900, 1500, 1100, 700][i]!])
    ),
    nextSeat: 1,
    nextPlayerId: players[1]!.id,
    nextPlayerNickname: players[1]!.nickname,
    winnerId: null,
    winnerNickname: null,
    totalPlayers: players.length,
    totalShuffles: players.length,
    gameStarted: true,
    gameEnded: false,
    myPlayerId: null,
    isMyTurn: false,
    arena: true,
    fairness: { handId: 'demo', seedHash: hex(99, 32) },
  };
}
