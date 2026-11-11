# Verifying Dark Table

For human judges and AI screeners. Every claim in the README maps to a command or test below. No API keys, wallet or funds are needed for sections 1–3.

## 1. Setup and tests

```sh
pnpm install
pnpm test
```

**Expected:** engine `Tests 23 passed (23)`; server `# pass 40`, `# fail 0`.

Contract (needs Rust via rustup — the repo pins 1.86 — and `cargo install --locked cargo-near@0.20.3`):

```sh
pnpm test:contract
```

**Expected:** `cargo test` → `26 passed`; sandbox suite → `5 passed`.

## 2. One-command demo

```sh
pnpm demo
```

Starts a throwaway server (in-memory DB, no blockchain), seats 6 bots, plays 20 hands. After every hand the bot script fetches `GET /hands/:id` and independently recomputes: `sha256(serverSeed) == seedHash`, the deck seed from the revealed entropy, the shuffle, and that each bot's privately received hole cards and the board match.

**Expected final lines:**

```
✅ 20 hands played by 6 bots. …
🔐 20/20 hands verified provably fair
```

Exit code 0 only if every hand verified. Run it twice: `first deckSeed` differs (the pre-hackathon code dealt the same deck every time).

## 3. Tamper checks (tests)

| Claim | Test |
|---|---|
| Changing one seed byte, one entropy, or one dealt card fails verification | `packages/poker-engine/src/__tests__/fairness.test.ts` |
| Seed/deck seed never appear in the public view before the hand ends | `apps/server/src/poker-bridge.test.ts` |
| Same TS and Rust test vector (seedHash `630dcd29…`, deckSeed `a75212b0…`) | `fairness.test.ts`, `contract/table-vault/src/tests.rs`, `INTERFACES.md §1` |
| Contract refuses wrong reveal, non-zero-sum settle, loss over cap, non-operator, withdraw during a hand | `contract/table-vault/src/tests.rs`, `contract/tests/table-vault.test.ts` |
| NEP-413 login: valid signature accepted, tampered/reused nonce rejected | `apps/server/src/auth.test.ts`, `near.test.ts` |
| Bot prompt contains only the bot's own cards; bad model output falls back to rules; response signature check fails when tampered | `apps/server/src/brain/*.test.ts` |
| Big blind can raise on its preflop option (fixed engine bug) | `packages/poker-engine/src/__tests__/engine.test.ts` |

## 4. Live on NEAR testnet (nothing to run)

Vault: [`vault.dark-table-390f55.testnet`](https://testnet.nearblocks.io/address/vault.dark-table-390f55.testnet). The README table lists real hands with their `commit_hand`, `reveal_hand` and `settle_hand` transactions; open a `reveal_hand` tx to see the `EVENT_JSON` log (`standard: "dark_table"`) with the revealed seed and on-chain deck seed. You can call the view `get_hand({"hand_id": "<id>"})` to read the stored seed, entropy and deltas.

## 5. Browser verify page

`pnpm --filter server dev` + `pnpm --filter www dev`, then open http://localhost:3000/verify/demo: the shared test vector is recomputed in your browser (all checks ✅). After running bots against the dev server, every finished hand links to `/verify/<handId>`.

## What is NOT claimed

- The game server sees hole cards during the hand (it deals them). Hiding cards from the operator too (TEE dealer) is future work.
- "Attested" = nonce-bound NEAR AI attestation report + verified response signature; Intel TDX / GPU quotes are not verified locally.
- AI bots need `NEARAI_API_KEY`; the demo uses rule personas without it.
