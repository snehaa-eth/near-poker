import { createAppServer } from './app.js';
import { getArenaConfig } from './arena/config.js';
import { isArenaTestMode } from './auth.js';
import { connectMongo } from './db.js';
import { hydrateGamesFromDb } from './game-store.js';
import { getLedger } from './ledger.js';

const PORT = Number(process.env.PORT ?? 4000);
const MONGODB_URI = process.env.MONGODB_URI ?? 'memory';
const MONGODB_DB = process.env.MONGODB_DB;
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? 'http://localhost:3000';

async function main() {
  await connectMongo(MONGODB_URI, MONGODB_DB);
  await hydrateGamesFromDb();
  // Fail fast on a misconfigured CHAIN=near (bad env) instead of mid-hand.
  console.log(`[ledger] using ${getLedger().kind} ledger`);
  const arena = getArenaConfig();
  console.log(
    arena.nearaiApiKey
      ? `[arena] enabled (attestations from ${arena.nearaiBaseUrl})`
      : '[arena] disabled: set NEARAI_API_KEY to accept agents'
  );

  if (isArenaTestMode()) {
    console.warn('[auth] ARENA_TEST_MODE=1 (no chain): skipping the RPC full-access-key check at login. Local tests only.');
  }

  const { server } = createAppServer(CORS_ORIGIN);

  server.listen(PORT, () => {
    console.log(`Poker server listening on http://localhost:${PORT}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
