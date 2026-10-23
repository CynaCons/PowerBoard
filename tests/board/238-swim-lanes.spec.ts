/**
 * Covers: REQ-PB-141 (PowerScroll REQ-BOARD-043, REQ-BOARD-044, REQ-BOARD-045)
 *
 * Owner request 2026-10-23: swim lanes by label; a card with several labels
 * shows in each of their lanes; lanes are always on. Ported from PowerScroll's
 * tests/board/238-swim-lanes.spec.ts.
 */
import { expect, test, type Page } from '@playwright/test';
import { getBoard, openBoard, runBridge } from '../helpers';

const create = (page: Page, boardId: string, title: string, labels: string[], column = 'todo') =>
  runBridge(page, 'card_create', { boardId, title, labels, column, actor: 'planner' });

const lane = (page: Page, column: string, key: string) =>
  page.getByTestId(`board-column-${column}`).locator(`[data-board-lane="${key}"]`);

test('a board without labels has no lanes', async ({ page }) => {
  const boardId = await openBoard(page);
  await create(page, boardId, 'Plain', []);
  await expect(page.getByTestId('board-lane-title')).toHaveCount(0);
  await expect(page.getByTestId('board-column-todo')).toContainText('Plain');
});

test('cards sit in one lane per label, rows aligned; lanes collapse', async ({ page }) => {
  const boardId = await openBoard(page);
  await create(page, boardId, 'Parser', ['engine']);
  await create(page, boardId, 'Screens', ['ui'], 'doing');
  await create(page, boardId, 'Shared model', ['engine', 'ui']);
  await create(page, boardId, 'Loose', []);

  await expect(page.getByTestId('board-lane-title')).toHaveText([/engine/, /ui/, /No label/]);
  await expect(lane(page, 'todo', 'engine').locator('.board-card__title')).toHaveText(['Parser', 'Shared model']);
  await expect(lane(page, 'todo', 'ui').locator('.board-card__title')).toHaveText(['Shared model']);
  await expect(page.getByTestId('board-column-todo').locator('.board-column__count')).toHaveText('3');
  const todoUi = (await lane(page, 'todo', 'ui').boundingBox())!;
  const doneUi = (await lane(page, 'done', 'ui').boundingBox())!;
  expect(Math.abs(todoUi.y - doneUi.y)).toBeLessThan(2);

  await page.getByRole('button', { name: 'Collapse engine lane' }).click();
  await expect(lane(page, 'todo', 'engine').locator('.board-card__title')).toHaveCount(0);
  await page.getByRole('button', { name: 'Expand engine lane' }).click();
  await expect(lane(page, 'todo', 'engine').locator('.board-card__title')).toHaveCount(2);
});

test('dragging a card into another lane swaps that lane\'s label', async ({ page }) => {
  const boardId = await openBoard(page);
  await create(page, boardId, 'Parser', ['engine', 'urgent']);
  await create(page, boardId, 'Screens', ['ui'], 'doing');

  const card = lane(page, 'todo', 'engine').getByTestId('board-card-1');
  const box = (await card.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 15);
  await page.mouse.down();
  await page.mouse.move(box.x + 60, box.y + 40, { steps: 4 });
  const target = (await lane(page, 'doing', 'ui').boundingBox())!;
  await page.mouse.move(target.x + 40, target.y + target.height - 6, { steps: 10 });
  await expect(lane(page, 'doing', 'ui').getByTestId('board-drop-slot')).toBeVisible();
  await page.mouse.up();

  await expect.poll(async () => {
    const card1 = (await getBoard(page, boardId)).cards.find((item) => item.number === 1)!;
    return { column: card1.column, labels: card1.labels };
  }).toEqual({ column: 'doing', labels: ['urgent', 'ui'] });
  await expect(lane(page, 'doing', 'ui').locator('.board-card__title')).toHaveText(['Screens', 'Parser']);
});
