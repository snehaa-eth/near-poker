# Texas Hold'em on Midnight

Human **No-Limit Texas Hold'em** — poker runs **off-chain** for speed. **NIGHT buy-in / claim** runs **on-chain** via Compact pool vaults. Players connect with a **Midnight wallet** (DApp Connector API).

## Architecture

```
Midnight wallet → deposit(entry NIGHT) → pool vault
                       ↓
              chips = night × 1.5 (off-chain)
                       ↓
              play No-Limit Hold'em (server)
                       ↓
              house settle → claim NIGHT on-chain
```

## Monorepo

| Path | Role |
|------|------|
| `apps/www` | Next.js frontend + Midnight wallet |
| `apps/server` | Realtime game server (Express + Socket.IO) |
| `packages/poker-pool` | Compact **NLITreasury** — NIGHT `deposit` / `withdraw` (5% fee retained) |
| `packages/poker-engine` | Pure deterministic NLHE engine + Vitest |
| `packages/game-engine` | Legacy simplified engine (current UI wiring) |
| `packages/db` | Prisma + PostgreSQL models |
| `packages/shared` | Shared types/constants |
| `packages/config` | ESLint / TS / Prettier |

## Quick start

```bash
pnpm install

# Compile pool contract (TS + circuits; add full ZK with `compact` without --skip-zk)
pnpm --filter @nli/poker-pool compact:fast

pnpm --filter server dev
pnpm --filter www dev
```

Install a Midnight wallet (1AM or Lace), network = `NEXT_PUBLIC_MIDNIGHT_NETWORK` (default `preprod`).

## Pool markets

Deploy one Compact contract per market (entry + chip rate sealed at deploy). Example: **100 NIGHT → 150 chips** (×1.5). See `packages/poker-pool/README.md`.

## Skills used

- `react-wallet-connector` — wallet connect
- `compact` + `example-payment-dapp` / `example-locker-dapp` — unshielded vault patterns
- `token-transfers` — NIGHT Stars units

## Security notes

- Never trust client game state or actions
- House `settle` is trusted for MVP (off-chain results)
- Never expose house secret key to the browser
