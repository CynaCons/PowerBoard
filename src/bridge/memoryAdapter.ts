/**
 * In-memory `BoardHostAdapter`. Used by the bridge unit tests today and by the
 * standalone app later; it keeps boards in a plain array and writes nothing.
 */

import type { BoardData, BoardHostAdapter, BoardRef } from '../core';
import { createBoard, generateId } from '../core';
import { BridgeCommandError } from './types';

/**
 * Boards live in an array the caller may inspect. `initial` boards are kept
 * as given (ids, titles, data and optional section), so a test can start from
 * a hand-built board and read the mutated one back through `getBoard`.
 */
export function createMemoryAdapter(initial: BoardRef[] = []): BoardHostAdapter {
  const boards: BoardRef[] = initial.slice();

  // Known sections, derived from the boards handed in. Sections are the host's
  // grouping (PowerScroll); the standalone app has none.
  const sections = new Map<string, string>();
  for (const ref of boards) {
    if (ref.sectionId) sections.set(ref.sectionId, ref.section ?? ref.sectionId);
  }

  return {
    listBoards(): BoardRef[] {
      return boards.slice();
    },

    getBoard(id: string): BoardRef | undefined {
      return boards.find((ref) => ref.id === id);
    },

    updateBoard(id: string, fn: (current: BoardData) => BoardData): void {
      const ref = boards.find((item) => item.id === id);
      if (!ref) {
        throw new BridgeCommandError('NOT_FOUND', `No page with id "${id}"`);
      }
      ref.board = fn(ref.board);
    },

    createBoard(title: string, opts?: { sectionId?: string }): BoardRef {
      const sectionId = opts?.sectionId;
      const ref: BoardRef = {
        id: generateId(),
        title,
        board: createBoard(),
      };
      if (sectionId !== undefined) {
        const sectionTitle = sections.get(sectionId);
        if (sectionTitle === undefined) {
          throw new BridgeCommandError('NOT_FOUND', `No section with id "${sectionId}"`);
        }
        ref.sectionId = sectionId;
        ref.section = sectionTitle;
      }
      boards.push(ref);
      return ref;
    },
  };
}
