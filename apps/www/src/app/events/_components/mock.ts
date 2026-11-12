/** Mock events for `/events?mock=1` and `/events/<id>?mock=scheduled|live|ended` (UI previews). */
import type { ArenaEventDetail, ArenaEventSummary } from '~/lib/api';

const MODEL = 'Qwen/Qwen3.6-35B-A3B-FP8';
const agents = [
  ['nightowl.testnet', 'NightOwl', MODEL],
  ['tightaggro.testnet', 'TightAggro', MODEL],
  ['bluff-bot.testnet', 'BluffBot', 'deepseek-ai/DeepSeek-V3.1'],
  ['gto-ish.testnet', 'GTO-ish', MODEL],
  ['calling-station.testnet', 'CallingStation', 'zai-org/GLM-4.6'],
  ['river-rat.testnet', 'RiverRat', MODEL],
  ['the-nit.testnet', 'TheNit', 'deepseek-ai/DeepSeek-V3.1'],
] as const;

export type MockState = 'scheduled' | 'live' | 'ended';

export function mockEventSummaries(): ArenaEventSummary[] {
  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();
  return [
    { eventId: 'friday-night-arena', name: 'Friday Night Arena', description: 'Six-max agents, 45 minutes, TEE moves only.', prize: '50 NEAR to the top agent', startsAt: iso(now - 20 * 60_000), endsAt: iso(now + 25 * 60_000), durationMin: 45, maxAgents: 24, status: 'live', registered: 7, startedAt: iso(now - 20 * 60_000), endedAt: null },
    { eventId: 'hackathon-showdown', name: 'NEAR Hackathon Showdown', description: 'Bring your agent before judging.', prize: null, startsAt: iso(now + 26 * 3600_000 + 14 * 60_000), endsAt: iso(now + 26.5 * 3600_000), durationMin: 30, maxAgents: 24, status: 'scheduled', registered: 4, startedAt: null, endedAt: null },
    { eventId: 'midnight-micro', name: 'Midnight Micro Stakes', description: '', prize: null, startsAt: iso(now + 3 * 86400_000), endsAt: iso(now + 3 * 86400_000 + 30 * 60_000), durationMin: 30, maxAgents: 12, status: 'scheduled', registered: 0, startedAt: null, endedAt: null },
    { eventId: 'opening-night', name: 'Opening Night', description: '', prize: '20 NEAR', startsAt: iso(now - 2 * 86400_000), endsAt: iso(now - 2 * 86400_000 + 30 * 60_000), durationMin: 30, maxAgents: 24, status: 'ended', registered: 9, startedAt: iso(now - 2 * 86400_000), endedAt: iso(now - 2 * 86400_000 + 30 * 60_000) },
  ];
}

export function mockEventDetail(eventId: string, state: MockState): ArenaEventDetail {
  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();
  const start = state === 'scheduled' ? now + 26 * 3600_000 + 14 * 60_000 + 9_000 : state === 'live' ? now - 20 * 60_000 : now - 3 * 3600_000;
  const registrations = agents.map(([walletAddress, nickname, model], i) => ({
    walletAddress,
    nickname,
    model,
    registeredAt: iso(now - (10 - i) * 3600_000),
  }));
  const nets = [412, 268, 95, -40, -151, -230, -354];
  const leaderboard =
    state === 'scheduled'
      ? []
      : agents.map(([walletAddress, nickname, model], i) => ({
          rank: i + 1,
          walletAddress,
          nickname,
          model,
          hands: 38 - i * 2,
          netChips: nets[i]!,
          movesVerified: 160 - i * 9,
        }));
  const seat = (i: number, s: number) => ({ seat: s, playerId: `p${i}`, nickname: agents[i]![1], walletAddress: agents[i]![0], model: agents[i]![2], chips: 1000 + nets[i]! });
  return {
    eventId,
    name: eventId === 'friday-night-arena' || eventId.startsWith('mock') ? 'Friday Night Arena' : eventId.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    description:
      'Six-max No-Limit Hold\'em for AI agents. Every move is produced by a NEAR AI Cloud confidential-TEE model and every deck is committed on NEAR before the deal. 45 minutes, highest net chips wins.',
    prize: '50 NEAR to the top agent',
    startsAt: iso(start),
    endsAt: iso(start + 45 * 60_000),
    durationMin: 45,
    maxAgents: 24,
    status: state,
    registered: registrations.length,
    startedAt: state === 'scheduled' ? null : iso(start),
    endedAt: state === 'ended' ? iso(start + 45 * 60_000) : null,
    registrations,
    gameIds: state === 'scheduled' ? [] : ['mock-ev-1', 'mock-ev-2'],
    tables:
      state === 'live'
        ? [
            { gameId: 'mock-ev-1', name: 'Friday Night Arena #1', seats: [seat(0, 0), seat(2, 1), seat(4, 2), seat(6, 3)], handsPlayed: 21, status: 'playing', eventId, freeSeats: 1, waiting: [{ nickname: 'LateRegistrant', model: MODEL }] },
            { gameId: 'mock-ev-2', name: 'Friday Night Arena #2', seats: [seat(1, 0), seat(3, 1), seat(5, 2)], handsPlayed: 19, status: 'between-hands', eventId, freeSeats: 3, waiting: [] },
          ]
        : [],
    leaderboard,
    final: state === 'ended',
  };
}
