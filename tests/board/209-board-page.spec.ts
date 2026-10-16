/**
 * Covers: REQ-BOARD-001, REQ-BOARD-002, REQ-BOARD-003, REQ-BOARD-004,
 * REQ-BOARD-005, REQ-BOARD-006, REQ-BOARD-007, REQ-BOARD-010, REQ-BOARD-011
 *
 * Ported from PowerScroll's tests/board/209-board-page.spec.ts to the standalone app.
 * Setup differences:
 * - the app opens on one empty board, so there is no "add board page" flow;
 * - REQ-BOARD-001/002 are about PowerScroll's canvas pages (canvas tools hidden on a
 *   board, ordinary pages keeping them). PowerBoard has no canvas pages, so the
 *   app-level equivalents are: the board renders at once without canvas controls, and
 *   `pb-new-board` creates another board;
 * - the stored board is read back through the E2E hook instead of the workspace store;
 * - save and reopen goes through a stubbed `showSaveFilePicker` and a temp file;
 * - `boardOps` runs in Node: the built app has no dev server to import modules from.
 */
import { expect, test, type Page } from '@playwright/test';
import { BoardOperationError, createBoard, createCard, moveCard, updateCard } from '../../src/core';
import {
  getBoard,
  openApp,
  openBoard,
  reopenFile,
  saveToFile,
  stubSaveFilePicker,
} from '../helpers';

async function addCard(
  page: Page,
  column: 'todo' | 'doing' | 'waiting' | 'done',
  title: string,
) {
  await page.getByTestId(`board-add-card-${column}`).click();
  await page.locator('.board-add-input').last().fill(title);
  await page.locator('.board-add-input').last().press('Enter');
}

test('REQ-BOARD-001/002 a new board opens immediately and the app renders no canvas controls', async ({ page }) => {
  await openApp(page);
  await expect(page.getByTestId('board-view')).toBeVisible();
  await expect(page.getByTestId('canvas-container')).toHaveCount(0);
  await expect(page.getByTestId('bottom-toolbar')).toHaveCount(0);
  await expect(page.getByTestId('zoom-bar')).toHaveCount(0);

  // The add control creates a board and opens it, again without canvas controls.
  await page.getByTestId('pb-new-board').click();
  const items = page.getByTestId(/^pb-board-item-/);
  await expect(items).toHaveCount(2);
  await expect(items.nth(1)).toHaveClass(/pb-board--active/);
  await expect(page.getByTestId('board-view')).toBeVisible();
  await expect(page.getByTestId('board-title')).toHaveText('New board');
  await expect(page.getByTestId('canvas-container')).toHaveCount(0);
  await expect(page.getByTestId('bottom-toolbar')).toHaveCount(0);
  await expect(page.getByTestId('zoom-bar')).toHaveCount(0);
});

test('REQ-BOARD-003/005 quick add works in every column and Escape cancels it', async ({ page }) => {
  await openBoard(page);

  for (const [column, title] of [
    ['todo', 'Plan'],
    ['doing', 'Build'],
    ['waiting', 'Ask'],
    ['done', 'Ship'],
  ] as const) {
    await addCard(page, column, title);
    await expect(page.getByTestId(`board-column-${column}`)).toContainText(title);
  }

  await page.getByTestId('board-add-card-todo').click();
  await page.locator('.board-add-input').last().fill('Discard this');
  await page.locator('.board-add-input').last().press('Escape');
  await expect(page.getByText('Discard this')).toHaveCount(0);
});

test('REQ-BOARD-006/011 pointer drag and keyboard movement update the stored column order', async ({ page }) => {
  await openBoard(page);
  await addCard(page, 'todo', 'First');
  await addCard(page, 'todo', 'Second');
  const first = page.getByTestId('board-card-1');
  const doing = page.getByTestId('board-column-doing');
  const firstBox = await first.boundingBox();
  const doingBox = await doing.boundingBox();
  if (!firstBox || !doingBox) throw new Error('board card layout missing');

  await first.dispatchEvent('pointerdown', {
    pointerId: 1,
    pointerType: 'mouse',
    clientX: firstBox.x + 8,
    clientY: firstBox.y + 8,
    bubbles: true,
  });
  await first.dispatchEvent('pointermove', {
    pointerId: 1,
    pointerType: 'pen',
    clientX: doingBox.x + 20,
    clientY: doingBox.y + 70,
    bubbles: true,
  });
  await doing.dispatchEvent('pointerup', {
    pointerId: 1,
    pointerType: 'pen',
    clientX: doingBox.x + 20,
    clientY: doingBox.y + 70,
    bubbles: true,
  });
  await expect(doing).toContainText('First');

  await page.getByTestId('board-card-2').focus();
  await page.keyboard.press('Alt+ArrowUp');
  const { cards } = await getBoard(page);
  expect(cards.find((card) => card.number === 1)?.column).toBe('doing');
  expect(cards.filter((card) => card.column === 'todo').map((card) => card.order)).toEqual([0]);

  // REQ-BOARD-011: edits are persisted (the file is marked unsaved), and the app
  // has no undo history for them to be added to.
  await expect(page.getByTestId('pb-dirty')).toBeVisible();
});

test('REQ-BOARD-004/006/007 waiting asks a question, the filter narrows cards, and keyboard movement works', async ({ page }) => {
  await openBoard(page);
  await addCard(page, 'doing', 'Review me');
  const card = page.getByTestId('board-card-1');
  await card.focus();
  await page.keyboard.press('Alt+ArrowRight');
  const question = page.getByRole('dialog', { name: 'Feedback question' });
  await expect(question).toBeVisible();
  await question.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('board-column-doing')).toContainText('Review me');

  await card.focus();
  await page.keyboard.press('Alt+ArrowRight');
  await question.locator('input').fill('Please approve the copy');
  await question.getByRole('button', { name: 'Move' }).click();
  await expect(page.getByTestId('board-column-waiting')).toContainText('Needs you');
  await expect(page.getByTestId('board-column-waiting')).toContainText('Please approve the copy');
  await page.getByTestId('board-filter-needs-me').click();
  await expect(page.getByTestId('board-column-waiting')).toContainText('Review me');
  await expect(page.getByTestId('board-column-doing')).not.toContainText('Review me');
});

test('REQ-BOARD-010 save and reopen keeps board cards, order, notes and checklist', async ({ page }, testInfo) => {
  await stubSaveFilePicker(page);
  await openBoard(page);
  await addCard(page, 'todo', 'Persisted');
  await page.getByTestId('board-card-1').click();
  const overlay = page.getByTestId('board-card-overlay');
  await overlay.getByLabel('Add checklist item').fill('One item');
  await overlay.getByLabel('Add checklist item').press('Enter');
  await overlay.getByLabel('Reply').fill('Saved note');
  await overlay.getByRole('button', { name: 'Reply', exact: true }).click();
  await overlay.getByLabel('Close card').click();

  const file = await saveToFile(page, testInfo, 'board-persist.html');
  await reopenFile(page, file);

  const board = await getBoard(page);
  expect(board.cards[0].title).toBe('Persisted');
  expect(board.cards[0].order).toBe(0);
  expect(board.cards[0].checklist[0].text).toBe('One item');
  expect(board.cards[0].notes[0].text).toBe('Saved note');
  await expect(page.getByTestId('board-card-1')).toContainText('Persisted');
});

test('REQ-BOARD-006/007 boardOps maintains numbering, ordering, questions and its 500-event cap', async () => {
  let board = createBoard();
  board = createCard(board, { title: 'One' }, 'you', 1);
  board = createCard(board, { title: 'Two' }, 'you', 2);
  const [one, two] = board.cards;
  board = moveCard(board, { cardId: two.id, to: 'doing', index: 0 }, 'you', 3);
  board = moveCard(board, { cardId: one.id, to: 'doing', index: 0 }, 'you', 4);
  const movedOut = moveCard(
    board,
    { cardId: one.id, to: 'waiting', index: 0, question: 'Approve?' },
    'you',
    5,
  );
  const cleared = moveCard(movedOut, { cardId: one.id, to: 'done', index: 0 }, 'you', 6);
  let capped = cleared;
  for (let index = 0; index < 510; index += 1) {
    capped = updateCard(capped, { cardId: one.id, title: `Title ${index}` }, 'you', 7 + index);
  }
  let error = '';
  try {
    moveCard(board, { cardId: two.id, to: 'waiting', index: 0 }, 'you', 8);
  } catch (caught) {
    error = (caught as BoardOperationError).code;
  }

  expect(board.cards.map((card) => card.number)).toEqual([1, 2]);
  expect(board.cards.filter((card) => card.column === 'doing').map((card) => card.order)).toEqual([0, 1]);
  expect(error).toBe('QUESTION_REQUIRED');
  expect(cleared.cards.find((card) => card.id === one.id)?.question).toBeUndefined();
  expect(capped.events.length).toBe(500);
});
