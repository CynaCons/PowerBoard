/**
 * `BoardHostAdapter` over the standalone app store, so the bridge client
 * (task B9) can run board commands against the open file. `createBoard` never
 * switches the active board (REQ-BOARD-017).
 */

import type { BoardData, BoardHostAdapter, BoardRef } from '../contract';
import { BridgeCommandError } from '../bridge/types';
import { useAppStore } from './store';

function toRef(entry: { id: string; title: string; board: BoardData }): BoardRef {
  // The standalone app has no sections, so BoardRef.section/sectionId stay out.
  return { id: entry.id, title: entry.title, board: entry.board };
}

export function createAppAdapter(): BoardHostAdapter {
  return {
    listBoards(): BoardRef[] {
      return useAppStore.getState().file.boards.map(toRef);
    },

    getBoard(id: string): BoardRef | undefined {
      const entry = useAppStore.getState().file.boards.find((item) => item.id === id);
      return entry ? toRef(entry) : undefined;
    },

    updateBoard(id: string, fn: (current: BoardData) => BoardData): void {
      if (!useAppStore.getState().file.boards.some((item) => item.id === id)) {
        throw new BridgeCommandError('NOT_FOUND', `No page with id "${id}"`);
      }
      useAppStore.getState().updateBoard(id, fn);
    },

    createBoard(title: string, opts?: { sectionId?: string }): BoardRef {
      if (opts?.sectionId !== undefined) {
        throw new BridgeCommandError('NOT_FOUND', `No section with id "${opts.sectionId}"`);
      }
      const id = useAppStore.getState().createBoard(title);
      const entry = useAppStore.getState().file.boards.find((item) => item.id === id);
      if (!entry) throw new BridgeCommandError('INTERNAL', 'New board was not stored');
      return toRef(entry);
    },
  };
}
