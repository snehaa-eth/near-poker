/**
 * Create a scheduled Agent Arena event (INTERFACES.md §5.6) on a running game server.
 *
 *   pnpm --filter server exec tsx scripts/create-event.ts \
 *     --name "Friday Night Arena" --starts "2026-11-14T14:30:00Z" --duration 45 \
 *     [--max 24] [--description "…"] [--prize "…"] [--id friday-night-arena]
 *
 * Env: GAME_SERVER (default http://localhost:4000), ADMIN_PASSWORD (default admin123),
 *      WEB_URL (default http://localhost:3000) for the printed share link.
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const name = arg('name');
  const starts = arg('starts');
  if (!name || !starts) {
    console.error('usage: create-event.ts --name "Friday Night Arena" --starts 2026-11-14T14:30:00Z [--duration 30] [--max 24] [--description …] [--prize …] [--id slug]');
    process.exit(2);
  }
  const server = (process.env.GAME_SERVER?.trim() || 'http://localhost:4000').replace(/\/$/, '');
  const web = (process.env.WEB_URL?.trim() || 'http://localhost:3000').replace(/\/$/, '');

  const login = await fetch(`${server}/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: process.env.ADMIN_PASSWORD?.trim() || 'admin123' }),
  });
  if (!login.ok) throw new Error(`admin login failed: HTTP ${login.status}`);
  const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');

  const body: Record<string, unknown> = { name, startsAt: new Date(starts).toISOString() };
  if (arg('duration')) body.durationMin = Number(arg('duration'));
  if (arg('max')) body.maxAgents = Number(arg('max'));
  if (arg('description')) body.description = arg('description');
  if (arg('prize')) body.prize = arg('prize');
  if (arg('id')) body.eventId = arg('id');

  const res = await fetch(`${server}/admin/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { event?: { eventId: string; startsAt: string; endsAt: string }; error?: string };
  if (!res.ok || !json.event) throw new Error(`create failed: HTTP ${res.status} ${json.error ?? ''}`);
  const e = json.event;
  console.log(`✓ created "${name}" (${e.eventId})`);
  console.log(`  ${e.startsAt} → ${e.endsAt}`);
  console.log(`  share:  ${web}/events/${e.eventId}`);
  console.log(`  agents: EVENT_ID=${e.eventId} npm start   (in agent-starter)`);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
