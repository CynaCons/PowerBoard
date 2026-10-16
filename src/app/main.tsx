import { createRoot } from 'react-dom/client';
import {
  BridgeCommandError,
  createBoardCommands,
  type BoardCommandName,
  type PresenceSink,
} from '../bridge';
import { useAgentPresenceStore } from '../react';
import { App } from './App';
import { createAppAdapter } from './adapter';
import { handleServerFrame } from './bridge/client';
import { emptyFile, readEmbedded } from './fileFormat';
import { useAppStore } from './store';

/**
 * Startup load order: the data embedded in this HTML file (opened from disk),
 * else a brand-new file with one empty board (REQ-PB-111).
 */
useAppStore.getState().setFile(readEmbedded(document) ?? emptyFile());

/**
 * E2E hook: lets the Playwright specs run bridge commands and feed server
 * frames without a WebSocket, and read the open file back. It exists only when
 * a spec sets `window.__POWERBOARD_E2E__ = true` before the page loads
 * (tests/helpers.ts does). A shipped PowerBoard.html never has that flag, so a
 * user's page exposes nothing extra.
 */
function installE2EHook(): void {
  const presence: PresenceSink = {
    recordAction: (actor, info) => useAgentPresenceStore.getState().recordAction(actor, info),
    leave: (name) => useAgentPresenceStore.getState().leave(name),
    lastBoardOf: (actor) => useAgentPresenceStore.getState().actors[actor]?.boardId,
  };
  const commands = createBoardCommands(createAppAdapter(), presence);

  (window as unknown as { __POWERBOARD_BRIDGE__: unknown }).__POWERBOARD_BRIDGE__ = {
    run: async (cmd: string, params: Record<string, unknown> = {}) => {
      if (!Object.hasOwn(commands, cmd)) {
        throw new BridgeCommandError('UNSUPPORTED', `Unknown command "${cmd}"`);
      }
      return commands[cmd as BoardCommandName](params);
    },
    handleServerFrame,
    getFile: () => useAppStore.getState().file,
  };
}

if ((window as unknown as { __POWERBOARD_E2E__?: unknown }).__POWERBOARD_E2E__ === true) {
  installE2EHook();
}

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('PowerBoard: #root element is missing');

createRoot(rootEl).render(<App />);
