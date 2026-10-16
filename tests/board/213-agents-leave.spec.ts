/**
 * Covers: REQ-BOARD-024, REQ-BOARD-025, REQ-AGENT-076
 *
 * Ported from PowerScroll's tests/board/213-agents-leave.spec.ts. The app opens on one
 * empty board; bridge commands and `agents` frames reach it through the E2E hook.
 * REQ-AGENT-076 is PowerScroll's agent-protocol id for `agent_leave`; PowerBoard
 * traces it to REQ-BOARD-025 and REQ-PB-103.
 */
import { expect, test } from '@playwright/test';
import { getPresenceStore, openBoard, runBridge, sendServerFrame, setPresenceNow } from '../helpers';

test('REQ-BOARD-024 a connected-but-silent label gets no chip; acting creates one', async ({ page }) => {
  const boardId = await openBoard(page);
  await sendServerFrame(page, {
    v: 1,
    type: 'agents',
    agents: [{ label: 'silent-bot', role: 'peer', connectedAt: Date.now() }],
  });
  await expect(page.getByTestId('board-agent-silent-bot')).toHaveCount(0);
  await expect(page.getByTestId('board-agents')).toHaveCount(0);

  await runBridge(page, 'card_create', {
    boardId,
    title: 'Live ticket',
    actor: 'feature-1',
  });
  await expect(page.getByTestId('board-agent-feature-1')).toBeVisible();
  await expect(page.getByTestId('board-agent-silent-bot')).toHaveCount(0);
});

test('REQ-BOARD-025 agent_leave removes the chip and its card active state; acting again restores it', async ({ page }) => {
  const boardId = await openBoard(page);
  await runBridge(page, 'card_create', {
    boardId,
    title: 'Live ticket',
    actor: 'feature-1',
  });
  await runBridge(page, 'card_claim', { boardId, card: 1, actor: 'feature-1' });
  const card = page.getByTestId('board-card-1');
  await expect(page.getByTestId('board-agent-feature-1')).toBeVisible();
  await expect(card).toHaveAttribute('data-active', 'true');

  await runBridge(page, 'agent_leave', {
    me: 'feature-1',
    boardId,
    note: 'wrapping up',
  });
  await expect(page.getByTestId('board-agent-feature-1')).toHaveCount(0);
  await expect(card).toHaveAttribute('data-active', 'false');
  await expect(page.getByTestId('board-view')).toContainText('feature-1 left');

  await runBridge(page, 'card_note', {
    boardId,
    card: 1,
    text: 'back on it',
    actor: 'feature-1',
  });
  await expect(page.getByTestId('board-agent-feature-1')).toBeVisible();
  await expect(card).toHaveAttribute('data-active', 'true');
});

test('REQ-BOARD-025 a frame without the label marks it left', async ({ page }) => {
  const boardId = await openBoard(page);
  await runBridge(page, 'card_create', {
    boardId,
    title: 'Live ticket',
    actor: 'feature-1',
  });
  await runBridge(page, 'card_claim', { boardId, card: 1, actor: 'feature-1' });
  await sendServerFrame(page, {
    v: 1,
    type: 'agents',
    agents: [
      { label: 'feature-1', role: 'peer', connectedAt: Date.now() },
      { label: 'other-bot', role: 'peer', connectedAt: Date.now() },
    ],
  });
  const card = page.getByTestId('board-card-1');
  await expect(page.getByTestId('board-agent-feature-1')).toBeVisible();
  await expect(card).toHaveAttribute('data-active', 'true');

  await sendServerFrame(page, {
    v: 1,
    type: 'agents',
    agents: [{ label: 'other-bot', role: 'peer', connectedAt: Date.now() }],
  });
  await expect(page.getByTestId('board-agent-feature-1')).toHaveCount(0);
  await expect(card).toHaveAttribute('data-active', 'false');
});

test('REQ-BOARD-025 dismiss × removes the chip', async ({ page }) => {
  const boardId = await openBoard(page);
  await runBridge(page, 'card_create', {
    boardId,
    title: 'Live ticket',
    actor: 'feature-1',
  });
  await runBridge(page, 'card_claim', { boardId, card: 1, actor: 'feature-1' });
  await expect(page.getByTestId('board-agent-feature-1')).toBeVisible();
  await expect(page.getByTestId('board-card-1')).toHaveAttribute('data-active', 'true');

  await page.getByTestId('board-agent-dismiss-feature-1').click();
  await expect(page.getByTestId('board-agent-feature-1')).toHaveCount(0);
  await expect(page.getByTestId('board-card-1')).toHaveAttribute('data-active', 'false');
});

test('REQ-BOARD-025 silence over 30 minutes hides the chip', async ({ page }) => {
  const boardId = await openBoard(page);
  await runBridge(page, 'card_create', {
    boardId,
    title: 'Live ticket',
    actor: 'feature-1',
  });
  await expect(page.getByTestId('board-agent-feature-1')).toBeVisible();

  const { actors } = await getPresenceStore(page);
  await setPresenceNow(page, actors['feature-1'].lastActionAt + 30 * 60_000 + 1);
  await expect(page.getByTestId('board-agent-feature-1')).toHaveCount(0);
});
