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
  /** Table talk from its latest move (only while fresh). */
  lastLine?: string;
  lastLineAt?: number;
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
  /** Minimum vault chips required to join. */
  minChips?: number;
  /** Starting blinds for the table (from lobby minChips or live hand). */
  smallBlind?: number;
  bigBlind?: number;
  /** Agents seated between hands, dealt in from the next hand (INTERFACES §5.2). */
  waiting?: Array<{ playerId?: string; nickname: string; walletAddress?: string; model?: string }>;
  /** Seats still free (6 minus seated and waiting). */
  freeSeats?: number;
  /** Scheduled event this table belongs to (INTERFACES §5.6). */
  eventId?: string | null;
  /** Event over: the table finishes its hand and closes. */
  closing?: boolean;
};

/** GET /arena/status (INTERFACES §5.2). */
export type ArenaStatus = {
  enabled: boolean;
  minAgents: number;
  minChips: number;
  turnMs: number;
  handGapMs: number;
  queue: Array<{ position: number; nickname: string; walletAddress: string; eventId?: string }>;
  me?: { gameId: string | null };
};

/** Scheduled arena event (INTERFACES §5.6), as listed by GET /events. */
export type ArenaEventSummary = {
  eventId: string;
  name: string;
  description: string;
  prize: string | null;
  startsAt: string;
  endsAt: string;
  durationMin: number;
  maxAgents: number;
  status: 'scheduled' | 'live' | 'ended';
  registered: number;
  startedAt: string | null;
  endedAt: string | null;
};

export type ArenaEventLeaderboardEntry = {
  rank: number;
  walletAddress: string;
  nickname: string;
  model: string;
  hands: number;
  netChips: number;
  movesVerified: number;
};

/** GET /events/:id (INTERFACES §5.6). */
export type ArenaEventDetail = ArenaEventSummary & {
  registrations: Array<{ walletAddress: string; nickname: string; model: string | null; registeredAt: string }>;
  gameIds: string[];
  tables: ArenaTable[];
  leaderboard: ArenaEventLeaderboardEntry[];
  /** Standings frozen (event ended and its tables closed). */
  final: boolean;
  me?: { registered: boolean };
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
  /** Raw NEAR AI completion (JSON) — carries the agent's table-talk `line`. */
  responseBody?: string;
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
    /** No chips behind and still in the hand (newer servers). */
    allIn?: boolean;
    /** Chips put in across the whole hand (newer servers). */
    committed?: number;
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
  /** Top winner's best hand name ("Two Pair", …) when the hand ended at showdown. */
  winningHand?: string;
  /** Arena: agents seated between hands, dealt in from the next hand ("joining next hand"). */
  arenaWaiting?: Array<{ nickname: string; walletAddress: string | null; model?: string }>;
  /* ---- Spectator broadcast fields (optional: older servers omit them) ---- */
  smallBlind?: number;
  bigBlind?: number;
  sbPlayerId?: string | null;
  bbPlayerId?: string | null;
  /** This hand's betting actions; `amount` = the actor's street total after acting. */
  actions?: PublicAction[];
  /** Main + side pots (in-hand: completed streets only; at hand end: awarded pots). */
  pots?: Array<{ amount: number; eligible: string[] }>;
  /** Hand end only: pot shares paid out. */
  winners?: Array<{ playerId: string; amount: number; potIndex: number }>;
  /** Hand end at showdown only: each contender's best hand name. */
  showdownHands?: Array<{ playerId: string; handName: string }>;
};

export type PublicAction = {
  playerId: string;
  street: string;
  type: 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'all-in' | string;
  amount?: number;
};

/** GET /games/:id/hands — recent provably-fair hands, newest first. */
export type GameHandSummary = {
  handId: string;
  seedHash: string;
  revealed?: boolean;
  complete?: boolean;
  createdAt?: string;
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
      // Lets the API work behind a free ngrok tunnel (skips its browser warning page).
      'ngrok-skip-browser-warning': '1',
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
    headers: {
      'Content-Type': 'application/json',
      'ngrok-skip-browser-warning': '1',
    },
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
  /** INTERFACES §5.2 — queue + settings (null when the endpoint is absent). */
  arenaStatus: () => requestOr<ArenaStatus | null>('/arena/status', null),
  /** INTERFACES §5.6 — scheduled arena events. */
  events: async () =>
    listFrom<ArenaEventSummary>(await requestOr<unknown>('/events', []), 'events'),
  event: (eventId: string) =>
    request<ArenaEventDetail>(`/events/${encodeURIComponent(eventId)}`),
  eventRegister: (eventId: string, model?: string) =>
    request<{ registered: boolean }>(`/events/${encodeURIComponent(eventId)}/register`, {
      method: 'POST',
      body: JSON.stringify(model ? { model } : {}),
    }),
  eventUnregister: (eventId: string) =>
    request<{ registered: boolean }>(`/events/${encodeURIComponent(eventId)}/unregister`, {
      method: 'POST',
      body: '{}',
    }),
  /** INTERFACES §5.2 — agents normally call these from agent-starter. */
  arenaJoin: () =>
    request<{ queued?: boolean; position?: number; gameId?: string }>(
      '/arena/join',
      { method: 'POST', body: '{}' }
    ),
  arenaLeave: () =>
    request<{ ok?: boolean }>('/arena/leave', { method: 'POST', body: '{}' }),
  gameHands: (gameId: string, limit = 200) =>
    request<{ hands: GameHandSummary[] }>(
      `/games/${encodeURIComponent(gameId)}/hands?limit=${limit}`
    ),
  getHand: (handId: string) =>
    request<HandRecord>(`/hands/${encodeURIComponent(handId)}`),
  /**
   * Credit chips. `nearAmount` is decimal NEAR; `txHash` is the
   * table-vault `deposit()` tx when on-chain (server verifies against chain).
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
      body: JSON.stringify(input),
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

// ─── Hosted agents (created on the website, run by the server) ──────────────

export type HostedPersona = { id: string; label: string; blurb: string };

export type HostedConfig = {
  enabled: boolean;
  reason?: string;
  chain: 'near' | 'local';
  defaultModel: string;
  personas: HostedPersona[];
  fundNear: number;
  depositNear: number;
  maxCallsDefault: number;
  customMax: number;
};

export type HostedAgentPublic = {
  agentId: string;
  name: string;
  persona: string;
  personaLabel: string;
  model: string;
  walletAddress: string;
  chain: 'near' | 'local';
  walletUrl: string | null;
  state: 'queued' | 'playing' | 'idle' | 'error' | 'deleted';
  gameId: string | null;
  stats: { hands: number; netChips: number; movesVerified: number };
  createdAt?: string;
};

export type HostedAgentOwner = HostedAgentPublic & {
  owner: true;
  customPrompt: string;
  maxCalls: number;
  eventId: string | null;
  statusDetail: string;
  chips: number | null;
  lastRun: { reason: string; hands: number; moves: number; llmCalls: number; endedAt: string } | null;
  runs: number;
  txs: { createAccount?: string; deposit?: string };
  logs: string[];
  appliesNextRun?: boolean;
};

export type HostedCreateInput = {
  name: string;
  persona: string;
  customPrompt?: string;
  model?: string;
  nearAiKey: string;
  maxCalls?: number;
  eventId?: string;
};

export type HostedCreated = {
  agentId: string;
  ownerToken: string;
  manageUrl: string;
  walletAddress: string;
  chain: 'near' | 'local';
  txs: { createAccount?: string; deposit?: string };
  warning?: string;
};

export type ArenaEventOption = { id: string; name: string; startsAt?: string };

const ownerHeaders = (token: string) => ({ 'x-owner-token': token });

export const hostedApi = {
  config: () => request<HostedConfig>('/hosted-agents/config'),
  list: async () =>
    listFrom<HostedAgentPublic>(
      await requestOr<unknown>('/hosted-agents', []),
      'agents'
    ),
  create: (input: HostedCreateInput) =>
    request<HostedCreated>('/hosted-agents', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  get: (id: string, token?: string | null) =>
    request<HostedAgentPublic | HostedAgentOwner>(
      `/hosted-agents/${encodeURIComponent(id)}`,
      token ? { headers: ownerHeaders(token) } : undefined
    ),
  play: (id: string, token: string) =>
    request<HostedAgentOwner>(`/hosted-agents/${encodeURIComponent(id)}/play`, {
      method: 'POST',
      body: '{}',
      headers: ownerHeaders(token),
    }),
  withdraw: (id: string, token: string, to: string) =>
    request<{ withdrawnYocto: string; sentYocto: string; txs: { withdraw?: string; transfer?: string } }>(
      `/hosted-agents/${encodeURIComponent(id)}/withdraw`,
      { method: 'POST', body: JSON.stringify({ to }), headers: ownerHeaders(token) }
    ),
  stop: (id: string, token: string, force = false) =>
    request<{ stopping: boolean }>(
      `/hosted-agents/${encodeURIComponent(id)}/stop`,
      { method: 'POST', body: JSON.stringify({ force }), headers: ownerHeaders(token) }
    ),
  update: (
    id: string,
    token: string,
    patch: Partial<Pick<HostedCreateInput, 'persona' | 'customPrompt' | 'model' | 'nearAiKey' | 'maxCalls'>> & {
      /** null leaves the event. */
      eventId?: string | null;
    }
  ) =>
    request<HostedAgentOwner>(`/hosted-agents/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
      headers: ownerHeaders(token),
    }),
  remove: (id: string, token: string) =>
    request<{ deleted: boolean }>(`/hosted-agents/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: ownerHeaders(token),
    }),
  /** Returns the .tar.gz as a Blob (secrets travel only in this owner-authenticated response). */
  download: async (id: string, token: string, includeApiKey: boolean) => {
    const res = await fetch(
      `${env.NEXT_PUBLIC_API_URL}/hosted-agents/${encodeURIComponent(id)}/download`,
      {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': '1',
          ...ownerHeaders(token),
        },
        body: JSON.stringify({ includeApiKey }),
      }
    );
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error ?? `Download failed (${res.status})`);
    }
    return res.blob();
  },
  /** Scheduled events, if the server has them (404 → null: hide the picker). */
  events: async (): Promise<ArenaEventOption[] | null> => {
    const data = await requestOr<unknown>('/events', null).catch(() => null);
    if (data === null) return null;
    return listFrom<Record<string, unknown>>(data, 'events')
      .map((e) => ({
        id: String(e.id ?? e.eventId ?? ''),
        name: String(e.name ?? e.title ?? e.id ?? 'Event'),
        startsAt: typeof e.startsAt === 'string' ? e.startsAt : undefined,
      }))
      .filter((e) => e.id);
  },
};
