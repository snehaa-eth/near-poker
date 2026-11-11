/**
 * Six AI bots play No-Limit Hold'em against each other on the running game server.
 *
 * Usage (server must be running on :4000):
 *   pnpm --filter server bots            # 5 hands
 *   HANDS=10 pnpm --filter server bots
 *
 * Each bot is a normal player: its own session, its own socket, and it only sees its own
 * hole cards (the server hides everyone else's until showdown). Sessions are created via
 * admin login + POST /admin/bot-session (flagged as bots → `players[i].bot` in the view).
 *
 *  - default: chips come from the server's off-chain /treasury/deposit (1.5 NEAR = 1500 chips).
 *  - BOT_ACCOUNTS=rock.x.testnet,maniac.x.testnet,... (server CHAIN=near): each bot is bound
 *    to that NEAR account and its chips are its `table-vault` balance (GET /treasury/sync).
 *    Fund the accounts' vault balances first (vault.deposit from each sub-account).
 *
 * Provably fair: every bot answers `game:entropyRequest` with 16 random bytes, and after
 * each hand the script fetches GET /hands/:handId and independently re-derives the deck
 * (sha256(serverSeed) == seedHash, deckSeed, shuffle, deal order) — see INTERFACES.md §1.
 * Exits non-zero if any hand fails verification.
 *
 * FAST headless mode:  HANDS=10 STEP_MS=30 START_DELAY_MS=0 npx tsx scripts/bots-6.ts
 *
 * LLM brains (NEAR AI Cloud, TEE inference): set NEARAI_API_KEY (and not FAST=1). Each decision
 * goes to the model with the bot's persona, its OWN hole cards and the public table state; the
 * response signature is checked against the nonce-bound attestation report (src/brain/nearai.ts).
 * Falls back to the rule bot on timeout / error / illegal output, or after MAX_LLM_CALLS (200).
 *   NEARAI_MODEL (default Qwen/Qwen3.6-35B-A3B-FP8), LLM_TIMEOUT_MS (default 6000),
 *   NEARAI_BASE_URL (default https://cloud-api.near.ai/v1; point at a mock for offline tests)
 * Output marker per action: 🧠 = LLM move (✔ signature verified), 📏 = rules.
 */
import { randomBytes } from 'node:crypto';

import { io, type Socket } from 'socket.io-client';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import {
  cardFromId,
  deriveDeckSeed,
  evaluateBestHand,
  formatCard,
  shuffleFromSeed,
} from '@nli/poker-engine';

import { createBrain, NEARAI_DEFAULT_MODEL, type AttestationSummary, type Brain } from '../src/brain/nearai.js';
import { decideMove, legalizeRules, type DecidedMove } from '../src/brain/decide.js';
import type { Snapshot } from '../src/brain/prompt.js';

const API = process.env.API_URL ?? 'http://localhost:4000';
const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const HANDS = Number(process.env.HANDS ?? 5);
const STEP_MS = Number(process.env.STEP_MS ?? 1200);
const START_DELAY_MS = Number(process.env.START_DELAY_MS ?? 10000);
const FAST = process.env.FAST === '1';
const MAX_LLM_CALLS = Number(process.env.MAX_LLM_CALLS ?? 200);
const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS ?? 6000);

type Style = { name: string; emoji: string; loose: number; aggro: number; bluff: number };
const BOTS: Style[] = [
  { name: 'Rock', emoji: '🪨', loose: 0.25, aggro: 0.3, bluff: 0.0 },
  { name: 'Maniac', emoji: '🔥', loose: 0.9, aggro: 0.9, bluff: 0.35 },
  { name: 'Shark', emoji: '🦈', loose: 0.45, aggro: 0.7, bluff: 0.12 },
  { name: 'Calley', emoji: '📞', loose: 0.8, aggro: 0.1, bluff: 0.0 },
  { name: 'Fox', emoji: '🦊', loose: 0.5, aggro: 0.5, bluff: 0.25 },
  { name: 'Owl', emoji: '🦉', loose: 0.4, aggro: 0.45, bluff: 0.05 },
];

type Jar = Map<string, string>;
type View = {
  gameId: string;
  status: string;
  round: string;
  roundLabel: string;
  players: Array<{ id: string; nickname: string; seat: number; chipsInPot: number; folded: boolean; holeCards: number[] }>;
  communityCards: number[];
  pot: number;
  highestBet: number;
  minRaise: number;
  dealerSeat?: number;
  stacksByPlayerId: Record<string, number>;
  nextPlayerId: string | null;
  winnerNickname: string | null;
  gameEnded: boolean;
  myPlayerId: string | null;
  isMyTurn: boolean;
  fairness?: {
    handId: string;
    seedHash: string;
    committedTx?: string;
    revealed?: { serverSeed: string; entropy: string[]; deckSeed: string; revealTx?: string };
  };
};

type HandRecord = {
  handId: string;
  seedHash: string;
  serverSeed?: string;
  entropy?: string[];
  deckSeed?: string;
  seats: Array<{ seat: number; playerId: string; nickname: string; holeCards: number[] }>;
  community: number[];
  txs?: Record<string, string>;
};

/**
 * Independent re-derivation (INTERFACES.md §1). Deal order (engine startHand/dealHoleCards/
 * dealCommunity): 2 hole cards per player in table order, then burn+3, burn+1, burn+1.
 * `seen` = hole cards each bot privately received (engine ids), `board` = final public board.
 */
function verifyRecord(
  rec: HandRecord,
  seen: Map<string, number[]>,
  board: number[],
  revealedInView?: View['fairness']
): string[] {
  const errs: string[] = [];
  if (!rec.serverSeed || !rec.entropy || !rec.deckSeed) return ['hand not revealed'];
  const serverSeed = hexToBytes(rec.serverSeed);
  if (bytesToHex(sha256(serverSeed)) !== rec.seedHash) errs.push('sha256(serverSeed) != seedHash');
  if (revealedInView && revealedInView.seedHash !== rec.seedHash) errs.push('view seedHash != record seedHash');
  if (rec.entropy.length !== rec.seats.length) errs.push('entropy count != seat count');
  const deckSeed = deriveDeckSeed(serverSeed, rec.entropy.map((e) => hexToBytes(e)));
  if (bytesToHex(deckSeed) !== rec.deckSeed) errs.push('deckSeed mismatch');
  const deck = shuffleFromSeed(deckSeed).map((c) => c.id);
  if (new Set(deck).size !== 52) errs.push('deck is not a permutation');
  const seats = [...rec.seats].sort((a, b) => a.seat - b.seat);
  let p = 0;
  for (const s of seats) {
    const exp = [deck[p]!, deck[p + 1]!];
    p += 2;
    if (s.holeCards.join() !== exp.join()) errs.push(`seat ${s.seat} hole ${s.holeCards} != deck ${exp}`);
    const mine = seen.get(s.playerId);
    if (mine && mine.join() !== exp.join()) errs.push(`seat ${s.seat}: cards the bot was dealt ${mine} != deck ${exp}`);
  }
  const expBoard = [deck[p + 1]!, deck[p + 2]!, deck[p + 3]!, deck[p + 5]!, deck[p + 7]!];
  rec.community.forEach((id, i) => {
    if (expBoard[i] !== id) errs.push(`community[${i}] ${id} != deck ${expBoard[i]}`);
  });
  if (board.join() !== rec.community.join()) errs.push(`table board ${board} != record ${rec.community}`);
  return errs;
}

// UI card id -> engine card id (the server maps engine suits c,d,h,s -> UI 3,2,1,0).
const uiToEngine = (ui: number) => (ui % 13) + [3, 2, 1, 0][Math.floor(ui / 13)]! * 13;
const show = (ui: number[]) => ui.filter((c) => c >= 0).map((c) => formatCard(cardFromId(uiToEngine(c)))).join(' ');

async function api(jar: Jar, path: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  for (const line of res.headers.getSetCookie?.() ?? []) {
    const [pair] = line.split(';');
    const i = pair!.indexOf('=');
    if (i > 0) jar.set(pair!.slice(0, i).trim(), pair!.slice(i + 1).trim());
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} ${res.status} ${JSON.stringify(json)}`);
  return json as Record<string, unknown>;
}

/** 0..1 hand strength from the bot's own cards + board. */
function strength(hole: number[], board: number[]): number {
  const h = hole.filter((c) => c >= 0).map((c) => cardFromId(uiToEngine(c)));
  const b = board.filter((c) => c >= 0).map((c) => cardFromId(uiToEngine(c)));
  if (h.length < 2) return 0;
  if (b.length === 0) {
    const [r1, r2] = [h[0]!.rank, h[1]!.rank].sort((x, y) => y - x) as [number, number];
    let s = (r1 + r2 - 4) / 24; // 0..1 by high cards
    if (r1 === r2) s = 0.55 + (r1 / 14) * 0.45; // pairs
    if (h[0]!.suit === h[1]!.suit) s += 0.06;
    if (r1 - r2 === 1) s += 0.04;
    return Math.min(1, s);
  }
  const cat = evaluateBestHand([...h, ...b]).score[0] ?? 0; // 0 high card .. 9 royal
  return Math.min(1, [0.2, 0.5, 0.7, 0.78, 0.84, 0.88, 0.93, 0.97, 0.99, 1][cat] ?? 0.2);
}

type Decision = { kind: 'fold' | 'check' | 'call' | 'raise'; amount: number; say: string };

function decide(bot: Style, v: View): Decision {
  const me = v.players.find((p) => p.id === v.myPlayerId)!;
  const stack = v.stacksByPlayerId[me.id] ?? 0;
  const toCall = Math.max(0, v.highestBet - me.chipsInPot);
  const s = strength(me.holeCards, v.communityCards);
  const r = Math.random();
  const bluffing = s <= 1 - bot.aggro * 0.45 && r < bot.bluff;
  const sizing = bluffing ? 0.5 : s > 0.9 ? 1.5 : 0.4 + bot.aggro * 0.6; // bluffs small, monsters big
  const raiseTo = Math.min(me.chipsInPot + stack, v.highestBet + Math.max(v.minRaise, Math.round(v.pot * sizing)));
  const wantsRaise = s > 1 - bot.aggro * 0.45 || bluffing;
  const tooExpensive = toCall > stack * 0.5 && s < 0.7; // don't call off a stack with junk

  if (wantsRaise && stack > toCall && !(bluffing && tooExpensive)) {
    return { kind: 'raise', amount: raiseTo, say: bluffing ? 'bluff!' : s > 0.75 ? 'strong hand' : 'pressure' };
  }
  if (toCall === 0) return { kind: 'check', amount: 0, say: 'check' };
  const potOdds = toCall / (v.pot + toCall);
  if (!tooExpensive && (s + bot.loose * 0.3 > potOdds + 0.25 || toCall <= v.minRaise * bot.loose)) {
    return { kind: 'call', amount: v.highestBet, say: 'call' };
  }
  return { kind: 'fold', amount: 0, say: 'fold' };
}

type Bot = { style: Style; jar: Jar; sock: Socket; id: string };

const cardsOf = (ui: number[]) => show(ui).split(' ').filter(Boolean);

/** Only this bot's own hole cards + public state (see src/brain/prompt.ts). */
function snapshotOf(bot: Style, v: View, recent: string[]): Snapshot {
  const me = v.players.find((p) => p.id === v.myPlayerId)!;
  return {
    persona: bot.name,
    hole: cardsOf(me.holeCards),
    board: cardsOf(v.communityCards),
    street: v.roundLabel || v.round,
    pot: v.pot,
    highestBet: v.highestBet,
    chipsInPot: me.chipsInPot,
    minRaise: v.minRaise,
    stack: v.stacksByPlayerId[me.id] ?? 0,
    seat: me.seat,
    dealerSeat: v.dealerSeat,
    numPlayers: v.players.length,
    activePlayers: v.players.filter((p) => !p.folded).length,
    recent: [...recent],
  };
}

async function main() {
  const admin: Jar = new Map();
  await api(admin, '/auth/nickname', { nickname: 'Dealer' });
  await api(admin, '/admin/login', { password: process.env.ADMIN_PASSWORD ?? 'admin123' });
  // ── LLM brain (optional) ──
  const apiKey = process.env.NEARAI_API_KEY;
  let brain: Brain | null = null;
  let attestation: AttestationSummary | null = null;
  if (apiKey && !FAST) {
    brain = createBrain({ apiKey, model: process.env.NEARAI_MODEL || NEARAI_DEFAULT_MODEL, baseUrl: process.env.NEARAI_BASE_URL || undefined, timeoutMs: LLM_TIMEOUT_MS });
    attestation = await brain.attest();
    const a = attestation;
    console.log(
      a.ok
        ? `🧠 NEAR AI Cloud brain: ${brain.model}  attested (nonce ${a.nonce.slice(0, 12)}… echoed, signer ${a.signingAddresses[0]!.slice(0, 16)}…, ${a.modelAttestationCount} model attestation(s))`
        : `🧠 NEAR AI Cloud brain: ${brain.model}  attestation NOT ok (${a.error ?? 'unknown'}) — moves still used, signatures will not verify`
    );
  } else {
    console.log(`📏 rule bots (${FAST ? 'FAST=1' : 'no NEARAI_API_KEY'})`);
  }
  const llm = { calls: 0, used: 0, verified: 0, fallbacks: 0, latency: 0 };

  const game = await api(admin, '/games', { name: 'Bot Table (6 AIs)', minChips: 100, maxPlayers: 6 });
  const gameId = game.gameId as string;

  const accounts = (process.env.BOT_ACCOUNTS ?? '').split(',').map((a) => a.trim()).filter(Boolean);
  const styles = accounts.length > 0 ? BOTS.slice(0, accounts.length) : BOTS;
  if (accounts.length === 1) throw new Error('BOT_ACCOUNTS needs at least 2 accounts');

  const bots: Bot[] = [];
  for (const [i, style] of styles.entries()) {
    const jar: Jar = new Map();
    await api(jar, '/admin/login', { password: process.env.ADMIN_PASSWORD ?? 'admin123' });
    const me = await api(jar, '/admin/bot-session', {
      nickname: `${style.name}Bot`,
      ...(accounts[i] ? { walletAddress: accounts[i] } : {}),
    });
    if (accounts[i]) {
      const sync = await api(jar, '/treasury/sync'); // chips = vault balance / 10^21
      console.log(`   ${style.emoji} ${style.name} → ${accounts[i]}  ${sync.chips} chips (vault ${sync.vaultYocto ?? '?'} yocto)`);
      if (Number(sync.chips ?? 0) < 100) throw new Error(`${accounts[i]} has < 100 chips in the vault; deposit first`);
    } else {
      await api(jar, '/treasury/deposit', { nearAmount: 1.5 }); // off-chain demo chips (1500)
    }
    await api(jar, `/games/${gameId}/join`, {});
    const sock = io(API, { transports: ['websocket'], extraHeaders: { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') } });
    await new Promise<void>((ok, bad) => { sock.on('connect', () => ok()); sock.on('connect_error', bad); });
    sock.emit('bot:meta', {
      gameId,
      meta: brain
        ? { persona: style.name, model: brain.model, attested: !!attestation?.ok, ...(attestation?.signingAddresses[0] ? { signingAddress: attestation.signingAddresses[0] } : {}) }
        : { persona: style.name, model: undefined, attested: false },
    });
    bots.push({ style, jar, sock, id: String((me as { sessionId?: string }).sessionId ?? '') });
  }

  console.log(`\n🃏 ${bots.length} bots seated at table ${gameId.slice(0, 8)} (blinds 5/10${accounts.length ? ', chips from vault' : ', 1500 chips each'})`);
  console.log(`   watch in the browser: ${WEB}/game/${gameId}\n`);

  let hand = 0;
  let lastRound = '';
  let acting = false;
  let lastPot = 0;
  let inHand = new Set<string>();
  const actedOn = new Map<Bot, string>();
  let handLog: string[] = []; // public actions this hand, fed to the LLM prompt
  // provably-fair bookkeeping
  const seenHole = new Map<string, Map<string, number[]>>(); // handId -> playerId -> engine ids
  const verifications: Promise<void>[] = [];
  const fingerprints: string[] = [];
  let verified = 0;
  let failed = 0;
  let checkedHand = '';
  let finished: () => void;
  const done = new Promise<void>((ok) => (finished = ok));

  const nameOf = (v: View, id: string | null) => {
    const b = bots.find((x) => v.players.find((p) => p.id === id)?.nickname === `${x.style.name}Bot`);
    return b ? `${b.style.emoji} ${b.style.name}` : v.players.find((p) => p.id === id)?.nickname ?? '?';
  };

  const startHand = () => {
    hand += 1;
    lastRound = '';
    inHand = new Set();
    handLog = [];
    console.log(`━━━━━━━━━━━━━━━━ HAND ${hand}/${HANDS} ━━━━━━━━━━━━━━━━`);
    bots[0]!.sock.emit('game:start', { gameId });
  };

  const verifyHand = async (handId: string, board: number[], fairness: View['fairness']) => {
    const n = verifications.length + 1;
    try {
      const rec = (await api(new Map(), `/hands/${handId}`)) as unknown as HandRecord;
      const errs = verifyRecord(rec, seenHole.get(handId) ?? new Map(), board, fairness);
      fingerprints.push(rec.deckSeed ?? '');
      if (errs.length === 0) {
        verified += 1;
        console.log(`  fair ✅  hand #${n} ${handId.slice(0, 8)}  seedHash ${rec.seedHash.slice(0, 12)}…  deckSeed ${rec.deckSeed!.slice(0, 12)}…  entropy ${rec.entropy!.filter((e) => e !== '00'.repeat(16)).length}/${rec.entropy!.length}`);
      } else {
        failed += 1;
        console.log(`  fair ❌  hand #${n} ${handId.slice(0, 8)}: ${errs.join('; ')}`);
      }
    } catch (e) {
      failed += 1;
      console.log(`  fair ❌  hand #${n} ${handId.slice(0, 8)}: ${(e as Error).message}`);
    }
  };

  for (const bot of bots) {
    bot.sock.on('game:entropyRequest', ({ gameId: g, handId }: { gameId: string; handId: string }) => {
      if (g !== gameId) return;
      bot.sock.emit('game:entropy', { gameId, handId, entropy: randomBytes(16).toString('hex') });
    });
    bot.sock.on('game:error', ({ error }) => {
      if (!/NotYourTurn|NoHandActive/.test(error)) console.log(`   ⚠️  ${bot.style.name}: ${error}`);
      // Don't stall the table on a rejected action: fall back to folding.
      if (/IllegalBet|MustRaise|InvalidAmount|InsufficientStack|CannotCheck|Illegal/.test(error)) {
        bot.sock.emit('game:fold', { gameId });
      }
    });
    bot.sock.on('game:state', (v: View) => {
      const me = v.players.find((p) => p.id === v.myPlayerId);
      if (v.fairness && me && me.holeCards.length === 2 && me.holeCards.every((c) => c >= 0)) {
        const m = seenHole.get(v.fairness.handId) ?? new Map<string, number[]>();
        if (!m.has(me.id)) m.set(me.id, me.holeCards.map(uiToEngine));
        seenHole.set(v.fairness.handId, m);
      }
      if (!v.gameEnded && v.pot > 0) lastPot = v.pot;
      if (!v.gameEnded) for (const p of v.players) if (p.chipsInPot > 0) inHand.add(p.id);
      if (bot === bots[0] && v.round !== lastRound && v.status === 'playing') {
        lastRound = v.round;
        const board = show(v.communityCards);
        console.log(`\n  ── ${v.roundLabel}${board ? `  board: ${board}` : ''}   pot ${v.pot}`);
        if (v.round === 'PreFlop' || v.round === 'Ante') {
          // each bot privately sees its own cards; print them for the audience
          for (const b of bots) b.sock.emit('game:joinRoom', { gameId });
        }
      }
      if (v.status === 'playing' && (v.round === 'PreFlop' || v.round === 'Ante') && me && !(bot as Bot & { shown?: number }).shown) {
        (bot as Bot & { shown?: number }).shown = hand;
      }
      if (v.gameEnded && bot === bots[0] && lastRound !== 'END') {
        lastRound = 'END';
        if (v.fairness && v.fairness.handId !== checkedHand) {
          checkedHand = v.fairness.handId;
          const board = v.communityCards.filter((c) => c >= 0).map(uiToEngine);
          verifications.push(verifyHand(v.fairness.handId, board, v.fairness));
        }
        console.log(`\n  🏆 ${v.winnerNickname ?? '?'} wins pot ${lastPot}   board: ${show(v.communityCards)}`);
        for (const p of v.players) {
          if (inHand.has(p.id) && !p.folded && p.holeCards.some((c) => c >= 0)) console.log(`     ${nameOf(v, p.id).padEnd(10)} showed ${show(p.holeCards)}`);
        }
        const stacks = v.players.map((p) => `${nameOf(v, p.id)} ${v.stacksByPlayerId[p.id]}`).join(' · ');
        console.log(`  stacks: ${stacks}\n`);
        const alive = v.players.filter((p) => (v.stacksByPlayerId[p.id] ?? 0) > 0).length;
        if (hand >= HANDS || alive < 2) finished();
        else setTimeout(startHand, STEP_MS * 3);
        return;
      }
      // Each turn is acted on once: duplicate/stale game:state snapshots (e.g. from the
      // pre-flop game:joinRoom re-broadcast) used to make a bot act twice on the same view,
      // and the second emit was rejected as IllegalBet.
      const turnKey = `${v.fairness?.handId ?? hand}|${v.round}|${v.pot}|${v.highestBet}|${me?.chipsInPot}`;
      if (v.isMyTurn && v.status === 'playing' && !acting && actedOn.get(bot) !== turnKey) {
        actedOn.set(bot, turnKey);
        acting = true;
        setTimeout(async () => {
          try {
            const snap = snapshotOf(bot.style, v, handLog);
            const rules = () => {
              const r = decide(bot.style, v);
              return { kind: r.kind, amount: r.amount, line: r.say };
            };
            let d: DecidedMove;
            if (brain && llm.calls < MAX_LLM_CALLS) {
              llm.calls += 1;
              d = await decideMove(brain, snap, rules);
              if (d.source === 'llm') {
                llm.used += 1;
                llm.latency += d.latencyMs ?? 0;
                if (d.verified) llm.verified += 1;
              } else llm.fallbacks += 1;
            } else {
              d = { ...legalizeRules(rules(), snap), source: 'rules' };
            }
            const hole = show(me!.holeCards);
            const label = d.kind === 'raise' ? `raises to ${d.amount}` : d.kind === 'call' ? `calls ${Math.max(0, v.highestBet - me!.chipsInPot)}` : d.kind === 'check' ? 'checks' : 'folds';
            const mark = d.source === 'llm' ? `🧠${d.verified ? '✔' : ' '}` : '📏 ';
            const why = d.fallbackReason ? `  [fallback: ${d.fallbackReason.slice(0, 60)}]` : '';
            const line = d.line || (d.source === 'rules' ? d.kind : '');
            inHand.add(me!.id);
            handLog.push(`${bot.style.name} ${label}`);
            console.log(`  ${bot.style.emoji} ${bot.style.name.padEnd(7)} [${hole}]  ${mark} ${label.padEnd(16)} "${line}"${d.latencyMs ? ` ${d.latencyMs}ms` : ''}${why}`);
            if (line) bot.sock.emit('bot:meta', { gameId, meta: { lastLine: line } });
            if (d.kind === 'fold') bot.sock.emit('game:fold', { gameId });
            else bot.sock.emit('game:bet', { gameId, amount: d.amount });
          } catch (e) {
            console.log(`   ⚠️  ${bot.style.name}: decision error ${(e as Error).message}; folding`);
            bot.sock.emit('game:fold', { gameId });
          } finally {
            acting = false;
          }
        }, STEP_MS);
      }
    });
    bot.sock.emit('game:joinRoom', { gameId });
  }

  console.log(`   first hand starts in ${START_DELAY_MS / 1000}s — open the link now\n`);
  await new Promise((r) => setTimeout(r, START_DELAY_MS));
  startHand();
  await Promise.race([done, new Promise((_, bad) => setTimeout(() => bad(new Error('timeout')), 10 * 60_000))]);
  await Promise.all(verifications);
  console.log(`✅ ${hand} hands played by ${bots.length} bots. Table: ${WEB}/game/${gameId}`);
  const allOk = failed === 0 && verified === hand;
  console.log(`${allOk ? '🔐' : '🚨'} ${verified}/${hand} hands verified provably fair${failed ? ` (${failed} FAILED)` : ''}`);
  if (fingerprints[0]) console.log(`   first deckSeed this run: ${fingerprints[0]}`);
  if (brain) {
    const avg = llm.used ? Math.round(llm.latency / llm.used) : 0;
    console.log(`🧠 LLM: ${llm.calls} calls (budget ${MAX_LLM_CALLS}), ${llm.used} moves used, ${llm.verified} signature-verified, ${llm.fallbacks} fell back to rules, avg ${avg}ms`);
  }
  for (const b of bots) b.sock.close();
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => {
  console.error('BOTS FAIL', e);
  process.exit(1);
});
