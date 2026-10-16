/**
 * Test 217: agents must say who they are; PowerBoard never invents a name.
 * Covers: REQ-AGENT-079
 *
 * Owner request 2026-10-14: "we should not generate random agent names ...
 * right now I see dozens of agents which are connected ... it's all the same
 * one, just connecting and reconnecting over and over."
 *
 * Ported from PowerScroll's tests/agent/217-agent-names-required.spec.ts. The app opens
 * on one empty board; commands run through the E2E hook. REQ-AGENT-079 is PowerScroll's
 * agent-protocol id; in PowerBoard the in-app commands answer to REQ-PB-103 and the MCP
 * server's own check to REQ-PB-131.
 */
import { expect, test } from '@playwright/test';
import { getBoard, openApp, runBridge, runBridgeExpectingError } from '../helpers';

test('REQ-PB-103/131 board commands without a name, or with a generated one, are refused', async ({ page }) => {
  await openApp(page);
  const board = await runBridge<{ boardId: string }>(page, 'board_create', {
    title: 'Names',
    actor: 'feature-1',
  });

  const missing = await runBridgeExpectingError(page, 'card_create', {
    boardId: board.boardId,
    title: 'No name',
  });
  expect(missing.code).toBe('NAME_REQUIRED');
  expect(missing.message).toMatch(/me/);

  for (const actor of ['agent-1a2b3c4d', 'unnamed-0f9e8d7c']) {
    const generated = await runBridgeExpectingError(page, 'card_create', {
      boardId: board.boardId,
      title: 'Generated',
      actor,
    });
    expect(generated.code, actor).toBe('NAME_REQUIRED');
  }

  // A real name works, and only real names reach the board.
  await runBridge(page, 'card_create', { boardId: board.boardId, title: 'Named', actor: 'feature-2' });
  const { events } = await getBoard(page, board.boardId);
  const actors = [...new Set(events.map((event) => event.actor))];
  expect(actors).toContain('feature-2');
  expect(actors.some((name) => /^(agent|unnamed)-/.test(name))).toBe(false);
});
