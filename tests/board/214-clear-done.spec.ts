/**
 * Covers: REQ-BOARD-026, REQ-AGENT-077, REQ-AGENT-078
 *
 * Ported from PowerScroll's tests/board/214-clear-done.spec.ts. The app opens on one
 * empty board. The save-and-reopen test saves through a stubbed `showSaveFilePicker`
 * and reopens the captured file as its own document. REQ-AGENT-077/078 are
 * PowerScroll's agent-protocol ids for `card_archive` / `include_archived`; PowerBoard
 * traces them to REQ-BOARD-026 and REQ-PB-103.
 */
import { expect, test } from '@playwright/test';
import {
  getBoard,
  openBoard,
  reopenFile,
  runBridge,
  runBridgeExpectingError,
  saveToFile,
  stubSaveFilePicker,
} from '../helpers';

test('REQ-BOARD-026 Clear done with confirm archives all done cards; cancel does nothing', async ({ page }) => {
  const boardId = await openBoard(page);
  await runBridge(page, 'card_create', { boardId, title: 'Ship A', actor: 'you', column: 'done' });
  await runBridge(page, 'card_create', { boardId, title: 'Ship B', actor: 'you', column: 'done' });
  await runBridge(page, 'card_create', { boardId, title: 'Still open', actor: 'you', column: 'todo' });

  await expect(page.getByTestId('board-column-done')).toContainText('Ship A');
  await expect(page.locator('.board-view__header p')).toHaveText('Board · 3 cards');
  await page.getByTestId('board-clear-done').click();
  const confirm = page.getByTestId('board-clear-done-confirm');
  await expect(confirm).toContainText('Archive 2 done cards?');
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toHaveCount(0);
  await expect(page.getByTestId('board-column-done')).toContainText('Ship A');
  await expect(page.locator('.board-view__header p')).toHaveText('Board · 3 cards');

  await page.getByTestId('board-clear-done').click();
  await page.getByTestId('board-clear-done-confirm').getByRole('button', { name: 'Archive' }).click();
  await expect(page.getByTestId('board-column-done')).not.toContainText('Ship A');
  await expect(page.getByTestId('board-column-done')).not.toContainText('Ship B');
  await expect(page.locator('.board-view__header p')).toHaveText('Board · 1 cards');
  await expect(page.getByTestId('board-view')).toContainText('You archived #1');
  await expect(page.getByTestId('board-view')).toContainText('You archived #2');
  await expect(page.getByTestId('board-archived-toggle')).toHaveText('Archived (2)');
});

test('REQ-BOARD-026 overlay Archive hides the card and Archived list can restore it', async ({ page }) => {
  const boardId = await openBoard(page);
  await runBridge(page, 'card_create', { boardId, title: 'Parked', actor: 'you', column: 'doing' });
  await page.getByTestId('board-card-1').click();
  await expect(page.getByTestId('board-card-overlay')).toBeVisible();
  await page.getByTestId('card-archive').click();
  await expect(page.getByTestId('board-card-overlay')).toHaveCount(0);
  await expect(page.getByTestId('board-card-1')).toHaveCount(0);
  await expect(page.locator('.board-view__header p')).toHaveText('Board · 0 cards');

  await page.getByTestId('board-archived-toggle').click();
  const list = page.getByTestId('board-archived-list');
  await expect(list).toContainText('#1');
  await expect(list).toContainText('Parked');
  await page.getByTestId('board-restore-1').click();
  await expect(page.getByTestId('board-card-1')).toBeVisible();
  await expect(page.getByTestId('board-column-doing')).toContainText('Parked');
  await expect(page.getByTestId('board-archived-list')).toHaveCount(0);
});

test('REQ-BOARD-026 board_read omits archived unless include_archived; moveCard throws ARCHIVED', async ({ page }) => {
  const boardId = await openBoard(page);
  await runBridge(page, 'card_create', { boardId, title: 'Keep', actor: 'you' });
  await runBridge(page, 'card_create', { boardId, title: 'Hide', actor: 'you' });
  await runBridge(page, 'card_archive', { boardId, card: 2, actor: 'you' });

  const live = await runBridge<{ cards: Array<{ number: number }> }>(page, 'board_read', { boardId });
  expect(live.cards.map((card) => card.number)).toEqual([1]);

  const all = await runBridge<{ cards: Array<{ number: number; archivedAt?: number }> }>(
    page,
    'board_read',
    { boardId, include_archived: true },
  );
  expect(all.cards.map((card) => card.number).sort()).toEqual([1, 2]);
  expect(all.cards.find((card) => card.number === 2)?.archivedAt).toBeTruthy();

  const got = await runBridge<{ card: { number: number; archivedAt?: number } }>(page, 'card_get', {
    boardId,
    card: 2,
  });
  expect(got.card.archivedAt).toBeTruthy();

  const err = await runBridgeExpectingError(page, 'card_move', {
    boardId,
    card: 2,
    to: 'done',
    actor: 'you',
  });
  expect(err.code).toBe('ARCHIVED');

  const updateErr = await runBridgeExpectingError(page, 'card_update', {
    boardId,
    card: 2,
    title: 'Nope',
    actor: 'you',
  });
  expect(updateErr.code).toBe('ARCHIVED');
});

test('REQ-BOARD-026 save and reopen keeps archived cards archived and restorable', async ({ page }, testInfo) => {
  await stubSaveFilePicker(page);
  const boardId = await openBoard(page);
  await runBridge(page, 'card_create', { boardId, title: 'Done deal', actor: 'you', column: 'done' });
  await runBridge(page, 'card_archive', { boardId, card: 1, actor: 'you' });

  const file = await saveToFile(page, testInfo, 'board-archive-persist.html');
  await reopenFile(page, file);

  const board = await getBoard(page);
  expect(board.cards[0].archivedAt).toBeTruthy();
  expect(board.cards[0].title).toBe('Done deal');

  await expect(page.getByTestId('board-card-1')).toHaveCount(0);
  await page.getByTestId('board-archived-toggle').click();
  await expect(page.getByTestId('board-archived-list')).toContainText('Done deal');
  await page.getByTestId('board-restore-1').click();
  await expect(page.getByTestId('board-column-done')).toContainText('Done deal');
});
