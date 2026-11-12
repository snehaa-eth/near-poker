/**
 * Agent wallets.
 *
 *  CHAIN=near: `<name>.<HOSTED_ROOT>` sub-account created and funded (HOSTED_FUND_NEAR) by the root
 *  account, whose key is read from HOSTED_FUNDER_KEY_FILE at call time (never logged, never
 *  cached), then the new account deposits HOSTED_DEPOSIT_NEAR into table-vault from itself.
 *  Same near-api-js 7 calls as scripts/deploy-testnet.ts.
 *
 *  Otherwise (local test path): a fresh ed25519 keypair and an off-chain session with chips; no
 *  network access at all.
 */
import { existsSync, readFileSync } from 'node:fs';

import { Account, JsonRpcProvider, KeyPair, actions, nearToYocto, teraToGas, type KeyPairString } from 'near-api-js';
import { v4 as uuidv4 } from 'uuid';

import { SessionModel } from '../db.js';
import type { HostedConfig } from './config.js';

export class WalletError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

export type NewWallet = { accountId: string; privateKey: string; txs: { createAccount?: string; deposit?: string }; depositError?: string };

const txHash = (r: unknown) => {
  const x = r as { transaction?: { hash?: string }; transaction_outcome?: { id?: string } };
  return x?.transaction?.hash ?? x?.transaction_outcome?.id ?? undefined;
};

/**
 * Funder key: HOSTED_FUNDER_PRIVATE_KEY ("ed25519:…", e.g. a container secret) wins over
 * HOSTED_FUNDER_KEY_FILE. Read at call time, never logged, never cached.
 */
export function readFunderKey(cfg: HostedConfig, env: NodeJS.ProcessEnv = process.env): KeyPairString {
  const fromEnv = env.HOSTED_FUNDER_PRIVATE_KEY?.trim();
  if (fromEnv) {
    if (!/^ed25519:[1-9A-HJ-NP-Za-km-z]{32,}$/.test(fromEnv)) throw new WalletError(503, 'HostedFunderMissing: HOSTED_FUNDER_PRIVATE_KEY must be "ed25519:<base58>"');
    return fromEnv as KeyPairString;
  }
  const f = cfg.funderKeyFile;
  if (!f || !existsSync(f)) throw new WalletError(503, 'HostedFunderMissing: funder key not configured');
  const j = JSON.parse(readFileSync(f, 'utf8')) as { account_id?: string; private_key?: string; secret_key?: string };
  if (j.account_id && j.account_id !== cfg.funder) throw new WalletError(503, 'HostedFunderMismatch: key file is for another account');
  const k = j.private_key ?? j.secret_key;
  if (!k) throw new WalletError(503, 'HostedFunderMissing: key file has no private key');
  return k as KeyPairString;
}

/** Hooks so tests can stub the chain (never used in production). */
export type ChainOps = {
  accountExists(id: string): Promise<boolean>;
  funderAvailableYocto(): Promise<bigint>;
  createSubAccount(id: string, publicKey: string, near: string): Promise<string | undefined>;
  deposit(id: string, key: KeyPairString, near: string): Promise<string | undefined>;
  /** Withdraw support (optional so older test stubs still type-check). */
  vaultBalanceYocto?(id: string): Promise<bigint>;
  vaultWithdraw?(id: string, key: KeyPairString, yocto: bigint): Promise<string | undefined>;
  availableYocto?(id: string): Promise<bigint>;
  transfer?(id: string, key: KeyPairString, to: string, yocto: bigint): Promise<string | undefined>;
};

export function nearChainOps(cfg: HostedConfig): ChainOps {
  const p = new JsonRpcProvider({ url: cfg.rpcUrl });
  return {
    async accountExists(id) {
      try {
        await p.viewAccount({ accountId: id });
        return true;
      } catch {
        return false;
      }
    },
    async funderAvailableYocto() {
      const funder = new Account(cfg.funder!, p, readFunderKey(cfg));
      return (await funder.getState()).balance.available;
    },
    async createSubAccount(id, publicKey, near) {
      const funder = new Account(cfg.funder!, p, readFunderKey(cfg));
      const r = await funder.createSubAccount({ accountOrPrefix: id, publicKey, nearToTransfer: nearToYocto(near as `${number}`) });
      return txHash(r);
    },
    async deposit(id, key, near) {
      const acc = new Account(id, p, key);
      const r = await acc.signAndSendTransaction({
        receiverId: cfg.vaultId!,
        actions: [actions.functionCall('deposit', {}, teraToGas('30'), nearToYocto(near as `${number}`))],
      });
      return txHash(r);
    },
    async vaultBalanceYocto(id) {
      const v = await p.callFunction({ contractId: cfg.vaultId!, method: 'balance_of', args: { account_id: id } });
      return BigInt(String(v ?? '0'));
    },
    async vaultWithdraw(id, key, yocto) {
      const acc = new Account(id, p, key);
      const r = await acc.signAndSendTransaction({
        receiverId: cfg.vaultId!,
        actions: [actions.functionCall('withdraw', { amount: yocto.toString() }, teraToGas('50'), 0n)],
      });
      return txHash(r);
    },
    async availableYocto(id) {
      return (await new Account(id, p).getState()).balance.available;
    },
    async transfer(id, key, to, yocto) {
      const acc = new Account(id, p, key);
      const r = await acc.signAndSendTransaction({ receiverId: to, actions: [actions.transfer(yocto)] });
      return txHash(r);
    },
  };
}

let chainOpsOverride: ((cfg: HostedConfig) => ChainOps) | null = null;
/** Tests only. */
export function setChainOps(f: ((cfg: HostedConfig) => ChainOps) | null) {
  chainOpsOverride = f;
}

const fmt = (n: number) => n.toFixed(6).replace(/\.?0+$/, '');

export async function createWallet(cfg: HostedConfig, name: string): Promise<NewWallet> {
  const kp = KeyPair.fromRandom('ed25519');
  const privateKey = kp.toString();

  if (!cfg.near) {
    const accountId = `${name}.hosted.local`;
    if (await SessionModel.exists({ walletAddress: accountId })) throw new WalletError(409, 'NameTaken');
    await SessionModel.create({ sessionId: uuidv4(), walletAddress: accountId, nickname: name, chips: cfg.devChips });
    return { accountId, privateKey, txs: {} };
  }

  const ops = (chainOpsOverride ?? nearChainOps)(cfg);
  const accountId = `${name}.${cfg.root}`;
  if (await ops.accountExists(accountId)) throw new WalletError(409, 'NameTaken: that account already exists on testnet');
  // 0.05 NEAR headroom for the root's own gas/storage.
  const need = nearToYocto(fmt(cfg.fundNear + 0.05) as `${number}`);
  if ((await ops.funderAvailableYocto()) < need) {
    throw new WalletError(503, 'HostedFunderLow: the server is out of free test NEAR for new agents. Try again later.');
  }
  const createTx = await ops.createSubAccount(accountId, kp.getPublicKey().toString(), fmt(cfg.fundNear));
  // A brand-new account can be briefly invisible to the RPC node that signs the deposit
  // ("access key not found"), so retry a few times before giving up.
  let lastError = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const depTx = await ops.deposit(accountId, privateKey as KeyPairString, fmt(cfg.depositNear));
      return { accountId, privateKey, txs: { createAccount: createTx, deposit: depTx } };
    } catch (e) {
      lastError = (e as Error).message.slice(0, 200);
      console.warn(`[hosted] vault deposit for ${accountId} failed (attempt ${attempt}/3): ${lastError}`);
      if (attempt < 3 && !chainOpsOverride) await new Promise((r) => setTimeout(r, 2500 * attempt));
    }
  }
  // The account exists and holds the NEAR; keep it (the owner can still download the key).
  return { accountId, privateKey, txs: { createAccount: createTx }, depositError: lastError };
}

/** Keep a little NEAR on the agent account for its own storage. */
const WITHDRAW_RESERVE_YOCTO = nearToYocto('0.01');

/**
 * Cash out a hosted agent: take its whole vault balance out (vault → agent account), then, if
 * `to` is given, send everything above a small reserve to that account.
 */
export async function withdrawWallet(
  cfg: HostedConfig,
  accountId: string,
  privateKey: string,
  to: string | null
): Promise<{ withdrawnYocto: string; sentYocto: string; txs: { withdraw?: string; transfer?: string } }> {
  if (!cfg.near) throw new WalletError(400, 'NotOnChain: this server keeps chips off-chain');
  const ops = (chainOpsOverride ?? nearChainOps)(cfg);
  if (!ops.vaultBalanceYocto || !ops.vaultWithdraw || !ops.availableYocto || !ops.transfer) throw new WalletError(503, 'WithdrawUnavailable');
  const key = privateKey as KeyPairString;
  if (to && !(await ops.accountExists(to))) throw new WalletError(400, 'UnknownAccount: that NEAR account does not exist on testnet');

  const txs: { withdraw?: string; transfer?: string } = {};
  const inVault = await ops.vaultBalanceYocto(accountId);
  if (inVault > 0n) txs.withdraw = await ops.vaultWithdraw(accountId, key, inVault);

  let sent = 0n;
  if (to) {
    // The vault pays out in a follow-up receipt; give it a moment to land.
    let available = 0n;
    for (let i = 0; i < 6; i++) {
      available = await ops.availableYocto(accountId);
      if (inVault === 0n || available >= inVault) break;
      if (!chainOpsOverride) await new Promise((r) => setTimeout(r, 1500));
    }
    const send = available - WITHDRAW_RESERVE_YOCTO;
    if (send > 0n) {
      txs.transfer = await ops.transfer(accountId, key, to, send);
      sent = send;
    }
  }
  return { withdrawnYocto: inVault.toString(), sentYocto: sent.toString(), txs };
}
