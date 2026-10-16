/**
 * Covers: REQ-BOARD-018, REQ-BOARD-019, REQ-BOARD-020, REQ-BOARD-021, REQ-BOARD-023
 *
 * Ported from PowerScroll's tests/board/212-live-board.spec.ts. The app opens on one
 * empty board; bridge commands and `agents` frames reach it through the E2E hook.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  getPresenceStore,
  openBoard,
  runBridge,
  sendServerFrame,
  setPresenceNow,
} from '../helpers';

const PALETTE = ['#2563eb', '#0f766e', '#7c3aed', '#c2410c', '#0e7490', '#a21caf', '#4d7c0f'];

function avatarColor(name: string): string {
  const hash = Array.from(name).reduce((total, character) => total + character.charCodeAt(0), 0);
  return PALETTE[hash % PALETTE.length];
}

async function openBoardWithCard(page: Page) {
  const boardId = await openBoard(page);
  await runBridge(page, 'card_create', {
    boardId,
    title: 'Live ticket',
    actor: 'feature-1',
  });
  return boardId;
}

test('REQ-BOARD-018/020/021/023 agents frame, active highlight, reduced motion, flash and needs-me badge', async ({ page }) => {
  const boardId = await openBoardWithCard(page);
  const color = avatarColor('feature-1');

  await sendServerFrame(page, {
    v: 1,
    type: 'agents',
    agents: [{ label: 'feature-1', role: 'peer', connectedAt: Date.now() }],
  });
  expect((await getPresenceStore(page)).connected.map((agent) => agent.label)).toEqual(['feature-1']);
  await expect(page.getByTestId('board-agent-feature-1')).toBeVisible();
  await expect(page.getByTestId('board-activity-live')).toBeVisible();

  await runBridge(page, 'card_claim', { boardId, card: 1, actor: 'feature-1' });
  const card = page.getByTestId('board-card-1');
  await expect(card).toHaveAttribute('data-active', 'true');
  await expect(card).toContainText('working now');
  await expect(page.getByTestId('board-agent-feature-1')).toHaveAttribute('data-active', 'true');

  const ring = await card.evaluate((element) => getComputedStyle(element).getPropertyValue('--agent-color').trim());
  expect(ring.toLowerCase()).toBe(color.toLowerCase());

  await expect(page.getByTestId('board-filter-needs-me')).not.toContainText('1');
  await expect(card).not.toHaveClass(/board-card--flash/, { timeout: 2500 });

  await runBridge(page, 'card_move', {
    boardId,
    card: 1,
    to: 'waiting',
    question: 'Need a look',
    actor: 'feature-1',
  });
  await expect(page.getByTestId('board-needs-me-count')).toHaveText('1');
  await expect(card).toHaveClass(/board-card--flash/);
  await expect(card).not.toHaveClass(/board-card--flash/, { timeout: 2500 });

  await runBridge(page, 'card_note', {
    boardId,
    card: 1,
    text: 'owner comment',
    actor: 'you',
  });
  await page.waitForTimeout(250);
  await expect(card).not.toHaveClass(/board-card--flash/);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  const animation = await card.evaluate((element) => getComputedStyle(element).animationName);
  expect(animation === 'none' || animation === '').toBeTruthy();

  const { actors } = await getPresenceStore(page);
  await setPresenceNow(page, actors['feature-1'].lastActionAt + 61_000);
  await expect(card).toHaveAttribute('data-active', 'false');
  await expect(card).not.toContainText('working now');
});

test('REQ-BOARD-020 a card lights up for the me name even when the process label differs, and goes dark when every agent leaves', async ({ page }) => {
  const boardId = await openBoardWithCard(page);
  // The MCP process is called agent-1a2b3c4d; the agent works as feature-2.
  await sendServerFrame(page, {
    v: 1,
    type: 'agents',
    agents: [{ label: 'agent-1a2b3c4d', role: 'hub', connectedAt: Date.now() }],
  });
  await runBridge(page, 'card_claim', { boardId, card: 1, actor: 'feature-2' });
  const card = page.getByTestId('board-card-1');
  await expect(card).toHaveAttribute('data-active', 'true');
  await expect(page.getByTestId('board-agent-feature-2')).toHaveAttribute('data-active', 'true');

  await sendServerFrame(page, { v: 1, type: 'agents', agents: [] });
  await expect(card).toHaveAttribute('data-active', 'false');
});

test("REQ-BOARD-020/021 the owner's own edits never light a card", async ({ page }) => {
  const boardId = await openBoardWithCard(page);
  await runBridge(page, 'card_claim', { boardId, card: 1, actor: 'you' });
  await runBridge(page, 'card_move', { boardId, card: 1, to: 'doing', actor: 'you' });
  const card = page.getByTestId('board-card-1');
  await expect(card).toHaveAttribute('data-active', 'false');
  await expect(card).not.toContainText('working now');
});
