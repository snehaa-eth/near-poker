/**
 * Wipe all lobbies and seed 10 waiting tables.
 * Usage: pnpm --filter server exec tsx --env-file=.env scripts/seed-lobbies.ts
 */
import { connectMongo, GameEventModel, GameModel } from '../src/db.js';
import { createEmptyLobby, hydrateGamesFromDb } from '../src/game-store.js';

const SEEDS: Array<{
  name: string;
  maxPlayers: number;
  minChips: number;
}> = [
  { name: 'Heads-Up 100', maxPlayers: 2, minChips: 100 },
  { name: 'Four-Max 200', maxPlayers: 4, minChips: 200 },
  { name: 'Six-Max 300', maxPlayers: 6, minChips: 300 },
  { name: 'Heads-Up 150', maxPlayers: 2, minChips: 150 },
  { name: 'Four-Max 250', maxPlayers: 4, minChips: 250 },
  { name: 'Six-Max 350', maxPlayers: 6, minChips: 350 },
  { name: 'Heads-Up 400', maxPlayers: 2, minChips: 400 },
  { name: 'Four-Max 500', maxPlayers: 4, minChips: 500 },
  { name: 'Six-Max 600', maxPlayers: 6, minChips: 600 },
  { name: 'Eight-Max 750', maxPlayers: 8, minChips: 750 },
];

async function main() {
  const uri = process.env.MONGODB_URI ?? 'memory';
  const db = process.env.MONGODB_DB;
  await connectMongo(uri, db);

  const [games, events] = await Promise.all([
    GameModel.deleteMany({}),
    GameEventModel.deleteMany({}),
  ]);
  console.log(
    `Cleared ${games.deletedCount ?? 0} games, ${events.deletedCount ?? 0} events`
  );

  const created = [];
  for (const seed of SEEDS) {
    const state = await createEmptyLobby(seed);
    created.push({
      name: state.name,
      gameId: state.gameId,
      joinCode: state.joinCode,
      maxPlayers: state.maxPlayers,
      minChips: state.minChips,
    });
  }

  await hydrateGamesFromDb();
  console.log(JSON.stringify({ seeded: created.length, lobbies: created }, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
