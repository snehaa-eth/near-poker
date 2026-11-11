/**
 * Six AI bots play No-Limit Hold'em against each other on the running game server.
 *
 * Usage (server must be running on :4000):
 *   pnpm --filter server bots            # 5 hands
 *   HANDS=10 pnpm --filter server bots
 *
 * Each bot is a normal player: its own session, its own socket, and it only sees its own
 * hole cards (the server hides everyone else's until showdown). Chips come from the
 * server's off-chain /treasury/deposit (no chain involved).
 */
import { io, type Socket } from 'socket.io-client';
import { cardFromId, evaluateBestHand, formatCard } from '@nli/poker-engine';

const API = process.env.API_URL ?? 'http://localhost:4000';
const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const HANDS = Number(process.env.HANDS ?? 5);
const STEP_MS = Number(process.env.STEP_MS ?? 1200);
const START_DELAY_MS = Number(process.env.START_DELAY_MS ?? 10000);

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
  stacksByPlayerId: Record<string, number>;
  nextPlayerId: string | null;
  winnerNickname: string | null;
  gameEnded: boolean;
  myPlayerId: string | null;
  isMyTurn: boolean;
};

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

async function main() {
  const admin: Jar = new Map();
  await api(admin, '/auth/nickname', { nickname: 'Dealer' });
  await api(admin, '/admin/login', { password: process.env.ADMIN_PASSWORD ?? 'admin123' });
  const game = await api(admin, '/games', { name: 'Bot Table (6 AIs)', minChips: 100, maxPlayers: 6 });
  const gameId = game.gameId as string;

  const bots: Bot[] = [];
  for (const style of BOTS) {
    const jar: Jar = new Map();
    const me = await api(jar, '/auth/nickname', { nickname: `${style.name}Bot` });
    await api(jar, '/treasury/deposit', { nightAmount: 1000 }); // off-chain demo chips
    await api(jar, `/games/${gameId}/join`, {});
    const sock = io(API, { transports: ['websocket'], extraHeaders: { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') } });
    await new Promise<void>((ok, bad) => { sock.on('connect', () => ok()); sock.on('connect_error', bad); });
    bots.push({ style, jar, sock, id: String((me as { sessionId?: string }).sessionId ?? '') });
  }

  console.log(`\n🃏 6 bots seated at table ${gameId.slice(0, 8)} (blinds 5/10, 1500 chips each)`);
  console.log(`   watch in the browser: ${WEB}/game/${gameId}\n`);

  let hand = 0;
  let lastRound = '';
  let acting = false;
  let lastPot = 0;
  let inHand = new Set<string>();
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
    console.log(`━━━━━━━━━━━━━━━━ HAND ${hand}/${HANDS} ━━━━━━━━━━━━━━━━`);
    bots[0]!.sock.emit('game:start', { gameId });
  };

  for (const bot of bots) {
    bot.sock.on('game:error', ({ error }) => {
      if (!/NotYourTurn|NoHandActive/.test(error)) console.log(`   ⚠️  ${bot.style.name}: ${error}`);
    });
    bot.sock.on('game:state', (v: View) => {
      const me = v.players.find((p) => p.id === v.myPlayerId);
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
      if (v.isMyTurn && v.status === 'playing' && !acting) {
        acting = true;
        setTimeout(() => {
          const d = decide(bot.style, v);
          const hole = show(me!.holeCards);
          const label = d.kind === 'raise' ? `raises to ${d.amount}` : d.kind === 'call' ? `calls ${Math.max(0, v.highestBet - me!.chipsInPot)}` : d.kind === 'check' ? 'checks' : 'folds';
          inHand.add(me!.id);
          console.log(`  ${bot.style.emoji} ${bot.style.name.padEnd(7)} [${hole}]  ${label.padEnd(16)} (${d.say})`);
          if (d.kind === 'fold') bot.sock.emit('game:fold', { gameId });
          else bot.sock.emit('game:bet', { gameId, amount: d.amount });
          acting = false;
        }, STEP_MS);
      }
    });
    bot.sock.emit('game:joinRoom', { gameId });
  }

  console.log(`   first hand starts in ${START_DELAY_MS / 1000}s — open the link now\n`);
  await new Promise((r) => setTimeout(r, START_DELAY_MS));
  startHand();
  await Promise.race([done, new Promise((_, bad) => setTimeout(() => bad(new Error('timeout')), 10 * 60_000))]);
  console.log(`✅ ${hand} hands played by 6 bots. Table: ${WEB}/game/${gameId}`);
  for (const b of bots) b.sock.close();
  process.exit(0);
}

main().catch((e) => {
  console.error('BOTS FAIL', e);
  process.exit(1);
});
