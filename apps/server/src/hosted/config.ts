/**
 * Hosted agents configuration (read lazily from env so tests can change it).
 *
 *   HOSTED_SECRET          32-byte hex AES-256-GCM key for stored secrets. Required in CHAIN=near
 *                          (feature disabled without it); generated per process (with a warning) otherwise.
 *   HOSTED_ROOT            parent account for agent sub-accounts (default BOT_ACCOUNT_SUFFIX, else
 *                          the value in apps/server/.env.testnet)
 *   HOSTED_FUNDER_PRIVATE_KEY  "ed25519:…" key of the funder account (wins over the key file; for containers)
 *   HOSTED_FUNDER_ACCOUNT  funder account id (default HOSTED_ROOT; agents are <name>.<HOSTED_ROOT>)
 *   HOSTED_FUNDER_KEY_FILE key file of the funder (default ~/.near-credentials/testnet/<funder>.json)
 *   HOSTED_PUBLIC_API_URL  GAME_SERVER written into downloads (default: the request's host)
 *   HOSTED_RESUME=0        do not restart previously running agents on boot
 *   HOSTED_FUND_NEAR       NEAR sent to each new agent account (default 0.15)
 *   HOSTED_DEPOSIT_NEAR    NEAR the agent deposits into table-vault right away (default 0.1 = 100 chips)
 *   HOSTED_MAX             max hosted agents in total (default 20)
 *   HOSTED_MAX_RUNNING     max agents running at once (default 10)
 *   HOSTED_RATE_PER_HOUR   creations per IP per hour (default 3)
 *   HOSTED_DEV_CHIPS       off-chain chips for agents in the local test path (default 1000)
 *   HOSTED_AGENT_DIR       agent-starter directory (default <repo>/agent-starter)
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isArenaTestMode } from '../auth.js';
import { isNearChain } from '../near.js';

const HERE = dirname(fileURLToPath(import.meta.url));
/** apps/server/src/hosted (or dist/hosted) → repo root */
export const REPO_ROOT = resolve(HERE, '../../../..');
export const DEFAULT_MODEL = 'Qwen/Qwen3.6-35B-A3B-FP8';

function num(env: NodeJS.ProcessEnv, key: string, fallback: number, min = 0): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= min ? n : fallback;
}

function rootFromEnvFile(): string | null {
  const f = join(REPO_ROOT, 'apps/server/.env.testnet');
  if (!existsSync(f)) return null;
  const m = /^BOT_ACCOUNT_SUFFIX=(.+)$/m.exec(readFileSync(f, 'utf8'));
  return m?.[1]?.trim() || null;
}

export type HostedConfig = {
  near: boolean;
  /** off-chain path usable (needs ARENA_TEST_MODE=1 because agent keys have no testnet account) */
  testMode: boolean;
  root: string | null;
  /** account that pays for new agents (default = root; must be root or the root itself for sub-accounts) */
  funder: string | null;
  funderKeyFile: string | null;
  fundNear: number;
  depositNear: number;
  max: number;
  maxRunning: number;
  ratePerHour: number;
  devChips: number;
  agentDir: string;
  rpcUrl: string;
  vaultId: string | null;
};

export function getHostedConfig(env: NodeJS.ProcessEnv = process.env): HostedConfig {
  const near = isNearChain(env);
  const root =
    env.HOSTED_ROOT?.trim() || env.HOSTED_FUNDER_ACCOUNT?.trim() || env.BOT_ACCOUNT_SUFFIX?.trim() || (near ? rootFromEnvFile() : null);
  const funder = env.HOSTED_FUNDER_ACCOUNT?.trim() || root;
  return {
    near,
    testMode: isArenaTestMode(env),
    root,
    funder,
    funderKeyFile:
      env.HOSTED_FUNDER_KEY_FILE?.trim() || (funder ? join(homedir(), '.near-credentials', 'testnet', `${funder}.json`) : null),
    fundNear: num(env, 'HOSTED_FUND_NEAR', 0.15, 0.01),
    depositNear: num(env, 'HOSTED_DEPOSIT_NEAR', 0.1, 0.001),
    max: Math.floor(num(env, 'HOSTED_MAX', 20, 0)),
    maxRunning: Math.floor(num(env, 'HOSTED_MAX_RUNNING', 10, 0)),
    ratePerHour: Math.floor(num(env, 'HOSTED_RATE_PER_HOUR', 3, 0)),
    devChips: Math.floor(num(env, 'HOSTED_DEV_CHIPS', 1000, 0)),
    agentDir: env.HOSTED_AGENT_DIR?.trim() || join(REPO_ROOT, 'agent-starter'),
    rpcUrl: env.NEAR_RPC_URL?.trim() || 'https://test.rpc.fastnear.com',
    vaultId: env.VAULT_ID?.trim() || null,
  };
}

/** null when creation is possible, else a human-readable reason. */
export function disabledReason(cfg: HostedConfig, env: NodeJS.ProcessEnv = process.env): string | null {
  if (!env.NEARAI_API_KEY?.trim()) return 'This server has no NEARAI_API_KEY, so the arena (and hosted agents) are off.';
  if (cfg.near) {
    if (!env.HOSTED_SECRET?.trim()) return 'Hosted agents are not configured on this server (HOSTED_SECRET missing).';
    if (!cfg.root) return 'Hosted agents are not configured on this server (HOSTED_ROOT missing).';
    if (!env.HOSTED_FUNDER_PRIVATE_KEY?.trim() && !(cfg.funderKeyFile && existsSync(cfg.funderKeyFile))) {
      return 'Hosted agents are not configured on this server (funder key missing: HOSTED_FUNDER_PRIVATE_KEY or HOSTED_FUNDER_KEY_FILE).';
    }
    if (cfg.funder !== cfg.root) {
      return 'Hosted agents misconfigured: HOSTED_FUNDER_ACCOUNT must equal HOSTED_ROOT (only the parent account can create <name>.<root>).';
    }
    if (!cfg.vaultId) return 'Hosted agents are not configured on this server (VAULT_ID missing).';
    return null;
  }
  if (!cfg.testMode) {
    return 'Hosted agents need CHAIN=near (real testnet wallets) or ARENA_TEST_MODE=1 (local testing).';
  }
  return null;
}
