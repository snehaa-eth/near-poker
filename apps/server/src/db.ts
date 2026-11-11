import mongoose, { Schema } from 'mongoose';
import type { GameState } from 'game-engine';

const sessionSchema = new Schema(
  {
    sessionId: { type: String, required: true, unique: true, index: true },
    /** Midnight unshielded address — profile + chips keyed to this when set. */
    walletAddress: {
      type: String,
      required: false,
      sparse: true,
      unique: true,
      index: true,
    },
    nickname: { type: String, required: true },
    /** Public path under /png/… */
    avatar: { type: String, required: false },
    chips: { type: Number, default: 10000 },
  },
  { timestamps: { createdAt: true, updatedAt: true } }
);

export const SessionModel = mongoose.model('Session', sessionSchema);

/** Full game snapshot + denormalized lobby/status fields for querying. */
const gameSchema = new Schema(
  {
    gameId: { type: String, required: true, unique: true, index: true },
    name: { type: String, default: 'Table' },
    joinCode: {
      type: String,
      required: false,
      sparse: true,
      unique: true,
      index: true,
    },
    minChips: { type: Number, default: 0 },
    maxPlayers: { type: Number, default: 6 },
    status: {
      type: String,
      enum: ['waiting', 'shuffling', 'playing', 'ended'],
      required: true,
      index: true,
    },
    round: {
      type: String,
      enum: ['Ante', 'PreFlop', 'Flop', 'Turn', 'River', 'End'],
      required: true,
      index: true,
    },
    totalPlayers: { type: Number, required: true, default: 0 },
    pot: { type: Number, required: true, default: 0 },
    winnerId: { type: String, default: null },
    playerIds: { type: [String], default: [], index: true },
    playerNicknames: { type: [String], default: [] },
    /** Full authoritative game state (including deck — server only). */
    state: { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: true }
);

gameSchema.index({ status: 1, updatedAt: -1 });
gameSchema.index({ createdAt: -1 });

export type GameDoc = {
  gameId: string;
  name?: string;
  joinCode?: string | null;
  minChips?: number;
  maxPlayers?: number;
  status: string;
  round: string;
  totalPlayers: number;
  pot: number;
  winnerId: string | null;
  playerIds: string[];
  playerNicknames: string[];
  state: GameState;
  createdAt?: Date;
  updatedAt?: Date;
};

export const GameModel = mongoose.model<GameDoc>('Game', gameSchema);

/** Append-only status / action log for each lobby. */
const gameEventSchema = new Schema(
  {
    gameId: { type: String, required: true, index: true },
    type: { type: String, required: true, index: true },
    actorId: { type: String, default: null },
    status: { type: String, required: true },
    round: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

gameEventSchema.index({ gameId: 1, createdAt: -1 });

export const GameEventModel = mongoose.model('GameEvent', gameEventSchema);

/**
 * Per-player activity ledger (deposits, withdrawals, table play).
 * Profile history reads this collection with pagination — DB only.
 */
const playerActivitySchema = new Schema(
  {
    sessionId: { type: String, required: true, index: true },
    walletAddress: { type: String, required: false, index: true },
    category: {
      type: String,
      enum: ['deposit', 'withdraw', 'game'],
      required: true,
      index: true,
    },
    type: { type: String, required: true, index: true },
    gameId: { type: String, default: null, index: true },
    amountChips: { type: Number, default: null },
    amountNight: { type: Number, default: null },
    balanceAfter: { type: Number, default: null },
    summary: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

playerActivitySchema.index({ sessionId: 1, createdAt: -1 });
playerActivitySchema.index({ walletAddress: 1, createdAt: -1 });
playerActivitySchema.index({ category: 1, createdAt: -1 });

export type PlayerActivityDoc = {
  _id: mongoose.Types.ObjectId;
  sessionId: string;
  walletAddress?: string | null;
  category: 'deposit' | 'withdraw' | 'game';
  type: string;
  gameId?: string | null;
  amountChips?: number | null;
  amountNight?: number | null;
  balanceAfter?: number | null;
  summary: string;
  payload?: Record<string, unknown>;
  createdAt?: Date;
};

export const PlayerActivityModel = mongoose.model<PlayerActivityDoc>(
  'PlayerActivity',
  playerActivitySchema
);

export type RecordPlayerActivityInput = {
  sessionId: string;
  walletAddress?: string | null;
  category: 'deposit' | 'withdraw' | 'game';
  type: string;
  summary: string;
  gameId?: string | null;
  amountChips?: number | null;
  amountNight?: number | null;
  balanceAfter?: number | null;
  payload?: Record<string, unknown>;
};

export async function recordPlayerActivity(input: RecordPlayerActivityInput) {
  return PlayerActivityModel.create({
    sessionId: input.sessionId,
    walletAddress: input.walletAddress || undefined,
    category: input.category,
    type: input.type,
    summary: input.summary,
    gameId: input.gameId ?? null,
    amountChips: input.amountChips ?? null,
    amountNight: input.amountNight ?? null,
    balanceAfter: input.balanceAfter ?? null,
    payload: input.payload ?? {},
  });
}

function withDbName(uri: string, dbName?: string) {
  if (!dbName) return uri;
  try {
    const url = new URL(uri);
    url.pathname = `/${dbName}`;
    return url.toString();
  } catch {
    return uri;
  }
}

export async function connectMongo(uri: string, dbName?: string) {
  let connectionUri = uri;
  if (uri === 'memory' || uri === 'mongodb-memory') {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    const mongod = await MongoMemoryServer.create();
    connectionUri = mongod.getUri(dbName || 'poker');
    console.log('Using in-memory MongoDB');
  } else {
    connectionUri = withDbName(uri, dbName);
  }
  await mongoose.connect(connectionUri);
  console.log(`MongoDB connected${dbName ? ` (db: ${dbName})` : ''}`);
}
