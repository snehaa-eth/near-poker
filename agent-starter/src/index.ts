/**
 * CLI.
 *   npm start                     play in the arena until MAX_LLM_CALLS is used, you bust, or Ctrl-C
 *   npm run deposit -- 0.25       deposit 0.25 NEAR (= 250 chips) into the table-vault
 *   npm run balance               show your vault balance in chips
 *
 * Env:
 *   AGENT_ACCOUNT     your testnet account (required)
 *   AGENT_PRIVATE_KEY optional "ed25519:…"; default ~/.near-credentials/testnet/<AGENT_ACCOUNT>.json
 *   GAME_SERVER       the Dark Table server URL (default http://localhost:4000 = a local dev server)
 *   EVENT_ID          optional: register for this scheduled arena event (POST /events/:id/register),
 *                     wait for its start, then join (also sent with POST /arena/join)
 *   AGENT_PERSONA     optional: replaces PERSONA in strategy.ts
 *   NEARAI_API_KEY    required for `start` (https://cloud.near.ai)
 *   NEARAI_MODEL      default Qwen/Qwen3.6-35B-A3B-FP8 (must be a Confidential-TEE model)
 *   NEARAI_BASE_URL   default https://cloud-api.near.ai/v1
 *   MAX_LLM_CALLS     default 40 — hard cap on paid completions per run
 *   VAULT_ID, NEAR_RPC_URL, AGENT_NICKNAME, SHOW_VERIFY_URL=1
 */
import { io } from 'socket.io-client';

import { ArenaAgent } from './agent.js';
import { chainConfig, deposit, GameHttp, loadKey, login, vaultBalance, yoctoToChips } from './near.js';
import { NICKNAME } from './strategy.js';
import { NEARAI_BASE_URL, NEARAI_DEFAULT_MODEL, Tee } from './tee.js';

export const DEFAULT_GAME_SERVER = 'http://localhost:4000';
export function gameServerUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.GAME_SERVER?.trim() || DEFAULT_GAME_SERVER).replace(/\/$/, '');
}

/** "fetch failed" → a message that says which URL was tried and what to set. */
export function unreachable(e: Error, server: string): Error {
  const cause = (e as Error & { cause?: { code?: string } }).cause?.code;
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|EAI_AGAIN/.test(`${e.message} ${cause ?? ''}`)) {
    return new Error(`cannot reach the game server at ${server} (${cause ?? e.message}). Is it running? Set GAME_SERVER=<public server URL>.`);
  }
  return e;
}

function need(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    console.error(`missing env ${name} (see AGENTS.md)`);
    process.exit(2);
  }
  return v;
}

async function main() {
  const cmd = process.argv[2] ?? 'play';
  const account = need('AGENT_ACCOUNT');
  const key = loadKey(account);
  const chain = chainConfig();

  if (cmd === 'balance') {
    const y = await vaultBalance(chain, account);
    console.log(`${account}: ${yoctoToChips(y)} chips in ${chain.vaultId} (${y} yocto)`);
    return;
  }

  if (cmd === 'deposit') {
    const amount = process.argv[3] ?? '0.25';
    console.log(`depositing ${amount} NEAR from ${account} into ${chain.vaultId} …`);
    const tx = await deposit(chain, account, key, amount);
    console.log(`✓ tx https://testnet.nearblocks.io/txns/${tx}`);
    const y = await vaultBalance(chain, account);
    console.log(`vault balance: ${yoctoToChips(y)} chips`);
    return;
  }

  if (cmd !== 'play') throw new Error(`unknown command "${cmd}" (play | deposit <near> | balance)`);

  const server = gameServerUrl();
  if (!process.env.GAME_SERVER?.trim()) console.log(`ℹ️  GAME_SERVER not set → using ${server} (set GAME_SERVER=<public server URL> to play on a hosted Dark Table)`);
  const maxLlmCalls = Number(process.env.MAX_LLM_CALLS ?? 40);
  if (!Number.isFinite(maxLlmCalls) || maxLlmCalls < 1) throw new Error('MAX_LLM_CALLS must be ≥ 1');
  const tee = new Tee({
    apiKey: need('NEARAI_API_KEY'),
    model: process.env.NEARAI_MODEL?.trim() || NEARAI_DEFAULT_MODEL,
    baseUrl: process.env.NEARAI_BASE_URL?.trim() || NEARAI_BASE_URL,
  });

  // 1. TEE attestation (free: no completion). Refuse to play with a non-TEE model.
  const att = await tee.attest();
  if (!att.ok && att.authError) throw new Error(`invalid NEARAI_API_KEY: NEAR AI Cloud answered ${att.error}`);
  if (!att.ok) throw new Error(`model ${tee.model} has no usable TEE model attestation: ${att.error}. Only Confidential-TEE models may play.`);
  console.log(`🔐 ${tee.model}: TEE model attestation ok (nonce echoed), signer ${att.signers[0]!.slice(0, 16)}…`);

  // 2. NEP-413 login
  const http = new GameHttp(server);
  const session = await login(http, account, key, NICKNAME).catch((e: Error) => {
    throw unreachable(e, server);
  });
  console.log(`👤 logged in as ${account} (${session.nickname ?? ''}) at ${server}, ${session.chips ?? '?'} chips`);

  // 3. socket + arena
  const socket = io(server, { transports: ['websocket'], extraHeaders: { cookie: http.cookieHeader() } });
  await new Promise<void>((ok, bad) => {
    socket.once('connect', () => ok());
    socket.once('connect_error', (e: Error) => bad(new Error(`socket.io connect to ${server} failed: ${e.message}. Set GAME_SERVER=<public server URL>.`)));
  });
  const eventId = process.env.EVENT_ID?.trim();
  const agent = new ArenaAgent({ api: http.api, socket, tee, maxLlmCalls, eventId: eventId || undefined, ...(eventId ? { joinBody: { eventId } } : {}) });
  let interrupted = false;
  process.on('SIGINT', () => {
    if (interrupted) process.exit(130);
    interrupted = true;
    console.log('\n^C → leaving after this hand (Ctrl-C again to quit now)');
    http.api('/arena/leave', {}).catch(() => undefined);
    agent.leaving = true;
    if (!agent.gameId) agent.stop('interrupted while queued');
  });
  await agent.start();
  const s = await agent.done;
  console.log(
    `\n■ stopped: ${s.reason}. hands ${s.hands}, provably fair ${s.handsVerified}/${s.hands}${s.handsFailed ? ` (${s.handsFailed} FAILED)` : ''}, ` +
      `moves ${s.movesSent}, LLM calls ${s.llmCalls}/${maxLlmCalls}, rejections ${s.rejections}`,
  );
  process.exit(s.handsFailed ? 1 : 0);
}

main().catch((e) => {
  console.error('agent error:', (e as Error).message);
  process.exit(1);
});
