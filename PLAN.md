# PowerBoard

**Goal:** A task board for people and AI agents: standalone single-file PowerBoard.html plus the powerboard npm package that PowerScroll embeds, with powerboard-mcp for agents.

**Philosophy:** Port PowerScroll's board as-is first, then generalize behind the pinned contract (src/contract.ts). Free OpenCode agents implement; the coordinator pins specs, reviews and gates.

---

## v0.1 — Extract PowerBoard from PowerScroll
> Rebrand plan (2026-10-16): the board feature becomes the standalone PowerBoard; PowerScroll embeds the package. Plan: C:\Users\cynak\.claude\plans\cheeky-finding-tide.md

### v0.1.0 — Package + standalone app + powerboard-mcp (released 2026-10-16) (COMPLETE)
**Goal:** powerboard package (core/react/bridge/mcp-tools), PowerBoard.html and powerboard-mcp pass the ported PowerScroll tests; an OpenCode agent works a card live on the standalone board.
- [x] W0 contract.ts, SRS_POWERBOARD.md, AGENTS.md (coordinator)
- [x] B1 scaffold: vite lib build with subpath exports, vitest, playwright, tsconfig, CI, single-file app build
- [x] B2 core: port boardOps.ts + vitest unit tests (REQ-PB-102)
- [x] B3 react: port BoardView and parts behind BoardViewProps; presence store (REQ-PB-104)
- [x] B4 CSS token pass: --pb-* custom properties, light/dark (REQ-PB-105)
- [x] B5 bridge: createBoardCommands(adapter), 17 commands + unit tests (REQ-PB-103)
- [x] B6 mcp-tools: tool definitions + withAgentMe + pollBoardUpdates as plain ESM
- [x] B7 powerboard-mcp server on 41778 + node tests (REQ-PB-130/131)
- [x] B8 app shell: multi-board sidebar, file format, open/save/autosave (REQ-PB-110..114)
- [x] B9 app bridge client + settings toggle (REQ-PB-120/121)
- [x] B10 Playwright: port T209-T218 against the standalone app [agent: cp-board-b10]
- [x] B11 README, release workflow (GitHub release PowerBoard.html, npm publish) [agent: cp-board-b11]

## v0.2 — Boards that agents work in

### v0.2.0 — Nested checklists that agents edit (released 2026-10-23) (COMPLETE)
**Goal:** Port PowerScroll v0.90.0: checklists nest, agents add, edit, move and remove items.
- [x] Port checklist depth and the new operations to core [agent: claude]
- [x] Port the checklist bridge commands and MCP tool definitions [agent: claude]
- [x] Card shows nesting with Indent and Outdent [agent: claude]
- [x] Unit, MCP and Playwright checks [agent: claude]
- [x] Release v0.2.0 [agent: claude]

### v0.3.0 — Swim lanes by label (released 2026-10-23) (COMPLETE)
**Goal:** Port PowerScroll v0.91.0: swim lanes per label, a card in each of its labels' lanes.
- [x] Lanes as rows across the columns, collapsible [agent: claude]
- [x] Drag into another lane swaps the card's label [agent: claude]
- [x] Unit and Playwright checks [agent: claude]
- [x] Release v0.3.0 [agent: claude]

## Future (Backlog)
- [ ] npm publish powerboard + powerboard-mcp 0.1.0 (owner npm login; swap mcp's file:.. dependency for ^0.1.0 first, see docs/RELEASING.md)
- [ ] PowerScroll: merge C1-C3 branches (feat/powerboard-branding) once the PowerScroll session can pause; then pin powerboard to the v0.1.0 tag
- [ ] Re-run the standalone E2E with a real free-model agent once OpenCode quota is back (board bookends already verified without an LLM)
- [ ] Optional: say PowerBoard instead of 'board page' in the shared mcp-tools descriptions
