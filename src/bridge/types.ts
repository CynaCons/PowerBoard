/**
 * Board bridge payloads and errors.
 *
 * Copied verbatim from PowerScroll's `src/bridge/protocol.ts` (the board /
 * card payload block and `BridgeCommandError`) so the MCP server, the host's
 * bridge client and the agent-facing results keep the exact same shapes and
 * error codes after the split.
 */

export type BridgeErrorCode =
  | 'BAD_PARAMS'
  | 'INVALID'
  | 'NAME_REQUIRED'
  | 'NOT_FOUND'
  | 'UNSUPPORTED'
  /** Command is valid but the app cannot run it in its current state. */
  | 'PRECONDITION'
  | 'QUESTION_REQUIRED'
  | 'ARCHIVED'
  | 'INTERNAL';

export class BridgeCommandError extends Error {
  code: BridgeErrorCode;
  constructor(code: BridgeErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'BridgeCommandError';
  }
}

/** The 17 board commands, named after their MCP tools. */
export type BoardCommandName =
  | 'board_list'
  | 'board_create'
  | 'board_read'
  | 'card_create'
  | 'card_get'
  | 'card_update'
  | 'card_claim'
  | 'card_release'
  | 'card_move'
  | 'card_note'
  | 'card_check'
  | 'card_checklist_add'
  | 'card_checklist_update'
  | 'card_checklist_remove'
  | 'card_checklist_move'
  | 'card_checklist_set'
  | 'card_archive'
  | 'card_restore'
  | 'agent_status'
  | 'agent_leave'
  | 'board_updates';

// ── Board / card payloads ───────────────────────────────────

export interface BoardColumnCounts {
  todo: number;
  doing: number;
  waiting: number;
  done: number;
}

export interface BoardListEntry {
  id: string;
  title: string;
  sectionId: string;
  section: string;
  counts: BoardColumnCounts;
}

export interface BoardListResult {
  boards: BoardListEntry[];
}

export interface BoardCreateResult {
  boardId: string;
  title: string;
  sectionId: string;
}

export interface CardNoteSummary {
  author: string;
  text: string;
  at: number;
}

export interface CardListEntry {
  id: string;
  number: number;
  title: string;
  column: string;
  order: number;
  assignee?: string;
  labels: string[];
  checklist: { done: number; total: number };
  question?: string;
  lastNote?: CardNoteSummary;
  updatedAt: number;
  archivedAt?: number;
}

/** A checklist item as agents see it: `index` is its 1-based position, `depth` its level (0 to 3). */
export interface CheckItemEntry {
  id: string;
  index: number;
  text: string;
  done: boolean;
  depth: number;
}

/** A card after a checklist change, with the item it touched. */
export interface ChecklistEditResult extends CardListEntry {
  item?: CheckItemEntry;
  items: CheckItemEntry[];
}

export interface BoardReadResult {
  boardId: string;
  title: string;
  cards: CardListEntry[];
}

export interface BoardCardDetail {
  id: string;
  number: number;
  title: string;
  description: string;
  column: string;
  order: number;
  assignee?: string;
  labels: string[];
  checklist: CheckItemEntry[];
  notes: Array<{ id: string; author: string; at: number; text: string }>;
  question?: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  archivedAt?: number;
  history: Array<{
    seq: number;
    at: number;
    actor: string;
    type: string;
    from?: string;
    to?: string;
    text?: string;
  }>;
}

export interface CardGetResult {
  boardId: string;
  card: BoardCardDetail;
}

export interface BoardEventEntry {
  seq: number;
  at: number;
  actor: string;
  type: string;
  cardId?: string;
  card?: number;
  from?: string;
  to?: string;
  text?: string;
}

export interface BoardUpdatesResult {
  events: BoardEventEntry[];
  cursor: number;
}

export interface AgentStatusResult {
  me: string;
  text: string;
  boardId?: string;
  cardId?: string;
}

export interface AgentLeaveResult {
  me: string;
  boardId?: string;
}
