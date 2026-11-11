# table-vault (NEAR contract)

Holds players' NEAR for Dark Table and makes every hand auditable: the operator commits
`sha256(server_seed)` before entropy is collected, reveals the seed + per-seat entropy after the
hand (the contract checks the hash and stores `deck_seed`), then settles zero-sum deltas.
Spec: `../INTERFACES.md` §1 (deck seed) and §2 (API). Amounts are yoctoNEAR (`U128` strings).

## API

| Method | Who | Notes |
|---|---|---|
| `new(owner, operator, max_loss_per_hand: U128)` | init | |
| `deposit()` payable | anyone | credits caller; returns new balance |
| `withdraw(amount: U128)` | holder | refused while caller is in an unsettled hand. Balance is deducted, NEAR transferred; if the transfer fails, the `on_withdraw` callback restores the balance (`withdraw_failed` event) |
| `commit_hand(hand_id, seed_hash, players)` | operator | unique id, 64-hex `seed_hash`, 2..=9 distinct players each with balance > 0 |
| `reveal_hand(hand_id, server_seed, entropy)` | operator | 64-hex seed, one 32-hex entropy per player (seat order); checks `sha256(seed) == seed_hash`; stores `deck_seed = sha256(seed ‖ entropy…)` (raw bytes) |
| `settle_hand(hand_id, deltas: [[account, "i128"], …])` | operator | revealed, accounts in hand, no duplicates, sum == 0, each loss ≤ min(balance, max_loss_per_hand) |
| `cancel_hand(hand_id)` | operator | unsettled hand: releases players, no balance change |
| `set_operator(operator)`, `set_max_loss(max_loss_per_hand)` | owner | |
| `balance_of(account_id)`, `get_hand(hand_id)`, `get_config()`, `is_in_hand(account_id)` | view | |

Hex inputs are accepted in either case and stored lowercase. Events are NEP-297 logs
`EVENT_JSON:{"standard":"dark_table","version":"1.0.0","event":…,"data":[…]}`: `deposit`, `withdraw`,
`withdraw_failed`, `hand_committed`, `hand_revealed`, `hand_settled`, `hand_cancelled`,
`operator_changed`, `max_loss_changed`.

## Build & test

Toolchain is pinned by `rust-toolchain.toml` (Rust 1.86; cargo-near 0.20.3; near-sdk =5.14.0 so the
near-workspaces 5.0.0 sandbox accepts the wasm).

```bash
cd contract
npm install
cd table-vault && cargo test && cd ..   # unit tests (incl. INTERFACES §1 test vector)
npm run build                           # -> table-vault/target/near/table_vault.wasm
npm test                                # near-workspaces sandbox suite (~40s)
```

## Deploy (testnet)

```bash
near deploy <vault>.testnet table-vault/target/near/table_vault.wasm \
  --initFunction new --initArgs '{"owner":"<owner>.testnet","operator":"<server>.testnet","max_loss_per_hand":"1000000000000000000000000"}'
```
