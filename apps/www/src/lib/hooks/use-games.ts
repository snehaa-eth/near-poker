'use client';

import { useQuery } from '@tanstack/react-query';

import {
  api,
  type LeaderboardEntry,
  type PlayerActivityPage,
} from '~/lib/api';

export function useLeaderboard(limit = 50) {
  return useQuery({
    queryKey: ['leaderboard', limit],
    queryFn: async (): Promise<LeaderboardEntry[]> => {
      const res = await api.leaderboard(limit);
      return res.entries;
    },
    refetchInterval: 15_000,
  });
}

export function useGames(opts?: {
  status?: string;
  includeEnded?: boolean;
}) {
  return useQuery({
    queryKey: ['games', opts?.status ?? null, opts?.includeEnded ?? false],
    queryFn: async () => {
      const res = await api.listGames(opts);
      return res.games;
    },
    refetchInterval: 8_000,
  });
}

export function usePlayerActivity(opts: {
  page: number;
  limit?: number;
  category?: 'deposit' | 'withdraw' | 'game' | 'all';
  enabled?: boolean;
}) {
  const limit = opts.limit ?? 10;
  const category = opts.category ?? 'all';

  return useQuery({
    queryKey: ['player-activity', opts.page, limit, category],
    queryFn: async (): Promise<PlayerActivityPage> =>
      api.activity({ page: opts.page, limit, category }),
    enabled: opts.enabled !== false,
    placeholderData: (prev) => prev,
  });
}
