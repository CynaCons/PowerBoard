# PowerBoard

**A task board for people and AI agents, in one editable HTML file or your app.**

[Download PowerBoard.html](https://github.com/CynaCons/PowerBoard/releases/latest/download/PowerBoard.html) |
[Agent setup](#let-agents-work-on-your-board) |
[Use the package](#use-the-package)

PowerBoard was extracted from [PowerScroll](https://github.com/CynaCons/PowerScroll).
People and agents share cards, checklists, signed notes and activity across
To do, In progress, Waiting for feedback and Done. No account or hosted backend
is required. PowerChannel is the separate agent-chat tool; PowerBoard tracks work.

## Two ways to use it

### Standalone: one file is the app and the data

1. Download [`PowerBoard.html` from the latest release](https://github.com/CynaCons/PowerBoard/releases/latest/download/PowerBoard.html).
2. Open it in a browser and add boards and cards.
3. Press **Ctrl+S** to save the complete app and all your board data in one file.
4. Reopen that saved file to continue, or share it as an editable working copy.

Chrome and Edge can save directly through the File System Access API. Choose a
location on the first save; later edits autosave to that file during the session.
Other browsers download a new HTML copy on save instead. Keep the saved file:
an unsaved browser tab is not your backup.

The sidebar lets you create, rename, delete and switch boards. Cards support
Markdown descriptions, labels, assignees, checklists, notes and history.

### Embedded in PowerScroll

PowerScroll embeds the same board through the `powerboard` npm package, on a
notebook page with `kind: 'board'`. The host owns storage and saving; board data
and behaviour stay the same. Other React hosts can use the package too.

## Let agents work on your board

Run the MCP server with Node.js, without a global installation:

```bash
npx -y powerboard-mcp
```

In PowerBoard, open **Settings > Agent bridge** and enable
**Let a local agent write into this board**. The status dot turns green when
connected. The app dials out to `ws://127.0.0.1:41778`; either side can start first.

Configure your agent to launch the same server:

**Claude Code** - add this to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "powerboard": { "command": "npx", "args": ["-y", "powerboard-mcp"] }
  }
}
```

**Codex** - add to `~/.codex/config.toml`:

```toml
[mcp_servers.powerboard]
command = "npx"
args = ["-y", "powerboard-mcp"]
```

**Cursor** - use `~/.cursor/mcp.json` or your project's `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "powerboard": { "command": "npx", "args": ["-y", "powerboard-mcp"] }
  }
}
```

Restart the agent session so its tools load. Give the agent a stable name such
as `feature-1`: board tools use `me`, or the server's `POWERBOARD_AGENT_NAME`.
Names are never invented; a missing name fails with `NAME_REQUIRED`.

The working loop is:

1. `board_list`, then `board_read` to understand the board.
2. `card_claim`, then `card_move` with `column: "doing"`.
3. Work, ticking `card_check`, leaving `card_note` and updating `agent_status`.
4. When owner input is needed, `card_move` to `waiting` with a non-empty `question`.
5. Use `board_updates` with `mine: true` and `wait_seconds` to wait for a reply.
6. Finish the work, then `card_move` to `done`; `agent_leave` signs off.

Several agents can connect; writes use a single-writer lease and reads remain
available. A `LOCKED` response names the holder; use `bridge_status` to inspect it.
Agent edits use the app's normal save pipeline. See the
[MCP guide](mcp/README.md) for tools, naming rules and connection details.

## Use the package

```bash
npm install powerboard react@18 react-dom@18
```

`powerboard/core` exports the board types and pure, immutable operations such as
`createBoard`, `createCard` and `moveCard`, without React code.
`powerboard/react` exports `BoardView`, its parts and `useAgentPresenceStore`.

```tsx
import { useState } from 'react';
import { createBoard } from 'powerboard/core';
import { BoardView } from 'powerboard/react';
import 'powerboard/style.css';

export function Tasks() {
  const [board, setBoard] = useState(createBoard);
  return <BoardView boardId="tasks" title="Tasks" board={board} onChange={setBoard} />;
}
```

This example keeps state in memory. The host must persist edits; `onChange`
receives an updater function. Supply `onRename` to enable title editing, or
`renderMarkdown` to use your host's Markdown renderer.

`powerboard/bridge` supplies the same 17 board commands through a host adapter:

```ts
import { createBoardCommands, createMemoryAdapter } from 'powerboard/bridge';

const adapter = createMemoryAdapter();
const commands = createBoardCommands(adapter);
```

For real storage, implement `BoardHostAdapter` from `powerboard/core` over your
store. Writes must persist without switching the owner's board or adding canvas
undo entries. `powerboard/mcp-tools` exports the plain ESM `BOARD_TOOLS`,
`withAgentMe` and `pollBoardUpdates` helpers for MCP integrations.

### Theming

Import the library CSS, then override its `--pb-*` custom properties on the board:

```css
.my-app .board-view { --pb-accent: #7c3aed; --pb-bg: #f7f8f7; }
```

Load overrides after the library CSS. Built-in light and dark defaults follow
the OS; `data-pb-theme="light"` or `"dark"` on an ancestor pins the theme.
See [BoardView.css](src/react/BoardView.css) for the complete token set.

## Development

Use Node.js 22.12+ (22.x in CI) and npm. From the repository root:

```bash
npm install
npm install --prefix mcp
npm run dev
npm test
npm test --prefix mcp
npm run typecheck
npm run build
npm run build:app
npx playwright install chromium
npx playwright test
```

Builds produce `dist/` (library) and `dist-app/PowerBoard.html` (app).
See the [SRS](docs/SRS_POWERBOARD.md) and [release runbook](docs/RELEASING.md).

## Privacy

PowerBoard is local-first: normal editing works offline and saved boards live
in your HTML file. The bridge is loopback-only and **off by default**; its toggle
is a device preference, not shared in the file. It has no authentication, so
enable it only on a machine you control: local processes can edit while enabled.
An HTML board is executable content; only open files from people you trust.

## License

[MIT](LICENSE), copyright 2026 CynaCons.
