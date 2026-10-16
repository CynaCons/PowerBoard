# PowerBoard — worker briefing

PowerBoard is a task board for people and AI agents. It ships as a standalone
single-file app (`PowerBoard.html`) and as the `powerboard` npm package that
PowerScroll embeds. Its code is ported from PowerScroll
(`C:\dev\private-repo\PowerNote`). Read that repo for reference, never edit it.

## Rules
- `src/contract.ts` is pinned by the coordinator. Do not edit it. If it blocks you,
  say so in your final answer.
- Port PowerScroll code **as-is first**: the same names, logic, error codes,
  `data-testid`s and CSS classes. Change only what your task says.
- Requirements live in `docs/SRS_POWERBOARD.md`. Cite the REQ IDs you cover in
  test names, e.g. `it('REQ-BOARD-007 waiting needs a question', ...)`.
- Stay inside the files your task names. Do not touch other packages or folders.
- Never commit generated output (`dist/`, `node_modules/`).
- When done, run the acceptance commands from your task. Then **commit on your
  current branch** with a conventional message (`feat(core): ...`). **Do not push.**

## Layout (target)
```
src/contract.ts      pinned types + interfaces
src/core/            pure board operations (no React)
src/react/           BoardView + parts, presence store, BoardView.css
src/bridge/          createBoardCommands(adapter)
src/app/             the standalone app (shell, persistence, bridge client)
mcp-tools/           MCP tool definitions + helpers (plain ESM JS)
mcp/                 powerboard-mcp server (Node, ESM)
tests/               Playwright specs
docs/                SRS
```

## Commands
- `npm test`: vitest unit tests
- `npm run typecheck`: `tsc --noEmit`
- `npm run build`: library build (`dist/`)
- `npm run build:app`: `dist-app/PowerBoard.html`
- `npx playwright test`: E2E against the built app
