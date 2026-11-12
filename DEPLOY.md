# Deploying Dark Table

| Part | Host | Cost |
|---|---|---|
| Game server (`apps/server`, Express + Socket.IO, always-on) | **Northflank** (Docker) | free tier |
| Website (`apps/www`, Next.js) | **Vercel** | free |
| Database | MongoDB Atlas | free |
| Money + proofs | NEAR testnet (`vault.dark-table-390f55.testnet`) | free |

Secrets go into each host's dashboard as environment variables — **never into git**.

---

## 1. MongoDB Atlas (one-time)
Atlas → your cluster → **Network Access** → **Add IP Address** → **Allow access from anywhere** (`0.0.0.0/0`).
Cloud servers don't have a fixed IP, so this is required. The database password protects it.

## 2. Game server on Northflank

1. Sign in at <https://northflank.com> with GitHub → **Create project** (any region close to you).
2. **Create new → Service → Deployment service** → *Build from a Git repo* → pick `snehaa-eth/near-poker`, branch `main`.
3. Build settings: **Dockerfile**, Dockerfile path `/Dockerfile.server`, build context `/`.
4. Networking: add port **4000**, protocol **HTTP**, **Publicly exposed** ✅. Northflank gives a URL like `https://p01--dark-table-server--xxxx.code.run` → this is your **SERVER_URL**.
5. Resources: the smallest free plan is fine. (Hosted agents each run a small process — keep `HOSTED_MAX_RUNNING` low, e.g. 3.)
6. **Environment variables** (Runtime variables → add as *secret* where marked 🔒):

| Name | Value |
|---|---|
| `PORT` | `4000` |
| `MONGODB_URI` 🔒 | your Atlas connection string |
| `MONGODB_DB` | `near_poker` |
| `CORS_ORIGIN` | `https://<your-vercel-app>.vercel.app` (add more, comma-separated, e.g. `http://localhost:3000`) |
| `CHAIN` | `near` |
| `NEAR_RPC_URL` | `https://test.rpc.fastnear.com` |
| `VAULT_ID` | `vault.dark-table-390f55.testnet` |
| `OPERATOR_ID` | `operator.dark-table-390f55.testnet` |
| `OPERATOR_PRIVATE_KEY` 🔒 | the `private_key` from `~/.near-credentials/testnet/operator.dark-table-390f55.testnet.json` |
| `NEARAI_API_KEY` 🔒 | your NEAR AI Cloud key (the server uses it only to fetch attestation reports — no paid completions) |
| `ADMIN_PASSWORD` 🔒 | pick a strong password (default `admin123` is NOT safe in public) |
| `PUBLIC_API_URL` | your SERVER_URL |
| `HOSTED_SECRET` 🔒 | 64 hex chars: run `openssl rand -hex 32` |
| `HOSTED_FUNDER_PRIVATE_KEY` 🔒 | `private_key` of `dark-table-390f55.testnet` (funds new hosted agents with test NEAR) |
| `HOSTED_FUNDER_ACCOUNT` | `dark-table-390f55.testnet` |
| `HOSTED_ROOT` | `dark-table-390f55.testnet` |
| `HOSTED_MAX_RUNNING` | `3` |

7. Deploy. Check `SERVER_URL/arena/status` → `{"enabled":true,...}`.

> To copy a key without showing it on screen-share: `python3 -c "import json;print(json.load(open('/Users/<you>/.near-credentials/testnet/operator.dark-table-390f55.testnet.json'))['private_key'])" | pbcopy` — then paste into Northflank.

## 3. Website on Vercel

1. Sign in at <https://vercel.com> with GitHub → **Add New → Project** → import `snehaa-eth/near-poker`.
2. **Root Directory:** `apps/www` (Vercel reads `apps/www/vercel.json` for install/build commands).
3. **Environment Variables:**

| Name | Value |
|---|---|
| `NEXT_PUBLIC_API_URL` | your SERVER_URL |
| `NEXT_PUBLIC_WS_URL` | your SERVER_URL |
| `NEXT_PUBLIC_NEAR_NETWORK` | `testnet` |
| `NEXT_PUBLIC_NEAR_RPC` | `https://test.rpc.fastnear.com` |
| `NEXT_PUBLIC_VAULT_ID` | `vault.dark-table-390f55.testnet` |

4. Deploy → you get `https://<name>.vercel.app`. Put that URL into Northflank's `CORS_ORIGIN` and redeploy the server.

## 4. Point agents at the public server
Agents use `GAME_SERVER=<SERVER_URL>` (see AGENTS.md). Update the README / X posts with the Vercel link.

## Notes
- Both hosts redeploy automatically on every push to `main`.
- The vault, operator and bot accounts already exist on testnet; nothing to redeploy on-chain.
- Rotate `NEARAI_API_KEY` and the MongoDB password after the hackathon (both were shared during development).
