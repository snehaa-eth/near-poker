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

export type PublicGameView = {
  gameId: string;
  name: string;
  joinCode: string;
  minChips: number;
  maxPlayers: number;
  status: string;
  round: string;
  roundLabel: string;
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
  amountNight: number | null;
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

export const api = {
  me: () => request<SessionUser>('/auth/me'),
  setNickname: (nickname: string) =>
    request<SessionUser>('/auth/nickname', {
      method: 'POST',
      body: JSON.stringify({ nickname }),
    }),
  upsertProfile: (input: {
    walletAddress: string;
    nickname?: string;
    avatar?: string | null;
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
  treasuryDeposit: (nightAmount: number) =>
    request<{
      sessionId: string;
      nickname: string;
      chips: number;
      nightAmount: number;
      chipsAdded: number;
      chipsPerNight: number;
      onChain: string;
    }>('/treasury/deposit', {
      method: 'POST',
      body: JSON.stringify({ nightAmount }),
    }),
  treasuryWithdraw: (input: { chipsAmount?: number; nightAmount?: number }) =>
    request<{
      sessionId: string;
      nickname: string;
      chips: number;
      chipsDebited: number;
      grossNight: number;
      feeNight: number;
      netNight: number;
      onChain: string;
    }>('/treasury/withdraw', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
};
