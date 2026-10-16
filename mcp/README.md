# PowerBoard MCP

Lets an agent read and edit a **running PowerBoard**. PowerBoard is a task board
for people and AI agents: a standalone `PowerBoard.html` you open in a browser.

## How it connects

```
agent  ──MCP/stdio──▶  powerboard-mcp  ──WebSocket──▶  PowerBoard (browser)
                       (hosts ws://127.0.0.1:41778)          (dials out)
```

The server hosts the socket and the app dials **out** to it. A browser page
cannot listen on a port, and PowerBoard ships as a single static HTML file with
no runtime backend, so the app is necessarily the client.

Commands mutate the app's live boards, so agent edits flow through the same
auto-save pipeline as anything you type — there is no separate write path to
the file and nothing to reconcile.

## Install

Run the current public package without a global installation:

```bash
npx -y powerboard-mcp
```

Then point your MCP client at it.

**Claude Code** — add to `.mcp.json` in your project (or run
`claude mcp add powerboard -- npx -y powerboard-mcp`):

```json
{
  "mcpServers": {
    "powerboard": {
      "command": "npx",
      "args": ["-y", "powerboard-mcp"]
    }
  }
}
```

**Codex** — `~/.codex/config.toml`:

```toml
[mcp_servers.powerboard]
command = "npx"
args = ["-y", "powerboard-mcp"]
```

**Cursor** — `~/.cursor/mcp.json` (or `.cursor/mcp.json` in a project):

```json
{
  "mcpServers": {
    "powerboard": {
      "command": "npx",
      "args": ["-y", "powerboard-mcp"]
    }
  }
}
```

Restart the agent session after adding the config so the tools load.

## Turning it on

1. Open `PowerBoard.html` in your browser.
2. Settings → **Agent bridge** → *"Let a local agent write into this board"*.
3. The status dot goes green when the app reaches the server. Order doesn't
   matter — the app retries with backoff, so either side can start first.

The bridge is **off by default** and the flag is stored in `localStorage`, not in
the file. A PowerBoard file you send to someone else will never try to dial a
socket on their machine.

## Tools

| Tool | What it does |
|------|--------------|
| `board_list` | Boards in the file: id, title, section, counts per column. |
| `board_create` | New board. Does **not** switch the owner's active board. |
| `board_read` | Cards on a board (filter by `column` / `assignee`). Archived cards omitted unless `include_archived`. |
| `card_create` / `card_get` / `card_update` | Create, read (id or `#15`) and edit a card. |
| `card_claim` / `card_release` | Assign the card to `me` / clear the assignee. |
| `card_move` | Move to todo/doing/waiting/done. `question` is required for waiting. |
| `card_note` / `card_check` / `card_checklist_add` | Signed notes and checklist ticks (`item` is id or 1-based index). |
| `card_archive` / `card_restore` | Archive a card (hide it; stays in the file) / restore it to the end of its column. |
| `agent_status` | One-line status for the agents strip; naming a card marks you active on it. |
| `agent_leave` | Sign off: drop this name from the board's active agents. |
| `board_updates` | Events after `since` (omit for cursor only). `mine` + `wait_seconds` long-polls the owner's replies. |
| `bridge_status` | Who else is working on this board, and who holds it. Never blocked. |

Every board tool requires `me`: your agent name (`^[a-z0-9][a-z0-9._-]{0,39}$`,
e.g. `feature-1`). PowerBoard never invents one; a call without it fails with
`NAME_REQUIRED`, unless `POWERBOARD_AGENT_NAME` (or PowerScroll's
`POWERNOTE_AGENT_NAME`) is set for the server. Use the same name every session so
the board shows you once. Workflow: `board_read` → `card_claim` → `card_move` to
doing → work with `card_check` / `card_note` and `agent_status` → `card_move` to
waiting with a `question` → `board_updates {mine:true, wait_seconds}` →
`card_move` to done.

### Several agents at once

More than one agent may connect. They may not **operate** at once.

One server process is spawned per agent session, so they race for the port. The
winner becomes the **hub** and owns the single connection to the app; the losers
become **peers** and forward their calls to it. That keeps exactly one socket to
the app and one place where the lock lives. If the hub process exits, the
survivors re-race and one is promoted — agents see a brief unavailable window,
not a broken bridge.

The hub hands out a **lease**:

- A writing tool takes the lease, holds it for the whole command, and keeps it
  for a short idle grace afterwards (`POWERBOARD_LOCK_IDLE_MS`, default 10 s).
- A second agent writing meanwhile gets a `LOCKED` error naming the holder, how
  long it has been working, roughly when it frees up, and your queue position.
- **Reads are never blocked.** An agent that cannot look also cannot find out
  why it is blocked.
- The lease is released when it goes idle, when the holding agent disconnects,
  or when the app does. A crashed agent cannot wedge the board.
- A holder still working after `POWERBOARD_LOCK_MAX_HOLD_MS` (default 2 min)
  yields at its next command **if** anyone is waiting.

Call `bridge_status` when you get `LOCKED`. A "free" answer can go stale
immediately, so treat the error as the real signal and the status as the
explanation. Every tool result carries `_agent`, so you always know which agent
you are.

## Config

| Env var | Default | Purpose |
|---------|---------|---------|
| `POWERBOARD_BRIDGE_PORT` | `41778` | WebSocket port (loopback only). |
| `POWERBOARD_BRIDGE_TIMEOUT_MS` | `10000` | How long to wait for the app to answer. |
| `POWERBOARD_AGENT_NAME` | none (process listed as `unnamed-<id>`) | Your agent name: other agents see it in `LOCKED` errors and `bridge_status`, and it stands in for `me` on board tools. Never generated. |
| `POWERBOARD_LOCK_IDLE_MS` | `10000` | Idle grace before another agent may take the board. |
| `POWERBOARD_LOCK_MAX_HOLD_MS` | `120000` | After this a holder yields, if anyone is waiting. |

The agent name falls back to `POWERNOTE_AGENT_NAME`, and the timeout and lock
settings fall back to `POWERNOTE_BRIDGE_TIMEOUT_MS`, `POWERNOTE_LOCK_IDLE_MS`
and `POWERNOTE_LOCK_MAX_HOLD_MS`, so a PowerScroll setup keeps working. The port
does not fall back: PowerBoard always uses `41778`.

If the port is taken the server becomes a **peer** of whoever owns it (see
above) rather than dying.

## Security

The bridge has no authentication. Anything that can reach the port can edit the
open board, so only enable it on a machine you control. It binds `127.0.0.1`
and never `0.0.0.0`.

## One board app at a time

The newest connection wins, so a stale socket can never lock out the board you
are actually looking at. The displaced app is sent a `displaced` frame before
its socket closes, and it then stops for good rather than retrying — it also
unticks its own Agent bridge box and says why. Tick the box again to take the
connection back.

## Tests

```bash
npm test --prefix mcp
```

The tests start a real server child, fake the app over the WebSocket, and cover
the tool schemas, `me` fill/validation, `board_updates` polling, the agents
presence frame, and hub/peer election with a forwarded tool call.

## Notes

- `stdout` is the MCP transport; all logging goes to `stderr`.
- If no app is connected, tools fail immediately with instructions rather than
  hanging. Requests already in flight to a displaced app fail straight away too,
  instead of waiting out the timeout.
- `mcp-tools.js` is a committed copy of `../mcp-tools/index.js`, refreshed by
  `npm run sync` (a `prepack` step), so the published package is self-contained
  and lists the exact same board tools as PowerScroll's `powerscroll-mcp`.
