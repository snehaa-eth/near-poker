/**
 * Runs hosted agents as agent-starter child processes (`tsx src/index.ts play`).
 *
 * Secrets travel only through the child's environment (never argv, never logs). Every captured
 * output line is redacted (the agent's own secrets + anything that looks like a NEAR private key
 * or an API key) before it is kept for the manage page (last 100 lines).
 *
 * Exit handling: the starter prints "■ stopped: <reason>. hands N, … moves M, LLM calls c/max".
 * Budget used → idle "budget used"; busted → idle "out of chips"; otherwise idle/error with the reason.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { getArenaConfig } from '../arena/config.js';
import { HostedAgentModel, type HostedAgentDoc } from '../db.js';
import { getHostedConfig } from './config.js';
import { decryptSecret } from './crypto.js';
import { personaText, type PersonaId } from './personas.js';

const LOG_LINES = 100;
const STOP_GRACE_MS = 90_000;

type Run = {
  child: ChildProcess;
  logs: string[];
  secrets: string[];
  startedAt: number;
  stopping: boolean;
  gameId: string | null;
  killTimer?: NodeJS.Timeout;
  exited: Promise<void>;
};

const runs = new Map<string, Run>();
let gamePort: number | null = null;

export function setGamePort(port: number) {
  gamePort = port;
}

export function isRunning(agentId: string) {
  return runs.has(agentId);
}
export function runningCount() {
  return runs.size;
}
export function liveLogs(agentId: string): string[] | null {
  return runs.get(agentId)?.logs ?? null;
}
export function liveGameId(agentId: string): string | null {
  return runs.get(agentId)?.gameId ?? null;
}

const KEY_RE = /ed25519:[1-9A-HJ-NP-Za-km-z]{32,}/g;
const API_KEY_RE = /\b(sk-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._-]{8,})/g;

export function redact(line: string, secrets: string[] = []): string {
  let out = line;
  for (const s of secrets) if (s && s.length >= 6) out = out.split(s).join('[redacted]');
  return out.replace(KEY_RE, 'ed25519:[redacted]').replace(API_KEY_RE, '[redacted]');
}

function minimalEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const k of ['PATH', 'HOME', 'TMPDIR', 'LANG', 'USER', 'SHELL', 'SYSTEMROOT']) if (process.env[k]) env[k] = process.env[k];
  return { ...env, ...extra };
}

export type StartResult = { ok: true } | { ok: false; status: number; error: string };

export async function startAgent(doc: HostedAgentDoc): Promise<StartResult> {
  if (runs.has(doc.agentId)) return { ok: true };
  installExitHooks();
  const cfg = getHostedConfig();
  if (runs.size >= cfg.maxRunning) return { ok: false, status: 503, error: 'RunnerFull: too many hosted agents are playing right now. Try again in a few minutes.' };
  if (!gamePort) return { ok: false, status: 503, error: 'RunnerNotReady' };
  const tsx = join(cfg.agentDir, 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx');
  if (!existsSync(tsx)) return { ok: false, status: 503, error: 'RunnerMissing: agent-starter dependencies are not installed on this server' };

  let apiKey: string;
  let privateKey: string;
  try {
    apiKey = decryptSecret(doc.encryptedNearAiKey);
    privateKey = decryptSecret(doc.encryptedAgentPrivateKey);
  } catch {
    await HostedAgentModel.updateOne({ agentId: doc.agentId }, { status: 'error', statusDetail: 'cannot decrypt secrets (server key changed)', wantRunning: false });
    return { ok: false, status: 500, error: 'SecretsUnavailable: this server cannot decrypt the agent secrets anymore' };
  }

  const env: Record<string, string> = {
    AGENT_ACCOUNT: doc.walletAddress,
    AGENT_PRIVATE_KEY: privateKey,
    AGENT_NICKNAME: doc.name,
    AGENT_PERSONA: personaText(doc.persona as PersonaId, doc.name, doc.customPrompt),
    NEARAI_API_KEY: apiKey,
    NEARAI_MODEL: doc.model,
    NEARAI_BASE_URL: getArenaConfig().nearaiBaseUrl,
    MAX_LLM_CALLS: String(doc.maxCalls),
    GAME_SERVER: `http://localhost:${gamePort}`,
    NEAR_RPC_URL: cfg.rpcUrl,
    ...(cfg.vaultId ? { VAULT_ID: cfg.vaultId } : {}),
    ...(doc.eventId ? { EVENT_ID: doc.eventId } : {}),
  };

  const child = spawn(tsx, ['src/index.ts', 'play'], {
    cwd: cfg.agentDir,
    env: minimalEnv(env),
    detached: process.platform !== 'win32', // own process group → we can stop tsx + node together
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let resolveExit!: () => void;
  const run: Run = {
    child,
    logs: [],
    secrets: [apiKey, privateKey, privateKey.replace(/^ed25519:/, '')],
    startedAt: Date.now(),
    stopping: false,
    gameId: null,
    exited: new Promise<void>((r) => (resolveExit = r)),
  };
  runs.set(doc.agentId, run);

  let summary: { reason: string; hands: number; moves: number; llmCalls: number } | null = null;
  const onLine = (raw: string) => {
    const line = redact(raw.replace(/\s+$/, ''), run.secrets);
    if (!line) return;
    run.logs.push(line);
    if (run.logs.length > LOG_LINES) run.logs.splice(0, run.logs.length - LOG_LINES);
    const seated = /seated at arena table (\S+)/.exec(line);
    if (seated) run.gameId = seated[1]!;
    if (/queued for the arena|arena:closed/.test(line)) run.gameId = null;
    const m = /■ stopped: (.*?)\. hands (\d+).*?moves (\d+), LLM calls (\d+)/.exec(line);
    if (m) summary = { reason: m[1]!, hands: Number(m[2]), moves: Number(m[3]), llmCalls: Number(m[4]) };
  };
  for (const stream of [child.stdout!, child.stderr!]) {
    let buf = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk: string) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        onLine(buf.slice(0, i));
        buf = buf.slice(i + 1);
      }
      if (buf.length > 4000) {
        onLine(buf);
        buf = '';
      }
    });
    stream.on('end', () => buf && onLine(buf));
  }

  await HostedAgentModel.updateOne(
    { agentId: doc.agentId },
    { status: 'running', statusDetail: 'starting', wantRunning: true, $inc: { 'stats.runs': 1 } }
  );

  child.on('exit', (code, signal) => {
    if (run.killTimer) clearTimeout(run.killTimer);
    runs.delete(doc.agentId);
    const s = summary as { reason: string; hands: number; moves: number; llmCalls: number } | null;
    let status: 'idle' | 'error' = 'idle';
    let detail: string;
    if (s && /LLM budget|MAX_LLM_CALLS/.test(s.reason)) detail = 'budget used';
    else if (s && /busted/.test(s.reason)) detail = 'out of chips';
    else if (run.stopping) detail = 'stopped';
    else if (s) detail = s.reason;
    else {
      status = 'error';
      const last = [...run.logs].reverse().find((l) => /error|missing|refus|fail/i.test(l)) ?? run.logs.at(-1) ?? '';
      detail = `exited (${signal ?? code})${last ? `: ${last.slice(0, 160)}` : ''}`;
    }
    const update: Record<string, unknown> = { status, statusDetail: detail, lastLog: run.logs.slice(-LOG_LINES) };
    // Only a deliberate stop or a finished run clears the restart-after-reboot flag.
    update.wantRunning = false;
    if (s) update['stats.lastRun'] = { ...s, endedAt: new Date().toISOString() };
    HostedAgentModel.updateOne({ agentId: doc.agentId, status: { $ne: 'deleted' } }, update)
      .catch((e) => console.error('[hosted] status update failed', (e as Error).message))
      .finally(resolveExit);
  });
  child.on('error', (e) => {
    run.logs.push(`runner error: ${redact(e.message, run.secrets)}`);
  });
  return { ok: true };
}

function killGroup(child: ChildProcess, sig: NodeJS.Signals) {
  try {
    if (child.pid && process.platform !== 'win32') process.kill(-child.pid, sig);
    else child.kill(sig);
  } catch {
    /* gone */
  }
}

/**
 * Graceful stop: SIGINT → the starter POSTs /arena/leave and exits after the current hand.
 * `force` (or a second stop) kills it now; the server auto-folds its pending turn.
 */
export function stopAgent(agentId: string, force = false): boolean {
  const run = runs.get(agentId);
  if (!run) return false;
  if (force || run.stopping) {
    run.stopping = true;
    killGroup(run.child, 'SIGKILL');
    return true;
  }
  run.stopping = true;
  // Signal only the tsx parent: it relays SIGINT once to the agent (a group-wide SIGINT would arrive twice = "quit now").
  try {
    run.child.kill('SIGINT');
  } catch {
    /* gone */
  }
  run.killTimer = setTimeout(() => killGroup(run.child, 'SIGKILL'), STOP_GRACE_MS);
  run.killTimer.unref();
  return true;
}

export async function waitForExit(agentId: string, timeoutMs = 30_000) {
  const run = runs.get(agentId);
  if (!run) return;
  await Promise.race([run.exited, new Promise((r) => setTimeout(r, timeoutMs).unref())]);
}

/** Server shutdown: kill every child (sync, safe inside process 'exit'). */
export function killAll() {
  for (const run of runs.values()) killGroup(run.child, 'SIGKILL');
}

let hooked = false;
export function installExitHooks() {
  if (hooked) return;
  hooked = true;
  process.on('exit', killAll);
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.once(sig, () => {
      killAll();
      process.kill(process.pid, sig);
    });
  }
}
