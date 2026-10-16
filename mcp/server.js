#!/usr/bin/env node
/**
 * powerboard-mcp — MCP server for reading and editing a live PowerBoard.
 *
 * Topology: this process hosts a WebSocket on loopback; the PowerBoard app dials
 * out to it (a browser page cannot listen on a port, and PowerBoard ships as a
 * single static HTML file). Tool calls are forwarded to the connected app,
 * which applies them to its live board; its normal auto-save then persists
 * them to the file.
 *
 * MULTIPLE AGENTS. One MCP server process is spawned per agent session, so
 * several of them race for the same port. The winner becomes the HUB and owns
 * the single app connection; the losers become PEERS and forward their tool
 * calls to the hub over the same loopback port. This keeps exactly one socket to
 * the board app, which means the app needs no changes and there is one obvious
 * place for the lock.
 *
 * Agents may connect freely but may not operate concurrently: the hub hands out
 * a lease, held for the duration of a command and for a short idle grace after
 * it. A blocked agent is told who holds the lock and when to retry. Read-only
 * tools bypass the lease, because looking while someone writes is harmless and
 * refusing it would make a blocked agent unable to find out anything.
 *
 * The board tool definitions and their argument helpers live in
 * ./mcp-tools.js, a build-time copy of ../mcp-tools/index.js shared verbatim
 * with PowerScroll's powerscroll-mcp (REQ-PB-101, REQ-PB-131). Run `npm run sync`
 * (a `prepack` step) to refresh it so the published package is self-contained.
 *
 * IMPORTANT: stdout is the MCP transport. All logging goes to stderr.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { WebSocketServer, WebSocket } from 'ws';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
  AGENT_NAME_RE,
  BOARD_READ_ONLY_TOOLS,
  BOARD_TOOLS,
  boardUpdatesTimeoutMs,
  pollBoardUpdates,
  withAgentMe,
} from './mcp-tools.js';

const PROTOCOL_VERSION = 1;
/** PowerBoard's own port; PowerScroll keeps 41777 (REQ-PB-130). */
const PORT = Number(process.env.POWERBOARD_BRIDGE_PORT || 41778);
const HOST = '127.0.0.1';
const REQUEST_TIMEOUT_MS = Number(process.env.POWERBOARD_BRIDGE_TIMEOUT_MS || 10_000);

/** The version reported in the MCP handshake, straight from package.json. */
const PACKAGE_VERSION = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
).version;

const log = (...args) => console.error('[powerboard-mcp]', ...args);

/** This process's id, used only to arbitrate the lease between processes. */
const AGENT_ID = randomUUID().slice(0, 8);

/**
 * The agent's own name, if its environment gives one. PowerBoard never makes
 * a name up: a generated name changes on every restart, so one agent that
 * reconnects would show up on the board as dozens of agents. Without
 * POWERBOARD_AGENT_NAME (or PowerScroll's POWERNOTE_AGENT_NAME) every board tool
 * must be told `me` (REQ-PB-131).
 */
const ENV_AGENT_NAME = (() => {
  const raw = (process.env.POWERBOARD_AGENT_NAME || process.env.POWERNOTE_AGENT_NAME || '').trim();
  if (!raw) return null;
  if (!AGENT_NAME_RE.test(raw)) {
    console.error(
      '[powerboard-mcp] POWERBOARD_AGENT_NAME "' + raw +
      '" is not a valid agent name (^[a-z0-9][a-z0-9._-]{0,39}$); ignoring it.',
    );
    return null;
  }
  return raw;
})();

/** How this process is listed to other processes and in bridge_status. Never a board actor. */
const AGENT_LABEL = ENV_AGENT_NAME || `unnamed-${AGENT_ID}`;

/**
 * Tools that only look. They bypass the lease: a blocked agent must still be
 * able to read, and above all to call `bridge_status` to find out why it is
 * blocked. `bridge_status` is the board server's own addition; the rest come
 * from the shared board-tool module.
 */
const READ_ONLY = new Set([...BOARD_READ_ONLY_TOOLS, 'bridge_status']);

const HUB_CONNECTED_AT = Date.now();

/** Idle grace between one agent's commands before another may take over. */
const LOCK_IDLE_MS = Number(
  process.env.POWERBOARD_LOCK_IDLE_MS || process.env.POWERNOTE_LOCK_IDLE_MS || 10_000,
);
/** A holder that keeps working still yields after this, if anyone is waiting. */
const LOCK_MAX_HOLD_MS = Number(
  process.env.POWERBOARD_LOCK_MAX_HOLD_MS || process.env.POWERNOTE_LOCK_MAX_HOLD_MS || 120_000,
);

// ── App connection ──────────────────────────────────────────

/** The currently connected PowerBoard tab, if any. Latest connection wins. */
let app = null;
/** Metadata from the app's hello frame. */
let appInfo = null;
/** id → { resolve, reject, timer } for in-flight requests. */
const pending = new Map();

/** 'hub' once we own the port, 'peer' once we are talking to whoever does. */
let mode = 'starting';
/** Peer mode: our socket to the hub. */
let hub = null;
/** Hub mode: peer socket -> { agentId, label }. */
const peers = new Map();
/** Set when startup failed for a reason the user has to fix. */
let startupError = null;
/** Hub mode: the listening server, so shutdown can close it. */
let wss = null;

/**
 * The lease. `inFlight` is what stops it expiring underneath a slow command:
 * a command that spends a while inside the app before it answers, and an
 * idle-only timer would hand the board to someone else mid-command.
 */
let lock = { holder: null, label: null, inFlight: 0, idleUntil: 0, since: 0 };
/** agentIds waiting, oldest first. Decides when a long holder must yield. */
const waiting = [];

function releaseLock(why) {
  if (!lock.holder) return;
  log('Lock released by ' + lock.label + ' (' + why + ').');
  lock = { holder: null, label: null, inFlight: 0, idleUntil: 0, since: 0 };
}

/**
 * Expiry is evaluated on use rather than on a timer: a timer that fires while
 * nothing is happening tells us nothing, and one that fires mid-command would
 * be wrong anyway.
 */
function currentHolder(now) {
  now = now || Date.now();
  if (lock.holder && lock.inFlight === 0 && now > lock.idleUntil) releaseLock('idle');
  return lock.holder;
}

function lockStatus(now) {
  now = now || Date.now();
  const holder = currentHolder(now);
  return {
    held: !!holder,
    holderId: holder,
    holder: holder ? lock.label : null,
    retryAfterMs: holder ? Math.max(0, lock.idleUntil - now) : 0,
    heldForMs: holder ? now - lock.since : 0,
    waiting: waiting.length,
  };
}

class Locked extends Error {}

/**
 * Grants the lease, or explains who has it. A holder past LOCK_MAX_HOLD_MS
 * yields at its next command boundary, but only when someone is actually
 * waiting -- otherwise a long solo task would interrupt itself for nothing.
 */
function acquireLock(agentId, label) {
  const now = Date.now();
  const holder = currentHolder(now);

  if (holder && holder !== agentId) {
    if (waiting.indexOf(agentId) < 0) waiting.push(agentId);
    const st = lockStatus(now);
    throw new Locked(
      'Another agent is operating this board. "' + st.holder + '" holds it and has ' +
      'been working for ' + Math.round(st.heldForMs / 1000) + 's; it frees up after about ' +
      Math.ceil(st.retryAfterMs / 1000) + 's of inactivity. Do other work and retry, or call ' +
      'bridge_status to check. You are queued at position ' + (waiting.indexOf(agentId) + 1) + '.',
    );
  }

  if (holder === agentId && now - lock.since > LOCK_MAX_HOLD_MS && waiting.length > 0) {
    const n = waiting.length;
    releaseLock('max hold reached with agents waiting');
    throw new Locked(
      'You have held this board for over ' + Math.round(LOCK_MAX_HOLD_MS / 1000) + 's and ' +
      n + ' agent(s) are waiting, so the lock was handed on. Retry to queue for it again.',
    );
  }

  const idx = waiting.indexOf(agentId);
  if (idx >= 0) waiting.splice(idx, 1);

  if (!holder) {
    lock = { holder: agentId, label: label, inFlight: 0, idleUntil: now + LOCK_IDLE_MS, since: now };
    log('Lock acquired by ' + label + '.');
  }
  lock.inFlight += 1;
  return function release() {
    lock.inFlight = Math.max(0, lock.inFlight - 1);
    lock.idleUntil = Date.now() + LOCK_IDLE_MS;
  };
}

/** Fail every in-flight request now, rather than letting each one time out. */
function rejectPending(message) {
  for (const [id, entry] of pending) {
    clearTimeout(entry.timer);
    pending.delete(id);
    entry.reject(new BridgeUnavailable(message));
  }
}

// -- Hub mode: own the port, own the app, own the lock -------

function startHub() {
  return new Promise((resolve, reject) => {
    const candidate = new WebSocketServer({ host: HOST, port: PORT });
    candidate.on('listening', () => {
      wss = candidate;
      log('Hub: listening on ws://' + HOST + ':' + PORT + ' as "' + AGENT_LABEL + '".');
      resolve(candidate);
    });
    candidate.on('error', (err) => reject(err));
    candidate.on('connection', (socket) => onHubConnection(socket));
  });
}

function onHubConnection(socket) {
  let kind = null;

  socket.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (e) {
      return;
    }

    // A peer announces itself before anything else; the app sends 'hello'.
    if (msg.type === 'peer-hello') {
      kind = 'peer';
      peers.set(socket, { agentId: msg.agentId, label: msg.label, connectedAt: Date.now() });
      log('Peer agent "' + msg.label + '" connected. ' + peers.size + ' peer(s).');
      socket.send(JSON.stringify({ v: PROTOCOL_VERSION, type: 'peer-welcome', hub: AGENT_LABEL }));
      pushAgents();
      return;
    }

    if (msg.type === 'hello') {
      kind = 'app';
      adoptApp(socket, msg);
      return;
    }

    if (kind === 'peer' && msg.type === 'peer-request') {
      handlePeerRequest(socket, msg);
      return;
    }

    // Otherwise it is the app answering one of our requests.
    const entry = pending.get(msg.id);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(msg.id);
    entry.resolve(msg);
  });

  socket.on('close', () => {
    if (kind === 'peer') {
      const info = peers.get(socket);
      peers.delete(socket);
      if (info) {
        // A peer that goes away must not keep the board locked.
        if (lock.holder === info.agentId) releaseLock('peer disconnected');
        const w = waiting.indexOf(info.agentId);
        if (w >= 0) waiting.splice(w, 1);
      }
      log('Peer agent disconnected. ' + peers.size + ' peer(s).');
      pushAgents();
      return;
    }
    if (app === socket) {
      app = null;
      appInfo = null;
      // The board going away invalidates any lease over it.
      releaseLock('board app disconnected');
      log('Board app disconnected.');
    }
  });

  socket.on('error', (err) => log('Socket error:', (err && err.message) || err));
}

function adoptApp(socket, msg) {
  const previous = app;
  // Newest connection wins: a stale or zombie socket must never lock out a
  // board the user is actually looking at.
  app = socket;
  // Protocol v1: the app names itself in a `hello` frame. Accept either the
  // PowerScroll field name (`notebook`) or the board app's (`board`).
  const boardName = msg.notebook ?? msg.board ?? null;
  appInfo = { appVersion: msg.appVersion, board: boardName };
  log('Hello from PowerBoard v' + msg.appVersion + ' -- board "' + boardName + '"');

  if (previous && previous !== socket && previous.readyState === previous.OPEN) {
    log('A second board app connected; displacing the previous one.');
    // Tell the old client to stand down BEFORE closing it. Without this it
    // reconnects on backoff, displaces this new client in turn, and the two
    // trade the slot forever -- commands then land in whichever board happens
    // to hold it, which is how writes ended up in the wrong file.
    try {
      previous.send(
        JSON.stringify({
          v: PROTOCOL_VERSION,
          type: 'displaced',
          reason: 'Another board app connected to the agent bridge.',
        }),
      );
    } catch (err) {
      log('Could not notify displaced board app:', (err && err.message) || err);
    }
    previous.close();
    releaseLock('board app displaced');
    rejectPending(
      'The board this request was sent to was displaced by another connection. Retry.',
    );
  }

  pushAgents();
}

function agentsFrame() {
  const agents = [
    { label: AGENT_LABEL, role: 'hub', connectedAt: HUB_CONNECTED_AT, named: !!ENV_AGENT_NAME },
  ];
  for (const info of peers.values()) {
    agents.push({
      label: info.label,
      role: 'peer',
      connectedAt: info.connectedAt || Date.now(),
    });
  }
  return { v: PROTOCOL_VERSION, type: 'agents', agents };
}

function pushAgents() {
  if (!app || app.readyState !== app.OPEN) return;
  try {
    app.send(JSON.stringify(agentsFrame()));
  } catch (err) {
    log('Could not push agents frame:', (err && err.message) || err);
  }
}

async function handlePeerRequest(socket, msg) {
  const reply = (body) =>
    socket.send(
      JSON.stringify(Object.assign(
        { v: PROTOCOL_VERSION, type: 'peer-response', reqId: msg.reqId },
        body,
      )),
    );
  try {
    const result = await runToolAsAgent(msg.cmd, msg.params, msg.agentId, msg.label);
    reply({ ok: true, result: result });
  } catch (err) {
    reply({
      ok: false,
      error: { code: err instanceof Locked ? 'LOCKED' : 'ERROR', message: err.message },
    });
  }
}

// -- Peer mode: forward everything to the hub ----------------

function connectToHub() {
  const socket = new WebSocket('ws://' + HOST + ':' + PORT);
  socket.on('open', () => {
    hub = socket;
    socket.send(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        type: 'peer-hello',
        agentId: AGENT_ID,
        label: AGENT_LABEL,
      }),
    );
    log('Peer: joined the hub on ws://' + HOST + ':' + PORT + ' as "' + AGENT_LABEL + '".');
  });
  socket.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (e) {
      return;
    }
    if (msg.type !== 'peer-response') return;
    const entry = pending.get(msg.reqId);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(msg.reqId);
    entry.resolve(msg);
  });
  socket.on('close', () => {
    hub = null;
    rejectPending('The agent hub went away. Retrying.');
    // The hub process exited, so the port is free again. Whoever gets there
    // first becomes the new hub; everyone else re-joins it. The jitter stops
    // every survivor retrying in lockstep.
    log('Hub connection lost -- re-racing for the port.');
    setTimeout(() => { void start(); }, 250 + Math.floor(Math.random() * 500));
  });
  socket.on('error', () => {
    // The close handler drives the retry; the error carries nothing useful.
  });
}

/** Peer side of a tool call: ask the hub to run it on our behalf. */
function askHub(cmd, params) {
  return new Promise((resolve, reject) => {
    if (!hub || hub.readyState !== hub.OPEN) {
      reject(new BridgeUnavailable('Not connected to the agent hub yet. Retry in a moment.'));
      return;
    }
    const reqId = randomUUID();
    const budget = timeoutFor(cmd, params);
    const timer = setTimeout(() => {
      pending.delete(reqId);
      reject(new Error('The agent hub did not answer "' + cmd + '" within ' + budget + 'ms'));
    }, budget);
    pending.set(reqId, { resolve: resolve, reject: reject, timer: timer });
    hub.send(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        type: 'peer-request',
        reqId: reqId,
        agentId: AGENT_ID,
        label: AGENT_LABEL,
        cmd: cmd,
        params: params,
      }),
    );
  });
}

async function start() {
  try {
    await startHub();
    mode = 'hub';
    startupError = null;
  } catch (err) {
    if (err && err.code === 'EADDRINUSE') {
      mode = 'peer';
      connectToHub();
      return;
    }
    startupError =
      'Could not start the agent bridge on ' + HOST + ':' + PORT + ': ' +
      ((err && err.message) || err) + '. Set POWERBOARD_BRIDGE_PORT to a free port.';
    log(startupError);
  }
}

class BridgeUnavailable extends Error {}

/**
 * The timeout budget a command needs. Board tools all answer promptly except
 * `board_updates`, whose own long-poll has to outlast its `wait_seconds`.
 */
function timeoutFor(cmd, params) {
  if (cmd === 'board_updates') return boardUpdatesTimeoutMs(params, REQUEST_TIMEOUT_MS);
  return REQUEST_TIMEOUT_MS;
}

function callApp(cmd, params) {
  return new Promise((resolve, reject) => {
    if (!app || app.readyState !== app.OPEN) {
      reject(
        new BridgeUnavailable(
          'No PowerBoard is connected. Open PowerBoard.html, then turn on ' +
          'Settings → Agent bridge → "Let a local agent write into this board".',
        ),
      );
      return;
    }

    const id = randomUUID();
    const budget = timeoutFor(cmd, params);
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`PowerBoard did not respond to "${cmd}" within ${budget}ms`));
    }, budget);

    pending.set(id, { resolve, reject, timer });
    app.send(JSON.stringify({ v: PROTOCOL_VERSION, id, cmd, params }));
  });
}

// ── MCP tools ───────────────────────────────────────────────

/**
 * The one tool the board server adds to the shared board set: the lease and
 * presence report. Its description is ported verbatim from powerscroll-mcp.
 */
const BRIDGE_STATUS_TOOL = {
  name: 'bridge_status',
  description:
    'Who else is working on this board. Several agents may be connected at ' +
    'once but only one may operate at a time, so call this when a tool comes ' +
    'back LOCKED, or before starting a long piece of work. Reports the ' +
    'connected board app, every connected agent, which one holds the board, ' +
    'how long until it frees up, and whether that is you. This tool is never ' +
    'blocked. Note that a free result can go stale immediately -- another agent ' +
    'may take the lock before your next call -- so treat the LOCKED error as the ' +
    'real signal and this as a way to understand it.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
};

/** Every tool this server advertises: the shared board tools plus bridge_status. */
const TOOLS = [...BOARD_TOOLS, BRIDGE_STATUS_TOOL];

const server = new Server(
  { name: 'powerboard-mcp', version: PACKAGE_VERSION },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

/** Everyone connected right now, from the hub's point of view. */
function connectedAgents() {
  const list = [{ agentId: AGENT_ID, label: AGENT_LABEL, role: 'hub' }];
  for (const info of peers.values()) {
    list.push({ agentId: info.agentId, label: info.label, role: 'peer' });
  }
  return list;
}

/**
 * Runs one tool on behalf of an agent, holding the lease for its duration.
 *
 * Only the hub ever gets here: peers forward to it, so there is exactly one
 * arbiter no matter how many agent processes are running.
 */
async function runToolAsAgent(name, params, agentId, label) {
  if (name === 'bridge_status') {
    const st = lockStatus();
    return {
      board: appInfo ? appInfo.board : null,
      boardConnected: !!app,
      you: { agentId: agentId, label: label, isHolder: st.holderId === agentId },
      agents: connectedAgents(),
      lock: {
        held: st.held,
        heldBy: st.holder,
        heldByYou: st.holderId === agentId,
        heldForMs: st.heldForMs,
        freesUpInMs: st.retryAfterMs,
        agentsWaiting: st.waiting,
      },
    };
  }

  const args = withAgentMe(name, params ?? {}, ENV_AGENT_NAME);

  // Reads never queue: an agent that cannot look also cannot find out why.
  if (READ_ONLY.has(name)) {
    if (name === 'board_updates') {
      return await pollBoardUpdates(args, async (p) => unwrap(await callApp('board_updates', p)));
    }
    const response = await callApp(name, args);
    return unwrap(response);
  }

  const release = acquireLock(agentId, label);
  try {
    const response = await callApp(name, args);
    return unwrap(response);
  } finally {
    release();
  }
}

class CommandFailed extends Error {}

function unwrap(response) {
  if (response.ok === false) {
    throw new CommandFailed(
      (response.error && response.error.code) + ': ' + (response.error && response.error.message),
    );
  }
  return response.result;
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  if (!TOOLS.some((t) => t.name === name)) {
    return {
      isError: true,
      content: [{ type: 'text', text: `Unknown tool "${name}"` }],
    };
  }

  if (startupError) {
    return { isError: true, content: [{ type: 'text', text: startupError }] };
  }

  try {
    // Hub runs it directly; a peer asks the hub, so the lease is decided in one
    // place regardless of which process the agent happens to be talking to.
    let result;
    if (mode === 'peer') {
      const response = await askHub(name, args ?? {});
      if (response.ok === false) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: (response.error && response.error.code) + ': ' + (response.error && response.error.message),
            },
          ],
        };
      }
      result = response.result;
    } else {
      result = await runToolAsAgent(name, args ?? {}, AGENT_ID, AGENT_LABEL);
    }

    const payload = { ...result };
    if (appInfo) payload._board = appInfo.board;
    // Stamp identity on every result: an agent that never learns who it is
    // cannot make sense of a LOCKED message naming someone else.
    payload._agent = { id: AGENT_ID, label: AGENT_LABEL, role: mode };
    return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
  } catch (err) {
    const code = err instanceof Locked ? 'LOCKED: ' : '';
    return { isError: true, content: [{ type: 'text', text: code + err.message }] };
  }
});

// ── Startup / shutdown ──────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Race for the port: winner hosts the app connection and the lock,
  // losers become peers of whoever won.
  await start();
  log('MCP server ready on stdio (' + mode + ').');
}

function shutdown() {
  for (const { timer } of pending.values()) clearTimeout(timer);
  pending.clear();
  if (wss) wss.close();
  if (hub) hub.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch((err) => {
  log('Fatal:', err?.stack || err);
  process.exit(1);
});
