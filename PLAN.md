# PowerBoard

**Goal:** A task board for people and AI agents: standalone single-file PowerBoard.html plus the powerboard npm package that PowerScroll embeds, with powerboard-mcp for agents.

**Philosophy:** Port PowerScroll's board as-is first, then generalize behind the pinned contract (src/contract.ts). Free OpenCode agents implement; the coordinator pins specs, reviews and gates.

---

## v0.1 — Extract PowerBoard from PowerScroll
> Rebrand plan (2026-10-16): the board feature becomes the standalone PowerBoard; PowerScroll embeds the package. Plan: C:\Users\cynak\.claude\plans\cheeky-finding-tide.md

### v0.1.0 — Package + standalone app + powerboard-mcp (In Progress)
**Goal:** powerboard package (core/react/bridge/mcp-tools), PowerBoard.html and powerboard-mcp pass the ported PowerScroll tests; an OpenCode agent works a card live on the standalone board.
- [x] W0 contract.ts, SRS_POWERBOARD.md, AGENTS.md (coordinator)
- [x] B1 scaffold: vite lib build with subpath exports, vitest, playwright, tsconfig, CI, single-file app build
- [x] B2 core: port boardOps.ts + vitest unit tests (REQ-PB-102)
- [x] B3 react: port BoardView and parts behind BoardViewProps; presence store (REQ-PB-104)
- [ ] B4 CSS token pass: --pb-* custom properties, light/dark (REQ-PB-105)
- [x] B5 bridge: createBoardCommands(adapter), 17 commands + unit tests (REQ-PB-103)
- [x] B6 mcp-tools: tool definitions + withAgentMe + pollBoardUpdates as plain ESM
- [x] B7 powerboard-mcp server on 41778 + node tests (REQ-PB-130/131)
- [ ] B8 app shell: multi-board sidebar, file format, open/save/autosave (REQ-PB-110..114)
- [ ] B9 app bridge client + settings toggle (REQ-PB-120/121)
- [ ] B10 Playwright: port T209-T218 against the standalone app
- [ ] B11 README, release workflow (GitHub release PowerBoard.html, npm publish)
