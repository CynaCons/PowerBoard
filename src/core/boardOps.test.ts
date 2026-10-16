import { describe, expect, it } from 'vitest';
import type { BoardCard, BoardData } from './index';
import {
  BOARD_COLUMNS,
  BoardOperationError,
  addChecklistItem,
  addNote,
  archiveCard,
  claimCard,
  clearDone,
  createBoard,
  createCard,
  deleteCard,
  isArchived,
  liveCards,
  moveCard,
  recordAgentLeave,
  releaseCard,
  removeChecklistItem,
  resolveCardRef,
  resolveCheckItem,
  restoreCard,
  setChecklistItem,
  updateCard,
} from './index';

const ACTOR = 'agent-1';
const NOW = 1_700_000_000_000;

function getCard(board: BoardData, id: string): BoardCard {
  const found = board.cards.find((card) => card.id === id);
  if (!found) throw new Error(`test card ${id} missing`);
  return found;
}

/** Run fn and return the BoardOperationError it throws, failing if it does not. */
function boardError(fn: () => unknown): BoardOperationError {
  try {
    fn();
  } catch (error) {
    if (error instanceof BoardOperationError) return error;
    throw error;
  }
  throw new Error('expected BoardOperationError to be thrown');
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nested);
    }
    Object.freeze(value);
  }
  return value;
}

function boardWithCards(...titles: string[]): { board: BoardData; ids: string[] } {
  let board = createBoard();
  const ids: string[] = [];
  for (const title of titles) {
    board = createCard(board, { title }, ACTOR, NOW);
    ids.push(board.cards[board.cards.length - 1].id);
  }
  return { board, ids };
}

describe('BOARD_COLUMNS', () => {
  it('REQ-PB-102 lists the four columns in order', () => {
    expect(BOARD_COLUMNS.map((column) => column.id)).toEqual([
      'todo',
      'doing',
      'waiting',
      'done',
    ]);
  });
});

describe('createBoard', () => {
  it('REQ-PB-102 returns an empty board shape', () => {
    expect(createBoard()).toEqual({
      cards: [],
      events: [],
      nextNumber: 1,
      nextSeq: 1,
    });
  });
});

describe('generateId', () => {
  it('REQ-PB-102 returns a 12-character id', async () => {
    const { generateId } = await import('./index');
    const id = generateId();
    expect(typeof id).toBe('string');
    expect(id).toHaveLength(12);
  });
});

describe('createCard', () => {
  it('REQ-PB-102 numbers cards from nextNumber and defaults to the todo column', () => {
    let board = createBoard();
    board = createCard(board, { title: 'First' }, ACTOR, NOW);
    const first = board.cards[0];
    expect(first.number).toBe(1);
    expect(board.nextNumber).toBe(2);
    expect(first.column).toBe('todo');
    expect(first.order).toBe(0);
    expect(first.description).toBe('');
    expect(first.labels).toEqual([]);
    expect(first.checklist).toEqual([]);
    expect(first.notes).toEqual([]);
    expect(first.createdBy).toBe(ACTOR);
    expect(first.createdAt).toBe(NOW);
    expect(first.updatedAt).toBe(NOW);
    expect(first.assignee).toBeUndefined();
    expect(first.question).toBeUndefined();
    expect(first.archivedAt).toBeUndefined();

    board = createCard(board, { title: 'Second' }, ACTOR, NOW);
    expect(board.cards[1].number).toBe(2);
    expect(board.cards[1].order).toBe(1);
    expect(board.nextNumber).toBe(3);
  });

  it('REQ-PB-102 appends a created event carrying the new card id', () => {
    const board = createCard(createBoard(), { title: 'First' }, ACTOR, NOW);
    expect(board.events).toEqual([
      { seq: 1, at: NOW, actor: ACTOR, type: 'created', cardId: board.cards[0].id },
    ]);
    expect(board.nextSeq).toBe(2);
  });

  it('REQ-PB-102 trims the title, falling back to Untitled card', () => {
    let board = createBoard();
    board = createCard(board, { title: '  Padded  ' }, ACTOR, NOW);
    expect(board.cards[0].title).toBe('Padded');
    board = createCard(board, { title: '   ' }, ACTOR, NOW);
    expect(board.cards[1].title).toBe('Untitled card');
  });

  it('REQ-PB-102 accepts a column, description, labels and checklist strings', () => {
    const board = createCard(
      createBoard(),
      {
        title: 'Body',
        column: 'doing',
        description: 'details',
        labels: ['a', 'b'],
        checklist: ['  one ', '', 'two'],
      },
      ACTOR,
      NOW,
    );
    const card = board.cards[0];
    expect(card.column).toBe('doing');
    expect(card.description).toBe('details');
    expect(card.labels).toEqual(['a', 'b']);
    expect(card.checklist.map((item) => item.text)).toEqual(['one', 'two']);
    expect(card.checklist.every((item) => item.done === false)).toBe(true);
  });
});

describe('moveCard', () => {
  it('REQ-PB-102 reorders within a column by the given index', () => {
    const { board, ids } = boardWithCards('A', 'B', 'C');
    // Move B to the end: the moved card keeps its old order (1), which collides
    // with C's reassigned order (1) and the stable sort puts C first.
    const moved = moveCard(board, { cardId: ids[1], to: 'todo', index: 2 }, ACTOR, NOW + 1);
    expect(board.cards.map((card) => card.title)).toEqual(['A', 'B', 'C']);
    expect(moved.cards.map((card) => card.title)).toEqual(['A', 'C', 'B']);
    expect(moved.cards.map((card) => card.order)).toEqual([0, 1, 2]);
    expect(moved.events[moved.events.length - 1]).toMatchObject({
      type: 'moved',
      cardId: ids[1],
      from: 'todo',
      to: 'todo',
    });
  });

  it('REQ-PB-102 moves across columns and clamps the index', () => {
    const { board, ids } = boardWithCards('A', 'B');
    const moved = moveCard(board, { cardId: ids[0], to: 'done', index: 99 }, ACTOR, NOW + 1);
    expect(getCard(moved, ids[0]).column).toBe('done');
    expect(getCard(moved, ids[0]).order).toBe(0);
    expect(getCard(moved, ids[1]).column).toBe('todo');
    expect(getCard(moved, ids[1]).order).toBe(0);
    expect(moved.cards.map((card) => card.title)).toEqual(['B', 'A']);
  });

  it('REQ-BOARD-007/015 moving to waiting without a question fails', () => {
    const { board, ids } = boardWithCards('A');
    const error = boardError(() => moveCard(board, { cardId: ids[0], to: 'waiting', index: 0 }, ACTOR, NOW));
    expect(error.code).toBe('QUESTION_REQUIRED');
    expect(error.message).toBe('A question is required before a card can wait for feedback');
  });

  it('REQ-BOARD-007 records the question and clears it when leaving waiting', () => {
    const { board, ids } = boardWithCards('A');
    const waiting = moveCard(board, { cardId: ids[0], to: 'waiting', index: 0, question: '  Why?  ' }, ACTOR, NOW + 1);
    expect(getCard(waiting, ids[0]).question).toBe('Why?');
    expect(waiting.events[waiting.events.length - 1].text).toBe('Why?');

    const back = moveCard(waiting, { cardId: ids[0], to: 'doing', index: 0 }, ACTOR, NOW + 2);
    expect(getCard(back, ids[0]).question).toBeUndefined();
    expect(back.events[back.events.length - 1].text).toBeUndefined();
  });

  it('REQ-BOARD-007 keeps an existing question when reordering inside waiting', () => {
    const { board, ids } = boardWithCards('A');
    const waiting = moveCard(board, { cardId: ids[0], to: 'waiting', index: 0, question: 'Q?' }, ACTOR, NOW + 1);
    const stillWaiting = moveCard(waiting, { cardId: ids[0], to: 'waiting', index: 0 }, ACTOR, NOW + 2);
    expect(getCard(stillWaiting, ids[0]).question).toBe('Q?');
  });

  it('REQ-PB-102 fails with NOT_FOUND for an unknown card', () => {
    const error = boardError(() => moveCard(createBoard(), { cardId: 'nope', to: 'doing', index: 0 }, ACTOR, NOW));
    expect(error.code).toBe('NOT_FOUND');
    expect(error.message).toBe('Board card "nope" was not found');
  });
});

describe('claimCard and releaseCard', () => {
  it('REQ-PB-102 claims a card for the actor and records a claimed event', () => {
    const { board, ids } = boardWithCards('A');
    const claimed = claimCard(board, { cardId: ids[0] }, ACTOR, NOW + 1);
    expect(getCard(claimed, ids[0]).assignee).toBe(ACTOR);
    expect(getCard(claimed, ids[0]).updatedAt).toBe(NOW + 1);
    expect(claimed.events[claimed.events.length - 1]).toEqual({
      seq: 2,
      at: NOW + 1,
      actor: ACTOR,
      type: 'claimed',
      cardId: ids[0],
    });
  });

  it('REQ-PB-102 releases a card and records a released event', () => {
    const { board, ids } = boardWithCards('A');
    const claimed = claimCard(board, { cardId: ids[0] }, ACTOR, NOW + 1);
    const released = releaseCard(claimed, { cardId: ids[0] }, ACTOR, NOW + 2);
    expect(getCard(released, ids[0]).assignee).toBeUndefined();
    expect(released.events[released.events.length - 1]).toMatchObject({
      type: 'released',
      actor: ACTOR,
      cardId: ids[0],
    });
  });
});

describe('addNote', () => {
  it('REQ-BOARD-009/014 records the actor and time on the note and event', () => {
    const { board, ids } = boardWithCards('A');
    const noted = addNote(board, { cardId: ids[0], text: '  hello  ' }, ACTOR, NOW + 5);
    const note = getCard(noted, ids[0]).notes[0];
    expect(note.author).toBe(ACTOR);
    expect(note.at).toBe(NOW + 5);
    expect(note.text).toBe('hello');
    expect(note.id).toHaveLength(12);
    expect(noted.events[noted.events.length - 1]).toMatchObject({
      type: 'noted',
      actor: ACTOR,
      cardId: ids[0],
      text: 'hello',
      at: NOW + 5,
    });
  });
});

describe('checklist operations', () => {
  it('REQ-PB-102 adds an item and records an updated event', () => {
    const { board, ids } = boardWithCards('A');
    const added = addChecklistItem(board, { cardId: ids[0], text: '  step  ' }, ACTOR, NOW + 1);
    expect(getCard(added, ids[0]).checklist.map((item) => item.text)).toEqual(['step']);
    expect(added.events[added.events.length - 1]).toMatchObject({ type: 'updated', text: 'step' });
  });

  it('REQ-PB-102 sets an item done, by id and by 1-based index', () => {
    let board = boardWithCards('A').board;
    const cardId = board.cards[0].id;
    board = addChecklistItem(board, { cardId, text: 'one' }, ACTOR, NOW + 1);
    board = addChecklistItem(board, { cardId, text: 'two' }, ACTOR, NOW + 2);
    const card = getCard(board, cardId);
    const firstId = card.checklist[0].id;

    expect(resolveCheckItem(card, firstId).text).toBe('one');
    expect(resolveCheckItem(card, 2).text).toBe('two');

    const checked = setChecklistItem(board, { cardId, itemId: firstId, done: true }, ACTOR, NOW + 3);
    expect(getCard(checked, cardId).checklist[0].done).toBe(true);
    expect(getCard(checked, cardId).checklist[1].done).toBe(false);
    expect(checked.events[checked.events.length - 1].type).toBe('checked');
  });

  it('REQ-PB-102 removes an item and records an updated event', () => {
    let board = boardWithCards('A').board;
    const cardId = board.cards[0].id;
    board = addChecklistItem(board, { cardId, text: 'one' }, ACTOR, NOW + 1);
    board = addChecklistItem(board, { cardId, text: 'two' }, ACTOR, NOW + 2);
    const firstId = getCard(board, cardId).checklist[0].id;
    const removed = removeChecklistItem(board, { cardId, itemId: firstId }, ACTOR, NOW + 3);
    expect(getCard(removed, cardId).checklist.map((item) => item.text)).toEqual(['two']);
    expect(removed.events[removed.events.length - 1]).toMatchObject({ type: 'updated', cardId });
  });

  it('REQ-PB-102 throws NOT_FOUND for unknown checklist items', () => {
    const { board, ids } = boardWithCards('A');
    const error = boardError(() =>
      setChecklistItem(board, { cardId: ids[0], itemId: 'missing', done: true }, ACTOR, NOW),
    );
    expect(error.code).toBe('NOT_FOUND');
    expect(error.message).toBe('Checklist item "missing" was not found');
  });

  it('REQ-PB-102 resolveCheckItem fails for an out-of-range index', () => {
    const { board, ids } = boardWithCards('A');
    const card = getCard(board, ids[0]);
    const error = boardError(() => resolveCheckItem(card, 1));
    expect(error.code).toBe('NOT_FOUND');
    expect(error.message).toBe(`Checklist item 1 was not found on card #${card.number}`);
  });
});

describe('resolveCardRef', () => {
  it('REQ-BOARD-016 resolves by id, by number and by #number', () => {
    let board = createBoard();
    for (let index = 1; index <= 15; index += 1) {
      board = createCard(board, { title: `Card ${index}` }, ACTOR, NOW);
    }
    const fifteenth = board.cards[14];
    expect(resolveCardRef(board, fifteenth.id)).toBe(fifteenth);
    expect(resolveCardRef(board, 15)).toBe(fifteenth);
    expect(resolveCardRef(board, '#15')).toBe(fifteenth);
    expect(resolveCardRef(board, '15')).toBe(fifteenth);
  });

  it('REQ-BOARD-016 throws NOT_FOUND for an unknown reference', () => {
    const board = createCard(createBoard(), { title: 'A' }, ACTOR, NOW);
    expect(boardError(() => resolveCardRef(board, '#99')).code).toBe('NOT_FOUND');
    expect(boardError(() => resolveCardRef(board, '#99')).message).toBe('Board card #99 was not found');
    expect(boardError(() => resolveCardRef(board, 'does-not-exist')).code).toBe('NOT_FOUND');
  });
});

describe('archive and restore', () => {
  it('REQ-BOARD-026 archives a card and liveCards excludes it', () => {
    const { board, ids } = boardWithCards('A', 'B');
    const archived = archiveCard(board, { cardId: ids[0] }, ACTOR, NOW + 9);
    const card = getCard(archived, ids[0]);
    expect(isArchived(card)).toBe(true);
    expect(card.archivedAt).toBe(NOW + 9);
    expect(card.updatedAt).toBe(NOW + 9);
    expect(liveCards(archived.cards).map((entry) => entry.id)).toEqual([ids[1]]);
    expect(archived.events[archived.events.length - 1]).toMatchObject({ type: 'archived', cardId: ids[0] });
  });

  it('REQ-BOARD-026 moveCard and updateCard fail with ARCHIVED', () => {
    const { board, ids } = boardWithCards('A');
    const archived = archiveCard(board, { cardId: ids[0] }, ACTOR, NOW + 1);
    expect(boardError(() => moveCard(archived, { cardId: ids[0], to: 'doing', index: 0 }, ACTOR, NOW + 2)).code).toBe('ARCHIVED');
    expect(boardError(() => updateCard(archived, { cardId: ids[0], title: 'Nope' }, ACTOR, NOW + 2)).code).toBe('ARCHIVED');
  });

  it('REQ-BOARD-026 restores a card to the end of its previous column', () => {
    const { board, ids } = boardWithCards('A', 'B', 'C');
    const archived = archiveCard(board, { cardId: ids[1] }, ACTOR, NOW + 1);
    const restored = restoreCard(archived, { cardId: ids[1] }, ACTOR, NOW + 2);
    const card = getCard(restored, ids[1]);
    expect(card.archivedAt).toBeUndefined();
    expect(card.column).toBe('todo');
    expect(card.order).toBe(2);
    expect(restored.events[restored.events.length - 1]).toMatchObject({ type: 'restored', cardId: ids[1] });
  });

  it('REQ-BOARD-026 restoring a live card throws NOT_FOUND', () => {
    const { board, ids } = boardWithCards('A');
    const error = boardError(() => restoreCard(board, { cardId: ids[0] }, ACTOR, NOW));
    expect(error.code).toBe('NOT_FOUND');
    expect(error.message).toBe(`Board card "${ids[0]}" is not archived`);
  });

  it('REQ-BOARD-026 clearDone archives every live done card', () => {
    let board = createBoard();
    board = createCard(board, { title: 'Done A', column: 'done' }, ACTOR, NOW);
    board = createCard(board, { title: 'Done B', column: 'done' }, ACTOR, NOW);
    board = createCard(board, { title: 'Todo', column: 'todo' }, ACTOR, NOW);
    const cleared = clearDone(board, ACTOR, NOW + 1);
    expect(liveCards(cleared.cards).map((card) => card.title)).toEqual(['Todo']);
    expect(cleared.cards.filter((card) => card.column === 'done').every(isArchived)).toBe(true);
    expect(cleared.events.filter((event) => event.type === 'archived')).toHaveLength(2);
  });
});

describe('deleteCard', () => {
  it('REQ-PB-102 removes the card, renumbers and records a deleted event', () => {
    const { board, ids } = boardWithCards('A', 'B', 'C');
    const deleted = deleteCard(board, { cardId: ids[1] }, ACTOR, NOW + 1);
    expect(deleted.cards.map((card) => card.title)).toEqual(['A', 'C']);
    expect(deleted.cards.map((card) => card.order)).toEqual([0, 1]);
    expect(deleted.events[deleted.events.length - 1]).toEqual({
      seq: 4,
      at: NOW + 1,
      actor: ACTOR,
      type: 'deleted',
      cardId: ids[1],
    });
  });
});

describe('recordAgentLeave', () => {
  it('REQ-PB-102 adds a left event with an optional note', () => {
    const board = recordAgentLeave(createBoard(), ACTOR, NOW, 'closing the card');
    expect(board.events).toEqual([
      { seq: 1, at: NOW, actor: ACTOR, type: 'left', text: 'closing the card' },
    ]);
    expect(board.nextSeq).toBe(2);

    const bare = recordAgentLeave(createBoard(), ACTOR, NOW);
    expect(bare.events[0].text).toBeUndefined();
  });
});

describe('event log', () => {
  it('REQ-PB-102 keeps at most 500 events while nextSeq keeps increasing', () => {
    let board = createBoard();
    for (let index = 0; index < 520; index += 1) {
      board = recordAgentLeave(board, ACTOR, NOW + index);
    }
    expect(board.events).toHaveLength(500);
    expect(board.events[0].seq).toBe(21);
    expect(board.events[499].seq).toBe(520);
    expect(board.nextSeq).toBe(521);
  });
});

describe('immutability', () => {
  it('REQ-PB-102 does not mutate the frozen input board', () => {
    const { board, ids } = boardWithCards('A', 'B');
    const frozen = deepFreeze(board);
    const snapshot = JSON.stringify(frozen);

    const next = moveCard(frozen, { cardId: ids[1], to: 'doing', index: 0 }, ACTOR, NOW + 1);
    expect(next).not.toBe(frozen);
    expect(JSON.stringify(frozen)).toBe(snapshot);
    expect(frozen.cards.map((card) => card.column)).toEqual(['todo', 'todo']);
  });

  it('REQ-PB-102 keeps createCard, claimCard and archiveCard pure', () => {
    const frozen = deepFreeze(createBoard());
    const snapshot = JSON.stringify(frozen);
    let next = createCard(frozen, { title: 'A', checklist: ['x'] }, ACTOR, NOW);
    const cardId = next.cards[0].id;
    next = claimCard(next, { cardId }, ACTOR, NOW + 1);
    next = archiveCard(next, { cardId }, ACTOR, NOW + 2);
    expect(JSON.stringify(frozen)).toBe(snapshot);
    expect(frozen.cards).toEqual([]);
  });
});
