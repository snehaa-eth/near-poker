import { env } from '~/env';

export type SessionUser = {
  sessionId: string;
  nickname: string;
  chips: number;
  walletAddress: string | null;
  avatar: string | null;
};

export type LobbyGame = {
  gameId: string;
  name: string;
  joinCode: string;
  minChips: number;
  maxPlayers: number;
  totalPlayers: number;
  players?: Array<{ id: string; nickname: string; seat: number }>;
  currentRound: string;
  round?: string;
  status: string;
  pot?: number;
  winnerId?: string | null;
  winnerNickname?: string | null;
  gameStarted: boolean;
  gameEnded?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

/** INTERFACES §4 — provably fair deck commitment / reveal. */
export type FairnessView = {
  handId: string;
  seedHash: string;
  /** explorer tx when committed on-chain */
  committedTx?: string;
  revealed?: {
    serverSeed: string;
    entropy: string[];
    deckSeed: string;
    revealTx?: string;
  };
};

/** INTERFACES §4 — AI agent seated at the table. */
export type BotInfo = {
  persona: string;
  model?: string;
  attested?: boolean;
  signingAddress?: string;
  lastLine?: string;
};

/** INTERFACES §5.4 — TEE agent seated at an arena table. */
export type AgentInfo = {
  model: string;
  movesVerified: number;
  /** NEAR AI Verification Center link for the agent's latest accepted move. */
  lastReceiptUrl?: string;
};

/** GET /arena/tables (INTERFACES §5.4). `seats` may be a count or a seat list. */
export type ArenaTable = {
  gameId: string;
  seats:
    | number
    | Array<{
        seat?: number;
        playerId?: string;
        nickname?: string;
        walletAddress?: string;
        model?: string;
        chips?: number;
      }>;
  handsPlayed: number;
  status: string;
  name?: string;
};

/** GET /arena/leaderboard (INTERFACES §5.4). */
export type ArenaLeaderboardEntry = {
  walletAddress: string;
  nickname: string;
  model: string;
  hands: number;
  netChips: number;
  movesVerified: number;
  lastSeen?: string | number | null;
};

/** GET /arena/moves/:handId (INTERFACES §5.4) — one accepted TEE move. */
export type ArenaMoveRecord = {
  handId: string;
  gameId: string;
  playerId: string;
  nickname?: string;
  action: 'fold' | 'check' | 'call' | 'raise' | string;
  amount?: number | null;
  challenge: string;
  completionId: string;
  model: string;
  signingAddress: string;
  signedText: string;
  signature: string;
  verifiedAt: string | number;
};

/** GET /hands/:handId (INTERFACES §4). */
export type HandRecord = {
  handId: string;
  gameId: string;
  seedHash: string;
  serverSeed?: string;
  entropy?: string[];
  seats: Array<{
    seat: number;
    playerId: string;
    nickname: string;
    holeCards: number[];
  }>;
  community: number[];
  txs?: Record<string, string | undefined> | string[];
  /** Card id space used in seats/community. Defaults to engine ids. */
  cardIds?: 'engine' | 'ui';
  /** @deprecated alias of cardIds */
  cardIdSpace?: 'engine' | 'ui';
  deckSeed?: string;
  revealed?: boolean;
  complete?: boolean;
  ledger?: string;
  deltas?: Record<string, number> | Array<[string, string | number]>;
  /** Server-side verifyHand problems (informational; we recompute anyway). */
  errors?: string[];
};

export type PublicGameView = {
  gameId: string;
  name: string;
  joinCode: string;
  minChips: number;
  maxPlayers: number;
  status: string;
  round: string;
  roundLabel: string;
  /** Engine street (preflop/flop/…) when the server sends it. */
  street?: string;
  players: Array<{
    id: string;
    nickname: string;
    seat: number;
    chipsInPot: number;
    folded: boolean;
    shuffled: boolean;
    holeCards: number[];
    chosenCommunity: number[];
    weight: number;
    bot?: BotInfo;
    /** Arena tables only (INTERFACES §5.4). */
    agent?: AgentInfo;
  }>;
  communityCards: number[];
  pot: number;
  highestBet: number;
  /** Min raise increment (NLHE). */
  minRaise?: number;
  dealerSeat?: number;
  stacksByPlayerId?: Record<string, number>;
  nextSeat: number;
  nextPlayerId: string | null;
  nextPlayerNickname: string | null;
  winnerId: string | null;
  winnerNickname: string | null;
  totalPlayers: number;
  totalShuffles: number;
  gameStarted: boolean;
  gameEnded: boolean;
  myPlayerId: string | null;
  isMyTurn: boolean;
  fairness?: FairnessView;
  /** Agent Arena table: hands auto-start, humans only watch (INTERFACES §5.2). */
  arena?: boolean;
};

export type NearProofBody = {
  accountId: string;
  publicKey: string;
  signature: string;
  message: string;
  recipient: string;
  nonce: string;
};

export type LeaderboardEntry = {
  rank: number;
  sessionId: string;
  nickname: string;
  chips: number;
  wins: number;
  potsWon: number;
  gamesPlayed: number;
};

export type PlayerActivityEvent = {
  id: string;
  sessionId: string;
  walletAddress: string | null;
  category: 'deposit' | 'withdraw' | 'game';
  type: string;
  gameId: string | null;
  amountChips: number | null;
  amountNear?: number | null;
  /** legacy field name from the Midnight build */
  amountNight?: number | null;
  balanceAfter: number | null;
  summary: string;
  payload: Record<string, unknown>;
  createdAt: string | null;
};

export type PlayerActivityPage = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
  events: PlayerActivityEvent[];
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${env.NEXT_PUBLIC_API_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new Error(
      typeof data === 'object' && data && 'error' in data && data.error
        ? String(data.error)
        : `Request failed (${res.status})`
    );
  }
  return data;
}

/**
 * Like `request`, but a missing endpoint (404) resolves to `fallback`, so
 * pages render while the server side of a feature is still being built.
 */
async function requestOr<T>(path: string, fallback: T): Promise<T> {
  const res = await fetch(`${env.NEXT_PUBLIC_API_URL}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  });
  if (res.status === 404) return fallback;
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    if (res.ok) return fallback;
  }
  if (!res.ok) {
    const err =
      data && typeof data === 'object' && 'error' in data
        ? String((data as { error: unknown }).error)
        : `Request failed (${res.status})`;
    throw new Error(err);
  }
  return data as T;
}

/** Accept either a bare array or `{ <key>: [...] }` from the server. */
function listFrom<T>(data: unknown, key: string): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === 'object') {
    const v = (data as Record<string, unknown>)[key];
    if (Array.isArray(v)) return v as T[];
  }
  return [];
}

export const api = {
  me: () => request<SessionUser>('/auth/me'),
  /** Server-issued one-time NEP-413 nonce (base64, 32 bytes, 5 min). */
  loginNonce: () =>
    request<{
      nonce: string;
      expiresAt: number;
      message: string;
      recipient: string;
    }>('/auth/nonce'),
  setNickname: (nickname: string) =>
    request<SessionUser>('/auth/nickname', {
      method: 'POST',
      body: JSON.stringify({ nickname }),
    }),
  upsertProfile: (input: {
    walletAddress: string;
    nickname?: string;
    avatar?: string | null;
    /** NEP-413 login proof; server verification pending. */
    nearProof?: NearProofBody;
  }) =>
    request<SessionUser>('/auth/profile', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  listGames: (opts?: { status?: string; includeEnded?: boolean }) => {
    const params = new URLSearchParams();
    if (opts?.status) params.set('status', opts.status);
    if (opts?.includeEnded) params.set('includeEnded', '1');
    const q = params.toString();
    return request<{ games: LobbyGame[] }>(`/games${q ? `?${q}` : ''}`);
  },
  getGame: (idOrCode: string) =>
    request<PublicGameView>(`/games/${encodeURIComponent(idOrCode)}`),
  createGame: (input: { name: string; minChips: number }) =>
    request<PublicGameView>('/games', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  joinGame: (idOrCode: string) =>
    request<PublicGameView>(`/games/${encodeURIComponent(idOrCode)}/join`, {
      method: 'POST',
      body: '{}',
    }),
  adminMe: () => request<{ admin: boolean }>('/admin/me'),
  adminLogin: (password: string) =>
    request<{ ok: boolean; admin: boolean }>('/admin/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),
  adminLogout: () =>
    request<{ ok: boolean }>('/admin/logout', {
      method: 'POST',
      body: '{}',
    }),
  leaderboard: (limit = 50) =>
    request<{ entries: LeaderboardEntry[] }>(
      `/leaderboard?limit=${encodeURIComponent(String(limit))}`
    ),
  activity: (opts?: {
    page?: number;
    limit?: number;
    category?: 'deposit' | 'withdraw' | 'game' | 'all';
  }) => {
    const params = new URLSearchParams();
    if (opts?.page) params.set('page', String(opts.page));
    if (opts?.limit) params.set('limit', String(opts.limit));
    if (opts?.category && opts.category !== 'all') {
      params.set('category', opts.category);
    }
    const q = params.toString();
    return request<PlayerActivityPage>(`/auth/activity${q ? `?${q}` : ''}`);
  },
  /** INTERFACES §5.4 — live arena tables (empty when the endpoint is absent). */
  arenaTables: async () =>
    listFrom<ArenaTable>(
      await requestOr<unknown>('/arena/tables', []),
      'tables'
    ),
  arenaLeaderboard: async () =>
    listFrom<ArenaLeaderboardEntry>(
      await requestOr<unknown>('/arena/leaderboard', []),
      'entries'
    ),
  arenaMoves: async (handId: string) =>
    listFrom<ArenaMoveRecord>(
      await requestOr<unknown>(
        `/arena/moves/${encodeURIComponent(handId)}`,
        []
      ),
      'moves'
    ),
  /** INTERFACES §5.2 — agents normally call these from agent-starter. */
  arenaJoin: () =>
    request<{ queued?: boolean; position?: number; gameId?: string }>(
      '/arena/join',
      { method: 'POST', body: '{}' }
    ),
  arenaLeave: () =>
    request<{ ok?: boolean }>('/arena/leave', { method: 'POST', body: '{}' }),
  getHand: (handId: string) =>
    request<HandRecord>(`/hands/${encodeURIComponent(handId)}`),
  /**
   * Credit off-chain chips. `nearAmount` is decimal NEAR; `txHash` is the
   * table-vault `deposit()` tx when on-chain (server verifies against chain).
   * `nightAmount` is sent as a legacy alias until the server is ported.
   */
  treasuryDeposit: (input: {
    nearAmount: number;
    yocto?: string;
    txHash?: string | null;
  }) =>
    request<{
      sessionId: string;
      nickname: string;
      chips: number;
      chipsAdded: number;
      nearAmount?: number;
      onChain?: string;
    }>('/treasury/deposit', {
      method: 'POST',
      body: JSON.stringify({ ...input, nightAmount: input.nearAmount }),
    }),
  treasuryWithdraw: (input: {
    chipsAmount: number;
    yocto?: string;
    txHash?: string | null;
  }) =>
    request<{
      sessionId: string;
      nickname: string;
      chips: number;
      chipsDebited: number;
      netNear?: number;
      onChain?: string;
    }>('/treasury/withdraw', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
};
