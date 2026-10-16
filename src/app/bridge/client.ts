/**
 * WebSocket client for the agent bridge (REQ-PB-120, REQ-PB-121).
 *
 * Ported from PowerScroll's `src/bridge/client.ts`. The app dials OUT to the
 * MCP server (a browser page cannot listen on a port and PowerBoard is one
 * static HTML file), announces itself with a `hello` frame, then serves board
 * commands until the socket drops. Reconnects with capped exponential backoff
 * so the app and the MCP server can be started in either order.
 *
 * Requests run through `createBoardCommands(createAppAdapter(), presenceSink)`
 * — the same 17 board commands the MCP server exposes — and report activity to
 * the presence store so the agents strip fills in.
 */

import { create } from 'zustand';
import { POWERBOARD_BRIDGE_PORT } from '../../contract';
import {
  BridgeCommandError,
  createBoardCommands,
  type BoardCommandName,
  type BridgeErrorCode,
  type PresenceSink,
} from '../../bridge';
import { useAgentPresenceStore, type ConnectedAgent } from '../../react/presence';
import { createAppAdapter } from '../adapter';
import { useAppStore } from '../store';

/** Wire protocol version shared with powerboard-mcp (protocol v1). */
const BRIDGE_PROTOCOL_VERSION = 1;
/** Reported in the hello frame; matches package.json. */
const APP_VERSION = '0.1.0';

/** Device preference keys. The toggle is NEVER stored in the file. */
export const BRIDGE_ENABLED_KEY = 'powerboard-bridge-enabled';
/**
 * Test-only override for the bridge port. A normal app never writes it, but
 * the E2E suite hosts powerboard-mcp on a free port and points the app here.
 */
export const BRIDGE_PORT_KEY = 'powerboard-bridge-port';

export type BridgeStatus = 'off' | 'connecting' | 'connected' | 'displaced';

function readEnabled(): boolean {
  try {
    return localStorage.getItem(BRIDGE_ENABLED_KEY) === 'true';
  } catch {
    return false;
  }
}

function persist(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignored — private mode / quota errors are non-fatal
  }
}

/** The port to dial: the test override when present, else the pinned one. */
export function bridgePort(): number {
  try {
    const raw = localStorage.getItem(BRIDGE_PORT_KEY);
    const port = raw === null ? Number.NaN : Number(raw);
    if (Number.isInteger(port) && port > 0 && port < 65536) return port;
  } catch {
    // fall through
  }
  return POWERBOARD_BRIDGE_PORT;
}

/** Loopback only — the bridge must never be reachable off-machine. */
export function bridgeUrl(): string {
  return `ws://127.0.0.1:${bridgePort()}`;
}

interface BridgeState {
  enabled: boolean;
  status: BridgeStatus;
  /** Why this app stood down, shown in Settings when status is 'displaced'. */
  reason: string | null;
  /** Commands served since page load — cheap "it's actually working" signal. */
  commandCount: number;
  lastCommand: string | null;
  setEnabled: (enabled: boolean) => void;
  setStatus: (status: BridgeStatus, reason?: string | null) => void;
  noteCommand: (cmd: string) => void;
}

/**
 * Agent bridge connection state. `enabled` lives in localStorage, not in the
 * file: it is a property of this machine, so a file sent elsewhere never
 * arrives trying to dial a socket on someone else's box.
 */
export const useBridgeStore = create<BridgeState>((set) => ({
  enabled: readEnabled(),
  status: 'off',
  reason: null,
  commandCount: 0,
  lastCommand: null,

  setEnabled: (enabled) => {
    persist(BRIDGE_ENABLED_KEY, String(enabled));
    set({ enabled, ...(enabled ? {} : { status: 'off' as BridgeStatus, reason: null }) });
  },

  setStatus: (status, reason = null) => set({ status, reason }),

  noteCommand: (cmd) =>
    set((state) => ({ commandCount: state.commandCount + 1, lastCommand: cmd })),
}));

/**
 * Response body minus the envelope fields. Written out rather than derived via
 * `Omit<…>`, which distributes over the union and collapses to the shared keys.
 */
type BridgeResponseBody =
  | { ok: true; result: unknown }
  | { ok: false; error: { code: BridgeErrorCode; message: string } };

/** A frame from the server: a control frame, or a command request. */
interface BridgeFrame {
  type?: string;
  id?: string;
  cmd?: string;
  params?: Record<string, unknown>;
  agents?: unknown;
  reason?: string;
}

const BASE_RECONNECT_MS = 500;
const MAX_RECONNECT_MS = 10_000;

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let attempt = 0;
let running = false;

/**
 * The board commands plus their presence sink. Built once: the adapter reads
 * the app store at call time, so a stale reference is never an issue.
 */
let commands: Record<BoardCommandName, (params: Record<string, unknown>) => unknown> | null = null;

function boardCommands() {
  if (!commands) {
    const presence: PresenceSink = {
      recordAction: (actor, info) => useAgentPresenceStore.getState().recordAction(actor, info),
      leave: (name) => useAgentPresenceStore.getState().leave(name),
      lastBoardOf: (actor) => useAgentPresenceStore.getState().actors[actor]?.boardId,
    };
    commands = createBoardCommands(createAppAdapter(), presence);
  }
  return commands;
}

function clearReconnect(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleReconnect(url: string): void {
  if (!running) return;
  clearReconnect();
  const delay = Math.min(MAX_RECONNECT_MS, BASE_RECONNECT_MS * 2 ** attempt);
  attempt += 1;
  reconnectTimer = setTimeout(() => open(url), delay);
}

function send(payload: unknown): void {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

/**
 * Stop for good — another board has claimed the connection.
 *
 * Deliberately does NOT schedule a reconnect. Retrying is exactly what caused
 * the flip-flop: this client would displace the newcomer, get displaced back,
 * and the two would trade the slot indefinitely while commands landed in
 * whichever board happened to hold it at the time.
 */
function standDown(reason: string): void {
  running = false;
  clearReconnect();
  attempt = 0;
  if (socket) {
    socket.onclose = null;
    socket.onerror = null;
    socket.close();
    socket = null;
  }
  // Flip the user-facing toggle off too. The checkbox should reflect that this
  // app is no longer connected, and clearing the persisted flag stops a
  // forgotten background tab from silently re-claiming the slot after a reload.
  // Re-ticking the box takes the connection back.
  useBridgeStore.getState().setEnabled(false);
  // Status must be set AFTER setEnabled: that call unwinds through stopBridge,
  // which would otherwise overwrite this with 'off'.
  useBridgeStore.getState().setStatus('displaced', reason);
}

/**
 * Entry point for every frame the server sends — control frames first, then
 * ordinary command requests. Exported so tests can drive it without a socket.
 */
export async function handleServerFrame(raw: string): Promise<void> {
  let frame: unknown;
  try {
    frame = JSON.parse(raw);
  } catch {
    return; // unparseable frame — nothing to reply to, no id
  }
  if (!frame || typeof frame !== 'object') return;
  const candidate = frame as BridgeFrame;

  if (candidate.type === 'displaced') {
    standDown(
      typeof candidate.reason === 'string' && candidate.reason
        ? candidate.reason
        : 'Another board took the connection',
    );
    return;
  }

  if (candidate.type === 'agents') {
    useAgentPresenceStore.getState().setConnected(
      Array.isArray(candidate.agents) ? (candidate.agents as ConnectedAgent[]) : [],
    );
    return;
  }

  if (typeof candidate.id === 'string' && typeof candidate.cmd === 'string') {
    await handleRequest(candidate.id, candidate.cmd, candidate.params ?? {});
  }
}

async function handleRequest(
  id: string,
  cmd: string,
  params: Record<string, unknown>,
): Promise<void> {
  const respond = (body: BridgeResponseBody) =>
    send({ v: BRIDGE_PROTOCOL_VERSION, id, ...body });

  try {
    const handler = boardCommands()[cmd as BoardCommandName];
    if (!handler) {
      throw new BridgeCommandError('UNSUPPORTED', `Unknown command "${cmd}"`);
    }
    const result = await handler(params);
    useBridgeStore.getState().noteCommand(cmd);
    respond({ ok: true, result });
  } catch (err) {
    const known = err instanceof BridgeCommandError;
    respond({
      ok: false,
      error: {
        code: known ? err.code : 'INTERNAL',
        message: err instanceof Error ? err.message : String(err),
      },
    });
  }
}

function open(url: string): void {
  if (!running) return;

  const store = useBridgeStore.getState();
  store.setStatus('connecting');

  let ws: WebSocket;
  try {
    ws = new WebSocket(url);
  } catch {
    // A malformed URL: retry on the normal backoff.
    scheduleReconnect(url);
    return;
  }
  socket = ws;

  ws.onopen = () => {
    attempt = 0;
    useBridgeStore.getState().setStatus('connected');
    const { fileName, file } = useAppStore.getState();
    send({
      v: BRIDGE_PROTOCOL_VERSION,
      type: 'hello',
      app: 'powerboard',
      appVersion: APP_VERSION,
      board: fileName ?? file.title,
    });
  };

  ws.onmessage = (event) => {
    if (typeof event.data === 'string') void handleServerFrame(event.data);
  };

  ws.onerror = () => {
    // The close handler drives reconnection; onerror carries no useful detail
    // in browsers, so the status stays 'connecting' until it does.
  };

  ws.onclose = () => {
    socket = null;
    if (!running) {
      useBridgeStore.getState().setStatus('off');
      return;
    }
    useBridgeStore.getState().setStatus('connecting');
    scheduleReconnect(url);
  };
}

/** Begin dialing the MCP server. Safe to call repeatedly. */
export function startBridge(url?: string): void {
  const target = url || bridgeUrl();
  if (running) return;
  running = true;
  attempt = 0;
  open(target);
}

/** Stop the bridge and drop any open socket. */
export function stopBridge(): void {
  running = false;
  clearReconnect();
  attempt = 0;
  if (socket) {
    socket.onclose = null;
    socket.close();
    socket = null;
  }
  useBridgeStore.getState().setStatus('off');
}

/**
 * Keep the socket in sync with the user's toggle. Returns an unsubscribe fn.
 * The bridge is OFF unless explicitly enabled — a PowerBoard.html opened on
 * someone else's machine must never dial out on its own.
 */
export function initBridge(): () => void {
  const apply = (enabled: boolean) => {
    if (enabled) {
      if (!running) startBridge();
    } else if (running) {
      stopBridge();
    }
  };

  const { enabled } = useBridgeStore.getState();
  apply(enabled);

  let prevEnabled = enabled;
  return useBridgeStore.subscribe((state) => {
    if (state.enabled === prevEnabled) return;
    prevEnabled = state.enabled;
    apply(state.enabled);
  });
}
