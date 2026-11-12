/**
 * Records raw 1920x1080 footage of the product for the launch teaser (not a test of behaviour).
 * Free and offline except scene 6, which opens NEAR AI's public Verification Center for a real
 * receipt from the live testnet run. Run: CAPTURE=1 pnpm exec playwright test e2e/capture.spec.ts
 */
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, type Page } from '@playwright/test';
import { ROOT, STATE_FILE, type StackState, fundAgent, interruptAgent, killGroup, makeAgents, startAgent } from './stack';

const OUT = join(ROOT, 'e2e', 'footage');
const NICKS = ['Ada', 'Grace', 'Linus', 'Turing', 'Hopper'];
const agents = makeAgents(NICKS);

// A real receipt from the live NEAR AI run on testnet (hand 759c63ae, RockBot, Qwen in TEE).
const REAL_RECEIPT_URL =
  'https://cloud.near.ai/verify?model=Qwen%2FQwen3.6-35B-A3B-FP8#receipt=eyJjb21wbGV0aW9uSWQiOiI5NzQxNWVkZWI3NmI0Y2M3YTE3MjAzZDk0MTQwYjU1MiIsIm1vZGVsIjoiUXdlbi9Rd2VuMy42LTM1Qi1BM0ItRlA4Iiwic2lnbmF0dXJlS2luZCI6InByb3ZpZGVyX3RlZSIsInNpZ25pbmdBbGdvIjoiZWQyNTUxOSIsInNpZ25pbmdBZGRyZXNzIjoiODlmYjc4MWE5NTMwNDczYTZkM2JkZGQ2YmIwYTA1MzZjOGQxNTUwNTg3OThlZGFlODhiMTkxNTNiZDhmNDM1MCIsInNpZ25lZFRleHQiOiJRd2VuL1F3ZW4zLjYtMzVCLUEzQi1GUDg6OTRiYzNkNmQxM2I5NGY1MTNjNTU5MTRhNDE1YWJmMjUzMTBiYzk3YjliMWE5ZDNmMzk3NWE5NmJkNzdjMWZmMTpjODNmNTdlMzJmZDUyOTQzMWFlNGJhMGY5YTRjOWVmZTQyYmNiN2EzZDY4OTExZWVjNTEzODk3NmE2Y2JlNThjIiwic2lnbmF0dXJlIjoiNGFmYjU4YzYwMWUyYjA5MWI1NDEwMGRlZDg5NzE0M2YyMmI0Mjk3YzJhMTFkZDU3Yjg5ZmU2M2E4NmExYWUwOGQxYTk3YTAzOGYwZDk4ZTU5NDBjNjlmMDgyMGMwOGY1MGZhYTY0ODNhN2VmOGM2ZGIzNGViYmNkM2MzYzY4MDkiLCJ2ZXJpZmllZEF0IjoiMjAyNi0xMS0xMVQxODozMTo0OS4wMjFaIn0';

test.skip(!process.env.CAPTURE, 'footage capture only runs with CAPTURE=1');
test.describe.configure({ mode: 'serial' });
test.use({ viewport: { width: 1920, height: 1080 }, video: { mode: 'on', size: { width: 1920, height: 1080 } } });

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    try {
      localStorage.setItem('dark-table-risk-accepted', '1');
    } catch {
      /* ignore */
    }
  });
});

let gameId = '';
let handId = '';

test.beforeAll(async () => {
  mkdirSync(OUT, { recursive: true });
  const { mockUrl } = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as StackState;
  for (const a of agents) await fundAgent(a);
  for (const a of agents) startAgent(a, mockUrl);
});

test.afterAll(async () => {
  for (const a of agents) interruptAgent(a);
  await Promise.all(agents.map((a) => killGroup(a.child?.pid, 3000)));
});

async function save(page: Page, name: string) {
  const v = page.video();
  await page.close();
  if (v) copyFileSync(await v.path(), join(OUT, `${name}.webm`));
}

test('01 arena lobby', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/arena');
  const watch = page.getByRole('link', { name: /watch/i }).first();
  await watch.waitFor({ timeout: 90_000 });
  await page.waitForTimeout(2500);
  const href = (await watch.getAttribute('href')) ?? '';
  gameId = href.split('/').pop() ?? '';
  await page.mouse.move(700, 600, { steps: 20 });
  await page.waitForTimeout(1500);
  await save(page, '01-arena');
});

test('02 live table', async ({ page, request }) => {
  test.setTimeout(120_000);
  await page.goto(`/game/${gameId}`);
  await page.waitForTimeout(22_000); // a few hands: deals, bets, winners
  const hands = (await (await request.get(`http://localhost:4310/games/${gameId}/hands`)).json()) as
    | { hands: Array<{ handId: string } | string> }
    | Array<{ handId: string } | string>;
  const list = Array.isArray(hands) ? hands : hands.hands;
  const first = list[0]!;
  handId = typeof first === 'string' ? first : first.handId;
  // open the TEE badge popover on a seat
  const badge = page.getByText(/TEE/).first();
  await badge.hover({ timeout: 5000 }).catch(() => {});
  await badge.click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(3500);
  await save(page, '02-table');
});

test('03 verify hand', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto(`/verify/${encodeURIComponent(handId)}`);
  await page.waitForTimeout(3000);
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, 260);
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(1500);
  await save(page, '03-verify');
});

test('04 leaderboard', async ({ page }) => {
  await page.goto('/leaderboard');
  await page.waitForTimeout(4000);
  await save(page, '04-leaderboard');
});

test('05 NEAR AI verification center (real receipt)', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(REAL_RECEIPT_URL);
  await page.getByText('Verified', { exact: true }).first().waitFor({ timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(3000);
  await page.mouse.wheel(0, 500);
  await page.waitForTimeout(2500);
  await save(page, '05-nearai');
});
