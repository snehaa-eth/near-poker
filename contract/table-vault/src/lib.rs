//! # Dark Table — `table-vault` contract
//!
//! Holds players' NEAR for the poker tables and makes every hand auditable:
//!
//! 1. `commit_hand`  — the operator (game server) commits `seed_hash = sha256(server_seed)`
//!    BEFORE any player entropy is collected; players are locked "in hand".
//! 2. `reveal_hand`  — after the hand the operator reveals `server_seed` and the per-seat
//!    entropy. The contract checks the hash and stores
//!    `deck_seed = sha256(server_seed ‖ entropy[0] ‖ entropy[1] ‖ …)` (raw bytes).
//! 3. `settle_hand`  — zero-sum balance deltas, each loss capped by
//!    `min(balance, max_loss_per_hand)`; players are released.
//!
//! See `INTERFACES.md` §1 and §2 at the repo root. All amounts are yoctoNEAR.
//! Every state change emits a NEP-297 event (`standard: "dark_table"`, `version: "1.0.0"`).
//!
//! ## Withdraw
//! The balance is deducted first, then a NEAR transfer promise is created with a
//! `on_withdraw` callback. If the transfer fails (e.g. receiver account deleted), the
//! callback restores the balance and emits `withdraw_failed`.

use near_sdk::json_types::{I128, U128};
use near_sdk::serde_json::{self, json};
use near_sdk::store::LookupMap;
use near_sdk::{
    env, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise,
    PromiseResult,
};

pub const MIN_PLAYERS: usize = 2;
pub const MAX_PLAYERS: usize = 9;
/// hex chars of a 32-byte value (server seed / seed hash)
const HEX32: usize = 64;
/// hex chars of a 16-byte player entropy
const HEX16: usize = 32;
const CALLBACK_GAS: Gas = Gas::from_tgas(10);

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct Hand {
    pub seed_hash: String,
    /// seat order (ascending seat number), same order as `entropy`
    pub players: Vec<AccountId>,
    pub revealed: bool,
    pub server_seed: Option<String>,
    pub entropy: Option<Vec<String>>,
    pub deck_seed: Option<String>,
    pub settled: bool,
    pub cancelled: bool,
    pub deltas: Option<Vec<(AccountId, I128)>>,
}

/// Returned by `get_hand`. Optional fields are omitted from JSON when absent.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct HandView {
    pub hand_id: String,
    pub seed_hash: String,
    pub players: Vec<AccountId>,
    pub revealed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_seed: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entropy: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deck_seed: Option<String>,
    pub settled: bool,
    /// extra (not in INTERFACES.md): true after `cancel_hand`
    pub cancelled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deltas: Option<Vec<(AccountId, I128)>>,
}

/// Returned by `get_config`.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct Config {
    pub owner: AccountId,
    pub operator: AccountId,
    pub max_loss_per_hand: U128,
}

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Balances,
    Hands,
    InHand,
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct TableVault {
    owner: AccountId,
    operator: AccountId,
    max_loss_per_hand: u128,
    balances: LookupMap<AccountId, u128>,
    hands: LookupMap<String, Hand>,
    /// number of committed-but-unsettled (and not cancelled) hands each account is in
    in_hand: LookupMap<AccountId, u32>,
}

#[near]
impl TableVault {
    #[init]
    pub fn new(owner: AccountId, operator: AccountId, max_loss_per_hand: U128) -> Self {
        Self {
            owner,
            operator,
            max_loss_per_hand: max_loss_per_hand.0,
            balances: LookupMap::new(StorageKey::Balances),
            hands: LookupMap::new(StorageKey::Hands),
            in_hand: LookupMap::new(StorageKey::InHand),
        }
    }

    // ------------------------------------------------------------ players

    /// Credit the caller with the attached deposit.
    #[payable]
    pub fn deposit(&mut self) -> U128 {
        let amount = env::attached_deposit().as_yoctonear();
        require!(amount > 0, "Attach a deposit");
        let who = env::predecessor_account_id();
        let bal = self.balance(&who).checked_add(amount).expect("Overflow");
        self.balances.insert(who.clone(), bal);
        emit(
            "deposit",
            json!({ "account_id": who, "amount": U128(amount), "balance": U128(bal) }),
        );
        U128(bal)
    }

    /// Withdraw `amount` yoctoNEAR. Refused while the caller is in an unsettled hand.
    pub fn withdraw(&mut self, amount: U128) -> Promise {
        let who = env::predecessor_account_id();
        let amount = amount.0;
        require!(amount > 0, "Amount must be > 0");
        require!(!self.in_hand_of(&who), "Account is in an unsettled hand");
        let bal = self.balance(&who);
        require!(amount <= bal, "Insufficient balance");
        self.set_balance(&who, bal - amount);
        emit(
            "withdraw",
            json!({ "account_id": who, "amount": U128(amount), "balance": U128(bal - amount) }),
        );
        Promise::new(who.clone())
            .transfer(NearToken::from_yoctonear(amount))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(CALLBACK_GAS)
                    .on_withdraw(who, U128(amount)),
            )
    }

    /// Callback after the withdraw transfer: restore the balance if the transfer failed.
    #[private]
    pub fn on_withdraw(&mut self, account_id: AccountId, amount: U128) -> bool {
        let ok = matches!(env::promise_result(0), PromiseResult::Successful(_));
        if !ok {
            let bal = self.balance(&account_id).checked_add(amount.0).expect("Overflow");
            self.set_balance(&account_id, bal);
            emit(
                "withdraw_failed",
                json!({ "account_id": account_id, "amount": amount, "balance": U128(bal) }),
            );
        }
        ok
    }

    // ----------------------------------------------------------- operator

    pub fn commit_hand(&mut self, hand_id: String, seed_hash: String, players: Vec<AccountId>) {
        self.assert_operator();
        require!(!hand_id.is_empty(), "Empty hand_id");
        require!(!self.hands.contains_key(&hand_id), "hand_id already used");
        let seed_hash = normalize_hex(&seed_hash, HEX32, "seed_hash");
        require!(
            (MIN_PLAYERS..=MAX_PLAYERS).contains(&players.len()),
            "A hand needs 2..=9 players"
        );
        for (i, p) in players.iter().enumerate() {
            require!(!players[..i].contains(p), "Duplicate player");
            require!(self.balance(p) > 0, format!("Player {p} has no balance"));
        }
        for p in &players {
            let n = self.in_hand.get(p).copied().unwrap_or(0);
            self.in_hand.insert(p.clone(), n + 1);
        }
        emit(
            "hand_committed",
            json!({ "hand_id": hand_id, "seed_hash": seed_hash, "players": players }),
        );
        self.hands.insert(
            hand_id,
            Hand {
                seed_hash,
                players,
                revealed: false,
                server_seed: None,
                entropy: None,
                deck_seed: None,
                settled: false,
                cancelled: false,
                deltas: None,
            },
        );
    }

    pub fn reveal_hand(&mut self, hand_id: String, server_seed: String, entropy: Vec<String>) {
        self.assert_operator();
        let hand = self.hands.get_mut(&hand_id).expect("Unknown hand");
        require!(!hand.cancelled, "Hand cancelled");
        require!(!hand.revealed, "Hand already revealed");
        require!(
            entropy.len() == hand.players.len(),
            "entropy length must equal players length"
        );
        let server_seed = normalize_hex(&server_seed, HEX32, "server_seed");
        let entropy: Vec<String> = entropy
            .iter()
            .map(|e| normalize_hex(e, HEX16, "entropy"))
            .collect();
        let seed_bytes = hex_decode(&server_seed);
        require!(
            hex_encode(&env::sha256(&seed_bytes)) == hand.seed_hash,
            "sha256(server_seed) does not match seed_hash"
        );
        let deck_seed = hex_encode(&compute_deck_seed(&server_seed, &entropy));
        emit(
            "hand_revealed",
            json!({ "hand_id": hand_id, "server_seed": server_seed, "entropy": entropy, "deck_seed": deck_seed }),
        );
        hand.revealed = true;
        hand.server_seed = Some(server_seed);
        hand.entropy = Some(entropy);
        hand.deck_seed = Some(deck_seed);
    }

    pub fn settle_hand(&mut self, hand_id: String, deltas: Vec<(AccountId, I128)>) {
        self.assert_operator();
        let hand = self.hands.get(&hand_id).expect("Unknown hand").clone();
        require!(!hand.cancelled, "Hand cancelled");
        require!(!hand.settled, "Hand already settled");
        require!(hand.revealed, "Hand not revealed");

        let mut sum: i128 = 0;
        for (i, (acc, d)) in deltas.iter().enumerate() {
            require!(hand.players.contains(acc), format!("{acc} is not in this hand"));
            require!(
                !deltas[..i].iter().any(|(a, _)| a == acc),
                "Duplicate account in deltas"
            );
            sum = sum.checked_add(d.0).expect("Overflow");
        }
        require!(sum == 0, "Deltas must sum to zero");

        let cap = self.max_loss_per_hand;
        for (acc, d) in &deltas {
            let bal = self.balance(acc);
            let new_bal = if d.0 < 0 {
                let loss = d.0.unsigned_abs();
                require!(loss <= bal.min(cap), format!("Loss for {acc} exceeds min(balance, max_loss_per_hand)"));
                bal - loss
            } else {
                bal.checked_add(d.0 as u128).expect("Overflow")
            };
            self.set_balance(acc, new_bal);
        }
        self.release_players(&hand.players);
        emit("hand_settled", json!({ "hand_id": hand_id, "deltas": deltas }));
        let h = self.hands.get_mut(&hand_id).unwrap();
        h.settled = true;
        h.deltas = Some(deltas);
    }

    pub fn cancel_hand(&mut self, hand_id: String) {
        self.assert_operator();
        let hand = self.hands.get(&hand_id).expect("Unknown hand").clone();
        require!(!hand.settled, "Hand already settled");
        require!(!hand.cancelled, "Hand already cancelled");
        self.release_players(&hand.players);
        self.hands.get_mut(&hand_id).unwrap().cancelled = true;
        emit("hand_cancelled", json!({ "hand_id": hand_id }));
    }

    // -------------------------------------------------------------- owner

    pub fn set_operator(&mut self, operator: AccountId) {
        self.assert_owner();
        emit(
            "operator_changed",
            json!({ "old_operator": self.operator, "new_operator": operator }),
        );
        self.operator = operator;
    }

    pub fn set_max_loss(&mut self, max_loss_per_hand: U128) {
        self.assert_owner();
        self.max_loss_per_hand = max_loss_per_hand.0;
        emit("max_loss_changed", json!({ "max_loss_per_hand": max_loss_per_hand }));
    }

    // -------------------------------------------------------------- views

    pub fn balance_of(&self, account_id: AccountId) -> U128 {
        U128(self.balance(&account_id))
    }

    pub fn get_hand(&self, hand_id: String) -> Option<HandView> {
        self.hands.get(&hand_id).map(|h| HandView {
            hand_id: hand_id.clone(),
            seed_hash: h.seed_hash.clone(),
            players: h.players.clone(),
            revealed: h.revealed,
            server_seed: h.server_seed.clone(),
            entropy: h.entropy.clone(),
            deck_seed: h.deck_seed.clone(),
            settled: h.settled,
            cancelled: h.cancelled,
            deltas: h.deltas.clone(),
        })
    }

    pub fn get_config(&self) -> Config {
        Config {
            owner: self.owner.clone(),
            operator: self.operator.clone(),
            max_loss_per_hand: U128(self.max_loss_per_hand),
        }
    }

    /// extra view (not in INTERFACES.md): is the account in a committed-but-unsettled hand?
    pub fn is_in_hand(&self, account_id: AccountId) -> bool {
        self.in_hand_of(&account_id)
    }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

impl TableVault {
    fn in_hand_of(&self, who: &AccountId) -> bool {
        self.in_hand.get(who).copied().unwrap_or(0) > 0
    }

    fn balance(&self, who: &AccountId) -> u128 {
        self.balances.get(who).copied().unwrap_or(0)
    }

    fn set_balance(&mut self, who: &AccountId, v: u128) {
        if v == 0 {
            self.balances.remove(who);
        } else {
            self.balances.insert(who.clone(), v);
        }
    }

    fn release_players(&mut self, players: &[AccountId]) {
        for p in players {
            match self.in_hand.get(p).copied().unwrap_or(0) {
                0 | 1 => {
                    self.in_hand.remove(p);
                }
                n => {
                    self.in_hand.insert(p.clone(), n - 1);
                }
            }
        }
    }

    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "Only owner");
    }

    fn assert_operator(&self) {
        require!(env::predecessor_account_id() == self.operator, "Only operator");
    }
}

/// `sha256(server_seed ‖ entropy[0] ‖ entropy[1] ‖ …)` over hex-decoded raw bytes
/// (INTERFACES.md §1 step 4). Inputs must already be validated lowercase hex.
pub fn compute_deck_seed(server_seed_hex: &str, entropy_hex: &[String]) -> Vec<u8> {
    let mut buf = hex_decode(server_seed_hex);
    for e in entropy_hex {
        buf.extend(hex_decode(e));
    }
    env::sha256(&buf)
}

/// Check `s` is exactly `len` hex chars; return it lowercased.
fn normalize_hex(s: &str, len: usize, what: &str) -> String {
    require!(
        s.len() == len && s.bytes().all(|b| b.is_ascii_hexdigit()),
        format!("{what} must be {len} hex chars")
    );
    s.to_ascii_lowercase()
}

fn hex_val(b: u8) -> u8 {
    match b {
        b'0'..=b'9' => b - b'0',
        b'a'..=b'f' => b - b'a' + 10,
        b'A'..=b'F' => b - b'A' + 10,
        _ => env::panic_str("invalid hex"),
    }
}

pub fn hex_decode(s: &str) -> Vec<u8> {
    let b = s.as_bytes();
    require!(b.len() % 2 == 0, "odd hex length");
    b.chunks(2).map(|c| (hex_val(c[0]) << 4) | hex_val(c[1])).collect()
}

pub fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push(HEX[(b >> 4) as usize] as char);
        s.push(HEX[(b & 0xf) as usize] as char);
    }
    s
}

/// Log a NEP-297 event: `EVENT_JSON:{"standard":"dark_table","version":"1.0.0","event":..,"data":[..]}`
fn emit(event: &str, data: serde_json::Value) {
    let ev = json!({
        "standard": "dark_table",
        "version": "1.0.0",
        "event": event,
        "data": [data],
    });
    env::log_str(&format!("EVENT_JSON:{ev}"));
}

#[cfg(test)]
mod tests;
