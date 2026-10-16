/**
 * Shared helpers for the board specs, ported from PowerScroll's tests/helpers.ts.
 *
 * The specs drive the built standalone app (dist-app/PowerBoard.html) over
 * file://. Where PowerScroll's helpers reached into `__POWERNOTE_STORES__` and
 * `__POWERNOTE_BRIDGE__`, these go through `window.__POWERBOARD_BRIDGE__`
 * (run a bridge command, feed a server frame, read the open file). The app
 * installs that hook only when `window.__POWERBOARD_E2E__` is set, which
 * `enableE2EHook` does before the page loads.
 */
import { expect, type Page, type TestInfo } from '@playwright/test';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { BoardData, PowerBoardFile } from '../src/contract';
import type { AgentActorState, ConnectedAgent } from '../src/react';

export const appPath = resolve(import.meta.dirname, '../dist-app/PowerBoard.html');
export const appUrl = pathToFileURL(appPath).href;

interface PresenceState {
  connected: ConnectedAgent[];
  actors: Record<string, AgentActorState>;
  left: Record<string, number>;
  now: number;
  setNow(ms: number): void;
}

interface E2EWindow {
  __POWERBOARD_E2E__?: boolean;
  __POWERBOARD_BRIDGE__?: {
    run(cmd: string, params?: Record<string, unknown>): Promise<unknown>;
    handleServerFrame(raw: string): Promise<void>;
    getFile(): PowerBoardFile;
  };
  __POWERBOARD_AGENT_PRESENCE__?: { getState(): PresenceState };
  __POWERNOTE_AGENT_PRESENCE__?: { getState(): PresenceState };
  __pbWritten?: string[];
  showSaveFilePicker?: unknown;
  showOpenFilePicker?: unknown;
}

/** Turn on the app's E2E hook. Must run BEFORE page.goto(), like any init script. */
export async function enableE2EHook(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as E2EWindow).__POWERBOARD_E2E__ = true;
  });
}

/** Wait for the app to expose its E2E hook (it is installed before the first render). */
export async function waitForBridgeReady(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean((window as unknown as E2EWindow).__POWERBOARD_BRIDGE__));
}

/**
 * Open the built app with the E2E hook on. A fresh file starts with one empty
 * board, so unlike PowerScroll there is no "add board" step.
 */
export async function openApp(page: Page): Promise<void> {
  expect(existsSync(appPath), `${appPath} should exist (npm run build:app)`).toBe(true);
  await enableE2EHook(page);
  await page.goto(appUrl);
  await waitForBridgeReady(page);
  await expect(page.getByTestId('board-view')).toBeVisible();
}

/** Open the app and return the id of its (active) board, ready for bridge commands. */
export async function openBoard(page: Page): Promise<string> {
  await openApp(page);
  return activeBoardId(page);
}

/** The whole open file, exactly as the app would save it. */
export async function getFile(page: Page): Promise<PowerBoardFile> {
  return page.evaluate(() => {
    const bridge = (window as unknown as E2EWindow).__POWERBOARD_BRIDGE__;
    if (!bridge) throw new Error('Bridge not exposed on window');
    return bridge.getFile();
  });
}

export async function activeBoardId(page: Page): Promise<string> {
  const file = await getFile(page);
  const id = file.activeBoardId ?? file.boards[0]?.id;
  if (!id) throw new Error('The open file has no boards');
  return id;
}

/** The stored data of a board (the active one when no id is given). */
export async function getBoard(page: Page, boardId?: string): Promise<BoardData> {
  const file = await getFile(page);
  const id = boardId ?? file.activeBoardId ?? file.boards[0]?.id;
  const entry = file.boards.find((item) => item.id === id);
  if (!entry) throw new Error(`No board "${id}" in the open file`);
  return entry.board;
}

/**
 * Run an agent bridge command in-page, bypassing the WebSocket transport.
 * Exercises the same `createBoardCommands` handlers the socket dispatches to.
 */
export async function runBridge<T = unknown>(
  page: Page,
  cmd: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  return page.evaluate(
    ({ cmd, params }) => {
      const bridge = (window as unknown as E2EWindow).__POWERBOARD_BRIDGE__;
      if (!bridge) throw new Error('Bridge not exposed on window');
      return bridge.run(cmd, params);
    },
    { cmd, params },
  ) as Promise<T>;
}

/** Run a bridge command expected to fail; returns the error code + message. */
export async function runBridgeExpectingError(
  page: Page,
  cmd: string,
  params: Record<string, unknown> = {},
): Promise<{ code: string; message: string }> {
  return page.evaluate(
    async ({ cmd, params }) => {
      const bridge = (window as unknown as E2EWindow).__POWERBOARD_BRIDGE__;
      if (!bridge) throw new Error('Bridge not exposed on window');
      try {
        await bridge.run(cmd, params);
      } catch (err) {
        const error = err as { code?: string; message?: unknown };
        return { code: error.code ?? 'UNKNOWN', message: String(error.message ?? err) };
      }
      throw new Error(`Expected "${cmd}" to throw, but it succeeded`);
    },
    { cmd, params },
  );
}

/**
 * Push a frame at the app exactly as the bridge server would, without standing
 * up a real WebSocket. Accepts an object (serialized for you) or a raw string,
 * so malformed input can be tested too.
 */
export async function sendServerFrame(page: Page, frame: object | string): Promise<void> {
  const raw = typeof frame === 'string' ? frame : JSON.stringify(frame);
  await page.evaluate(async (raw) => {
    const bridge = (window as unknown as E2EWindow).__POWERBOARD_BRIDGE__;
    if (!bridge) throw new Error('Bridge not exposed on window');
    await bridge.handleServerFrame(raw);
  }, raw);
}

/** Presence store used by the live board (agents strip / active cards). */
export async function getPresenceStore(page: Page) {
  return page.evaluate(() => {
    const w = window as unknown as E2EWindow;
    const store = w.__POWERBOARD_AGENT_PRESENCE__ ?? w.__POWERNOTE_AGENT_PRESENCE__;
    if (!store) throw new Error('Agent presence store is not exposed');
    const state = store.getState();
    return {
      connected: state.connected,
      actors: state.actors,
      left: state.left ?? {},
      now: state.now,
    };
  });
}

/** Pin the live board's clock (the presence store's `setNow`). */
export async function setPresenceNow(page: Page, ms: number): Promise<void> {
  await page.evaluate((ms) => {
    const w = window as unknown as E2EWindow;
    const store = w.__POWERBOARD_AGENT_PRESENCE__ ?? w.__POWERNOTE_AGENT_PRESENCE__;
    if (!store) throw new Error('Agent presence store is not exposed');
    store.getState().setNow(ms);
  }, ms);
}

/**
 * Replace the File System Access pickers with stubs that capture what the app
 * writes. Must run BEFORE page.goto(); `saveToFile` reads what was captured.
 */
export async function stubSaveFilePicker(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as E2EWindow;
    const written: string[] = [];
    w.__pbWritten = written;
    w.showSaveFilePicker = async (options?: { suggestedName?: string }) => ({
      name: options?.suggestedName ?? 'PowerBoard.html',
      queryPermission: async () => 'granted',
      requestPermission: async () => 'granted',
      createWritable: async () => ({
        write: async (html: string) => {
          written.push(html);
        },
        close: async () => {},
      }),
    });
    w.showOpenFilePicker = async () => {
      throw new Error('not used');
    };
  });
}

const writtenCount = (page: Page) =>
  page.evaluate(() => (window as unknown as E2EWindow).__pbWritten?.length ?? 0);

/**
 * Click Save, then write the HTML the app handed to the stubbed picker into the
 * test's output folder and return its path. Needs `stubSaveFilePicker` first.
 */
export async function saveToFile(page: Page, testInfo: TestInfo, name: string): Promise<string> {
  const before = await writtenCount(page);
  await page.getByTestId('pb-save').click();
  await expect.poll(() => writtenCount(page)).toBeGreaterThan(before);
  const html = await page.evaluate(
    (index) => (window as unknown as E2EWindow).__pbWritten![index],
    before,
  );
  const file = testInfo.outputPath(name);
  writeFileSync(file, html, 'utf-8');
  return file;
}

/** Open a saved PowerBoard.html the way a user does: as its own document. */
export async function reopenFile(page: Page, file: string): Promise<void> {
  await page.goto(pathToFileURL(file).href);
  await waitForBridgeReady(page);
  await expect(page.getByTestId('board-view')).toBeVisible();
}
