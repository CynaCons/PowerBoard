import { describe, expect, it, vi } from 'vitest';
import type { BoardCommandName } from './index';
import {
  BridgeCommandError,
  createBoardCommands,
  createMemoryAdapter,
  type AgentLeaveResult,
  type BoardCreateResult,
  type BoardListResult,
  type BoardUpdatesResult,
  type CardGetResult,
  type CardListEntry,
  type PresenceSink,
} from './index';
import { createBoard, type BoardRef } from '../core';

const ACTOR = 'agent-1';

type Commands = ReturnType<typeof createBoardCommands>;

function call<T>(commands: Commands, name: BoardCommandName, params: Record<string, unknown>): T {
  return commands[name](params) as T;
}

/** A board ref with a fresh, empty board. `nextNumber` may be overridden. */
function memoryBoard(id = 'b1', title = 'Board', nextNumber?: number): BoardRef {
  const board = createBoard();
  if (nextNumber !== undefined) board.nextNumber = nextNumber;
  return { id, title, board };
}

function commandsFor(refs: BoardRef[], presence?: PresenceSink) {
  const adapter = createMemoryAdapter(refs);
  return { adapter, commands: createBoardCommands(adapter, presence) };
}

/** Run fn and return the BridgeCommandError it throws, failing if it does not. */
function bridgeError(fn: () => unknown): BridgeCommandError {
  try {
    fn();
  } catch (error) {
    if (error instanceof BridgeCommandError) return error;
    throw error;
  }
  throw new Error('expected BridgeCommandError to be thrown');
}

interface FakePresence {
  sink: PresenceSink;
  recordAction: ReturnType<typeof vi.fn>;
  leave: ReturnType<typeof vi.fn>;
  setLast: (boardId: string | undefined) => void;
}

function fakePresence(): FakePresence {
  const recordAction = vi.fn();
  const leave = vi.fn();
  let last: string | undefined;
  return {
    sink: { recordAction, leave, lastBoardOf: () => last },
    recordAction,
    leave,
    setLast: (boardId) => {
      last = boardId;
    },
  };
}

describe('createBoardCommands REQ-PB-103', () => {
  it('board_list counts live cards per column', () => {
    const ref = memoryBoard('b1', 'Board');
    const { commands } = commandsFor([ref]);

    call<CardListEntry>(commands, 'card_create', { me: ACTOR, boardId: 'b1', title: 'A' });
    const second = call<CardListEntry>(commands, 'card_create', {
      me: ACTOR,
      boardId: 'b1',
      title: 'B',
    });
    const third = call<CardListEntry>(commands, 'card_create', {
      me: ACTOR,
      boardId: 'b1',
      title: 'C',
    });
    call<CardListEntry>(commands, 'card_move', {
      me: ACTOR,
      boardId: 'b1',
      card: second.id,
      to: 'doing',
    });
    call<CardListEntry>(commands, 'card_move', {
      me: ACTOR,
      boardId: 'b1',
      card: third.id,
      to: 'waiting',
      question: 'Which one?',
    });
    // An archived card is excluded from the counts (REQ-BOARD-026).
    const archived = call<CardListEntry>(commands, 'card_create', {
      me: ACTOR,
      boardId: 'b1',
      title: 'D',
    });
    call<CardListEntry>(commands, 'card_archive', {
      me: ACTOR,
      boardId: 'b1',
      card: archived.id,
    });

    const result = call<BoardListResult>(commands, 'board_list', {});
    expect(result.boards).toHaveLength(1);
    expect(result.boards[0]).toMatchObject({
      id: 'b1',
      title: 'Board',
      sectionId: '',
      section: '',
      counts: { todo: 1, doing: 1, waiting: 1, done: 0 },
    });
  });

  it('board_create returns an id and leaves the other boards alone', () => {
    const first = memoryBoard('b1', 'One');
    const before = JSON.stringify(first.board);
    const { adapter, commands } = commandsFor([first]);

    const created = call<BoardCreateResult>(commands, 'board_create', {
      me: ACTOR,
      title: 'Two',
    });

    expect(created.boardId).toBeTruthy();
    expect(created).toMatchObject({ title: 'Two', sectionId: '' });
    expect(adapter.listBoards()).toHaveLength(2);
    expect(adapter.getBoard('b1')!.board).toEqual(first.board);
    expect(JSON.stringify(adapter.getBoard('b1')!.board)).toBe(before);
    expect(adapter.getBoard(created.boardId)!.title).toBe('Two');
  });

  it('board_create rejects an unknown sectionId and keeps the given section', () => {
    const { adapter, commands } = commandsFor([
      { ...memoryBoard('b1', 'One'), sectionId: 's1', section: 'Work' },
    ]);

    const created = call<BoardCreateResult>(commands, 'board_create', {
      me: ACTOR,
      title: 'Two',
      sectionId: 's1',
    });
    expect(created.sectionId).toBe('s1');
    expect(adapter.getBoard(created.boardId)!.section).toBe('Work');

    const error = bridgeError(() =>
      commands.board_create({ me: ACTOR, title: 'Three', sectionId: 'nope' }),
    );
    expect(error.code).toBe('NOT_FOUND');
    expect(error.message).toBe('No section with id "nope"');
  });

  it('REQ-BOARD-014 records the actor on the card, note and event', () => {
    const { adapter, commands } = commandsFor([memoryBoard()]);
    const created = call<CardListEntry>(commands, 'card_create', {
      me: ACTOR,
      boardId: 'b1',
      title: 'Ship it',
      checklist: ['write', 'test'],
    });
    call<CardListEntry>(commands, 'card_claim', { me: ACTOR, boardId: 'b1', card: created.id });
    call<CardListEntry>(commands, 'card_move', {
      me: ACTOR,
      boardId: 'b1',
      card: created.id,
      to: 'doing',
    });
    call<CardListEntry>(commands, 'card_note', {
      me: ACTOR,
      boardId: 'b1',
      card: created.id,
      text: 'a note',
    });
    call<CardListEntry>(commands, 'card_checklist_add', {
      me: ACTOR,
      boardId: 'b1',
      card: created.id,
      text: 'third',
    });
    call<CardListEntry>(commands, 'card_check', {
      me: ACTOR,
      boardId: 'b1',
      card: created.id,
      item: 1,
      done: true,
    });

    const card = adapter.getBoard('b1')!.board.cards.find((item) => item.id === created.id)!;
    expect(card.createdBy).toBe(ACTOR);
    expect(card.assignee).toBe(ACTOR);
    expect(card.notes[0]).toMatchObject({ author: ACTOR, text: 'a note' });

    const board = adapter.getBoard('b1')!.board;
    expect(board.events.length).toBeGreaterThan(0);
    for (const event of board.events) expect(event.actor).toBe(ACTOR);
    expect(board.events.map((event) => event.type)).toEqual(
      expect.arrayContaining(['created', 'claimed', 'moved', 'noted', 'checked']),
    );
  });

  it('REQ-BOARD-015 card_move to waiting without a question fails with QUESTION_REQUIRED', () => {
    const { commands } = commandsFor([memoryBoard()]);
    const card = call<CardListEntry>(commands, 'card_create', {
      me: ACTOR,
      boardId: 'b1',
      title: 'Needs an answer',
    });

    const error = bridgeError(() =>
      commands.card_move({ me: ACTOR, boardId: 'b1', card: card.id, to: 'waiting' }),
    );
    expect(error.code).toBe('QUESTION_REQUIRED');
    expect(error.message).toBe('A question is required before a card can wait for feedback');
  });

  it('REQ-BOARD-016 finds a card by id, by number and by "#15"', () => {
    const { commands } = commandsFor([memoryBoard('b1', 'Board', 15)]);
    const created = call<CardListEntry>(commands, 'card_create', {
      me: ACTOR,
      boardId: 'b1',
      title: 'Fifteen',
    });
    expect(created.number).toBe(15);

    for (const ref of [created.id, 15, '#15']) {
      const got = call<CardGetResult>(commands, 'card_get', { boardId: 'b1', card: ref });
      expect(got.card.id).toBe(created.id);
      expect(got.card.number).toBe(15);
    }
  });

  it('REQ-BOARD-022 board_updates returns the cursor, then newer events', () => {
    const { commands } = commandsFor([memoryBoard()]);
    const card = call<CardListEntry>(commands, 'card_create', {
      me: ACTOR,
      boardId: 'b1',
      title: 'A',
    });

    const initial = call<BoardUpdatesResult>(commands, 'board_updates', { boardId: 'b1' });
    expect(initial.events).toEqual([]);
    expect(initial.cursor).toBeGreaterThan(0);

    const all = call<BoardUpdatesResult>(commands, 'board_updates', { boardId: 'b1', since: 0 });
    expect(all.events.length).toBeGreaterThan(0);
    expect(all.events.map((event) => event.type)).toContain('created');
    expect(all.cursor).toBe(all.events[all.events.length - 1].seq);

    call<CardListEntry>(commands, 'card_note', {
      me: ACTOR,
      boardId: 'b1',
      card: card.id,
      text: 'later',
    });
    const newer = call<BoardUpdatesResult>(commands, 'board_updates', {
      boardId: 'b1',
      since: all.cursor,
    });
    expect(newer.events.map((event) => event.type)).toEqual(['noted']);
    expect(newer.events[0]).toMatchObject({ actor: ACTOR, cardId: card.id, card: 1 });
    expect(newer.cursor).toBeGreaterThan(all.cursor);
  });

  it('REQ-BOARD-026 archives, blocks writes to archived cards and restores', () => {
    const { commands } = commandsFor([memoryBoard()]);
    const card = call<CardListEntry>(commands, 'card_create', {
      me: ACTOR,
      boardId: 'b1',
      title: 'Old',
    });

    const archived = call<CardListEntry>(commands, 'card_archive', {
      me: ACTOR,
      boardId: 'b1',
      card: card.id,
    });
    expect(archived.archivedAt).toBeTypeOf('number');

    const update = bridgeError(() =>
      commands.card_update({ me: ACTOR, boardId: 'b1', card: card.id, title: 'New' }),
    );
    expect(update.code).toBe('ARCHIVED');

    const move = bridgeError(() =>
      commands.card_move({ me: ACTOR, boardId: 'b1', card: card.id, to: 'doing' }),
    );
    expect(move.code).toBe('ARCHIVED');

    const read = call<CardGetResult>(commands, 'card_get', { boardId: 'b1', card: card.id });
    expect(read.card.archivedAt).toBeTypeOf('number');

    const restored = call<CardListEntry>(commands, 'card_restore', {
      me: ACTOR,
      boardId: 'b1',
      card: card.id,
    });
    expect(restored.archivedAt).toBeUndefined();
    expect(restored.column).toBe('todo');

    const again = bridgeError(() =>
      commands.card_restore({ me: ACTOR, boardId: 'b1', card: card.id }),
    );
    expect(again.code).toBe('NOT_FOUND');
  });

  it('agent_leave records a left event and calls presence.leave', () => {
    const presence = fakePresence();
    const { adapter, commands } = commandsFor([memoryBoard()], presence.sink);
    call<CardListEntry>(commands, 'card_create', { me: ACTOR, boardId: 'b1', title: 'A' });
    presence.setLast('b1');

    const result = call<AgentLeaveResult>(commands, 'agent_leave', { me: ACTOR, note: 'bye' });

    expect(result).toEqual({ me: ACTOR, boardId: 'b1' });
    expect(presence.leave).toHaveBeenCalledWith(ACTOR);
    const left = adapter.getBoard('b1')!.board.events.find((event) => event.type === 'left')!;
    expect(left).toMatchObject({ actor: ACTOR, text: 'bye' });

    const unknown = bridgeError(() =>
      commands.agent_leave({ me: ACTOR, boardId: 'ghost' }),
    );
    expect(unknown.code).toBe('NOT_FOUND');
  });

  it('missing or generated actor names fail exactly like the source', () => {
    const { commands } = commandsFor([memoryBoard()]);
    const message =
      'Tell PowerScroll who you are: pass "me" with your agent name (e.g. "feature-1"), '
      + 'the same name every session.';

    const missing = bridgeError(() =>
      commands.card_create({ boardId: 'b1', title: 'No actor' }),
    );
    expect(missing.code).toBe('NAME_REQUIRED');
    expect(missing.message).toBe(message);

    const generated = bridgeError(() =>
      commands.card_create({ me: 'agent-1234abcd', boardId: 'b1', title: 'No actor' }),
    );
    expect(generated.code).toBe('NAME_REQUIRED');
    expect(generated.message).toBe(message);

    const invalid = bridgeError(() =>
      commands.card_create({ me: 'Agent One', boardId: 'b1', title: 'No actor' }),
    );
    expect(invalid.code).toBe('INVALID');
  });

  it('reports every write through presence.recordAction', () => {
    const presence = fakePresence();
    const { commands } = commandsFor([memoryBoard()], presence.sink);
    const card = call<CardListEntry>(commands, 'card_create', {
      me: ACTOR,
      boardId: 'b1',
      title: 'A',
    });

    expect(presence.recordAction).toHaveBeenCalledWith(ACTOR, { boardId: 'b1', cardId: card.id });

    presence.recordAction.mockClear();
    call<CardListEntry>(commands, 'card_note', {
      me: ACTOR,
      boardId: 'b1',
      card: card.id,
      text: 'hi',
    });
    expect(presence.recordAction).toHaveBeenCalledWith(ACTOR, { boardId: 'b1', cardId: card.id });

    presence.recordAction.mockClear();
    commands.agent_status({ me: ACTOR, boardId: 'b1', card: card.id, text: 'working' });
    expect(presence.recordAction).toHaveBeenCalledWith(ACTOR, {
      boardId: 'b1',
      cardId: card.id,
      status: 'working',
    });
  });

  it('board_read only reads and never switches the active board (REQ-BOARD-017)', () => {
    const { adapter, commands } = commandsFor([memoryBoard('b1', 'One'), memoryBoard('b2', 'Two')]);
    call<CardListEntry>(commands, 'card_create', { me: ACTOR, boardId: 'b2', title: 'Only b2' });

    const read = call<{ boardId: string; title: string; cards: CardListEntry[] }>(
      commands,
      'board_read',
      { boardId: 'b2' },
    );
    expect(read.boardId).toBe('b2');
    expect(read.cards).toHaveLength(1);
    expect(adapter.getBoard('b1')!.board.cards).toHaveLength(0);
  });
});
