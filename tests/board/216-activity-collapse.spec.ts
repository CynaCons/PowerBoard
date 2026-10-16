/**
 * Test 216: the board's activity panel collapses to a rail.
 * Covers: REQ-BOARD-028
 *
 * Owner request 2026-10-14: "the activity panel, I need to be able to collapse it".
 *
 * Ported from PowerScroll's tests/board/216-activity-collapse.spec.ts. The app opens on
 * one empty board with its sidebar always visible, so PowerScroll's sidebar toggling is
 * gone. The preference is stored under PowerBoard's default key
 * (`powerboard-activity-collapsed`, BoardViewProps.activityCollapsedKey) instead of
 * `powerscroll-board-activity-collapsed`.
 */
import { expect, test } from '@playwright/test';
import { openBoard, runBridge } from '../helpers';

const COLLAPSED_KEY = 'powerboard-activity-collapsed';

test('REQ-BOARD-028 collapse gives the columns the room, counts new activity, and is remembered', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const boardId = await openBoard(page);
  await runBridge(page, 'card_create', { boardId, title: 'First', actor: 'feature-1' });

  const panel = page.getByTestId('board-activity');
  const columns = page.getByTestId('board-column-todo');
  await expect(panel).toHaveAttribute('data-collapsed', 'false');
  const openWidth = (await columns.boundingBox())!.width;

  await page.getByTestId('board-activity-toggle').click();
  await expect(panel).toHaveAttribute('data-collapsed', 'true');
  expect((await panel.boundingBox())!.width).toBeLessThanOrEqual(46);
  expect((await columns.boundingBox())!.width).toBeGreaterThan(openWidth + 40);
  await expect(page.getByTestId('board-activity-unread')).toHaveCount(0);

  // Activity while collapsed is counted on the rail.
  await runBridge(page, 'card_create', { boardId, title: 'Second', actor: 'feature-1' });
  await runBridge(page, 'card_create', { boardId, title: 'Third', actor: 'feature-2' });
  await expect(page.getByTestId('board-activity-unread')).toHaveText('2');

  // Remembered on this device: a newly opened board starts collapsed too.
  await page.getByTestId('pb-new-board').click();
  await expect(page.getByTestId('board-activity')).toHaveAttribute('data-collapsed', 'true');
  expect(await page.evaluate((key) => localStorage.getItem(key), COLLAPSED_KEY)).toBe('1');

  // ...and so does the app after a reload, since the preference lives in localStorage.
  await page.reload();
  await expect(page.getByTestId('board-activity')).toHaveAttribute('data-collapsed', 'true');
});

test('REQ-BOARD-028 expanding clears the count and shows the list again', async ({ page }) => {
  const boardId = await openBoard(page);
  await page.getByTestId('board-activity-toggle').click();
  await runBridge(page, 'card_create', { boardId, title: 'While away', actor: 'feature-1' });
  await expect(page.getByTestId('board-activity-unread')).toHaveText('1');
  await page.getByTestId('board-activity-toggle').click();
  await expect(page.getByTestId('board-activity')).toHaveAttribute('data-collapsed', 'false');
  await expect(page.getByTestId('board-activity')).toContainText('created #1');
  await page.getByTestId('board-activity-toggle').click();
  await expect(page.getByTestId('board-activity-unread')).toHaveCount(0);
});
