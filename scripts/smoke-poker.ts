/**
 * Two-player smoke test against a running server.
 * Usage: pnpm --filter server smoke
 */
import { io, type Socket } from 'socket.io-client';

const API = process.env.API_URL ?? 'http://localhost:4000';

type Jar = Map<string, string>;

function storeCookies(jar: Jar, res: Response) {
  const raw = res.headers.getSetCookie?.() ?? [];
  for (const line of raw) {
    const [pair] = line.split(';');
    const eq = pair!.indexOf('=');
    if (eq === -1) continue;
    jar.set(pair!.slice(0, eq).trim(), pair!.slice(eq + 1).trim());
  }
}

function cookieHeader(jar: Jar) {
  return Array.from(jar.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

async function api(jar: Jar, path: string, init?: RequestInit) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookieHeader(jar),
      ...(init?.headers ?? {}),
    },
  });
  storeCookies(jar, res);
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data;
}

function connectSocket(jar: Jar): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(API, {
      transports: ['websocket'],
      extraHeaders: { Cookie: cookieHeader(jar) },
    });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', (err) => reject(err));
  });
}

function waitForState(
  socket: Socket,
  pred: (s: Record<string, unknown>) => boolean,
  timeoutMs = 15000
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error('timeout waiting for state')),
      timeoutMs
    );
    const handler = (state: Record<string, unknown>) => {
      if (pred(state)) {
        clearTimeout(t);
        socket.off('game:state', handler);
        resolve(state);
      }
    };
    socket.on('game:state', handler);
  });
}

async function main() {
  const jarA: Jar = new Map();
  const jarB: Jar = new Map();

  await api(jarA, '/auth/nickname', {
    method: 'POST',
    body: JSON.stringify({ nickname: 'Alice' }),
  });
  await api(jarB, '/auth/nickname', {
    method: 'POST',
    body: JSON.stringify({ nickname: 'Bob' }),
  });

  await api(jarA, '/admin/login', {
    method: 'POST',
    body: JSON.stringify({
      password: process.env.ADMIN_PASSWORD ?? 'admin123',
    }),
  });

  const created = await api(jarA, '/games', {
    method: 'POST',
    body: JSON.stringify({ name: 'Smoke Table', minChips: 0 }),
  });
  const gameId = created.gameId as string;
  await api(jarA, `/games/${gameId}/join`, { method: 'POST', body: '{}' });
  await api(jarB, `/games/${gameId}/join`, { method: 'POST', body: '{}' });

  const sockA = await connectSocket(jarA);
  const sockB = await connectSocket(jarB);
  sockA.emit('game:joinRoom', { gameId });
  sockB.emit('game:joinRoom', { gameId });

  let pending = waitForState(sockA, (s) => s.status === 'shuffling');
  sockA.emit('game:start', { gameId });
  await pending;

  pending = waitForState(sockA, (s) => s.status === 'playing');
  sockA.emit('game:shuffle', { gameId });
  sockB.emit('game:shuffle', { gameId });
  let state = await pending;

  const order = ['Ante', 'PreFlop', 'Flop', 'Turn', 'River'] as const;
  for (const round of order) {
    if (state.round !== round) continue;
    pending = waitForState(sockA, (s) => s.round !== round);
    // Seat 0 then seat 1 — Alice created so she is seat 0
    sockA.emit('game:bet', { gameId, amount: 10 });
    await new Promise((r) => setTimeout(r, 150));
    sockB.emit('game:bet', { gameId, amount: 10 });
    state = await pending;
  }

  if (state.round !== 'End') {
    throw new Error(`Expected End, got ${String(state.round)}`);
  }

  const community = (state.communityCards as number[]).filter((c) => c >= 0);
  const pick: [number, number, number] = [
    community[0]!,
    community[1]!,
    community[2]!,
  ];

  sockA.emit('game:chooseCards', { gameId, cards: pick });
  sockB.emit('game:chooseCards', { gameId, cards: pick });
  await new Promise((r) => setTimeout(r, 200));

  pending = waitForState(sockA, (s) => s.gameEnded === true);
  sockA.emit('game:declareWinner', { gameId });
  state = await pending;

  console.log('SMOKE OK', {
    gameId,
    winner: state.winnerNickname,
    pot: state.pot,
    round: state.roundLabel,
  });

  sockA.close();
  sockB.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('SMOKE FAIL', err);
  process.exit(1);
});
