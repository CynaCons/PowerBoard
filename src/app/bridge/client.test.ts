/**
 * The app-side agent bridge client (REQ-PB-120, REQ-PB-121, REQ-BOARD-018).
 *
 * The MCP server is faked with a plain WebSocket so the test drives the exact
 * frames powerboard-mcp emits (`hello` in, `agents`/`displaced`/requests out),
 * without a socket or a child process.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyFile } from '../fileFormat';
import { useAppStore } from '../store';
import { useAgentPresenceStore } from '../../react/presence';
import {
  BRIDGE_ENABLED_KEY,
  BRIDGE_PORT_KEY,
  bridgeUrl,
  handleServerFrame,
  startBridge,
  stopBridge,
  useBridgeStore,
} from './client';

/** Minimal stand-in for the browser WebSocket the client dials. */
class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  readonly url: string;
  readonly sent: string[] = [];

  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({});
  }

  /** Test driver: pretend the handshake finished. */
  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.({});
  }

  /** Test driver: deliver a server frame. */
  deliver(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
}

const RealWebSocket = globalThis.WebSocket;

function installFakeWebSocket(): void {
  (globalThis as { WebSocket: unknown }).WebSocket = FakeWebSocket;
}

function sentFrames(socket: FakeWebSocket): Array<Record<string, unknown>> {
  return socket.sent.map((raw) => JSON.parse(raw) as Record<string, unknown>);
}

beforeEach(() => {
  installFakeWebSocket();
  FakeWebSocket.instances = [];
  localStorage.clear();
  useAppStore.getState().setFile(emptyFile());
  useAgentPresenceStore.setState({
    connected: [],
    presenceSeen: false,
    actors: {},
    left: {},
  });
  useBridgeStore.setState({
    enabled: false,
    status: 'off',
    reason: null,
    commandCount: 0,
    lastCommand: null,
  });
});

afterEach(() => {
  stopBridge();
  vi.useRealTimers();
  (globalThis as { WebSocket: unknown }).WebSocket = RealWebSocket;
});

describe('agent bridge client', () => {
  it('REQ-PB-121 dials loopback and announces itself with a hello frame', () => {
    localStorage.setItem(BRIDGE_PORT_KEY, '4999');
    expect(bridgeUrl()).toBe('ws://127.0.0.1:4999');

    startBridge();
    const socket = FakeWebSocket.instances[0];
    expect(socket.url).toBe('ws://127.0.0.1:4999');
    expect(useBridgeStore.getState().status).toBe('connecting');

    socket.open();
    expect(useBridgeStore.getState().status).toBe('connected');
    expect(sentFrames(socket)[0]).toMatchObject({
      v: 1,
      type: 'hello',
      app: 'powerboard',
      appVersion: '0.1.0',
    });
  });

  it('REQ-PB-121 serves card_create through createBoardCommands and the store has the card', async () => {
    const boardId = useAppStore.getState().file.boards[0].id;

    startBridge();
    const socket = FakeWebSocket.instances[0];
    socket.open();

    await handleServerFrame(
      JSON.stringify({
        v: 1,
        id: 'req-1',
        cmd: 'card_create',
        params: { me: 'agent-1', boardId, title: 'From the agent' },
      }),
    );

    const response = sentFrames(socket)[1] as {
      id: string;
      ok: boolean;
      result?: { title: string; number: number };
    };
    expect(response.id).toBe('req-1');
    expect(response.ok).toBe(true);
    expect(response.result).toMatchObject({ title: 'From the agent', number: 1 });

    const board = useAppStore.getState().file.boards.find((entry) => entry.id === boardId);
    expect(board?.board.cards.some((card) => card.title === 'From the agent')).toBe(true);

    // REQ-BOARD-014: the write is recorded against the agent that asked.
    expect(useAgentPresenceStore.getState().actors['agent-1']).toMatchObject({ boardId });
    expect(useBridgeStore.getState()).toMatchObject({ commandCount: 1, lastCommand: 'card_create' });
  });

  it('REQ-PB-121 answers an unknown command with the same UNSUPPORTED error frame', async () => {
    startBridge();
    const socket = FakeWebSocket.instances[0];
    socket.open();

    await handleServerFrame(
      JSON.stringify({ v: 1, id: 'req-2', cmd: 'no_such_command', params: {} }),
    );

    expect(sentFrames(socket)[1]).toMatchObject({
      id: 'req-2',
      ok: false,
      error: { code: 'UNSUPPORTED', message: 'Unknown command "no_such_command"' },
    });
  });

  it('REQ-BOARD-018 an agents frame stores the connected labels', async () => {
    await handleServerFrame(
      JSON.stringify({
        v: 1,
        type: 'agents',
        agents: [{ label: 'feature-1', role: 'hub', connectedAt: 111 }],
      }),
    );

    const state = useAgentPresenceStore.getState();
    expect(state.presenceSeen).toBe(true);
    expect(state.connected).toEqual([
      { label: 'feature-1', role: 'hub', connectedAt: 111 },
    ]);
  });

  it('REQ-PB-121 a displaced frame stops retrying and clears the setting', () => {
    useBridgeStore.getState().setEnabled(true);
    expect(localStorage.getItem(BRIDGE_ENABLED_KEY)).toBe('true');

    startBridge();
    const socket = FakeWebSocket.instances[0];
    socket.open();
    expect(useBridgeStore.getState().enabled).toBe(true);

    vi.useFakeTimers();
    socket.deliver({ v: 1, type: 'displaced', reason: 'Another board app connected.' });

    const state = useBridgeStore.getState();
    expect(state.enabled).toBe(false);
    expect(state.status).toBe('displaced');
    expect(state.reason).toBe('Another board app connected.');
    expect(localStorage.getItem(BRIDGE_ENABLED_KEY)).toBe('false');
    expect(socket.onclose).toBeNull();
    expect(socket.readyState).toBe(FakeWebSocket.CLOSED);

    // No reconnect timer may survive: wait far past the capped backoff.
    vi.advanceTimersByTime(30_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});
