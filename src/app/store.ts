/**
 * The standalone app's file store (zustand).
 *
 * It owns the whole `PowerBoardFile` plus the transient save state (dirty dot
 * and file name). Every board edit marks the file dirty and is kept only in
 * this store — there is no canvas undo history to add them to
 * (REQ-BOARD-011, REQ-PB-113).
 */

import { create } from 'zustand';
import type { BoardData, PowerBoardFile } from '../contract';
import { createBoard as coreCreateBoard, generateId } from '../core';
import { emptyFile } from './fileFormat';

export interface BoardStoreState {
  file: PowerBoardFile;
  dirty: boolean;
  fileName?: string;
  /** Replace the whole file (open / startup). Loads start clean. */
  setFile(file: PowerBoardFile): void;
  /** Apply an edit to one board. Marks the file dirty. */
  updateBoard(id: string, fn: (current: BoardData) => BoardData): void;
  /** Add a board and return its id. Does NOT change the active board. */
  createBoard(title: string): string;
  renameBoard(id: string, title: string): void;
  deleteBoard(id: string): void;
  setActive(id: string): void;
  /** Record a successful save: clears dirty and remembers the file name. */
  markSaved(name: string): void;
}

export const useAppStore = create<BoardStoreState>((set) => ({
  file: emptyFile(),
  dirty: false,
  fileName: undefined,

  setFile: (file) => set({ file, dirty: false }),

  updateBoard: (id, fn) =>
    set((state) => ({
      file: {
        ...state.file,
        boards: state.file.boards.map((entry) =>
          entry.id === id ? { ...entry, board: fn(entry.board) } : entry,
        ),
      },
      dirty: true,
    })),

  createBoard: (title) => {
    const id = generateId();
    set((state) => ({
      file: {
        ...state.file,
        boards: [...state.file.boards, { id, title, board: coreCreateBoard() }],
      },
      dirty: true,
    }));
    return id;
  },

  renameBoard: (id, title) =>
    set((state) => ({
      file: {
        ...state.file,
        boards: state.file.boards.map((entry) =>
          entry.id === id ? { ...entry, title } : entry,
        ),
      },
      dirty: true,
    })),

  deleteBoard: (id) =>
    set((state) => {
      const boards = state.file.boards.filter((entry) => entry.id !== id);
      const activeBoardId =
        state.file.activeBoardId === id ? boards[0]?.id : state.file.activeBoardId;
      return { file: { ...state.file, boards, activeBoardId }, dirty: true };
    }),

  setActive: (id) =>
    set((state) => ({ file: { ...state.file, activeBoardId: id }, dirty: true })),

  markSaved: (name) => set({ dirty: false, fileName: name }),
}));
