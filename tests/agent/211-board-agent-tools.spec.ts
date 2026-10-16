/**
 * Covers: REQ-BOARD-014, REQ-BOARD-015, REQ-BOARD-016, REQ-BOARD-017,
 * REQ-BOARD-022, REQ-AGENT-072
 *
 * Ported from PowerScroll's tests/agent/211-board-agent-tools.spec.ts. The app opens on
 * one empty board; commands run through the E2E hook, and the stored board is read
 * back through it instead of the workspace store. REQ-AGENT-072 is PowerScroll's
 * agent-protocol id for the board tools; PowerBoard traces it to REQ-PB-103.
 *
 * PowerScroll-only assertions, replaced by their app-level equivalents:
 * - "does not switch page / the canvas stays visible" becomes: the owner's active
 *   board and its board view are unchanged;
 * - `board_read` on a canvas page answers PRECONDITION (page is not a board). The
 *   standalone app has no canvas pages, so an unknown board id answers NOT_FOUND.
 */
import { expect, test } from '@playwright/test';
import { getBoard, getFile, openApp, runBridge, runBridgeExpectingError } from '../helpers';

test.describe('211 - Board agent tools', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
  });

  test('REQ-BOARD-014/015/016/017/022 board commands record actor, accept card numbers, and do not switch page', async ({ page }) => {
    const before = await getFile(page);
    const activeBoardId = before.activeBoardId;
    expect(activeBoardId).toBeTruthy();

    const created = await runBridge<{ boardId: string; title: string }>(page, 'board_create', {
      title: 'Sprint',
      actor: 'feature-1',
    });
    expect(created.boardId).toBeTruthy();
    expect(created.title).toBe('Sprint');

    const afterCreate = await getFile(page);
    expect(afterCreate.activeBoardId).toBe(activeBoardId);
    expect(afterCreate.boards).toHaveLength(2);
    await expect(page.getByTestId('board-view')).toBeVisible();
    await expect(page.getByTestId('board-title')).toHaveText('My board');

    const listed = await runBridge<{ boards: Array<{ id: string; title: string; counts: Record<string, number> }> }>(
      page,
      'board_list',
    );
    expect(listed.boards.some((board) => board.id === created.boardId && board.title === 'Sprint')).toBe(true);

    const notBoard = await runBridgeExpectingError(page, 'board_read', { boardId: 'no-such-board' });
    expect(notBoard.code).toBe('NOT_FOUND');

    const missingActor = await runBridgeExpectingError(page, 'card_create', {
      boardId: created.boardId,
      title: 'No actor',
    });
    expect(missingActor.code).toBe('NAME_REQUIRED');

    const card = await runBridge<{ id: string; number: number; title: string; column: string }>(
      page,
      'card_create',
      {
        boardId: created.boardId,
        title: 'Ship live board',
        description: 'MCP + UI',
        labels: ['agent'],
        checklist: ['claim', 'move'],
        actor: 'feature-1',
      },
    );
    expect(card.number).toBe(1);
    expect(card.column).toBe('todo');

    const byNumber = await runBridge<{ card: { number: number; title: string; createdBy: string; checklist: unknown[] } }>(
      page,
      'card_get',
      { boardId: created.boardId, card: 1 },
    );
    expect(byNumber.card.title).toBe('Ship live board');
    expect(byNumber.card.createdBy).toBe('feature-1');
    expect(byNumber.card.checklist).toHaveLength(2);

    const byHash = await runBridge<{ card: { id: string } }>(page, 'card_get', {
      boardId: created.boardId,
      card: '#1',
    });
    expect(byHash.card.id).toBe(card.id);

    await runBridge(page, 'card_claim', { boardId: created.boardId, card: 1, actor: 'feature-1' });
    await runBridge(page, 'card_move', {
      boardId: created.boardId,
      card: 1,
      to: 'doing',
      actor: 'feature-1',
    });
    await runBridge(page, 'card_note', {
      boardId: created.boardId,
      card: 1,
      text: 'working the strip',
      actor: 'feature-1',
    });
    await runBridge(page, 'card_check', {
      boardId: created.boardId,
      card: 1,
      item: 1,
      done: true,
      actor: 'feature-1',
    });
    await runBridge(page, 'card_checklist_add', {
      boardId: created.boardId,
      card: 1,
      text: 'highlight',
      actor: 'feature-2',
    });
    await runBridge(page, 'card_update', {
      boardId: created.boardId,
      card: 1,
      title: 'Ship live board now',
      actor: 'feature-2',
    });

    const waitingErr = await runBridgeExpectingError(page, 'card_move', {
      boardId: created.boardId,
      card: 1,
      to: 'waiting',
      actor: 'feature-1',
    });
    expect(waitingErr.code).toBe('QUESTION_REQUIRED');

    await runBridge(page, 'card_move', {
      boardId: created.boardId,
      card: 1,
      to: 'waiting',
      question: 'Does the pulse look right?',
      actor: 'feature-1',
    });

    const status = await runBridge<{ me: string; text: string }>(page, 'agent_status', {
      me: 'feature-1',
      text: 'waiting on owner',
      boardId: created.boardId,
      card: 1,
    });
    expect(status.me).toBe('feature-1');

    const stillOnOwnersBoard = await getFile(page);
    expect(stillOnOwnersBoard.activeBoardId).toBe(activeBoardId);
    await expect(page.getByTestId('board-title')).toHaveText('My board');

    const stored = await getBoard(page, created.boardId);
    expect(stored.cards[0].assignee).toBe('feature-1');
    expect(stored.cards[0].column).toBe('waiting');
    expect(stored.cards[0].notes[0].author).toBe('feature-1');
    expect(stored.events.some((event) => event.actor === 'feature-2')).toBe(true);

    const cursorOnly = await runBridge<{ events: unknown[]; cursor: number }>(page, 'board_updates', {
      boardId: created.boardId,
    });
    expect(cursorOnly.events).toEqual([]);
    expect(cursorOnly.cursor).toBeGreaterThan(0);

    await runBridge(page, 'card_note', {
      boardId: created.boardId,
      card: 1,
      text: 'owner reply',
      actor: 'you',
    });
    const updates = await runBridge<{ events: Array<{ seq: number; actor: string; type: string }> }>(
      page,
      'board_updates',
      { boardId: created.boardId, since: cursorOnly.cursor },
    );
    expect(updates.events.some((event) => event.actor === 'you' && event.type === 'noted')).toBe(true);

    const mine = await runBridge<{ events: Array<{ actor: string }> }>(page, 'board_updates', {
      boardId: created.boardId,
      since: 0,
      mine: true,
      me: 'feature-1',
    });
    expect(mine.events.length).toBeGreaterThan(0);

    await runBridge(page, 'card_release', { boardId: created.boardId, card: '#1', actor: 'feature-1' });
    const missing = await runBridgeExpectingError(page, 'card_get', {
      boardId: created.boardId,
      card: 99,
    });
    expect(missing.code).toBe('NOT_FOUND');
  });
});
