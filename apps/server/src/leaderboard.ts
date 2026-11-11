import { GameModel, SessionModel } from './db.js';

export type LeaderboardEntry = {
  rank: number;
  sessionId: string;
  nickname: string;
  chips: number;
  wins: number;
  potsWon: number;
  gamesPlayed: number;
};

export async function getLeaderboard(limit = 50): Promise<LeaderboardEntry[]> {
  const capped = Math.min(Math.max(limit, 1), 100);

  const [sessions, endedGames] = await Promise.all([
    SessionModel.find({}).lean(),
    GameModel.find({ status: 'ended' }).lean(),
  ]);

  type Acc = {
    sessionId: string;
    nickname: string;
    chips: number;
    wins: number;
    potsWon: number;
    gamesPlayed: number;
  };

  const byId = new Map<string, Acc>();

  for (const session of sessions) {
    byId.set(session.sessionId, {
      sessionId: session.sessionId,
      nickname: session.nickname,
      chips: session.chips ?? 0,
      wins: 0,
      potsWon: 0,
      gamesPlayed: 0,
    });
  }

  for (const game of endedGames) {
    const nickById = new Map<string, string>();
    const ids = game.playerIds ?? [];
    const nicks = game.playerNicknames ?? [];
    for (let i = 0; i < ids.length; i++) {
      nickById.set(ids[i]!, nicks[i] ?? `Player ${i + 1}`);
    }

    for (const playerId of ids) {
      const existing = byId.get(playerId);
      if (existing) {
        existing.gamesPlayed += 1;
      } else {
        byId.set(playerId, {
          sessionId: playerId,
          nickname: nickById.get(playerId) ?? 'Unknown',
          chips: 0,
          wins: 0,
          potsWon: 0,
          gamesPlayed: 1,
        });
      }
    }

    if (game.winnerId) {
      const winner = byId.get(game.winnerId);
      if (winner) {
        winner.wins += 1;
        winner.potsWon += game.pot ?? 0;
        if (
          !sessions.some((s) => s.sessionId === game.winnerId) &&
          nickById.has(game.winnerId)
        ) {
          winner.nickname = nickById.get(game.winnerId)!;
        }
      } else {
        byId.set(game.winnerId, {
          sessionId: game.winnerId,
          nickname: nickById.get(game.winnerId) ?? 'Unknown',
          chips: 0,
          wins: 1,
          potsWon: game.pot ?? 0,
          gamesPlayed: 1,
        });
      }
    }
  }

  const sorted = [...byId.values()].sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (b.potsWon !== a.potsWon) return b.potsWon - a.potsWon;
    if (b.chips !== a.chips) return b.chips - a.chips;
    return a.nickname.localeCompare(b.nickname);
  });

  return sorted.slice(0, capped).map((entry, index) => ({
    rank: index + 1,
    ...entry,
  }));
}
