# SRS: PowerBoard

**Project:** PowerBoard
**Version:** 0.1.0 (draft)
**Date:** 2026-10-16

## Purpose

PowerBoard is a lightweight task board for people and AI agents. It ships two ways:

- **Standalone**: `PowerBoard.html` is one local-first file that holds the app and its boards.
- **Embedded**: PowerScroll renders the same board on a notebook page with `kind: 'board'`,
  through the `powerboard` npm package.

The contract is pinned in `src/contract.ts`.

## Board behaviour (from PowerScroll, unchanged)

These are PowerScroll's board requirements, kept verbatim.

- The IDs are kept so the two codebases trace to the same rows.
- "Notebook" means the host's file. For the standalone app that is `PowerBoard.html`.
- T2xx are PowerScroll's tests. PowerBoard's ported tests keep the same numbers under `tests/`.

| ID | Requirement | Priority | Test |
|---|---|---|---|
| REQ-BOARD-001 | A page may be a board; opening it shall not render canvas tools or drawing surface. | Must | T209 |
| REQ-BOARD-002 | The section add controls shall create ordinary Pages and Board pages independently. | Must | T209 |
| REQ-BOARD-003 | A board shall always use the fixed columns To do, In progress, Waiting for feedback, and Done. | Must | T209 |
| REQ-BOARD-004 | A card face shall show its number, #EEF1F0 labels, feedback state/question, title, vivid stable assignee avatar, and relative time written as just now, N min ago, N h ago or N d ago, plus checklist or note metadata. | Should | T209, T210 |
| REQ-BOARD-005 | Each column shall provide inline quick add, committed by Enter and cancelled by Escape. | Must | T209 |
| REQ-BOARD-006 | Cards shall be draggable by pointer within/across columns, with a visible drop position, and movable/reorderable with Alt+arrow keys. | Must | T209 |
| REQ-BOARD-007 | Moving a card into Waiting for feedback shall require a non-empty feedback question; moving it out clears that question. | Must | T209 |
| REQ-BOARD-008 | A card overlay shall edit title, status, assignee, labels, Markdown description, checklist, notes and card history; Escape, close and backdrop shall close it and restore card focus. | Must | T210 |
| REQ-BOARD-009 | Notes shall record the actor and time; owner-created notes display as You. | Must | T210 |
| REQ-BOARD-010 | Board pages and card data shall survive notebook save and reopen through normal workspace serialization. | Must | T209 |
| REQ-BOARD-011 | Board edits shall be persisted but shall not be added to canvas undo history. | Must | T209 |
| REQ-BOARD-012 | The board shall show the 50 newest board events in a 290 px Activity panel, newest first, with actor avatar, action and relative time. | Should | T210 |
| REQ-BOARD-013 | The card overlay shall use a centred 920 x 760 px maximum dialog with an editable header, two-column body and 250 px details/history sidebar. | Must | T210 |
| REQ-BOARD-014 | Every board write from the agent bridge shall record the supplied `actor` on the card, note and board event it produces. | Must | T211 |
| REQ-BOARD-015 | Moving a card to Waiting for feedback over the bridge shall fail with `QUESTION_REQUIRED` when no question is supplied and the card has none. | Must | T211 |
| REQ-BOARD-016 | Bridge card commands shall accept a card by id, by number (`15`) or by `#15`. | Must | T211 |
| REQ-BOARD-017 | Board bridge commands shall update the board in place and shall not switch the owner's active page or disturb the canvas. | Must | T211 |
| REQ-BOARD-018 | The app shall accept a server `agents` frame `{type:'agents', agents:[{label, role, connectedAt}]}` and store the connected labels. | Must | T212 |
| REQ-BOARD-019 | (superseded by REQ-BOARD-024) A board shall show an agents strip between the header and the columns: one chip per name that is connected or that acted on this board in the last 30 minutes, with avatar, name, status line and a presence dot. | Must | T212 |
| REQ-BOARD-020 | A card is active while its assignee has acted on it in the last 60 s and is still connected: 2 px ring in the agent colour, glow at 22% alpha, 2.4 s pulse, footer "<name> · working now". The window lapsing or the agent disconnecting fades the highlight over ~600 ms. Under `prefers-reduced-motion: reduce` the ring stays and animation is off. Recomputed on a 5 s ticker. | Must | T212 |
| REQ-BOARD-021 | A card changed by someone other than `you` shall flash its background for ~1.2 s; the owner's own edits shall not. | Must | T212 |
| REQ-BOARD-022 | `board_updates` with no `since` shall return `{events: [], cursor}` for the latest event; with `since` it shall return events with seq greater than that cursor. | Must | T211 |
| REQ-BOARD-023 | The Needs me header filter shall show a count badge of cards in Waiting for feedback. | Should | T212 |
| REQ-BOARD-024 | Agent chips shall come from board activity only: a name gets a chip when it acted on this board in the last 30 minutes and has not left. Connected-but-silent MCP process labels shall not appear. Chip avatar, status line and presence-dot colour/blink are unchanged. | Must | T213 |
| REQ-BOARD-025 | A name shall leave the strip (chip removed, its cards stop being active at once, the active fade still plays) when (a) `agent_leave` is called, (b) an `agents` frame arrives without a previously listed process label equal to that name, (c) the owner dismisses the chip via its × (`board-agent-dismiss-<name>`), or (d) 30 minutes of silence on this board. Acting again by that name shall restore the chip and clear left. | Must | T213 |
| REQ-BOARD-026 | A live card may be archived (`archivedAt` set, `archived` event); archived cards are excluded from column order/renumbering, counts, the Needs me filter and "Board · N cards". Done's Clear button (`board-clear-done`) shall confirm inline (`board-clear-done-confirm`) then archive every live Done card. Overlay Archive (`card-archive`) archives that card and closes. `Archived (N)` (`board-archived-toggle`) lists archived cards with Restore (`board-restore-<number>`), which returns a card to the end of its previous column (`restored` event). `moveCard`/`updateCard` on an archived card fail with `ARCHIVED`. Archive state shall persist across save and reopen. | Must | T214 |
| REQ-BOARD-027 | Clicking an agent chip body shall toggle a transient spotlight on that name (`aria-pressed`, `data-spotlight` on the board): cards whose assignee or createdBy is that name stay at full opacity with a 2 px ring in the agent's colour; all other cards dim to about 0.35 opacity. Columns stay in place. Clicking the same chip, another chip, or Escape (when no overlay is open) shall change or clear it. Spotlight shall combine with the All / Needs me filter; dimmed cards stay clickable; active highlighting still shows on top. | Must | T215 |
| REQ-BOARD-028 | The activity panel shall collapse to a 44 px rail from a button in its header, giving the columns the space; the rail shows the live dot, the count of events that arrived while collapsed, and expands on click (the count then clears). The collapsed state is a device preference (localStorage), not saved in the notebook. Owner request 2026-10-14 | Must | T216 |
| REQ-BOARD-029 | Text typed in the card overlay (title, description, assignee) shall stay a draft until the overlay closes (X, Escape, backdrop, Archive, leaving the board or the tab going hidden); closing then writes at most one `updated` event for title and description together and one `claimed`/`released` for the assignee, and nothing if the text is unchanged. Typing shall never write an event per keystroke. Enter in the title or assignee ends editing without saving early. Card history and the activity list shall show a run of adjacent `updated` events by the same actor on the same card as one line. Owner report 2026-10-14 | Must | T218 |

## Standalone app and package (new)

| ID | Requirement | Priority | Test |
|---|---|---|---|
| REQ-PB-101 | The package shall expose `powerboard/core` (pure board operations + types, no React), `powerboard/react` (BoardView and its parts, presence store), `powerboard/bridge` (`createBoardCommands(adapter)`), and `powerboard/mcp-tools` (MCP tool definitions and argument helpers as plain ESM). | Must | `src/core/contract.test.ts`, `src/react/BoardView.test.tsx`, `src/react/components.test.tsx`, `src/bridge/boardCommands.test.ts`, `mcp-tools/test/mcp-tools.test.mjs` |
| REQ-PB-102 | `powerboard/core` operations shall behave exactly like PowerScroll's `src/board/boardOps.ts` (same results, errors and event log; event log capped at 500). | Must | `src/core/boardOps.test.ts` |
| REQ-PB-103 | `createBoardCommands(adapter)` shall implement the 17 board bridge commands (board_list, board_create, board_read, card_create, card_get, card_update, card_claim, card_release, card_move, card_note, card_check, card_checklist_add, card_archive, card_restore, agent_status, agent_leave, board_updates) against `BoardHostAdapter` only, with the same validation and error codes as PowerScroll's `src/bridge/boardCommands.ts`. | Must | `src/bridge/boardCommands.test.ts`, `mcp-tools/test/mcp-tools.test.mjs`, `tests/agent/211-board-agent-tools.spec.ts`, `tests/agent/217-agent-names-required.spec.ts` |
| REQ-PB-104 | `BoardView` shall take `BoardViewProps` and read no host store. Its `data-testid`s and CSS class names shall match PowerScroll's so the host's tests keep passing. | Must | `src/react/BoardView.test.tsx`, `src/react/components.test.tsx`, `tests/board/209-board-page.spec.ts`, `tests/board/210-card-overlay.spec.ts`, `tests/agent/211-board-agent-tools.spec.ts`, `tests/board/212-live-board.spec.ts`, `tests/board/213-agents-leave.spec.ts`, `tests/board/214-clear-done.spec.ts`, `tests/board/215-agent-spotlight.spec.ts`, `tests/board/216-activity-collapse.spec.ts`, `tests/agent/217-agent-names-required.spec.ts`, `tests/board/218-card-drafts.spec.ts` |
| REQ-PB-105 | All board colours shall come from `--pb-*` CSS custom properties with built-in light and dark defaults; a host may override them. | Should | `src/react/tokens.test.ts` |
| REQ-PB-110 | `npm run build:app` shall produce one self-contained `PowerBoard.html` (no external requests) that opens offline. | Must | `tests/app-smoke.spec.ts` |
| REQ-PB-111 | The app shall keep its data in `<script id="powerboard-data" type="application/json">` using the `PowerBoardFile` format; a new file starts with one empty board. | Must | `src/app/fileFormat.test.ts`, `src/app/store.test.ts`, `tests/app-shell.spec.ts` |
| REQ-PB-112 | A sidebar shall list the file's boards and allow create, rename, delete (with confirmation) and switching; the open board is remembered in `activeBoardId`. | Must | `src/app/store.test.ts`, `tests/app-shell.spec.ts` |
| REQ-PB-113 | Ctrl+S shall save the whole app and data into the opened file through the File System Access API, falling back to a download; after the first save, edits autosave. A dirty indicator shall show unsaved changes. | Must | `src/app/store.test.ts`, `tests/app-shell.spec.ts`, `tests/board/209-board-page.spec.ts` |
| REQ-PB-114 | Opening a PowerBoard.html written by an older PowerBoard version shall load its boards unchanged. | Must | `src/app/fileFormat.test.ts`, `tests/app-shell.spec.ts` |
| REQ-PB-120 | Settings shall have an Agent bridge toggle, off by default and stored in localStorage (not in the file), that dials `ws://127.0.0.1:41778` with retry/backoff and shows a status dot. | Must | `src/app/bridge/client.test.ts`, `tests/agent-bridge.spec.ts` |
| REQ-PB-121 | The bridge client shall run board commands through `createBoardCommands` and handle the hub's `agents` frame (REQ-BOARD-018) and `displaced` frame (stop retrying, untick the toggle, say why). | Must | `src/app/bridge/client.test.ts`, `tests/agent-bridge.spec.ts` |
| REQ-PB-130 | `powerboard-mcp` shall serve the board tools plus `bridge_status` over MCP stdio, host the WebSocket on 127.0.0.1:41778, and use the same hub/peer election, lease and LOCKED semantics as powerscroll-mcp (protocol v1). | Must | `mcp/test/board-tools.test.mjs`, `mcp/test/hub-election.test.mjs` |
| REQ-PB-131 | `powerboard-mcp` shall take the agent name from `me` or `POWERBOARD_AGENT_NAME` (falling back to `POWERNOTE_AGENT_NAME`) and reject missing or generated names with NAME_REQUIRED. | Must | `mcp/test/agent-names.test.mjs`, `mcp/test/board-tools.test.mjs`, `mcp-tools/test/mcp-tools.test.mjs`, `tests/agent/217-agent-names-required.spec.ts` |

## Traceability

- T209–T218: `tests/board/*` and `tests/agent/*`, ported from PowerScroll (see the Test column above).
- unit: `src/**/*.test.ts` and `src/**/*.test.tsx` (vitest)
- MCP tool helpers: `mcp-tools/test/*.test.mjs` (Node test runner)
- node: `mcp/test/*.test.mjs`
- Standalone E2E: `tests/app-smoke.spec.ts`, `tests/app-shell.spec.ts` and `tests/agent-bridge.spec.ts` (Playwright)
- Test file references identify existing coverage, not an assertion that every clause has a dedicated test. An untested requirement is marked `—`.
