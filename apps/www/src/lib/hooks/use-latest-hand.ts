'use client';

import { api } from '~/lib/api';

import { useQuery } from '@tanstack/react-query';

export type LatestHand = { handId: string; gameId: string; gameName: string; createdAt?: string; complete?: boolean };

/**
 * The most recent recorded hand across arena tables (live or ended), so empty
 * states can always offer something real to replay / verify.
 */
export async function fetchLatestHands(limit = 5): Promise<LatestHand[]> {
  const { games } = await api.listGames({ includeEnded: true });
  const recent = [...games]
    .sort((a, b) => String((b as { updatedAt?: string }).updatedAt ?? '').localeCompare(String((a as { updatedAt?: string }).updatedAt ?? '')))
    .slice(0, 4);
  const lists = await Promise.all(
    recent.map(async (g) => {
      try {
        const { hands } = await api.gameHands(g.gameId, limit);
        return hands.map((h) => ({ handId: h.handId, gameId: g.gameId, gameName: g.name, createdAt: h.createdAt, complete: h.complete }));
      } catch {
        return [];
      }
    })
  );
  return lists
    .flat()
    .filter((h) => h.complete !== false)
    .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))
    .slice(0, limit);
}

export function useLatestHands(limit = 5, enabled = true) {
  return useQuery({
    queryKey: ['latest-hands', limit],
    queryFn: () => fetchLatestHands(limit),
    enabled,
    staleTime: 15_000,
    retry: false,
  });
}
