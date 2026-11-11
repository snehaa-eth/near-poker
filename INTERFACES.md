# Interfaces (source of truth for the NEAR port)

Everything here is shared between the poker engine (TS), the game server (TS), the
browser verify page (TS) and the `table-vault` contract (Rust). Change it here first.

## 1. Provably fair deck

Per hand:

1. Server draws `serverSeed` = 32 random bytes. `seedHash = sha256(serverSeed)` (hex, lowercase).
2. Server **commits** `seedHash` (on-chain `commit_hand`, or the in-memory ledger) BEFORE asking anyone for entropy.
3. Every seated player contributes `entropy` = 16 random bytes as 32 lowercase hex chars
   (bots generate it; browsers send it on socket `game:entropy`; a player who does not
   answer within `ENTROPY_TIMEOUT_MS` (default 3000) gets entropy `"00"*16` and that is recorded).
4. `deckSeed = sha256( serverSeed ‖ entropy[seat0] ‖ entropy[seat1] ‖ … )`
   — raw bytes (hex-decoded), players ordered by ascending seat number.
5. Deck = `shuffleFromSeed(deckSeed)`:
   - start from the engine's ordered deck (`createOrderedDeck()`, card id 0..51)
   - byte stream: `block_k = sha256(deckSeed ‖ u32be(k))`, k = 0,1,2…, concatenated
   - `nextU32()` reads 4 bytes big-endian from the stream
   - Fisher–Yates from `i = 51` down to `1`: `j = uniform(0..i)` via rejection sampling:
     `limit = floor(2^32 / (i+1)) * (i+1)`; draw `r = nextU32()` until `r < limit`; `j = r % (i+1)`; swap `deck[i], deck[j]`
6. After the hand completes the server **reveals** `serverSeed` + the entropy list.
   Anyone recomputes steps 4–5 and checks `sha256(serverSeed) == seedHash` and that the
   dealt cards (hole cards by seat, then community) match the engine's deal order from that deck.

Hash: `@noble/hashes/sha256` everywhere in TS (works in Node and browser). Rust: `env::sha256`.

Test vector (must match in TS and Rust):
- serverSeed = `000102…1f` (bytes 0..31), entropies = [`aa`*16, `bb`*16]
- seedHash = sha256(serverSeed); deckSeed = sha256(serverSeed ‖ aa*16 ‖ bb*16)
- seedHash = `630dcd2966c4336691125448bbb25b4ff412a49c732db2c8abc1b8581bd710dd`
- deckSeed = `a75212b041f3bad423cf5b163091aa974e48b4e10eba71968acfcb1234392924`
- shuffleFromSeed(deckSeed) card ids = `48,14,25,31,13,36,12,30,41,0,28,49,39,18,33,22,11,24,21,35,38,6,45,23,20,3,7,5,47,27,34,43,8,46,16,19,50,9,26,29,1,17,32,15,10,4,40,37,51,44,42,2`
- Implementers: put these values in a test in each language.

## 2. Contract `table-vault` (NEAR, Rust, near-sdk 5.14)

Units: yoctoNEAR (`U128` strings). Events: NEP-297, `standard: "dark_table"`, `version: "1.0.0"`.

| Method | Who | What |
|---|---|---|
| `new(owner: AccountId, operator: AccountId, max_loss_per_hand: U128)` | init | |
| `deposit()` payable | anyone | credit caller with attached deposit. event `deposit` |
| `withdraw(amount: U128)` | balance holder | refuse if caller is in any committed-but-unsettled hand; transfer NEAR. event `withdraw` |
| `commit_hand(hand_id: String, seed_hash: String, players: Vec<AccountId>)` | operator | hand_id unique; 2..=9 players, each must have balance > 0; marks players "in hand". event `hand_committed` |
| `reveal_hand(hand_id: String, server_seed: String, entropy: Vec<String>)` | operator | `entropy.len() == players.len()` (same order as commit = seat order); check `sha256(hex(server_seed)) == seed_hash`; store `deck_seed = sha256(server_seed ‖ entropy…)`. event `hand_revealed` |
| `settle_hand(hand_id: String, deltas: Vec<(AccountId, I128-as-String)>)` | operator | requires revealed; every account in deltas is in the hand; **sum(deltas) == 0**; each loss ≤ min(balance, max_loss_per_hand); apply; clear "in hand". event `hand_settled` |
| `cancel_hand(hand_id)` | operator | unsettled hand → clear "in hand", no balance change. event `hand_cancelled` |
| `set_operator(operator)`, `set_max_loss(U128)` | owner | |
| views: `balance_of(account_id) -> U128`, `get_hand(hand_id) -> Option<HandView>`, `get_config()` | | |

`HandView = { hand_id, seed_hash, players, revealed: bool, server_seed?, entropy?, deck_seed?, settled: bool, deltas? }`

## 3. Server ↔ ledger

`apps/server/src/ledger.ts` exports `interface HandLedger { commit(handId, seedHashHex, players: string[]): Promise<{tx?: string}>; reveal(handId, serverSeedHex, entropyHex: string[]): Promise<{tx?: string}>; settle(handId, deltas: Record<string, number>): Promise<{tx?: string}> }`
with `MemoryLedger` (default) and `NearLedger` (when `CHAIN=near`; env `NEAR_RPC_URL`, `VAULT_ID`, `OPERATOR_ID`, `OPERATOR_PRIVATE_KEY`).
Player ids passed to the NEAR ledger are NEAR account ids (session `walletAddress`); chips ↔ yocto conversion: `1 chip = 10^21 yocto` (0.001 NEAR).

## 4. Public view additions (`NlhePublicView`, `apps/www/src/lib/api.ts` `PublicGameView`)

```ts
fairness?: {
  handId: string;
  seedHash: string;
  committedTx?: string;      // explorer tx when on-chain
  revealed?: { serverSeed: string; entropy: string[]; deckSeed: string; revealTx?: string };
};
players[i].bot?: { persona: string; model?: string; attested?: boolean; signingAddress?: string; lastLine?: string };
```

Routes: `GET /hands/:handId` → `{ handId, gameId, seedHash, serverSeed?, entropy?, seats: [{seat, playerId, nickname, holeCards}], community, txs }`;
browser page `/verify/[handId]` recomputes and shows ✅/❌.
