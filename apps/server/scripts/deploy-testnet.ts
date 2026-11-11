/**
 * Deploy Dark Table to NEAR testnet (idempotent: re-run to repair).
 *
 *   TESTNET_ROOT=<faucet-funded>.testnet npx tsx scripts/deploy-testnet.ts
 *
 * Creates (sub-accounts of the root):
 *   vault.<root>      table-vault contract (owner = root, operator = operator.<root>)
 *   operator.<root>   key used by the game server to commit / reveal / settle hands
 *   rock|maniac|shark|calley|fox|owl.<root>   the 6 AI bots, each depositing BOT_DEPOSIT NEAR into the vault
 *
 * Keys go to ~/.near-credentials/testnet/<account>.json (never into the repo).
 * Writes apps/server/.env.testnet with the env the server needs (no secrets except a path note).
 * Refuses anything that is not testnet.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  Account,
  JsonRpcProvider,
  KeyPair,
  actions,
  nearToYocto,
  teraToGas,
  yoctoToNear,
  type KeyPairString,
} from 'near-api-js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../..');
const RPC_URL = process.env.NEAR_RPC_URL ?? 'https://test.rpc.fastnear.com';
const CRED_DIR = join(homedir(), '.near-credentials', 'testnet');
const WASM = join(REPO, 'contract/table-vault/target/near/table_vault.wasm');
const ENV_OUT = join(HERE, '../.env.testnet');

export const BOTS = ['rock', 'maniac', 'shark', 'calley', 'fox', 'owl'] as const;
const FUND = { vault: '2.6', operator: '0.5', bot: '0.4' };
const BOT_DEPOSIT = '0.25'; // = 250 chips at 1 chip = 0.001 NEAR
const MAX_LOSS_PER_HAND = nearToYocto('0.25');

const log = (s = '') => console.log(s);
const explorerTx = (h: string) => `https://testnet.nearblocks.io/txns/${h}`;
const explorerAcc = (id: string) => `https://testnet.nearblocks.io/address/${id}`;
const txHash = (r: any): string => r?.transaction?.hash ?? r?.transaction_outcome?.id ?? '?';

function assertTestnetId(id: string) {
  if (!/^[a-z0-9._-]+\.testnet$/.test(id)) throw new Error(`"${id}" is not a .testnet account — refusing`);
}
function readCredential(id: string): KeyPairString | null {
  const f = join(CRED_DIR, `${id}.json`);
  if (!existsSync(f)) return null;
  const j = JSON.parse(readFileSync(f, 'utf8'));
  return (j.private_key ?? j.secret_key ?? null) as KeyPairString | null;
}
function writeCredential(id: string, pub: string, priv: string) {
  mkdirSync(CRED_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(join(CRED_DIR, `${id}.json`), JSON.stringify({ account_id: id, public_key: pub, private_key: priv }), { mode: 0o600 });
}

async function main() {
  const root = process.env.TESTNET_ROOT;
  if (!root) throw new Error('set TESTNET_ROOT=<your-account>.testnet');
  assertTestnetId(root);
  const p = new JsonRpcProvider({ url: RPC_URL });
  const status = await p.viewNodeStatus();
  if (status.chain_id !== 'testnet') throw new Error(`RPC serves ${status.chain_id}, not testnet — refusing`);
  const rootKey = readCredential(root);
  if (!rootKey) throw new Error(`no key for ${root} in ${CRED_DIR}`);
  const rootAcc = new Account(root, p, rootKey);
  if (!existsSync(WASM)) throw new Error(`missing ${WASM} — run \`cd contract && npm run build\``);

  const st = await rootAcc.getState();
  log(`Dark Table testnet deploy — root ${root} (${yoctoToNear(st.balance.available, 3)} NEAR available)`);

  const exists = async (id: string) => {
    try { await p.viewAccount({ accountId: id }); return true; } catch { return false; }
  };
  async function ensureAccount(id: string, near: string): Promise<Account> {
    if (await exists(id)) {
      const k = readCredential(id);
      if (!k) throw new Error(`${id} exists but its key is not in ${CRED_DIR}`);
      log(`  · ${id} exists`);
      return new Account(id, p, k);
    }
    const kp = KeyPair.fromRandom('ed25519');
    writeCredential(id, kp.getPublicKey().toString(), kp.toString()); // save before the tx lands
    const r = await rootAcc.createSubAccount({ accountOrPrefix: id, publicKey: kp.getPublicKey(), nearToTransfer: nearToYocto(near as `${number}`) });
    log(`  ✓ create ${id} (${near} NEAR)  ${explorerTx(txHash(r))}`);
    return new Account(id, p, kp.toString() as KeyPairString);
  }

  const ids = {
    vault: `vault.${root}`,
    operator: `operator.${root}`,
    bots: Object.fromEntries(BOTS.map((b) => [b, `${b}.${root}`])) as Record<(typeof BOTS)[number], string>,
  };

  log('\nAccounts');
  const vault = await ensureAccount(ids.vault, FUND.vault);
  await ensureAccount(ids.operator, FUND.operator);
  const bots: Record<string, Account> = {};
  for (const b of BOTS) bots[b] = await ensureAccount(ids.bots[b], FUND.bot);

  log('\nContract');
  const deployed = (await p.viewAccount({ accountId: ids.vault })).code_hash !== '11111111111111111111111111111111';
  if (deployed) {
    log(`  · ${ids.vault} already deployed`);
  } else {
    // deploy + init in one transaction so nobody can front-run `new`
    const r = await vault.signAndSendTransaction({
      receiverId: ids.vault,
      actions: [
        actions.deployContract(new Uint8Array(readFileSync(WASM))),
        actions.functionCall('new', { owner: root, operator: ids.operator, max_loss_per_hand: MAX_LOSS_PER_HAND.toString() }, teraToGas('50'), 0n),
      ],
    });
    log(`  ✓ deploy + new  ${explorerTx(txHash(r))}`);
  }
  const view = async <T>(method: string, args: Record<string, unknown> = {}) =>
    (await p.callFunction({ contractId: ids.vault, method, args })) as T;
  log(`  config: ${JSON.stringify(await view('get_config'))}`);

  log('\nBot bankrolls (each bot deposits into the vault)');
  for (const b of BOTS) {
    const id = ids.bots[b];
    const bal = BigInt(await view<string>('balance_of', { account_id: id }));
    if (bal > 0n) { log(`  · ${b.padEnd(7)} ${yoctoToNear(bal, 3)} NEAR in vault`); continue; }
    const r = await bots[b]!.signAndSendTransaction({
      receiverId: ids.vault,
      actions: [actions.functionCall('deposit', {}, teraToGas('30'), nearToYocto(BOT_DEPOSIT))],
    });
    log(`  ✓ ${b.padEnd(7)} deposited ${BOT_DEPOSIT} NEAR  ${explorerTx(txHash(r))}`);
  }

  const opKeyFile = join(CRED_DIR, `${ids.operator}.json`);
  writeFileSync(
    ENV_OUT,
    [
      '# generated by scripts/deploy-testnet.ts — no secrets in this file',
      'CHAIN=near',
      `NEAR_RPC_URL=${RPC_URL}`,
      `VAULT_ID=${ids.vault}`,
      `OPERATOR_ID=${ids.operator}`,
      `# OPERATOR_PRIVATE_KEY is read from ${opKeyFile}`,
      `OPERATOR_KEY_FILE=${opKeyFile}`,
      `BOT_ACCOUNT_SUFFIX=${root}`,
      `BOT_ACCOUNTS=${BOTS.map((b) => ids.bots[b]).join(',')}`,
      `NEXT_PUBLIC_VAULT_ID=${ids.vault}`,
      '',
    ].join('\n'),
  );
  log(`\nWrote ${ENV_OUT}`);
  log(`Vault: ${explorerAcc(ids.vault)}`);
}

main().catch((e) => {
  console.error('DEPLOY FAILED:', e?.message ?? e);
  process.exit(1);
});
