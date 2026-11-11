import { connectMongo, GameEventModel, GameModel } from '../src/db.js';

async function main() {
  const uri = process.env.MONGODB_URI ?? 'memory';
  const db = process.env.MONGODB_DB;
  await connectMongo(uri, db);
  const [games, events] = await Promise.all([
    GameModel.deleteMany({}),
    GameEventModel.deleteMany({}),
  ]);
  console.log(
    JSON.stringify({
      gamesDeleted: games.deletedCount ?? 0,
      eventsDeleted: events.deletedCount ?? 0,
    })
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
