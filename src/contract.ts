/**
 * PowerBoard contract — pinned by the coordinator. Workers implement against
 * this file and must not change it; ask on the card (move to waiting) instead.
 *
 * The board data types are copied verbatim from PowerScroll
 * (src/types/data.ts) so notebooks written before the split load unchanged:
 * a PowerScroll page with `kind: 'board'` carries exactly this `BoardData`.
 */

// ── Board data (verbatim from PowerScroll; do not rename or reshape) ──────────

export type BoardColumnId = 'todo' | 'doing' | 'waiting' | 'done';

export interface BoardNote {
  id: string;
  author: string;
  at: number;
  text: string;
}

export interface BoardCheckItem {
  id: string;
  text: string;
  done: boolean;
  /** Nesting level, 0 to 3 (REQ-BOARD-040); absent means the top level. */
  depth?: number;
}

export interface BoardCard {
  id: string;
  number: number;
  title: string;
  description: string;
  column: BoardColumnId;
  order: number;
  assignee?: string;
  labels: string[];
  checklist: BoardCheckItem[];
  notes: BoardNote[];
  question?: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  /** Absent means the card is live; no migration for older notebooks. */
  archivedAt?: number;
}

export type BoardEventType =
  | 'created'
  | 'moved'
  | 'updated'
  | 'claimed'
  | 'released'
  | 'noted'
  | 'checked'
  | 'deleted'
  | 'archived'
  | 'restored'
  | 'left';

export interface BoardEvent {
  seq: number;
  at: number;
  actor: string;
  type: BoardEventType;
  cardId?: string;
  from?: BoardColumnId;
  to?: BoardColumnId;
  text?: string;
}

export interface BoardData {
  cards: BoardCard[];
  events: BoardEvent[];
  nextNumber: number;
  nextSeq: number;
  /** New in PowerBoard. Absent means 1; PowerScroll notebooks never wrote it. */
  schemaVersion?: 1;
}

/** The owner's actor name. Agents may never use it. */
export const OWNER_ACTOR = 'you';

// ── Host adapter (how a host app hands boards to PowerBoard) ─────────────────
//
// PowerScroll implements it over its workspace store (a board is a page with
// kind:'board'); the standalone app implements it over its own file store.
// The bridge commands (src/bridge) talk only to this interface.

export interface BoardRef {
  id: string;
  title: string;
  board: BoardData;
  /** Host grouping, e.g. the PowerScroll section. The standalone app leaves these out. */
  sectionId?: string;
  section?: string;
}

export interface BoardHostAdapter {
  listBoards(): BoardRef[];
  getBoard(id: string): BoardRef | undefined;
  /**
   * Replace the board with fn(current). The host persists it (marks the file
   * dirty / autosaves) and does NOT add it to any undo history.
   */
  updateBoard(id: string, fn: (current: BoardData) => BoardData): void;
  /**
   * Create an empty board and return it. Must not switch the owner's active
   * page/board. Throws BridgeCommandError('NOT_FOUND') for an unknown sectionId.
   */
  createBoard(title: string, opts?: { sectionId?: string }): BoardRef;
  /**
   * Title of a NON-board page with this id, if the host has such pages
   * (PowerScroll canvas pages). Lets the bridge answer `PRECONDITION: Page "…"
   * is not a board` instead of NOT_FOUND, as PowerScroll always did.
   */
  pageTitle?(id: string): string | undefined;
}

// ── Presence (agents strip) ──────────────────────────────────────────────────
//
// The presence store moves into PowerBoard unchanged (zustand), exported from
// `powerboard/react` as `useAgentPresenceStore`; the host's bridge client calls
// `setConnected` on each `agents` frame. Constants are unchanged:
export const AGENT_ACTIVE_MS = 60_000;
export const AGENT_RECENT_MS = 30 * 60_000;
export const AGENT_TICK_MS = 5_000;

// ── React view ───────────────────────────────────────────────────────────────

export interface BoardViewProps {
  boardId: string;
  title: string;
  board: BoardData;
  /** Apply an edit. Same semantics as BoardHostAdapter.updateBoard. */
  onChange(fn: (current: BoardData) => BoardData): void;
  /** Rename from the board header; omit to make the title read-only. */
  onRename?(title: string): void;
  /** localStorage key for the activity panel collapsed state (device preference). */
  activityCollapsedKey?: string; // default 'powerboard-activity-collapsed'
  /**
   * Markdown → HTML for card descriptions. Default: PowerBoard's built-in
   * renderer (marked, GFM, clickable task checkboxes, no math). PowerScroll
   * passes its own `markdownToHtml` so KaTeX keeps working when embedded.
   */
  renderMarkdown?(markdown: string): string;
}

// ── Standalone file format (PowerBoard.html) ─────────────────────────────────
//
// The app and its data live in one HTML file. The data is JSON inside
//   <script id="powerboard-data" type="application/json">…</script>
// with `<` escaped as < so the JSON can never close the script tag.

export interface PowerBoardFile {
  format: 'powerboard';
  version: 1;
  title: string;
  boards: Array<{ id: string; title: string; board: BoardData }>;
  /** Board shown when the file opens. */
  activeBoardId?: string;
}

// ── Agent bridge ─────────────────────────────────────────────────────────────

/** powerboard-mcp hosts ws://127.0.0.1:POWERBOARD_BRIDGE_PORT; the app dials out. */
export const POWERBOARD_BRIDGE_PORT = 41778; // PowerScroll keeps 41777
