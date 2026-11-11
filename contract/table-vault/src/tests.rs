//! Unit tests. Run with `cargo test` in `contract/table-vault`.
//! These run the contract as plain Rust against a mocked blockchain (no sandbox).

use super::*;
use near_sdk::test_utils::{get_logs, VMContextBuilder};
use near_sdk::{testing_env, PromiseResult};
use sha2::{Digest, Sha256};

const MAX_LOSS: u128 = 1_000;

/// INTERFACES.md §1 test vector: serverSeed = bytes 0..31, entropies = [aa*16, bb*16].
const VECTOR_SEED_HASH: &str = "630dcd2966c4336691125448bbb25b4ff412a49c732db2c8abc1b8581bd710dd";
const VECTOR_DECK_SEED: &str = "a75212b041f3bad423cf5b163091aa974e48b4e10eba71968acfcb1234392924";

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}
fn vault() -> AccountId {
    acc("vault.test.near")
}
fn owner() -> AccountId {
    acc("owner.test.near")
}
fn op() -> AccountId {
    acc("operator.test.near")
}
fn alice() -> AccountId {
    acc("alice.test.near")
}
fn bob() -> AccountId {
    acc("bob.test.near")
}
fn carol() -> AccountId {
    acc("carol.test.near")
}

fn ctx(predecessor: AccountId, deposit: u128) {
    testing_env!(VMContextBuilder::new()
        .current_account_id(vault())
        .predecessor_account_id(predecessor)
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .account_balance(NearToken::from_near(100))
        .build());
}

fn vector_seed() -> String {
    hex_encode(&(0u8..32).collect::<Vec<_>>())
}
fn vector_entropy() -> Vec<String> {
    vec!["aa".repeat(16), "bb".repeat(16)]
}

/// Independent sha256 (sha2 crate, not env::sha256).
fn sha2_hex(bytes: &[u8]) -> String {
    hex_encode(&Sha256::digest(bytes))
}

/// Contract with alice and bob each holding 5_000 yocto.
fn setup() -> TableVault {
    ctx(owner(), 0);
    let mut v = TableVault::new(owner(), op(), U128(MAX_LOSS));
    for p in [alice(), bob()] {
        ctx(p, 5_000);
        v.deposit();
    }
    v
}

fn commit(v: &mut TableVault, id: &str) {
    ctx(op(), 0);
    v.commit_hand(id.into(), VECTOR_SEED_HASH.into(), vec![alice(), bob()]);
}

fn commit_reveal(v: &mut TableVault, id: &str) {
    commit(v, id);
    v.reveal_hand(id.into(), vector_seed(), vector_entropy());
}

fn d(a: AccountId, x: i128) -> (AccountId, I128) {
    (a, I128(x))
}

fn assert_event(name: &str) {
    let logs = get_logs();
    assert!(
        logs.iter().any(|l| l.starts_with("EVENT_JSON:")
            && l.contains(r#""standard":"dark_table""#)
            && l.contains(r#""version":"1.0.0""#)
            && l.contains(&format!(r#""event":"{name}""#))),
        "missing event {name} in {logs:?}"
    );
}

#[test]
fn deck_seed_test_vector() {
    let seed = vector_seed();
    assert_eq!(seed, "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f");
    let raw: Vec<u8> = (0u8..32).collect();
    // env::sha256 vs sha2 crate
    assert_eq!(hex_encode(&env::sha256(&raw)), sha2_hex(&raw));
    assert_eq!(sha2_hex(&raw), VECTOR_SEED_HASH);

    let mut concat = raw.clone();
    concat.extend([0xaau8; 16]);
    concat.extend([0xbbu8; 16]);
    let contract_path = hex_encode(&compute_deck_seed(&seed, &vector_entropy()));
    assert_eq!(contract_path, sha2_hex(&concat));
    assert_eq!(contract_path, VECTOR_DECK_SEED);
    println!("seedHash = {VECTOR_SEED_HASH}\ndeckSeed = {VECTOR_DECK_SEED}");
}

#[test]
fn happy_path() {
    let mut v = setup();
    assert_eq!(v.balance_of(alice()).0, 5_000);
    assert_event("deposit");

    commit(&mut v, "h1");
    assert_event("hand_committed");
    assert!(v.is_in_hand(alice()));
    let h = v.get_hand("h1".into()).unwrap();
    assert!(!h.revealed && !h.settled);
    assert_eq!(h.players, vec![alice(), bob()]);

    v.reveal_hand("h1".into(), vector_seed(), vector_entropy());
    assert_event("hand_revealed");
    let h = v.get_hand("h1".into()).unwrap();
    assert!(h.revealed);
    assert_eq!(h.deck_seed.as_deref(), Some(VECTOR_DECK_SEED));
    assert_eq!(h.entropy, Some(vector_entropy()));

    v.settle_hand("h1".into(), vec![d(alice(), 700), d(bob(), -700)]);
    assert_event("hand_settled");
    assert_eq!(v.balance_of(alice()).0, 5_700);
    assert_eq!(v.balance_of(bob()).0, 4_300);
    assert!(!v.is_in_hand(alice()) && !v.is_in_hand(bob()));
    let h = v.get_hand("h1".into()).unwrap();
    assert!(h.settled);
    assert_eq!(h.deltas.unwrap().len(), 2);

    // withdraw now allowed
    ctx(alice(), 0);
    v.withdraw(U128(5_700));
    assert_event("withdraw");
    assert_eq!(v.balance_of(alice()).0, 0);

    let cfg = v.get_config();
    assert_eq!(cfg.operator, op());
    assert_eq!(cfg.max_loss_per_hand.0, MAX_LOSS);
}

#[test]
fn hand_view_json_shape() {
    let mut v = setup();
    commit(&mut v, "h1");
    let j = serde_json::to_value(v.get_hand("h1".into()).unwrap()).unwrap();
    assert!(j.get("server_seed").is_none());
    v.reveal_hand("h1".into(), vector_seed(), vector_entropy());
    v.settle_hand("h1".into(), vec![d(alice(), -5), d(bob(), 5)]);
    let j = serde_json::to_value(v.get_hand("h1".into()).unwrap()).unwrap();
    assert_eq!(j["deltas"][0][1], "-5");
    assert_eq!(j["deck_seed"], VECTOR_DECK_SEED);
}

#[test]
#[should_panic(expected = "does not match seed_hash")]
fn reveal_wrong_seed_rejected() {
    let mut v = setup();
    commit(&mut v, "h1");
    v.reveal_hand("h1".into(), "ff".repeat(32), vector_entropy());
}

#[test]
#[should_panic(expected = "entropy must be 32 hex chars")]
fn reveal_bad_entropy_rejected() {
    let mut v = setup();
    commit(&mut v, "h1");
    v.reveal_hand("h1".into(), vector_seed(), vec!["aa".repeat(16), "zz".repeat(16)]);
}

#[test]
#[should_panic(expected = "entropy length must equal players length")]
fn reveal_wrong_entropy_count_rejected() {
    let mut v = setup();
    commit(&mut v, "h1");
    v.reveal_hand("h1".into(), vector_seed(), vec!["aa".repeat(16)]);
}

#[test]
#[should_panic(expected = "seed_hash must be 64 hex chars")]
fn commit_bad_seed_hash_rejected() {
    let mut v = setup();
    ctx(op(), 0);
    v.commit_hand("h1".into(), "abcd".into(), vec![alice(), bob()]);
}

#[test]
#[should_panic(expected = "hand_id already used")]
fn commit_duplicate_hand_id_rejected() {
    let mut v = setup();
    commit(&mut v, "h1");
    commit(&mut v, "h1");
}

#[test]
#[should_panic(expected = "has no balance")]
fn commit_player_without_balance_rejected() {
    let mut v = setup();
    ctx(op(), 0);
    v.commit_hand("h1".into(), VECTOR_SEED_HASH.into(), vec![alice(), carol()]);
}

#[test]
#[should_panic(expected = "2..=9 players")]
fn commit_one_player_rejected() {
    let mut v = setup();
    ctx(op(), 0);
    v.commit_hand("h1".into(), VECTOR_SEED_HASH.into(), vec![alice()]);
}

#[test]
#[should_panic(expected = "Deltas must sum to zero")]
fn settle_non_zero_sum_rejected() {
    let mut v = setup();
    commit_reveal(&mut v, "h1");
    v.settle_hand("h1".into(), vec![d(alice(), 100), d(bob(), -99)]);
}

#[test]
#[should_panic(expected = "Hand not revealed")]
fn settle_before_reveal_rejected() {
    let mut v = setup();
    commit(&mut v, "h1");
    v.settle_hand("h1".into(), vec![d(alice(), 100), d(bob(), -100)]);
}

#[test]
#[should_panic(expected = "exceeds min(balance, max_loss_per_hand)")]
fn loss_above_cap_rejected() {
    let mut v = setup();
    commit_reveal(&mut v, "h1");
    v.settle_hand("h1".into(), vec![d(alice(), 1_001), d(bob(), -1_001)]);
}

#[test]
#[should_panic(expected = "exceeds min(balance, max_loss_per_hand)")]
fn loss_above_balance_rejected() {
    let mut v = setup();
    ctx(owner(), 0);
    v.set_max_loss(U128(1_000_000));
    commit_reveal(&mut v, "h1");
    v.settle_hand("h1".into(), vec![d(alice(), 5_001), d(bob(), -5_001)]);
}

#[test]
#[should_panic(expected = "is not in this hand")]
fn settle_outsider_rejected() {
    let mut v = setup();
    commit_reveal(&mut v, "h1");
    v.settle_hand("h1".into(), vec![d(alice(), 100), d(carol(), -100)]);
}

#[test]
#[should_panic(expected = "Hand already settled")]
fn settle_twice_rejected() {
    let mut v = setup();
    commit_reveal(&mut v, "h1");
    v.settle_hand("h1".into(), vec![d(alice(), 1), d(bob(), -1)]);
    v.settle_hand("h1".into(), vec![d(alice(), 1), d(bob(), -1)]);
}

#[test]
#[should_panic(expected = "Only operator")]
fn non_operator_commit_rejected() {
    let mut v = setup();
    ctx(alice(), 0);
    v.commit_hand("h1".into(), VECTOR_SEED_HASH.into(), vec![alice(), bob()]);
}

#[test]
#[should_panic(expected = "Only operator")]
fn non_operator_reveal_rejected() {
    let mut v = setup();
    commit(&mut v, "h1");
    ctx(alice(), 0);
    v.reveal_hand("h1".into(), vector_seed(), vector_entropy());
}

#[test]
#[should_panic(expected = "Only operator")]
fn non_operator_settle_rejected() {
    let mut v = setup();
    commit_reveal(&mut v, "h1");
    ctx(alice(), 0);
    v.settle_hand("h1".into(), vec![d(alice(), 100), d(bob(), -100)]);
}

#[test]
#[should_panic(expected = "Only owner")]
fn non_owner_set_operator_rejected() {
    let mut v = setup();
    ctx(op(), 0);
    v.set_operator(alice());
}

#[test]
#[should_panic(expected = "Account is in an unsettled hand")]
fn withdraw_while_in_hand_rejected() {
    let mut v = setup();
    commit(&mut v, "h1");
    ctx(alice(), 0);
    v.withdraw(U128(1));
}

#[test]
#[should_panic(expected = "Insufficient balance")]
fn withdraw_over_balance_rejected() {
    let mut v = setup();
    ctx(alice(), 0);
    v.withdraw(U128(5_001));
}

#[test]
fn cancel_clears_in_hand() {
    let mut v = setup();
    commit(&mut v, "h1");
    assert!(v.is_in_hand(alice()));
    v.cancel_hand("h1".into());
    assert_event("hand_cancelled");
    assert!(!v.is_in_hand(alice()) && !v.is_in_hand(bob()));
    assert_eq!(v.balance_of(alice()).0, 5_000);
    assert!(v.get_hand("h1".into()).unwrap().cancelled);
    ctx(alice(), 0);
    v.withdraw(U128(5_000)); // allowed again
    assert_eq!(v.balance_of(alice()).0, 0);
}

#[test]
fn overlapping_hands_keep_player_locked() {
    let mut v = setup();
    commit(&mut v, "h1");
    commit(&mut v, "h2");
    v.cancel_hand("h1".into());
    assert!(v.is_in_hand(alice()));
    v.cancel_hand("h2".into());
    assert!(!v.is_in_hand(alice()));
}

#[test]
fn failed_withdraw_restores_balance() {
    let mut v = setup();
    ctx(alice(), 0);
    v.withdraw(U128(2_000));
    assert_eq!(v.balance_of(alice()).0, 3_000);
    // callback with a failed transfer
    testing_env!(
        VMContextBuilder::new()
            .current_account_id(vault())
            .predecessor_account_id(vault())
            .build(),
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        Default::default(),
        vec![PromiseResult::Failed],
    );
    assert!(!v.on_withdraw(alice(), U128(2_000)));
    assert_event("withdraw_failed");
    assert_eq!(v.balance_of(alice()).0, 5_000);
}

#[test]
fn owner_setters() {
    let mut v = setup();
    ctx(owner(), 0);
    v.set_operator(carol());
    v.set_max_loss(U128(42));
    assert_event("max_loss_changed");
    let c = v.get_config();
    assert_eq!(c.operator, carol());
    assert_eq!(c.max_loss_per_hand.0, 42);
}
