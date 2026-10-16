/**
 * Board/card bridge commands. These update the board in place through the
 * `BoardHostAdapter` and never switch the owner's active page or flush any
 * canvas.
 *
 * Ported from PowerScroll's `src/bridge/boardCommands.ts`. The logic,
 * validation and error codes/messages are unchanged; only the workspace
 * store and the presence store are replaced by the host adapter and the
 * optional presence sink.
 */

import type { BoardCard, BoardColumnId, BoardData, BoardHostAdapter, BoardRef } from '../core';
import {
  addChecklistItem,
  addNote,
  archiveCard,
  BOARD_COLUMNS,
  BoardOperationError,
  claimCard,
  createCard,
  liveCards,
  moveCard,
  recordAgentLeave,
  releaseCard,
  resolveCardRef,
  resolveCheckItem,
  restoreCard,
  setChecklistItem,
  updateCard,
} from '../core';
import { BridgeCommandError } from './types';
import type {
  AgentLeaveResult,
  AgentStatusResult,
  BoardCardDetail,
  BoardCommandName,
  BoardCreateResult,
  BoardListResult,
  BoardReadResult,
  BoardUpdatesResult,
  CardGetResult,
  CardListEntry,
} from './types';

const ACTOR_RE = /^[a-z0-9][a-z0-9._-]{0,39}$/;
const COLUMNS = new Set<BoardColumnId>(BOARD_COLUMNS.map((column) => column.id));

/**
 * Where the commands report agent activity. The host passes its presence
 * store; without one every call is a no-op (e.g. in tests or a headless
 * bridge).
 */
export interface PresenceSink {
  recordAction(actor: string, info?: { cardId?: string; boardId?: string; status?: string }): void;
  leave(name: string): void;
  /** Replaces `useAgentPresenceStore...actors[actor]?.boardId`. */
  lastBoardOf(actor: string): string | undefined;
}

/**
 * Names an MCP server used to generate (agent-<8 hex>) or gives to unnamed
 * processes. They change on every restart, so one agent reconnecting would
 * fill the board with strangers — agents must say who they are.
 */
const GENERATED_NAME_RE = /^(agent|unnamed)-[0-9a-f]{8}$/;

export function createBoardCommands(
  adapter: BoardHostAdapter,
  presence?: PresenceSink,
): Record<BoardCommandName, (params: Record<string, unknown>) => unknown> {
  function requireActor(params: Record<string, unknown>): string {
    const raw = params.actor ?? params.me;
    const missing = raw === undefined || raw === null || raw === '';
    if (missing || (typeof raw === 'string' && GENERATED_NAME_RE.test(raw))) {
      throw new BridgeCommandError(
        'NAME_REQUIRED',
        'Tell PowerScroll who you are: pass "me" with your agent name (e.g. "feature-1"), ' +
          'the same name every session.',
      );
    }
    if (typeof raw !== 'string' || !ACTOR_RE.test(raw)) {
      throw new BridgeCommandError(
        'INVALID',
        '"me" / "actor" must match ^[a-z0-9][a-z0-9._-]{0,39}$',
      );
    }
    return raw;
  }

  function requireString(params: Record<string, unknown>, key: string): string {
    const value = params[key];
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new BridgeCommandError('INVALID', `"${key}" must be a non-empty string`);
    }
    return value.trim();
  }

  function optionalString(params: Record<string, unknown>, key: string): string | undefined {
    const value = params[key];
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'string') {
      throw new BridgeCommandError('INVALID', `"${key}" must be a string when provided`);
    }
    return value;
  }

  function optionalBool(params: Record<string, unknown>, key: string): boolean | undefined {
    const value = params[key];
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'boolean') {
      throw new BridgeCommandError('INVALID', `"${key}" must be a boolean when provided`);
    }
    return value;
  }

  function optionalInt(params: Record<string, unknown>, key: string): number | undefined {
    const value = params[key];
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      throw new BridgeCommandError('INVALID', `"${key}" must be a non-negative integer`);
    }
    return value;
  }

  function optionalStringList(params: Record<string, unknown>, key: string): string[] | undefined {
    const value = params[key];
    if (value === undefined || value === null) return undefined;
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
      throw new BridgeCommandError('INVALID', `"${key}" must be an array of strings`);
    }
    return value;
  }

  function requireCardRef(params: Record<string, unknown>): string | number {
    const card = params.card;
    if (typeof card === 'number' && Number.isInteger(card) && card > 0) return card;
    if (typeof card === 'string' && card.trim().length > 0) return card.trim();
    throw new BridgeCommandError('INVALID', '"card" must be a card id or number (15 or "#15")');
  }

  function optionalColumnId(
    params: Record<string, unknown>,
    key = 'column',
  ): BoardColumnId | undefined {
    const value = params[key];
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value !== 'string' || !COLUMNS.has(value as BoardColumnId)) {
      throw new BridgeCommandError(
        'INVALID',
        `"${key}" must be one of ${BOARD_COLUMNS.map((column) => column.id).join(', ')}`,
      );
    }
    return value as BoardColumnId;
  }

  /** A host page that is not a board → PRECONDITION (PowerScroll's wording); nothing at all → NOT_FOUND. */
  function notABoardOrMissing(id: string): BridgeCommandError {
    const title = adapter.pageTitle?.(id);
    return title !== undefined
      ? new BridgeCommandError('PRECONDITION', `Page "${title}" is not a board`)
      : new BridgeCommandError('NOT_FOUND', `No page with id "${id}"`);
  }

  function requireBoard(boardId: string): BoardRef {
    const ref = adapter.getBoard(boardId);
    if (!ref) {
      throw notABoardOrMissing(boardId);
    }
    if (!ref.board) {
      throw new BridgeCommandError('PRECONDITION', `Page "${ref.title}" is not a board`);
    }
    return ref;
  }

  function runBoardOp<T>(fn: () => T): T {
    try {
      return fn();
    } catch (err) {
      if (err instanceof BoardOperationError) {
        throw new BridgeCommandError(err.code, err.message);
      }
      throw err;
    }
  }

  function recordAction(
    actor: string,
    info: { boardId?: string; cardId?: string; status?: string },
  ): void {
    presence?.recordAction(actor, info);
  }

  function lastNote(card: BoardCard): CardListEntry['lastNote'] {
    const note = card.notes[card.notes.length - 1];
    if (!note) return undefined;
    return { author: note.author, text: note.text, at: note.at };
  }

  function summariseCard(card: BoardCard): CardListEntry {
    return {
      id: card.id,
      number: card.number,
      title: card.title,
      column: card.column,
      order: card.order,
      assignee: card.assignee,
      labels: card.labels,
      checklist: {
        done: card.checklist.filter((item) => item.done).length,
        total: card.checklist.length,
      },
      question: card.question,
      lastNote: lastNote(card),
      updatedAt: card.updatedAt,
      archivedAt: card.archivedAt,
    };
  }

  function cardDetail(board: BoardData, card: BoardCard): BoardCardDetail {
    return {
      id: card.id,
      number: card.number,
      title: card.title,
      description: card.description,
      column: card.column,
      order: card.order,
      assignee: card.assignee,
      labels: card.labels,
      checklist: card.checklist.map((item) => ({ id: item.id, text: item.text, done: item.done })),
      notes: card.notes.map((note) => ({
        id: note.id,
        author: note.author,
        at: note.at,
        text: note.text,
      })),
      question: card.question,
      createdBy: card.createdBy,
      createdAt: card.createdAt,
      updatedAt: card.updatedAt,
      archivedAt: card.archivedAt,
      history: board.events
        .filter((event) => event.cardId === card.id)
        .map((event) => ({
          seq: event.seq,
          at: event.at,
          actor: event.actor,
          type: event.type,
          from: event.from,
          to: event.to,
          text: event.text,
        })),
    };
  }

  function countsOf(board: BoardData) {
    const live = liveCards(board.cards);
    return {
      todo: live.filter((card) => card.column === 'todo').length,
      doing: live.filter((card) => card.column === 'doing').length,
      waiting: live.filter((card) => card.column === 'waiting').length,
      done: live.filter((card) => card.column === 'done').length,
    };
  }

  function editBoard(
    boardId: string,
    actor: string,
    cardId: string | undefined,
    fn: (board: BoardData) => BoardData,
  ): BoardData {
    const next = runBoardOp(() => fn(requireBoard(boardId).board));
    adapter.updateBoard(boardId, () => next);
    recordAction(actor, { boardId, cardId });
    return requireBoard(boardId).board;
  }

  function boardList(): BoardListResult {
    const boards = adapter.listBoards().map((ref) => ({
      id: ref.id,
      title: ref.title,
      sectionId: ref.sectionId ?? '',
      section: ref.section ?? '',
      counts: countsOf(ref.board),
    }));
    return { boards };
  }

  function boardCreate(params: Record<string, unknown>): BoardCreateResult {
    const actor = requireActor(params);
    const title = requireString(params, 'title');
    const sectionId = optionalString(params, 'sectionId');
    // The "active section" default belongs to the adapter now: pass a section
    // only when the caller named one.
    const ref = adapter.createBoard(title, sectionId === undefined ? undefined : { sectionId });
    recordAction(actor, { boardId: ref.id });
    return { boardId: ref.id, title: ref.title, sectionId: ref.sectionId ?? sectionId ?? '' };
  }

  function boardRead(params: Record<string, unknown>): BoardReadResult {
    const boardId = requireString(params, 'boardId');
    const ref = requireBoard(boardId);
    const board = ref.board;
    const column = optionalColumnId(params);
    const assignee = optionalString(params, 'assignee');
    const includeArchived = optionalBool(params, 'include_archived') === true;
    let cards = (includeArchived ? board.cards : liveCards(board.cards)).slice().sort((left, right) => {
      if (left.column === right.column) return left.order - right.order;
      return (
        BOARD_COLUMNS.findIndex((item) => item.id === left.column)
        - BOARD_COLUMNS.findIndex((item) => item.id === right.column)
      );
    });
    if (column) cards = cards.filter((card) => card.column === column);
    if (assignee) cards = cards.filter((card) => card.assignee === assignee);
    return {
      boardId: ref.id,
      title: ref.title,
      cards: cards.map(summariseCard),
    };
  }

  function cardCreate(params: Record<string, unknown>): CardListEntry {
    const actor = requireActor(params);
    const boardId = requireString(params, 'boardId');
    const title = requireString(params, 'title');
    const column = optionalColumnId(params) ?? 'todo';
    const description = optionalString(params, 'description');
    const labels = optionalStringList(params, 'labels');
    const checklist = optionalStringList(params, 'checklist');
    const now = Date.now();
    let createdNumber = 0;
    const board = editBoard(boardId, actor, undefined, (current) => {
      createdNumber = current.nextNumber;
      return createCard(current, { title, column, description, labels, checklist }, actor, now);
    });
    const card = board.cards.find((item) => item.number === createdNumber)!;
    recordAction(actor, { boardId, cardId: card.id });
    return summariseCard(card);
  }

  function cardGet(params: Record<string, unknown>): CardGetResult {
    const boardId = requireString(params, 'boardId');
    const { board } = requireBoard(boardId);
    const card = runBoardOp(() => resolveCardRef(board, requireCardRef(params)));
    return { boardId, card: cardDetail(board, card) };
  }

  function cardUpdate(params: Record<string, unknown>): CardListEntry {
    const actor = requireActor(params);
    const boardId = requireString(params, 'boardId');
    const { board } = requireBoard(boardId);
    const card = runBoardOp(() => resolveCardRef(board, requireCardRef(params)));
    const title = optionalString(params, 'title');
    const description = optionalString(params, 'description');
    const labels = optionalStringList(params, 'labels');
    const next = editBoard(boardId, actor, card.id, (current) =>
      updateCard(current, { cardId: card.id, title, description, labels }, actor, Date.now()),
    );
    return summariseCard(next.cards.find((item) => item.id === card.id)!);
  }

  function cardClaim(params: Record<string, unknown>): CardListEntry {
    const actor = requireActor(params);
    const boardId = requireString(params, 'boardId');
    const { board } = requireBoard(boardId);
    const card = runBoardOp(() => resolveCardRef(board, requireCardRef(params)));
    const next = editBoard(boardId, actor, card.id, (current) =>
      claimCard(current, { cardId: card.id }, actor, Date.now()),
    );
    return summariseCard(next.cards.find((item) => item.id === card.id)!);
  }

  function cardRelease(params: Record<string, unknown>): CardListEntry {
    const actor = requireActor(params);
    const boardId = requireString(params, 'boardId');
    const { board } = requireBoard(boardId);
    const card = runBoardOp(() => resolveCardRef(board, requireCardRef(params)));
    const next = editBoard(boardId, actor, card.id, (current) =>
      releaseCard(current, { cardId: card.id }, actor, Date.now()),
    );
    return summariseCard(next.cards.find((item) => item.id === card.id)!);
  }

  function cardMove(params: Record<string, unknown>): CardListEntry {
    const actor = requireActor(params);
    const boardId = requireString(params, 'boardId');
    const to = optionalColumnId(params, 'to');
    if (!to) {
      throw new BridgeCommandError('INVALID', '"to" must be one of todo, doing, waiting, done');
    }
    const question = optionalString(params, 'question');
    const position = optionalInt(params, 'position');
    const { board } = requireBoard(boardId);
    const card = runBoardOp(() => resolveCardRef(board, requireCardRef(params)));
    const remaining = board.cards.filter((item) => item.id !== card.id && item.column === to).length;
    const index = position ?? remaining;
    const next = editBoard(boardId, actor, card.id, (current) =>
      moveCard(current, { cardId: card.id, to, index, question }, actor, Date.now()),
    );
    return summariseCard(next.cards.find((item) => item.id === card.id)!);
  }

  function cardNote(params: Record<string, unknown>): CardListEntry {
    const actor = requireActor(params);
    const boardId = requireString(params, 'boardId');
    const text = requireString(params, 'text');
    const { board } = requireBoard(boardId);
    const card = runBoardOp(() => resolveCardRef(board, requireCardRef(params)));
    const next = editBoard(boardId, actor, card.id, (current) =>
      addNote(current, { cardId: card.id, text }, actor, Date.now()),
    );
    return summariseCard(next.cards.find((item) => item.id === card.id)!);
  }

  function cardCheck(params: Record<string, unknown>): CardListEntry {
    const actor = requireActor(params);
    const boardId = requireString(params, 'boardId');
    const done = optionalBool(params, 'done');
    if (done === undefined) {
      throw new BridgeCommandError('INVALID', '"done" must be a boolean');
    }
    const itemRef = params.item;
    if (
      !(typeof itemRef === 'string' && itemRef.trim().length > 0)
      && !(typeof itemRef === 'number' && Number.isInteger(itemRef))
    ) {
      throw new BridgeCommandError('INVALID', '"item" must be a checklist item id or 1-based index');
    }
    const { board } = requireBoard(boardId);
    const card = runBoardOp(() => resolveCardRef(board, requireCardRef(params)));
    const item = runBoardOp(() => resolveCheckItem(card, itemRef as string | number));
    const next = editBoard(boardId, actor, card.id, (current) =>
      setChecklistItem(current, { cardId: card.id, itemId: item.id, done }, actor, Date.now()),
    );
    return summariseCard(next.cards.find((item) => item.id === card.id)!);
  }

  function cardChecklistAdd(params: Record<string, unknown>): CardListEntry {
    const actor = requireActor(params);
    const boardId = requireString(params, 'boardId');
    const text = requireString(params, 'text');
    const { board } = requireBoard(boardId);
    const card = runBoardOp(() => resolveCardRef(board, requireCardRef(params)));
    const next = editBoard(boardId, actor, card.id, (current) =>
      addChecklistItem(current, { cardId: card.id, text }, actor, Date.now()),
    );
    return summariseCard(next.cards.find((item) => item.id === card.id)!);
  }

  function cardArchive(params: Record<string, unknown>): CardListEntry {
    const actor = requireActor(params);
    const boardId = requireString(params, 'boardId');
    const { board } = requireBoard(boardId);
    const card = runBoardOp(() => resolveCardRef(board, requireCardRef(params)));
    const next = editBoard(boardId, actor, card.id, (current) =>
      archiveCard(current, { cardId: card.id }, actor, Date.now()),
    );
    return summariseCard(next.cards.find((item) => item.id === card.id)!);
  }

  function cardRestore(params: Record<string, unknown>): CardListEntry {
    const actor = requireActor(params);
    const boardId = requireString(params, 'boardId');
    const { board } = requireBoard(boardId);
    const card = runBoardOp(() => resolveCardRef(board, requireCardRef(params)));
    const next = editBoard(boardId, actor, card.id, (current) =>
      restoreCard(current, { cardId: card.id }, actor, Date.now()),
    );
    return summariseCard(next.cards.find((item) => item.id === card.id)!);
  }

  function agentLeave(params: Record<string, unknown>): AgentLeaveResult {
    const actor = requireActor(params);
    const boardIdParam = optionalString(params, 'boardId');
    const note = optionalString(params, 'note');
    const knownBoardId = boardIdParam ?? presence?.lastBoardOf(actor);
    if (knownBoardId) {
      const located = adapter.getBoard(knownBoardId);
      if (boardIdParam) {
        if (!located) {
          throw notABoardOrMissing(knownBoardId);
        }
        if (!located.board) {
          throw new BridgeCommandError('PRECONDITION', `Page "${located.title}" is not a board`);
        }
      }
      if (located?.board) {
        const currentBoard = located.board;
        const next = runBoardOp(() =>
          recordAgentLeave(currentBoard, actor, Date.now(), note),
        );
        adapter.updateBoard(knownBoardId, () => next);
      }
    }
    presence?.leave(actor);
    return { me: actor, boardId: knownBoardId };
  }

  function agentStatus(params: Record<string, unknown>): AgentStatusResult {
    const actor = requireActor(params);
    const text = requireString(params, 'text');
    const boardId = optionalString(params, 'boardId');
    const cardRef = params.card;
    let cardId: string | undefined;
    if (boardId && (typeof cardRef === 'string' || typeof cardRef === 'number')) {
      const { board } = requireBoard(boardId);
      cardId = runBoardOp(() => resolveCardRef(board, cardRef)).id;
    } else if (cardRef !== undefined && cardRef !== null && cardRef !== '') {
      throw new BridgeCommandError('INVALID', '"card" requires "boardId"');
    }
    recordAction(actor, { boardId, cardId, status: text });
    return { me: actor, text, boardId, cardId };
  }

  function boardUpdates(params: Record<string, unknown>): BoardUpdatesResult {
    const boardId = requireString(params, 'boardId');
    const { board } = requireBoard(boardId);
    const since = optionalInt(params, 'since');
    const mine = optionalBool(params, 'mine') === true;
    const me = optionalString(params, 'me') ?? optionalString(params, 'actor');
    const cursor = board.events.length ? board.events[board.events.length - 1].seq : 0;

    if (since === undefined) {
      return { events: [], cursor };
    }

    let events = board.events.filter((event) => event.seq > since);
    if (mine) {
      if (!me) {
        throw new BridgeCommandError('INVALID', '"mine" requires "me"');
      }
      events = events.filter((event) => {
        if (!event.cardId) return false;
        const card = board.cards.find((item) => item.id === event.cardId);
        return card?.assignee === me;
      });
    }

    return {
      events: events.map((event) => ({
        seq: event.seq,
        at: event.at,
        actor: event.actor,
        type: event.type,
        cardId: event.cardId,
        card: event.cardId
          ? board.cards.find((item) => item.id === event.cardId)?.number
          : undefined,
        from: event.from,
        to: event.to,
        text: event.text,
      })),
      cursor: events.length ? events[events.length - 1].seq : cursor,
    };
  }

  return {
    board_list: boardList,
    board_create: boardCreate,
    board_read: boardRead,
    card_create: cardCreate,
    card_get: cardGet,
    card_update: cardUpdate,
    card_claim: cardClaim,
    card_release: cardRelease,
    card_move: cardMove,
    card_note: cardNote,
    card_check: cardCheck,
    card_checklist_add: cardChecklistAdd,
    card_archive: cardArchive,
    card_restore: cardRestore,
    agent_status: agentStatus,
    agent_leave: agentLeave,
    board_updates: boardUpdates,
  };
}
