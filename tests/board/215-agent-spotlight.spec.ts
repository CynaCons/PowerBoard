/**
 * Covers: REQ-BOARD-027
 *
 * Ported from PowerScroll's tests/board/215-agent-spotlight.spec.ts. The app opens on
 * one empty board; bridge commands reach it through the E2E hook.
 */
import { expect, test, type Locator } from '@playwright/test';
import { openBoard, runBridge } from '../helpers';

const PALETTE = ['#2563eb', '#0f766e', '#7c3aed', '#c2410c', '#0e7490', '#a21caf', '#4d7c0f'];

function avatarColor(name: string): string {
  const hash = Array.from(name).reduce((total, character) => total + character.charCodeAt(0), 0);
  return PALETTE[hash % PALETTE.length];
}

async function opacityOf(locator: Locator) {
  return locator.evaluate((element) => Number.parseFloat(getComputedStyle(element).opacity));
}

test('REQ-BOARD-027 chip click dims non-matching cards and rings assigned or created-by matches', async ({ page }) => {
  const boardId = await openBoard(page);
  await runBridge(page, 'card_create', { boardId, title: 'Owned by one', actor: 'feature-1' });
  await runBridge(page, 'card_claim', { boardId, card: 1, actor: 'feature-1' });
  await runBridge(page, 'card_create', { boardId, title: 'Owned by two', actor: 'feature-2' });
  await runBridge(page, 'card_claim', { boardId, card: 2, actor: 'feature-2' });
  await runBridge(page, 'card_create', { boardId, title: 'Created by one', actor: 'feature-1' });

  const one = page.getByTestId('board-card-1');
  const two = page.getByTestId('board-card-2');
  const created = page.getByTestId('board-card-3');
  const chip = page.getByTestId('board-agent-feature-1');

  await chip.getByRole('button').first().click();
  await expect(page.getByTestId('board-view')).toHaveAttribute('data-spotlight', 'feature-1');
  await expect(chip.getByRole('button').first()).toHaveAttribute('aria-pressed', 'true');
  await expect(one).toHaveAttribute('data-spotlighted', 'true');
  await expect(created).toHaveAttribute('data-spotlighted', 'true');
  await expect(two).toHaveAttribute('data-spotlighted', 'false');
  expect(await opacityOf(one)).toBeCloseTo(1, 2);
  expect(await opacityOf(created)).toBeCloseTo(1, 2);
  expect(await opacityOf(two)).toBeCloseTo(0.35, 2);

  const color = avatarColor('feature-1').toLowerCase();
  const ring = await one.evaluate((element) =>
    getComputedStyle(element).getPropertyValue('--spotlight-color').trim().toLowerCase(),
  );
  expect(ring).toBe(color);
  const createdRing = await created.evaluate((element) =>
    getComputedStyle(element).boxShadow,
  );
  expect(createdRing).not.toBe('none');

  await chip.getByRole('button').first().click();
  await expect(page.getByTestId('board-view')).not.toHaveAttribute('data-spotlight');
  expect(await opacityOf(two)).toBeCloseTo(1, 2);
});

test('REQ-BOARD-027 Escape clears spotlight; another chip switches it', async ({ page }) => {
  const boardId = await openBoard(page);
  await runBridge(page, 'card_create', { boardId, title: 'A', actor: 'feature-1' });
  await runBridge(page, 'card_claim', { boardId, card: 1, actor: 'feature-1' });
  await runBridge(page, 'card_create', { boardId, title: 'B', actor: 'feature-2' });
  await runBridge(page, 'card_claim', { boardId, card: 2, actor: 'feature-2' });

  await page.getByTestId('board-agent-feature-1').getByRole('button').first().click();
  await expect(page.getByTestId('board-view')).toHaveAttribute('data-spotlight', 'feature-1');

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('board-view')).not.toHaveAttribute('data-spotlight');

  await page.getByTestId('board-agent-feature-1').getByRole('button').first().click();
  await page.getByTestId('board-agent-feature-2').getByRole('button').first().click();
  await expect(page.getByTestId('board-view')).toHaveAttribute('data-spotlight', 'feature-2');
  await expect(page.getByTestId('board-card-2')).toHaveAttribute('data-spotlighted', 'true');
  await expect(page.getByTestId('board-card-1')).toHaveAttribute('data-spotlighted', 'false');
});

test('REQ-BOARD-027 Needs me filter combines with spotlight; dimmed cards stay clickable', async ({ page }) => {
  const boardId = await openBoard(page);
  await runBridge(page, 'card_create', { boardId, title: 'Wait one', actor: 'feature-1' });
  await runBridge(page, 'card_claim', { boardId, card: 1, actor: 'feature-1' });
  await runBridge(page, 'card_move', {
    boardId,
    card: 1,
    to: 'waiting',
    question: 'Need a look',
    actor: 'feature-1',
  });
  await runBridge(page, 'card_create', { boardId, title: 'Wait two', actor: 'feature-2' });
  await runBridge(page, 'card_claim', { boardId, card: 2, actor: 'feature-2' });
  await runBridge(page, 'card_move', {
    boardId,
    card: 2,
    to: 'waiting',
    question: 'Need you',
    actor: 'feature-2',
  });
  await runBridge(page, 'card_create', { boardId, title: 'Todo one', actor: 'feature-1' });

  await page.getByTestId('board-filter-needs-me').click();
  await expect(page.getByTestId('board-card-1')).toBeVisible();
  await expect(page.getByTestId('board-card-2')).toBeVisible();
  await expect(page.getByTestId('board-card-3')).toHaveCount(0);

  await page.getByTestId('board-agent-feature-1').getByRole('button').first().click();
  await expect(page.getByTestId('board-card-1')).toHaveAttribute('data-spotlighted', 'true');
  await expect(page.getByTestId('board-card-2')).toHaveAttribute('data-spotlighted', 'false');
  expect(await opacityOf(page.getByTestId('board-card-2'))).toBeCloseTo(0.35, 2);

  await page.getByTestId('board-card-2').click();
  await expect(page.getByTestId('board-card-overlay')).toBeVisible();
});
