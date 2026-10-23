/**
 * Covers: REQ-PB-140 (PowerScroll REQ-BOARD-040, REQ-BOARD-041, REQ-BOARD-042)
 *
 * Owner request 2026-10-23: checklists nest like PowerPlan, and agents edit
 * them. Ported from PowerScroll's tests/board/237-checklist-nesting.spec.ts.
 */
import { expect, test } from '@playwright/test';
import { getBoard, openBoard, runBridge } from '../helpers';

test('an agent nests a checklist; the card shows it and Indent / Outdent / Alt+arrows change it', async ({ page }) => {
  const boardId = await openBoard(page);
  await runBridge(page, 'card_create', { boardId, title: 'Feature', actor: 'planner' });
  await runBridge(page, 'card_checklist_set', {
    boardId,
    card: 1,
    actor: 'worker-1',
    text: ['- [x] Engine', '  - [ ] Parser', '    - [ ] Lexer', '- [ ] App'].join('\n'),
  });

  await page.getByTestId('board-card-1').click();
  const overlay = page.getByTestId('board-card-overlay');
  const row = (text: string) => overlay.locator('[data-check-item]').filter({ hasText: text });
  await expect(row('Lexer')).toHaveAttribute('data-depth', '2');
  const lexer = (await row('Lexer').getByRole('checkbox').boundingBox())!.x;
  const engine = (await row('Engine').getByRole('checkbox').boundingBox())!.x;
  expect(lexer - engine).toBeGreaterThan(24);

  await overlay.getByRole('button', { name: 'Indent App' }).click();
  await expect(row('App')).toHaveAttribute('data-depth', '1');
  await overlay.getByRole('button', { name: 'Outdent Parser' }).click();
  await expect(row('Parser')).toHaveAttribute('data-depth', '0');
  await expect(row('Lexer')).toHaveAttribute('data-depth', '1');

  await row('Parser').getByRole('checkbox').focus();
  await page.keyboard.press('Alt+ArrowRight');
  await expect(row('Parser')).toHaveAttribute('data-depth', '1');
  await expect(row('Parser').getByRole('checkbox')).toBeFocused();

  const board = await getBoard(page, boardId);
  expect(board.cards[0].checklist.map((item) => [item.text, item.depth ?? 0])).toEqual([
    ['Engine', 0],
    ['Parser', 1],
    ['Lexer', 2],
    ['App', 2],
  ]);
  if (process.env.PB_SHOT) await overlay.locator('.board-checklist').screenshot({ path: process.env.PB_SHOT });
});
