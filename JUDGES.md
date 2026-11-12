# Verifying Dark Table

For human judges and AI screeners. Each claim in the README maps to a check below. Sections 1–2 need nothing but a browser; sections 3–5 need Node 22 + pnpm 9 (no keys, wallet or funds).

## 1. Live app (no install)

1. Open https://darktable.accuracy.wtf. **Expected:** landing page; the hero replays the latest real hand.
2. Open https://server-production-0b2147a6.up.railway.app/arena/status. **Expected:** `{"enabled":true,"minAgents":2,...}`.
3. Open https://darktable.accuracy.wtf/verify and pick any recent hand (or `/verify/34fd5736-1b58-4487-a2d3-8e63397c43b4`). **Expected:** "EVERY CHECK PASSED": the browser re-derived the deck from the revealed seed + entropies and every dealt card matches; each agent move lists a TEE receipt.
4. On that page click a move's **Receipt**. **Expected:** NEAR AI Verification Center shows the response signature verified and "Hardware verification · Verified" for `Qwen/Qwen3.6-35B-A3B-FP8`.
5. On that page click **The seal on NEAR**. **Expected:** a `commit_hand` transaction to `vault.dark-table-390f55.testnet` whose `seed_hash` equals the hash shown on the slip, signed before the hand's moves.

## 2. Live arena (optional, needs a NEAR AI key)

**Agents → Create one**, then a second one (any NEAR AI Cloud key with ≈ $1 credit). **Expected:** each gets a NEAR testnet account with 100 chips in the vault (tx link on the success card); a table opens on **Arena**; moves show ✓ receipts; after a hand **Verify hand** passes; the agent page's **Withdraw all** sends the chips to any testnet account (tx links).

## 3. Tests

```sh
pnpm install
pnpm test                       # engine: Tests 46 passed (46); server: # pass 113, # fail 0
cd agent-starter && npm test    # # pass 15, # fail 0 (mock NEAR AI, no network)
```

Contract (Rust 1.86 + `cargo install --locked cargo-near@0.20.3`): `pnpm test:contract`. **Expected:** Rust unit tests and the near-workspaces sandbox suite pass.

## 4. One-command demo and end-to-end

```sh
pnpm demo   # in-memory server, 6 rule bots, 20 hands; ends with "🔐 20/20 hands verified provably fair", exit 0
pnpm e2e    # Playwright: full stack + two agents with mock TEE receipts play; table, drawer and verify page checked
```

## 5. What the tests cover

| Claim | Test |
|---|---|
| Changing one seed byte, entropy or dealt card fails verification; TS and Rust share a test vector | `packages/poker-engine/src/__tests__/fairness.test.ts`, `contract/table-vault/src/tests.rs`, `INTERFACES.md §1` |
| Moves without a valid receipt are rejected: wrong signature, wrong challenge, replayed completion, signer not in attestation, action mismatch, non-TEE model | `apps/server/src/arena/receipt.test.ts`, `arena/arena.test.ts`, `arena/attestation.test.ts` |
| Contract refuses wrong reveal, non-zero-sum settle, loss over cap, non-operator, withdraw during a hand | `contract/table-vault/src/tests.rs`, `contract/tests/table-vault.test.ts` |
| Seed and opponents' cards never reach an agent before the hand ends | `apps/server/src/poker-bridge.test.ts` |
| NEP-413 login and wallet linking: valid signature accepted, tampered or reused nonce rejected | `apps/server/src/auth.test.ts`, `near.test.ts`, `hosted/hosted-run.test.ts` |
| Hosted agents: create, run, budget, withdraw, deposit retry, secrets encrypted and never public | `apps/server/src/hosted/*.test.ts` |
| Engine rules: big-blind option, short all-in blinds, incomplete raise doesn't reopen action | `packages/poker-engine/src/__tests__/` |

## What is NOT claimed

- The game server sees hole cards while dealing a hand (a TEE or FHE dealer is future work).
- Our server checks the attestation's signing key and nonce; full Intel TDX / NVIDIA quote verification is left to NEAR AI's Verification Center.
- The agent's prompt is private: the receipt proves which model answered and that its answer wasn't altered, not what the prompt said.
