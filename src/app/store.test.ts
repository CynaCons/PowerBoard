import { beforeEach, describe, expect, it } from 'vitest';
import { createAppAdapter } from './adapter';
import { emptyFile } from './fileFormat';
import { useAppStore } from './store';

function reset(): void {
  useAppStore.getState().setFile(emptyFile());
}

describe('app store', () => {
  beforeEach(reset);

  it('REQ-PB-111 starts with one active board and no unsaved changes', () => {
    const { file, dirty } = useAppStore.getState();
    expect(file.boards).toHaveLength(1);
    expect(file.activeBoardId).toBe(file.boards[0].id);
    expect(dirty).toBe(false);
  });

  it('REQ-PB-112 creates a board without switching the active one', () => {
    const before = useAppStore.getState().file.activeBoardId;
    const id = useAppStore.getState().createBoard('Second');

    const state = useAppStore.getState();
    expect(state.file.boards).toHaveLength(2);
    expect(state.file.boards[1]).toMatchObject({ id, title: 'Second' });
    expect(state.file.activeBoardId).toBe(before);
    expect(state.dirty).toBe(true);
  });

  it('REQ-PB-112 renames a board', () => {
    const id = useAppStore.getState().file.boards[0].id;
    useAppStore.getState().renameBoard(id, 'Renamed');
    expect(useAppStore.getState().file.boards[0].title).toBe('Renamed');
    expect(useAppStore.getState().dirty).toBe(true);
  });

  it('REQ-PB-112 switches the active board', () => {
    const id = useAppStore.getState().createBoard('Second');
    useAppStore.getState().setActive(id);
    expect(useAppStore.getState().file.activeBoardId).toBe(id);
  });

  it('REQ-PB-112 deletes a board and picks a new active one', () => {
    const first = useAppStore.getState().file.boards[0].id;
    const second = useAppStore.getState().createBoard('Second');
    useAppStore.getState().setActive(second);

    useAppStore.getState().deleteBoard(second);

    const state = useAppStore.getState();
    expect(state.file.boards.map((board) => board.id)).toEqual([first]);
    expect(state.file.activeBoardId).toBe(first);
    expect(state.dirty).toBe(true);
  });

  it('REQ-BOARD-011 updateBoard applies the edit and marks the file dirty', () => {
    const id = useAppStore.getState().file.boards[0].id;
    useAppStore.getState().markSaved('PowerBoard.html');
    expect(useAppStore.getState().dirty).toBe(false);

    useAppStore.getState().updateBoard(id, (board) => ({ ...board, nextNumber: 7 }));

    expect(useAppStore.getState().file.boards[0].board.nextNumber).toBe(7);
    expect(useAppStore.getState().dirty).toBe(true);
  });

  it('REQ-PB-113 markSaved records the name and clears dirty', () => {
    const id = useAppStore.getState().file.boards[0].id;
    useAppStore.getState().updateBoard(id, (board) => board);
    useAppStore.getState().markSaved('My.html');
    expect(useAppStore.getState().fileName).toBe('My.html');
    expect(useAppStore.getState().dirty).toBe(false);
  });

  it('REQ-BOARD-017 the adapter createBoard keeps the active board', () => {
    const adapter = createAppAdapter();
    const before = useAppStore.getState().file.activeBoardId;

    const ref = adapter.createBoard('Agent board');

    expect(ref.title).toBe('Agent board');
    expect(useAppStore.getState().file.activeBoardId).toBe(before);
    expect(adapter.getBoard(ref.id)?.title).toBe('Agent board');
    expect(adapter.listBoards().map((board) => board.id)).toContain(ref.id);
  });

  it('the adapter updateBoard writes through and rejects unknown ids', () => {
    const adapter = createAppAdapter();
    const id = useAppStore.getState().file.boards[0].id;

    adapter.updateBoard(id, (board) => ({ ...board, nextNumber: 3 }));
    expect(useAppStore.getState().file.boards[0].board.nextNumber).toBe(3);

    expect(() => adapter.updateBoard('missing', (board) => board)).toThrow();
    expect(() => adapter.createBoard('x', { sectionId: 'nope' })).toThrow();
  });
});
