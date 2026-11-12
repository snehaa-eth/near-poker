/**
 * Arena ↔ socket.io glue: who is connected as which session, emit helpers, a broadcast
 * hook (socket.ts broadcastGame) and a per-key serial queue.
 */
import type { Server } from 'socket.io';

type Broadcast = (gameId: string) => Promise<void>;

let io: Server | null = null;
let broadcastFn: Broadcast = async () => {};

export function setArenaRuntime(server: Server | null, broadcast?: Broadcast) {
  io = server;
  broadcastFn = broadcast ?? (async () => {});
}

export async function broadcast(gameId: string) {
  try {
    await broadcastFn(gameId);
  } catch (e) {
    console.error('[arena] broadcast failed', e);
  }
}

/** Emit to every socket authenticated as `sessionId` (socket.data.sessionId). */
export function emitTo(sessionId: string, event: string, payload: unknown): number {
  if (!io) return 0;
  let n = 0;
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.sessionId === sessionId) {
      (socket.emit as (ev: string, p: unknown) => boolean)(event, payload);
      n += 1;
    }
  }
  return n;
}

/** True when at least one socket is authenticated as `sessionId`. */
export function isConnected(sessionId: string): boolean {
  if (!io) return false;
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.sessionId === sessionId) return true;
  }
  return false;
}

const queues = new Map<string, Promise<unknown>>();

/** Run `fn` after every earlier task with the same key (errors don't break the chain). */
export function serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(key) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(fn);
  const tail = run.catch(() => undefined);
  queues.set(key, tail);
  void tail.then(() => {
    if (queues.get(key) === tail) queues.delete(key);
  });
  return run;
}

export function errMsg(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}
