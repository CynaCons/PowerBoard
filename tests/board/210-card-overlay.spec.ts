/**
 * Covers: REQ-BOARD-004, REQ-BOARD-008, REQ-BOARD-009, REQ-BOARD-012,
 * REQ-BOARD-013
 *
 * Ported from PowerScroll's tests/board/210-card-overlay.spec.ts. The app opens on one
 * empty board, so `openCard` skips PowerScroll's "add board page" steps.
 */
import { expect, test, type Page } from '@playwright/test';
import { openApp } from '../helpers';

async function openCard(page: Page, column = 'todo') {
  await openApp(page);
  await page.getByTestId(`board-add-card-${column}`).click();
  await page.locator('.board-add-input').fill('Overlay task');
  await page.locator('.board-add-input').press('Enter');
  await page.getByTestId('board-card-1').click();
  return page.getByTestId('board-card-overlay');
}

test('REQ-BOARD-008 overlay closes by Escape, cross and backdrop and restores card focus', async ({ page }) => {
  let overlay = await openCard(page);
  await expect(overlay).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(overlay).toHaveCount(0);
  await expect(page.getByTestId('board-card-1')).toBeFocused();

  await page.getByTestId('board-card-1').click();
  overlay = page.getByTestId('board-card-overlay');
  await overlay.getByLabel('Close card').click();
  await expect(overlay).toHaveCount(0);

  await page.getByTestId('board-card-1').click();
  overlay = page.getByTestId('board-card-overlay');
  await overlay.click({ position: { x: 2, y: 2 } });
  await expect(overlay).toHaveCount(0);
});

test('REQ-BOARD-004/008 title, markdown description, checklist, labels and assignee update the card face', async ({ page }) => {
  const overlay = await openCard(page);
  await overlay.getByLabel('Card title').fill('Edited title');
  await overlay.locator('.board-description').click();
  await overlay.getByLabel('Description').fill('**Details**');
  await overlay.getByLabel('Description').blur();
  await expect(overlay.locator('.board-description')).toContainText('Details');

  await overlay.getByLabel('Add checklist item').fill('Check it');
  await overlay.getByLabel('Add checklist item').press('Enter');
  const checkbox = overlay.getByRole('checkbox', { name: 'Check it' });
  await checkbox.click();
  await expect(checkbox).toBeChecked();
  await overlay.getByLabel('Add label').fill('Design');
  await overlay.getByLabel('Add label').press('Enter');
  await overlay.getByLabel('Assignee').fill('Ada');
  await overlay.getByLabel('Close card').click();

  const card = page.getByTestId('board-card-1');
  await expect(card).toContainText('Edited title');
  await expect(card).toContainText('Design');
  await expect(card).toContainText('Ada');
  await expect(card).toContainText('1/1');
});

test('REQ-BOARD-008/009 signed replies move waiting cards and history records card work', async ({ page }) => {
  const overlay = await openCard(page, 'doing');
  await overlay.getByLabel('Status').selectOption('waiting');
  await overlay.locator('.board-overlay__question input').fill('Please approve');
  await overlay.getByRole('button', { name: 'Move', exact: true }).click();
  await expect(overlay).toContainText('Needs you');

  await overlay.getByLabel('Reply').fill('Looks good');
  await overlay.getByRole('button', { name: 'Reply and move to In progress' }).click();
  await expect(overlay).not.toContainText('Needs you');
  await expect(overlay.locator('.board-notes')).toContainText('You');
  await expect(overlay.locator('.board-history')).toContainText('You');
  await expect(overlay.locator('.board-history')).toContainText('moved');
  await expect(overlay.locator('.board-history')).toContainText('noted');
});

test('REQ-BOARD-013 overlay has the approved two-column right sidebar geometry', async ({ page }) => {
  const overlay = await openCard(page);
  const sidebar = overlay.locator('.board-overlay__sidebar');
  const dialog = overlay.locator('.board-overlay__dialog');
  const sidebarBox = await sidebar.boundingBox();
  const dialogBox = await dialog.boundingBox();
  if (!sidebarBox || !dialogBox) throw new Error('overlay layout missing');

  expect(Math.abs(sidebarBox.width - 250)).toBeLessThanOrEqual(2);
  expect(sidebarBox.x + sidebarBox.width).toBeCloseTo(dialogBox.x + dialogBox.width, 0);
  await expect(sidebar).toContainText('Details');
  await expect(sidebar).toContainText('History');
});
