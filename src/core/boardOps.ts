import type {
  BoardCard,
  BoardCheckItem,
  BoardColumnId,
  BoardData,
  BoardEvent,
  BoardEventType,
  BoardNote,
} from '../contract';
import { generateId } from './ids';

export const BOARD_COLUMNS: ReadonlyArray<{
  id: BoardColumnId;
  title: string;
}> = [
  { id: 'todo', title: 'To do' },
  { id: 'doing', title: 'In progress' },
  { id: 'waiting', title: 'Waiting for feedback' },
  { id: 'done', title: 'Done' },
];

/** A small, inspectable domain error for UI callers and future agent tools. */
export class BoardOperationError extends Error {
  constructor(
    public readonly code: 'NOT_FOUND' | 'QUESTION_REQUIRED' | 'ARCHIVED',
    message: string,
  ) {
    super(message);
    this.name = 'BoardOperationError';
  }
}

interface CreateCardArgs {
  title: string;
  column?: BoardColumnId;
  description?: string;
  labels?: string[];
  checklist?: string[];
}

interface UpdateCardArgs {
  cardId: string;
  title?: string;
  description?: string;
  labels?: string[];
}

interface MoveCardArgs {
  cardId: string;
  to: BoardColumnId;
  index: number;
  question?: string;
}

export function createBoard(): BoardData {
  return {
    cards: [],
    events: [],
    nextNumber: 1,
    nextSeq: 1,
  };
}

function appendEvent(
  board: BoardData,
  type: BoardEventType,
  actor: string,
  at: number,
  extra: Partial<BoardEvent> = {},
): BoardData {
  const next: BoardEvent = {
    seq: board.nextSeq,
    at,
    actor,
    type,
    ...extra,
  };

  return {
    ...board,
    events: [...board.events, next].slice(-500),
    nextSeq: board.nextSeq + 1,
  };
}

export function isArchived(card: BoardCard): boolean {
  return Boolean(card.archivedAt);
}

export function liveCards(cards: BoardCard[]): BoardCard[] {
  return cards.filter((card) => !isArchived(card));
}

function getCard(board: BoardData, id: string): BoardCard {
  const found = board.cards.find((item) => item.id === id);

  if (!found) {
    throw new BoardOperationError('NOT_FOUND', `Board card "${id}" was not found`);
  }

  return found;
}

function requireLive(card: BoardCard): BoardCard {
  if (isArchived(card)) {
    throw new BoardOperationError('ARCHIVED', `Board card "${card.id}" is archived`);
  }
  return card;
}

/** Resolve a card by id, number (`15`), or `#15`. */
export function resolveCardRef(board: BoardData, card: string | number): BoardCard {
  if (typeof card === 'number' || /^-?\d+$/.test(String(card)) || /^#\d+$/.test(String(card).trim())) {
    const number = typeof card === 'number'
      ? card
      : Number(String(card).trim().replace(/^#/, ''));
    const found = board.cards.find((item) => item.number === number);
    if (!found) {
      throw new BoardOperationError('NOT_FOUND', `Board card #${number} was not found`);
    }
    return found;
  }

  return getCard(board, String(card));
}

/** Resolve a checklist item by id or 1-based index. */
export function resolveCheckItem(card: BoardCard, item: string | number): BoardCheckItem {
  if (typeof item === 'number' || /^-?\d+$/.test(String(item))) {
    const index = typeof item === 'number' ? item : Number(item);
    const found = card.checklist[index - 1];
    if (!found) {
      throw new BoardOperationError(
        'NOT_FOUND',
        `Checklist item ${index} was not found on card #${card.number}`,
      );
    }
    return found;
  }

  const found = card.checklist.find((entry) => entry.id === item);
  if (!found) {
    throw new BoardOperationError('NOT_FOUND', `Checklist item "${item}" was not found`);
  }
  return found;
}

function orderedInColumn(cards: BoardCard[], column: BoardColumnId): BoardCard[] {
  return liveCards(cards)
    .filter((item) => item.column === column)
    .sort((left, right) => left.order - right.order)
    .map((item, order) => ({ ...item, order }));
}

function normalizeOrders(cards: BoardCard[]): BoardCard[] {
  const live = BOARD_COLUMNS.flatMap((column) => orderedInColumn(cards, column.id));
  const archived = cards.filter((card) => isArchived(card));
  return [...live, ...archived];
}

function replaceCard(
  board: BoardData,
  cardId: string,
  update: (card: BoardCard) => BoardCard,
): BoardCard[] {
  return board.cards.map((item) => (item.id === cardId ? update(item) : item));
}

export function createCard(
  board: BoardData,
  args: CreateCardArgs,
  actor: string,
  now: number,
): BoardData {
  const column = args.column ?? 'todo';
  const newCard: BoardCard = {
    id: generateId(),
    number: board.nextNumber,
    title: args.title.trim() || 'Untitled card',
    description: args.description ?? '',
    column,
    order: liveCards(board.cards).filter((item) => item.column === column).length,
    labels: args.labels ?? [],
    checklist: (args.checklist ?? [])
      .map((text) => text.trim())
      .filter(Boolean)
      .map((text) => ({
        id: generateId(),
        text,
        done: false,
      })),
    notes: [],
    createdBy: actor,
    createdAt: now,
    updatedAt: now,
  };

  return appendEvent(
    {
      ...board,
      cards: [...board.cards, newCard],
      nextNumber: board.nextNumber + 1,
    },
    'created',
    actor,
    now,
    { cardId: newCard.id },
  );
}

export function updateCard(
  board: BoardData,
  args: UpdateCardArgs,
  actor: string,
  now: number,
): BoardData {
  requireLive(getCard(board, args.cardId));

  return appendEvent(
    {
      ...board,
      cards: replaceCard(board, args.cardId, (current) => ({
        ...current,
        ...(args.title !== undefined ? { title: args.title } : {}),
        ...(args.description !== undefined ? { description: args.description } : {}),
        ...(args.labels !== undefined ? { labels: args.labels } : {}),
        updatedAt: now,
      })),
    },
    'updated',
    actor,
    now,
    { cardId: args.cardId },
  );
}

export function moveCard(
  board: BoardData,
  args: MoveCardArgs,
  actor: string,
  now: number,
): BoardData {
  const found = requireLive(getCard(board, args.cardId));
  const question = args.question?.trim();

  if (args.to === 'waiting' && !question && !found.question) {
    throw new BoardOperationError(
      'QUESTION_REQUIRED',
      'A question is required before a card can wait for feedback',
    );
  }

  const remaining = board.cards.filter((item) => item.id !== args.cardId);
  const destination = orderedInColumn(remaining, args.to);
  const index = Math.max(0, Math.min(args.index, destination.length));

  destination.splice(index, 0, {
    ...found,
    column: args.to,
    question: args.to === 'waiting' ? question ?? found.question : undefined,
    updatedAt: now,
  });

  return appendEvent(
    {
      ...board,
      cards: normalizeOrders([
        ...remaining.filter((item) => item.column !== args.to),
        ...destination,
      ]),
    },
    'moved',
    actor,
    now,
    {
      cardId: args.cardId,
      from: found.column,
      to: args.to,
      text: args.to === 'waiting' ? question ?? found.question : undefined,
    },
  );
}

export function claimCard(
  board: BoardData,
  args: { cardId: string },
  actor: string,
  now: number,
): BoardData {
  requireLive(getCard(board, args.cardId));

  return appendEvent(
    {
      ...board,
      cards: replaceCard(board, args.cardId, (current) => ({
        ...current,
        assignee: actor,
        updatedAt: now,
      })),
    },
    'claimed',
    actor,
    now,
    { cardId: args.cardId },
  );
}

export function releaseCard(
  board: BoardData,
  args: { cardId: string },
  actor: string,
  now: number,
): BoardData {
  requireLive(getCard(board, args.cardId));

  return appendEvent(
    {
      ...board,
      cards: replaceCard(board, args.cardId, (current) => ({
        ...current,
        assignee: undefined,
        updatedAt: now,
      })),
    },
    'released',
    actor,
    now,
    { cardId: args.cardId },
  );
}

export function addNote(
  board: BoardData,
  args: { cardId: string; text: string },
  actor: string,
  now: number,
): BoardData {
  requireLive(getCard(board, args.cardId));

  const note: BoardNote = {
    id: generateId(),
    author: actor,
    at: now,
    text: args.text.trim(),
  };

  return appendEvent(
    {
      ...board,
      cards: replaceCard(board, args.cardId, (current) => ({
        ...current,
        notes: [...current.notes, note],
        updatedAt: now,
      })),
    },
    'noted',
    actor,
    now,
    { cardId: args.cardId, text: note.text },
  );
}

export function addChecklistItem(
  board: BoardData,
  args: { cardId: string; text: string },
  actor: string,
  now: number,
): BoardData {
  requireLive(getCard(board, args.cardId));

  const item: BoardCheckItem = {
    id: generateId(),
    text: args.text.trim(),
    done: false,
  };

  return appendEvent(
    {
      ...board,
      cards: replaceCard(board, args.cardId, (current) => ({
        ...current,
        checklist: [...current.checklist, item],
        updatedAt: now,
      })),
    },
    'updated',
    actor,
    now,
    { cardId: args.cardId, text: item.text },
  );
}

export function setChecklistItem(
  board: BoardData,
  args: { cardId: string; itemId: string; done: boolean },
  actor: string,
  now: number,
): BoardData {
  const found = requireLive(getCard(board, args.cardId));

  if (!found.checklist.some((item) => item.id === args.itemId)) {
    throw new BoardOperationError('NOT_FOUND', `Checklist item "${args.itemId}" was not found`);
  }

  return appendEvent(
    {
      ...board,
      cards: replaceCard(board, args.cardId, (current) => ({
        ...current,
        checklist: current.checklist.map((item) =>
          item.id === args.itemId ? { ...item, done: args.done } : item,
        ),
        updatedAt: now,
      })),
    },
    'checked',
    actor,
    now,
    { cardId: args.cardId },
  );
}

export function removeChecklistItem(
  board: BoardData,
  args: { cardId: string; itemId: string },
  actor: string,
  now: number,
): BoardData {
  const found = requireLive(getCard(board, args.cardId));

  if (!found.checklist.some((item) => item.id === args.itemId)) {
    throw new BoardOperationError('NOT_FOUND', `Checklist item "${args.itemId}" was not found`);
  }

  return appendEvent(
    {
      ...board,
      cards: replaceCard(board, args.cardId, (current) => ({
        ...current,
        checklist: current.checklist.filter((item) => item.id !== args.itemId),
        updatedAt: now,
      })),
    },
    'updated',
    actor,
    now,
    { cardId: args.cardId },
  );
}

export function deleteCard(
  board: BoardData,
  args: { cardId: string },
  actor: string,
  now: number,
): BoardData {
  requireLive(getCard(board, args.cardId));

  return appendEvent(
    {
      ...board,
      cards: normalizeOrders(board.cards.filter((item) => item.id !== args.cardId)),
    },
    'deleted',
    actor,
    now,
    { cardId: args.cardId },
  );
}

export function archiveCard(
  board: BoardData,
  args: { cardId: string },
  actor: string,
  now: number,
): BoardData {
  requireLive(getCard(board, args.cardId));

  return appendEvent(
    {
      ...board,
      cards: normalizeOrders(replaceCard(board, args.cardId, (current) => ({
        ...current,
        archivedAt: now,
        updatedAt: now,
      }))),
    },
    'archived',
    actor,
    now,
    { cardId: args.cardId },
  );
}

export function restoreCard(
  board: BoardData,
  args: { cardId: string },
  actor: string,
  now: number,
): BoardData {
  const found = getCard(board, args.cardId);
  if (!isArchived(found)) {
    throw new BoardOperationError('NOT_FOUND', `Board card "${args.cardId}" is not archived`);
  }

  const others = board.cards.filter((item) => item.id !== args.cardId);
  const liveCount = liveCards(others).filter((item) => item.column === found.column).length;
  const restored: BoardCard = {
    ...found,
    archivedAt: undefined,
    order: liveCount,
    updatedAt: now,
  };

  return appendEvent(
    {
      ...board,
      cards: normalizeOrders([...others, restored]),
    },
    'restored',
    actor,
    now,
    { cardId: args.cardId },
  );
}

export function clearDone(
  board: BoardData,
  actor: string,
  now: number,
): BoardData {
  const done = liveCards(board.cards).filter((card) => card.column === 'done');
  let next = board;
  for (const card of done) {
    next = archiveCard(next, { cardId: card.id }, actor, now);
  }
  return next;
}

export function recordAgentLeave(
  board: BoardData,
  actor: string,
  now: number,
  note?: string,
): BoardData {
  return appendEvent(
    board,
    'left',
    actor,
    now,
    note ? { text: note } : {},
  );
}
