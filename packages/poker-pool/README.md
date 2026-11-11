# NLITreasury (Midnight / NIGHT)

On-chain **NIGHT** custody for poker — same role as the Orbio `NLITreasury` CREDIT contract.

| Layer | Responsibility |
|-------|----------------|
| Compact treasury | `deposit` / `withdraw` unshielded NIGHT only |
| Backend + MongoDB (`night-poker`) | chips, bets, pots, wins/losses |

No on-chain poker actions.

## Flow

```
Wallet ──deposit(amount)──► Treasury (NIGHT Stars)
                                 │
                          Backend credits chips (×1.5)
                                 │
                          Off-chain poker
                                 │
Backend validates balance ──withdraw(user, amount)──► User gets 95%
                                                      5% stays in treasury
```

## Circuits

| Circuit | Who | What |
|---------|-----|------|
| `deposit(player, amount)` | Player | `receiveUnshielded` any positive NIGHT amount |
| `withdraw(user, amount, fee)` | Operator | Send net (95%); retain 5% fee in vault |
| `setOperator(newOperator)` | Owner | Rotate backend operator key |
| `transferOwnership(newOwnerSecret)` | Owner | Rotate owner |

`quoteWithdraw(amount)` is off-chain TS (`feeAmount` / `netAmount`).

## Units

- On-chain: **Stars** (`1 NIGHT = 1_000_000 Stars`)
- Off-chain chips: **1 NIGHT → 1.5 chips** (`CHIP_RATE_NUM/DEN = 3/2`) → 100 NIGHT deposit → 150 chips

## Compile

```bash
pnpm --filter @nli/poker-pool compact:fast   # TS + zkir, skip proving keys
pnpm --filter @nli/poker-pool compact        # full ZK keys before deploy
```

Output: `src/managed/treasury/`

## Midnight vs Solidity note

No ERC-20 `approve`. Deposit pulls unshielded NIGHT inside the circuit. No Solidity-style events — backend polls indexer / ledger state after txs.
