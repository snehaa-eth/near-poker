/**
 * Hand ledger: commit / reveal / settle each hand (INTERFACES.md §3).
 *
 *  - MemoryLedger (default): in-process record, no chain. Enforces the same
 *    invariants as the contract so bugs surface locally.
 *  - NearLedger (CHAIN=near): calls `commit_hand` / `reveal_hand` / `settle_hand`
 *    on the `table-vault` contract as the operator account.
 *
 * Ledger failures must never crash a game: callers catch and record the error.
 */
import { Account, teraToGas, type KeyPairString } from 'near-api-js';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

export type LedgerResult = { tx?: string };

export interface HandLedger {
  readonly kind: 'memory' | 'near';
  commit(handId: string, seedHashHex: string, players: string[]): Promise<LedgerResult>;
  reveal(handId: string, serverSeedHex: string, entropyHex: string[]): Promise<LedgerResult>;
  settle(handId: string, deltas: Record<string, number>): Promise<LedgerResult>;
}

/** 1 chip = 10^21 yoctoNEAR (0.001 NEAR). */
export const YOCTO_PER_CHIP = 10n ** 21n;
export function chipsToYocto(chips: number): bigint {
  return BigInt(Math.trunc(chips)) * YOCTO_PER_CHIP;
}

type MemHand = {
  seedHash: string;
  players: string[];
  revealed: boolean;
  settled: boolean;
  serverSeed?: string;
  entropy?: string[];
  deckSeed?: string;
  deltas?: Record<string, number>;
};

export class MemoryLedger implements HandLedger {
  readonly kind = 'memory' as const;
  readonly hands = new Map<string, MemHand>();

  async commit(handId: string, seedHashHex: string, players: string[]) {
    if (this.hands.has(handId)) throw new Error(`MemoryLedger: hand ${handId} already committed`);
    if (players.length < 2 || players.length > 9) throw new Error('MemoryLedger: 2..=9 players required');
    this.hands.set(handId, { seedHash: seedHashHex.toLowerCase(), players: [...players], revealed: false, settled: false });
    return {};
  }

  async reveal(handId: string, serverSeedHex: string, entropyHex: string[]) {
    const h = this.hands.get(handId);
    if (!h) throw new Error(`MemoryLedger: unknown hand ${handId}`);
    if (entropyHex.length !== h.players.length) throw new Error('MemoryLedger: entropy length mismatch');
    const seed = hexToBytes(serverSeedHex);
    if (bytesToHex(sha256(seed)) !== h.seedHash) throw new Error('MemoryLedger: seed hash mismatch');
    const parts = [seed, ...entropyHex.map((e) => hexToBytes(e))];
    const all = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
    let off = 0;
    for (const p of parts) { all.set(p, off); off += p.length; }
    h.revealed = true;
    h.serverSeed = serverSeedHex;
    h.entropy = [...entropyHex];
    h.deckSeed = bytesToHex(sha256(all));
    return {};
  }

  async settle(handId: string, deltas: Record<string, number>) {
    const h = this.hands.get(handId);
    if (!h) throw new Error(`MemoryLedger: unknown hand ${handId}`);
    if (!h.revealed) throw new Error('MemoryLedger: hand not revealed');
    if (h.settled) throw new Error('MemoryLedger: hand already settled');
    const sum = Object.values(deltas).reduce((s, d) => s + d, 0);
    if (sum !== 0) throw new Error(`MemoryLedger: deltas sum to ${sum}, expected 0`);
    for (const id of Object.keys(deltas)) {
      if (!h.players.includes(id)) throw new Error(`MemoryLedger: ${id} not in hand`);
    }
    h.settled = true;
    h.deltas = { ...deltas };
    return {};
  }
}

export class NearLedger implements HandLedger {
  readonly kind = 'near' as const;
  private account: Account;
  private vaultId: string;
  private static GAS = teraToGas(100);

  constructor(opts: { rpcUrl: string; vaultId: string; operatorId: string; privateKey: string }) {
    if (!opts.privateKey.startsWith('ed25519:') && !opts.privateKey.startsWith('secp256k1:')) {
      throw new Error('NearLedger: OPERATOR_PRIVATE_KEY must look like "ed25519:..."');
    }
    this.vaultId = opts.vaultId;
    this.account = new Account(opts.operatorId, opts.rpcUrl, opts.privateKey as KeyPairString);
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env): NearLedger {
    const missing = ['NEAR_RPC_URL', 'VAULT_ID', 'OPERATOR_ID', 'OPERATOR_PRIVATE_KEY'].filter((k) => !env[k]);
    if (missing.length) {
      throw new Error(`NearLedger: CHAIN=near but missing env ${missing.join(', ')}`);
    }
    return new NearLedger({
      rpcUrl: env.NEAR_RPC_URL!,
      vaultId: env.VAULT_ID!,
      operatorId: env.OPERATOR_ID!,
      privateKey: env.OPERATOR_PRIVATE_KEY!,
    });
  }

  private async call(methodName: string, args: Record<string, unknown>): Promise<LedgerResult> {
    try {
      const res = (await this.account.callFunctionRaw({
        contractId: this.vaultId,
        methodName,
        args,
        gas: NearLedger.GAS,
      })) as unknown as {
        transaction_outcome?: { id?: string };
        transaction?: { hash?: string };
        status?: unknown;
      };
      const status = res.status as { Failure?: unknown } | undefined;
      if (status && typeof status === 'object' && 'Failure' in status) {
        throw new Error(`tx failed: ${JSON.stringify(status.Failure)}`);
      }
      return { tx: res.transaction_outcome?.id ?? res.transaction?.hash };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`NearLedger.${methodName} on ${this.vaultId} failed: ${msg}`);
    }
  }

  commit(handId: string, seedHashHex: string, players: string[]) {
    return this.call('commit_hand', { hand_id: handId, seed_hash: seedHashHex, players });
  }

  reveal(handId: string, serverSeedHex: string, entropyHex: string[]) {
    return this.call('reveal_hand', { hand_id: handId, server_seed: serverSeedHex, entropy: entropyHex });
  }

  settle(handId: string, deltas: Record<string, number>) {
    const list = Object.entries(deltas).map(([acct, chips]) => [acct, chipsToYocto(chips).toString()]);
    return this.call('settle_hand', { hand_id: handId, deltas: list });
  }
}

let singleton: HandLedger | null = null;

/** CHAIN=near → NearLedger (throws loudly on bad config); otherwise MemoryLedger. */
export function getLedger(): HandLedger {
  if (singleton) return singleton;
  if ((process.env.CHAIN ?? '').toLowerCase() === 'near') {
    singleton = NearLedger.fromEnv();
    console.log(`[ledger] NEAR ledger → ${process.env.VAULT_ID} via ${process.env.NEAR_RPC_URL}`);
  } else {
    singleton = new MemoryLedger();
  }
  return singleton;
}

/** Test hook. */
export function setLedger(ledger: HandLedger | null) {
  singleton = ledger;
}
