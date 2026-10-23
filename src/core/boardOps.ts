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
  checklist?: Array<string | ChecklistEntry>;
}

/** A checklist item as written by a person or an agent, before it has an id. */
export interface ChecklistEntry {
  text: string;
  done?: boolean;
  depth?: number;
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
    checklist: newChecklist(
      (args.checklist ?? []).map((entry) => (typeof entry === 'string' ? { text: entry } : entry)),
      [],
    ),
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

/** Deepest checklist level: four levels, 0 to 3, like PowerPlan's outline (REQ-BOARD-040). */
export const MAX_CHECK_DEPTH = 3;

export function depthOf(item: BoardCheckItem): number {
  return item.depth ?? 0;
}

function clampDepth(depth: number, max = MAX_CHECK_DEPTH): number {
  return Math.max(0, Math.min(max, MAX_CHECK_DEPTH, Math.round(depth)));
}

/** Each item at most one level below the item above it; the first at the top level. */
export function normalizeChecklist(items: BoardCheckItem[]): BoardCheckItem[] {
  let above = -1;
  return items.map((item) => {
    const depth = clampDepth(depthOf(item), above + 1);
    above = depth;
    return depth === depthOf(item) ? item : { ...item, depth };
  });
}

/** The index just past `index`'s sub-items. */
export function subtreeEnd(items: BoardCheckItem[], index: number): number {
  let end = index + 1;
  while (end < items.length && depthOf(items[end]) > depthOf(items[index])) end += 1;
  return end;
}

/**
 * Builds a checklist from written entries. An entry whose text matches an
 * item of `previous` keeps that item's id, so an agent rewriting the list does
 * not lose the items it left alone.
 */
function newChecklist(entries: ChecklistEntry[], previous: BoardCheckItem[]): BoardCheckItem[] {
  const unused = [...previous];
  const items = entries
    .map((entry) => ({ ...entry, text: entry.text.trim() }))
    .filter((entry) => entry.text)
    .map((entry) => {
      const at = unused.findIndex((item) => item.text === entry.text);
      const id = at >= 0 ? unused.splice(at, 1)[0].id : generateId();
      return { id, text: entry.text, done: entry.done ?? false, depth: clampDepth(entry.depth ?? 0) };
    });
  return normalizeChecklist(items);
}

/**
 * Reads PowerPlan-style lines: `- [ ] text`, `- [x] text`, two spaces (or a
 * tab) per level. Plain lines and `- text` become open items.
 */
export function parseChecklistText(text: string): ChecklistEntry[] {
  return text.split(/\r?\n/).flatMap((line) => {
    if (!line.trim()) return [];
    const indent = line.match(/^[ \t]*/)![0].replace(/\t/g, '  ').length;
    const body = line.trim().replace(/^[-*+]\s+/, '');
    const box = body.match(/^\[([ xX])\]\s*/);
    return [{
      text: box ? body.slice(box[0].length) : body,
      done: box ? box[1] !== ' ' : false,
      depth: Math.floor(indent / 2),
    }];
  });
}

function withChecklist(
  board: BoardData,
  cardId: string,
  checklist: BoardCheckItem[],
  type: BoardEventType,
  actor: string,
  now: number,
  text?: string,
): BoardData {
  return appendEvent(
    {
      ...board,
      cards: replaceCard(board, cardId, (current) => ({ ...current, checklist, updatedAt: now })),
    },
    type,
    actor,
    now,
    text === undefined ? { cardId } : { cardId, text },
  );
}

/**
 * Adds an item at `index` (0-based; default the end) and `depth` (clamped to
 * one level below the item above it).
 */
export function addChecklistItem(
  board: BoardData,
  args: { cardId: string; text: string; index?: number; depth?: number; done?: boolean; id?: string },
  actor: string,
  now: number,
): BoardData {
  const found = requireLive(getCard(board, args.cardId));
  const list = found.checklist;
  const at = Math.max(0, Math.min(list.length, Math.round(args.index ?? list.length)));
  const above = at === 0 ? -1 : depthOf(list[at - 1]);
  const item: BoardCheckItem = {
    id: args.id ?? generateId(),
    text: args.text.trim(),
    done: args.done ?? false,
    depth: clampDepth(args.depth ?? 0, above + 1),
  };
  const checklist = [...list];
  checklist.splice(at, 0, item);
  return withChecklist(board, args.cardId, normalizeChecklist(checklist), 'updated', actor, now, item.text);
}

export function setChecklistItem(
  board: BoardData,
  args: { cardId: string; itemId: string; done: boolean },
  actor: string,
  now: number,
): BoardData {
  const found = requireLive(getCard(board, args.cardId));
  const target = requireChecklistItem(found, args.itemId);
  const checklist = found.checklist.map((item) =>
    item.id === args.itemId ? { ...item, done: args.done } : item,
  );
  return withChecklist(board, args.cardId, checklist, 'checked', actor, now, target.text);
}

/** Renames a checklist item. Blank text is refused rather than saved as an empty row. */
export function renameChecklistItem(
  board: BoardData,
  args: { cardId: string; itemId: string; text: string },
  actor: string,
  now: number,
): BoardData {
  const found = requireLive(getCard(board, args.cardId));
  const target = requireChecklistItem(found, args.itemId);
  const text = args.text.trim();

  if (!text || text === target.text) return board;

  const checklist = found.checklist.map((item) => (item.id === args.itemId ? { ...item, text } : item));
  return withChecklist(board, args.cardId, checklist, 'updated', actor, now, text);
}

/**
 * Sets an item's level; its sub-items move with it (REQ-BOARD-041). The level
 * is clamped to one below the item above it.
 */
export function setChecklistItemDepth(
  board: BoardData,
  args: { cardId: string; itemId: string; depth: number },
  actor: string,
  now: number,
): BoardData {
  const found = requireLive(getCard(board, args.cardId));
  const target = requireChecklistItem(found, args.itemId);
  const list = found.checklist;
  const at = list.indexOf(target);
  const above = at === 0 ? -1 : depthOf(list[at - 1]);
  const delta = clampDepth(args.depth, above + 1) - depthOf(target);

  if (delta === 0) return board;

  const end = subtreeEnd(list, at);
  const checklist = list.map((item, index) =>
    index >= at && index < end ? { ...item, depth: clampDepth(depthOf(item) + delta) } : item,
  );
  return withChecklist(board, args.cardId, normalizeChecklist(checklist), 'updated', actor, now, target.text);
}

/** Moves a checklist item, alone, to `index` (clamped) in the card's list. */
export function moveChecklistItem(
  board: BoardData,
  args: { cardId: string; itemId: string; index: number },
  actor: string,
  now: number,
): BoardData {
  const found = requireLive(getCard(board, args.cardId));
  const target = requireChecklistItem(found, args.itemId);
  const from = found.checklist.indexOf(target);
  const to = Math.max(0, Math.min(found.checklist.length - 1, Math.round(args.index)));

  if (from === to) return board;

  const checklist = found.checklist.filter((item) => item.id !== args.itemId);
  checklist.splice(to, 0, target);
  return withChecklist(board, args.cardId, normalizeChecklist(checklist), 'updated', actor, now, target.text);
}

/** Replaces the whole checklist; items whose text is unchanged keep their id (REQ-BOARD-042). */
export function replaceChecklist(
  board: BoardData,
  args: { cardId: string; items: ChecklistEntry[] },
  actor: string,
  now: number,
): BoardData {
  const found = requireLive(getCard(board, args.cardId));
  const checklist = newChecklist(args.items, found.checklist);
  return withChecklist(board, args.cardId, checklist, 'updated', actor, now, `checklist of ${checklist.length}`);
}

function requireChecklistItem(card: BoardCard, itemId: string): BoardCheckItem {
  const item = card.checklist.find((entry) => entry.id === itemId);
  if (!item) {
    throw new BoardOperationError('NOT_FOUND', `Checklist item "${itemId}" was not found`);
  }
  return item;
}

/** Removes an item; its sub-items stay, one level up (REQ-BOARD-041). */
export function removeChecklistItem(
  board: BoardData,
  args: { cardId: string; itemId: string },
  actor: string,
  now: number,
): BoardData {
  const found = requireLive(getCard(board, args.cardId));
  const target = requireChecklistItem(found, args.itemId);
  const list = found.checklist;
  const at = list.indexOf(target);
  const end = subtreeEnd(list, at);
  const checklist = list.flatMap((item, index) => {
    if (index === at) return [];
    if (index > at && index < end) return [{ ...item, depth: depthOf(item) - 1 }];
    return [item];
  });
  return withChecklist(board, args.cardId, normalizeChecklist(checklist), 'updated', actor, now);
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
