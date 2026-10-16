/**
 * Shared helpers for the powerboard-mcp tests.
 *
 * The tests talk to a real `server.js` child over stdio (MCP) and fake the
 * PowerBoard app with a plain WebSocket client, exactly as powerscroll-mcp's
 * tests do. Each test file should bind a freshly allocated free port via
 * `freePort()` and start its server with `POWERBOARD_BRIDGE_PORT`.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import WebSocket from 'ws';

export const serverPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'server.js',
);

/** Ask the OS for a free loopback port, so parallel test files never collide. */
export function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/** Poll `fn` until it returns a truthy value or `timeoutMs` elapses. */
export function waitUntil(fn, timeoutMs = 5000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      try {
        const value = fn();
        if (value) return resolve(value);
      } catch {
        // keep waiting
      }
      if (Date.now() - started > timeoutMs) return reject(new Error('timeout'));
      setTimeout(tick, 25);
    };
    tick();
  });
}

/**
 * Start a powerboard-mcp server process and expose a small MCP client over its
 * stdin/stdout plus a way to watch stderr (where it logs hub/peer election).
 *
 * `env` is merged last, so a caller can blank POWERBOARD_AGENT_NAME to test the
 * NAME_REQUIRED path.
 */
export function startServer(options = {}) {
  const { port, agentName = 'feature-1', env = {}, timeoutMs = 4000 } = options;
  const child = spawn(process.execPath, [serverPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      POWERBOARD_BRIDGE_PORT: String(port),
      POWERBOARD_AGENT_NAME: agentName,
      POWERBOARD_BRIDGE_TIMEOUT_MS: String(timeoutMs),
      ...env,
    },
  });

  let stdout = '';
  let stderr = '';
  const waiters = new Map();
  const stderrWaiters = new Set();

  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
    let nl;
    while ((nl = stdout.indexOf('\n')) >= 0) {
      const line = stdout.slice(0, nl).trim();
      stdout = stdout.slice(nl + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      const waiter = waiters.get(msg.id);
      if (waiter) {
        waiters.delete(msg.id);
        waiter(msg);
      }
    }
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
    for (const w of [...stderrWaiters]) {
      if (stderr.includes(w.text)) {
        clearTimeout(w.timer);
        stderrWaiters.delete(w);
        w.resolve();
      }
    }
  });

  let nextId = 1;
  const rpc = (method, params) =>
    new Promise((resolve) => {
      const id = nextId++;
      waiters.set(id, resolve);
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });

  function waitForStderr(text, ms = 10_000) {
    if (stderr.includes(text)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const w = {
        text,
        resolve,
        timer: setTimeout(() => {
          stderrWaiters.delete(w);
          reject(new Error(`server never logged "${text}". stderr:\n${stderr}`));
        }, ms),
      };
      stderrWaiters.add(w);
    });
  }

  async function ready({ hub = true } = {}) {
    await waitForStderr(hub ? 'listening on' : 'joined the hub');
    await rpc('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'powerboard-mcp-test', version: '1' },
    });
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`,
    );
  }

  async function call(name, args = {}) {
    const res = await rpc('tools/call', { name, arguments: args });
    const text = res?.result?.content?.[0]?.text ?? '';
    return { isError: !!res?.result?.isError, text, raw: res };
  }

  async function listTools() {
    const res = await rpc('tools/list', {});
    return res?.result?.tools ?? [];
  }

  return {
    child,
    rpc,
    call,
    listTools,
    ready,
    waitForStderr,
    stop() {
      child.kill();
    },
    get stderr() {
      return stderr;
    },
  };
}

/**
 * Fake the PowerBoard app: dial the hub, send the v1 `hello` frame, and answer
 * every command the way the app's bridge client would. `onCommand(msg, n)` may
 * return the result to send; the default echoes `{ran: cmd}`.
 */
export function connectApp(port, onCommand) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const frames = [];
  const control = [];
  ws.on('open', () => {
    ws.send(
      JSON.stringify({
        v: 1,
        type: 'hello',
        app: 'powerboard',
        appVersion: 'test',
        notebook: 'PowerBoard.html',
      }),
    );
  });
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.type) {
      control.push(msg);
      return;
    }
    if (!msg.cmd) return;
    frames.push(msg);
    const result = onCommand ? onCommand(msg, frames.length) : { ran: msg.cmd };
    ws.send(JSON.stringify({ v: 1, id: msg.id, ok: true, result }));
  });
  return {
    ws,
    frames,
    control,
    close: () => ws.close(),
  };
}
