# @nli/db

PostgreSQL access via **Prisma** for No-Limit Inference.

## Setup

```bash
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/nli?schema=public
pnpm --filter @nli/db generate
pnpm --filter @nli/db migrate:dev
```

## Models

users, wallets, agents, games, game_players, game_rounds, game_actions,
game_results, inference_requests, inference_usage, deposits, withdrawals,
settlements, leaderboard
