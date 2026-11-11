/**
 * Sandbox integration tests for the table-vault contract.
 *
 * Prereq: `npm run build` (writes table-vault/target/near/table_vault.wasm)
 * Run:    `npm test`  (spins up a local near-sandbox node; no testnet needed)
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Worker, type NearAccount } from "near-workspaces";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const WASM = fileURLToPath(new URL("../table-vault/target/near/table_vault.wasm", import.meta.url));

const NEAR = (n: number) => BigInt(Math.round(n * 1e6)) * 10n ** 18n; // n NEAR -> yocto
const TGAS = 10n ** 12n;
const sha256Hex = (hex: string) => createHash("sha256").update(Buffer.from(hex, "hex")).digest("hex");

// INTERFACES.md §1 test vector
const SERVER_SEED = Buffer.from(Array.from({ length: 32 }, (_, i) => i)).toString("hex");
const ENTROPY = ["aa".repeat(16), "bb".repeat(16)];
const SEED_HASH = sha256Hex(SERVER_SEED);
const DECK_SEED = sha256Hex(SERVER_SEED + ENTROPY.join(""));

const events = (logs: string[]) =>
  logs.filter((l) => l.startsWith("EVENT_JSON:")).map((l) => JSON.parse(l.slice("EVENT_JSON:".length)));

describe.skipIf(!existsSync(WASM))("table-vault (sandbox)", { timeout: 120_000 }, () => {
  let worker: Worker;
  let root: NearAccount, owner: NearAccount, operator: NearAccount, vault: NearAccount;
  let alice: NearAccount, bob: NearAccount;

  const opCall = (method: string, args: object) =>
    operator.callRaw(vault, method, args, { gas: 100n * TGAS });

  beforeAll(async () => {
    worker = await Worker.init();
    root = worker.rootAccount;
    owner = await root.createSubAccount("owner", { initialBalance: NEAR(10) });
    operator = await root.createSubAccount("operator", { initialBalance: NEAR(10) });
    vault = await root.createSubAccount("vault", { initialBalance: NEAR(20) });
    alice = await root.createSubAccount("alice", { initialBalance: NEAR(20) });
    bob = await root.createSubAccount("bob", { initialBalance: NEAR(20) });

    await vault.deploy(WASM);
    await vault.call(vault, "new", {
      owner: owner.accountId,
      operator: operator.accountId,
      max_loss_per_hand: NEAR(2).toString(),
    });
  }, 300_000);

  afterAll(async () => {
    await worker?.tearDown().catch(() => {});
  });

  test("two players deposit", async () => {
    for (const p of [alice, bob]) {
      const res = await p.callRaw(vault, "deposit", {}, { attachedDeposit: NEAR(5) });
      expect(res.succeeded).toBe(true);
      const ev = events(res.logs);
      expect(ev[0]).toMatchObject({ standard: "dark_table", version: "1.0.0", event: "deposit" });
      expect(await vault.view("balance_of", { account_id: p.accountId })).toBe(NEAR(5).toString());
    }
    const cfg = await vault.view<any>("get_config");
    expect(cfg).toMatchObject({ owner: owner.accountId, operator: operator.accountId, max_loss_per_hand: NEAR(2).toString() });
  });

  test("commit -> reveal -> settle updates balances, then withdraw works", async () => {
    let res = await opCall("commit_hand", {
      hand_id: "h1",
      seed_hash: SEED_HASH,
      players: [alice.accountId, bob.accountId],
    });
    expect(res.succeeded).toBe(true);
    expect(events(res.logs)[0]).toMatchObject({ standard: "dark_table", event: "hand_committed" });

    // withdraw refused while in hand
    await expect(alice.call(vault, "withdraw", { amount: "1" }, { gas: 100n * TGAS })).rejects.toThrow(
      /unsettled hand/,
    );

    res = await opCall("reveal_hand", { hand_id: "h1", server_seed: SERVER_SEED, entropy: ENTROPY });
    expect(res.succeeded).toBe(true);
    const revealed = events(res.logs)[0];
    expect(revealed).toMatchObject({ standard: "dark_table", event: "hand_revealed" });
    expect(revealed.data[0].deck_seed).toBe(DECK_SEED);

    res = await opCall("settle_hand", {
      hand_id: "h1",
      deltas: [
        [alice.accountId, NEAR(1.5).toString()],
        [bob.accountId, (-NEAR(1.5)).toString()],
      ],
    });
    expect(res.succeeded).toBe(true);
    expect(events(res.logs)[0]).toMatchObject({ standard: "dark_table", event: "hand_settled" });

    expect(await vault.view("balance_of", { account_id: alice.accountId })).toBe(NEAR(6.5).toString());
    expect(await vault.view("balance_of", { account_id: bob.accountId })).toBe(NEAR(3.5).toString());

    const hand = await vault.view<any>("get_hand", { hand_id: "h1" });
    expect(hand).toMatchObject({
      hand_id: "h1",
      seed_hash: SEED_HASH,
      revealed: true,
      settled: true,
      server_seed: SERVER_SEED,
      entropy: ENTROPY,
      deck_seed: DECK_SEED,
    });

    const before = await alice.availableBalance();
    res = await alice.callRaw(vault, "withdraw", { amount: NEAR(6.5).toString() }, { gas: 100n * TGAS });
    expect(res.succeeded).toBe(true);
    expect(events(res.logs).some((e) => e.standard === "dark_table" && e.event === "withdraw")).toBe(true);
    expect(await vault.view("balance_of", { account_id: alice.accountId })).toBe("0");
    const gained = (await alice.availableBalance()) - before;
    expect(gained > NEAR(6.4) && gained <= NEAR(6.5)).toBe(true); // minus prepaid gas (refund may land later)
  });

  test("bad reveal is refused", async () => {
    await alice.call(vault, "deposit", {}, { attachedDeposit: NEAR(5) });
    await opCall("commit_hand", { hand_id: "h2", seed_hash: SEED_HASH, players: [alice.accountId, bob.accountId] });
    await expect(
      operator.call(vault, "reveal_hand", { hand_id: "h2", server_seed: "ff".repeat(32), entropy: ENTROPY }),
    ).rejects.toThrow(/does not match seed_hash/);
    expect((await vault.view<any>("get_hand", { hand_id: "h2" })).revealed).toBe(false);
  });

  test("non-zero-sum settle is refused", async () => {
    await opCall("reveal_hand", { hand_id: "h2", server_seed: SERVER_SEED, entropy: ENTROPY });
    await expect(
      operator.call(vault, "settle_hand", {
        hand_id: "h2",
        deltas: [
          [alice.accountId, "100"],
          [bob.accountId, "-99"],
        ],
      }),
    ).rejects.toThrow(/sum to zero/);
    expect((await vault.view<any>("get_hand", { hand_id: "h2" })).settled).toBe(false);
  });

  test("non-operator cannot commit; cancel releases players", async () => {
    await expect(
      alice.call(vault, "commit_hand", { hand_id: "h3", seed_hash: SEED_HASH, players: [alice.accountId, bob.accountId] }),
    ).rejects.toThrow(/Only operator/);
    const res = await opCall("cancel_hand", { hand_id: "h2" });
    expect(events(res.logs)[0]).toMatchObject({ standard: "dark_table", event: "hand_cancelled" });
    expect(await vault.view("is_in_hand", { account_id: bob.accountId })).toBe(false);
  });
});
