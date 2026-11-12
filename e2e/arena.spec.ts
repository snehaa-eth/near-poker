/**
 * Full arena flow in a real browser, free and offline: three real agent-starter agents play
 * against the mock NEAR AI Cloud (every move carries a mock-TEE receipt the server verifies),
 * a spectator watches, verifies a hand and checks the leaderboard, then the agents quit.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { API, ROOT, STATE_FILE, type StackState, fundAgent, interruptAgent, killGroup, makeAgents, startAgent } from './stack';

const SHOTS = join(ROOT, 'e2e', 'screenshots');
const NICKS = ['Ada', 'Grace', 'Linus'];
const agents = makeAgents(NICKS);

const shot = (page: Page, name: string) => page.screenshot({ path: join(SHOTS, `${name}.png`) });

test.describe.configure({ mode: 'serial' });

// A first-time visitor gets the risk disclaimer; accept it up front like a returning viewer.
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    try {
      localStorage.setItem('dark-table-risk-accepted', '1');
    } catch {
      /* ignore */
    }
  });
});

test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true });
  const { mockUrl } = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as StackState;
  for (const a of agents) await fundAgent(a);
  for (const a of agents) startAgent(a, mockUrl);
});

test.afterAll(async () => {
  await Promise.all(agents.map((a) => killGroup(a.child?.pid, 3000)));
});

test('beginner hints render on a (mock) arena table', async ({ page }) => {
  await page.goto('/game/demo?mock=1');
  await expect(page.getByText('Flop · 3 shared cards')).toBeVisible();
  await page.getByRole('button', { name: 'How to watch' }).click();
  await expect(page.getByText('🔒 TEE = the model really decided.')).toBeVisible();
  await expect(page.getByText('✅ Verify hand = nobody rigged the deck.')).toBeVisible();
  await expect(page.getByText('How a hand ends.')).toBeVisible();
  await shot(page, '00-how-to-watch');
});

test('watch three TEE agents, verify a hand, see the leaderboard, table closes', async ({ page }) => {
  // 1. Arena lobby shows a live table with all three agents.
  await page.goto('/arena');
  // Lobby rows list the seated agents; the row's /game/ link opens the table.
  const card = page
    .locator('tr')
    .filter({ hasText: NICKS[0]! })
    .filter({ hasText: NICKS[1]! })
    .filter({ hasText: NICKS[2]! })
    .locator('a[href^="/game/"]')
    .first();
  await expect(card).toBeVisible({ timeout: 60_000 });
  await shot(page, '01-arena-lobby');
  const tableHref = (await card.getAttribute('href'))!;
  await card.click();
  await expect(page).toHaveURL(new RegExp(tableHref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  // 2. Three seats, each with a 🔒 TEE chip (appears once the agent has a verified move).
  const tee = page.getByRole('button', { name: 'TEE agent details' });
  await expect(tee).toHaveCount(3, { timeout: 45_000 });
  for (const t of await tee.all()) await expect(t).toContainText('🔒 TEE');
  for (const n of NICKS) await expect(page.getByText(n, { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'How to watch' })).toBeVisible();
  await shot(page, '02-table-live');

  // 3. A hand ends: plain-English end state, winner seat, "Next hand starting…", Verify link.
  await expect(page.getByText(/^Hand over · (won before the flop|everyone else folded|showdown)$/)).toBeVisible({
    timeout: 45_000,
  });
  const verify = page.getByRole('link', { name: /Verify hand/ });
  await expect(verify).toBeVisible();
  const verifyHref = (await verify.getAttribute('href'))!;
  expect(verifyHref).toMatch(/^\/verify\//);
  await expect(page.getByText('Next hand starting…').first()).toBeVisible();
  // The mock model always checks/calls, so hands reach showdown and the winner's hand is named.
  await expect(page.getByText(/^🏆 Winner · .+/).first()).toBeVisible();
  await shot(page, '03-hand-over');

  // 4. Verify page: every fairness check passes, and the agent moves carry TEE receipts.
  await page.goto(verifyHref);
  await expect(page.getByText('Every check passed', { exact: false })).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText('⏳')).toHaveCount(0);
  await expect(page.getByText('❌')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /Agent moves/ })).toBeVisible({ timeout: 30_000 });
  const moves = page.locator('section', { has: page.getByRole('heading', { name: /Agent moves/ }) }).locator('tbody tr');
  expect(await moves.count()).toBeGreaterThanOrEqual(1);
  const receipts = page.locator('a[href^="https://cloud.near.ai/verify?model="]');
  expect(await receipts.count()).toBeGreaterThanOrEqual(1);
  await shot(page, '04-verify-hand');

  // 5. Leaderboard lists the three agents.
  await page.goto('/leaderboard');
  for (const n of NICKS) await expect(page.getByText(n, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await shot(page, '05-leaderboard');

  // 6. Agents quit (Ctrl-C → /arena/leave after the hand) → the table says it's finished.
  await page.goto(tableHref);
  await expect(tee.first()).toBeVisible({ timeout: 30_000 });
  for (const a of agents) interruptAgent(a);
  await expect(page.getByText('Table finished — all agents left.')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/^[1-9]\d* hands? played\.$/)).toBeVisible({ timeout: 15_000 });
  const last = page.getByRole('link', { name: /Verify last hand/ });
  await expect(last).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to arena' })).toBeVisible();
  await shot(page, '06-table-finished');

  // The arena is empty again on the server.
  const tables = (await (await fetch(`${API}/arena/tables`)).json()) as { tables: unknown[] };
  expect(tables.tables).toHaveLength(0);
});
