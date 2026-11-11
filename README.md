# Dark Table

**Private AI poker on NEAR.** Play No-Limit Hold'em against six AI players whose decisions come from a model running inside a TEE (NEAR AI Cloud), on a deck that nobody can rig: every shuffle is committed to a NEAR contract before the deal and revealed after it, and every pot is settled on-chain.

Built at NEAR HACKATHON (Nov 2026). Tracks: Games With Real Economies (`games`), Privacy & Private AI (`privacy`), AI Swarms (`swarms`).

> **Judges / AI screeners:** [JUDGES.md](JUDGES.md) has a short verification path with expected output. No keys, wallet or funds needed.

## The problem

Online poker asks you to trust the house twice: that the deck is really random, and that nobody (including the house) is peeking at your cards. AI opponents add a third question: is the "AI" really an independent model, or a script the operator steers? Before this port, this very codebase dealt **the same cards at every table** (the engine's RNG seed defaulted to `1`).

## What it does

| Guarantee | How | Where |
|---|---|---|
| **The deck isn't rigged** | Server commits `sha256(serverSeed)` on NEAR *before* asking players for entropy; every seated player (human or bot) adds 16 random bytes; deck = SHA-256 Fisher–Yates of `sha256(serverSeed ‖ entropies)`; seed revealed on-chain after the hand | [INTERFACES.md §1](INTERFACES.md), [packages/poker-engine/src/fairness.ts](packages/poker-engine/src/fairness.ts), `/verify/<handId>` page |
| **Nobody else sees your cards** | Each player (and each bot) only receives its own hole cards; the seed is never exposed before the hand ends (tested) | [apps/server/src/poker-bridge.ts](apps/server/src/poker-bridge.ts), [poker-bridge.test.ts](apps/server/src/poker-bridge.test.ts) |
| **AI players think inside a TEE** | Each bot move is a NEAR AI Cloud completion; the bot fetches a nonce-bound attestation report and verifies the per-response ed25519 signature locally; seats show "AI · attested" | [apps/server/src/brain/](apps/server/src/brain/) |
| **Money is on-chain and can't be skimmed** | `table-vault` contract holds deposits; the operator can only settle a committed, revealed hand, deltas must sum to zero, each loss is capped; players withdraw themselves | [contract/table-vault/src/lib.rs](contract/table-vault/src/lib.rs) |
| **Bots are NPCs with wallets** | Each bot is a NEAR sub-account with its own vault bankroll; winners grow, losers go broke | [apps/server/scripts/deploy-testnet.ts](apps/server/scripts/deploy-testnet.ts) |
| **You prove who you are** | Wallet login with a NEP-413 signed, server-issued one-time nonce, checked against a full-access key on-chain | [apps/server/src/near.ts](apps/server/src/near.ts) |

```
browser / bot ──entropy──▶ game server ──commit_hand(seedHash)──▶ table-vault (NEAR)
                            deals from sha256(seed ‖ entropy)
                            ──reveal_hand(seed, entropy)──▶ checks hash, stores deck_seed
                            ──settle_hand(zero-sum deltas)──▶ moves balances
bot ──move prompt (own cards only)──▶ NEAR AI Cloud (TEE) ──signed answer──▶ bot verifies
```

## Trust model (stated plainly)

- **Proven:** the deck was fixed before anyone added entropy and matches the revealed seed; on-chain balances only change through zero-sum settlements of committed hands; bot answers are signed by a key that appears in a fresh attestation report.
- **Not proven yet:** the game server sees hole cards *during* a hand (it deals them). A dealer that even the operator can't see (e.g. a TEE dealer on OutLayer) is the next step. "Attested" means the nonce-bound report and response signature check out; we don't verify the Intel TDX / GPU quotes locally (use [nearai-cloud-verifier](https://github.com/nearai/nearai-cloud-verifier)).

## Quick start

Requirements: Node 22+, pnpm 8 or 9.

```sh
pnpm install
pnpm test        # engine (23) + server (40) unit tests
pnpm demo        # local server + 6 bots play 20 hands, every hand verified; exit 0 = all fair
```

| Do this | See this |
|---|---|
| `pnpm demo` | per hand: `fair ✅ hand #N … entropy 6/6`; at the end `🔐 20/20 hands verified provably fair` |
| `HANDS=50 pnpm demo` | 50/50 verified; a different `first deckSeed` every run |
| `NEARAI_API_KEY=… pnpm demo` | bot moves marked 🧠✔ (TEE model, signature verified) with trash talk lines; falls back to 📏 rules on timeout |
| `pnpm test:contract` (Rust 1.86 + cargo-near 0.20.3) | 26 Rust unit tests + 5 near-workspaces sandbox tests |
| Web UI: `pnpm --filter server dev` and `pnpm --filter www dev`, open http://localhost:3000, then `cd apps/server && pnpm exec tsx scripts/bots-6.ts` | live table with 6 bots, "🔒 Deck committed" pill, "✅ Verify hand" link → `/verify/<handId>` recomputes the deck in your browser |
| Open http://localhost:3000/verify/demo | the INTERFACES test vector verified offline in the browser |

## Live on NEAR testnet

- Vault contract: [`vault.dark-table-390f55.testnet`](https://testnet.nearblocks.io/address/vault.dark-table-390f55.testnet) (owner `dark-table-390f55.testnet`, operator `operator.dark-table-390f55.testnet`)
- Bot wallets: `rock`, `maniac`, `shark`, `calley`, `fox`, `owl` `.dark-table-390f55.testnet`, each funded the vault with 0.25 NEAR
- Real hands played by the bots (each = commit → reveal → settle):

| Hand | commit | reveal | settle |
|---|---|---|---|
| dec5ccaf | [9zHdSPhT…](https://testnet.nearblocks.io/txns/9zHdSPhT6fDXDDUr6exviHxjpsriPsM8Aabm9yomxzTH) | [9Wvjika9…](https://testnet.nearblocks.io/txns/9Wvjika9iFueijHeJ4KgXMSdYhH96bHnMQcXXnB9bVL7) | [2bFW2ma6…](https://testnet.nearblocks.io/txns/2bFW2ma6edccMzq4SydETzZhA1rdySXbUUp6sEseM4ek) |
| 974bd995 | [HWhPm3n2…](https://testnet.nearblocks.io/txns/HWhPm3n2FUu6JJ9KRKKoMS2teH3VrPjq5sfCBPyvwRsW) | [Ea9M7MW6…](https://testnet.nearblocks.io/txns/Ea9M7MW6sFF979Xi1VUZhzFxPq3rdeakqibAd7k1kQ77) | [AUtCynCh…](https://testnet.nearblocks.io/txns/AUtCynChUD3Q8PqeHZycQJHo4ruTFMht7PM9xbdZUFbr) |
| 6ecb7718 | [FR7Pk9e3…](https://testnet.nearblocks.io/txns/FR7Pk9e3z4ZCoSA2A1PPVimtkCJ2KE1Pvzowq32dV3WT) | [25r3xemj…](https://testnet.nearblocks.io/txns/25r3xemjGjkdn1w7hQrST1soPnmkYi6y3nW5TCEJy2KK) | [EKFh4j31…](https://testnet.nearblocks.io/txns/EKFh4j31aXmtYgpigosQR1steo3VTLimx3msyTkDJ37n) |

After those three hands the bots' on-chain vault balances matched the game stacks exactly and still summed to 1500 chips (1 chip = 0.001 NEAR).

Reproduce on your own account: create a faucet account (`near account create-account sponsor-by-faucet-service <name>.testnet …`), build the contract (`cd contract && npm i && npm run build`), then `cd apps/server && TESTNET_ROOT=<name>.testnet pnpm deploy:testnet`. It writes `apps/server/.env.testnet`; start the server with those vars plus `OPERATOR_PRIVATE_KEY` (from `~/.near-credentials/testnet/operator.<root>.json`) and run the bots with `BOT_ACCOUNTS` from that file.

## How NEAR is used

- **Smart contract (near-sdk 5.14, Rust):** deposits, withdrawals, per-hand commit / reveal (sha256 check on-chain, deck seed stored) / zero-sum settle with loss caps, NEP-297 events (`standard: "dark_table"`).
- **Sub-accounts:** every AI bot is its own NEAR account with its own bankroll.
- **NEAR AI Cloud:** TEE inference for bot decisions, with attestation report + signed responses.
- **Wallet selector + NEP-413:** MyNearWallet / Meteor login; signed one-time nonce verified server-side against an on-chain full-access key.

## What existed before vs. what's new

This project is built on an earlier Midnight-chain poker by **Nikku (Neeraj Choubisa)**, used with permission. The git history starts with that code, tagged **`pre-hackathon`** (`git diff pre-hackathon` shows all hackathon work).

| Existing (Sep 2026, Midnight) | New during NEAR HACKATHON |
|---|---|
| NLHE engine, hand ranking, pots | SHA-256 commit–reveal deck (`fairness.ts`), big-blind-option fix, 23 tests |
| Express/Socket.IO server, lobby, UI table | entropy protocol, hand records, `/hands` API, NEAR ledger, NEP-413 login, vault-backed chips, bot sessions, spectator mode |
| Midnight Compact treasury (off-chain chips) | removed; replaced by `contract/table-vault` (Rust) + sandbox tests + testnet deploy |
| Midnight wallet | NEAR wallet selector, deposit/withdraw to vault, verify page, AI seat badges |
| — | 6 AI bots: rule personas + NEAR AI Cloud brains with attestation, `pnpm demo` |

## Limits

- The server sees hole cards during a hand (see trust model). Folded hands' cards are published after the hand for verification.
- A player who doesn't send entropy within 3 s gets zero bytes (recorded and visible on the verify page); the server seed is committed first, so this can't help the server choose the deck.
- Hands are settled after they finish, one transaction each for commit, reveal and settle (~3 testnet txs per hand). Withdrawals are blocked while a player is in an unsettled hand.
- Social login (email/Google) isn't wired yet; login is through a NEAR wallet.
- Testnet only. NEAR AI Cloud calls need `NEARAI_API_KEY`; without it bots use rule personas and the seat badge shows "not attested".

## Other project by the same builder

Per hackathon rule Q-015: the same builder also submitted **Intent Guard**, a payment firewall for AI agents on NEAR (https://github.com/snehaa-eth/near-intent-guard). The two projects share no code except a ported NEAR AI attestation check.

## Repository layout

```
contract/table-vault/   Rust contract + unit tests;  contract/tests/  sandbox tests
packages/poker-engine/  NLHE engine + provably-fair deck
apps/server/            game server, NEAR ledger, auth, bots (scripts/bots-6.ts), brain/ (NEAR AI)
apps/www/               Next.js UI: table, wallet, verify page
INTERFACES.md           shared spec: deck derivation, contract API, public view
```

## Built with

near-sdk 5.14, near-workspaces 5, near-api-js 7, @near-wallet-selector 10, @noble/hashes, NEAR AI Cloud, Next.js 14, Express, Socket.IO, MongoDB (in-memory for demos), vitest. Hackathon work was written with AI assistance (Claude Code).
