/**
 * The standalone app shell: a left sidebar of the file's boards plus the
 * board view for the active one, and a top bar to open/save (REQ-PB-112,
 * REQ-PB-113).
 */

import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { BoardView } from '../react';
import { useAppStore } from './store';
import { openNow, saveNow, startAutoSave } from './save';
import { Settings } from './Settings';
import { initBridge } from './bridge/client';
// BoardView's own stylesheet, loaded the same way the component loads it.
import '../react/BoardView.css';
import './App.css';

export function App() {
  const file = useAppStore((state) => state.file);
  const dirty = useAppStore((state) => state.dirty);
  const fileName = useAppStore((state) => state.fileName);
  const updateBoard = useAppStore((state) => state.updateBoard);
  const createBoard = useAppStore((state) => state.createBoard);
  const renameBoard = useAppStore((state) => state.renameBoard);
  const deleteBoard = useAppStore((state) => state.deleteBoard);
  const setActive = useAppStore((state) => state.setActive);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void saveNow();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    const stopAutoSave = startAutoSave();
    // Dial the agent bridge when the setting is on (REQ-PB-120); the returned
    // unsubscribe keeps the socket in step with the toggle.
    const stopBridgeWatch = initBridge();
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      stopAutoSave();
      stopBridgeWatch();
    };
  }, []);

  const active =
    file.boards.find((board) => board.id === file.activeBoardId) ?? file.boards[0];

  const startRename = (id: string, title: string) => {
    setConfirmId(null);
    setRenamingId(id);
    setRenameDraft(title);
  };

  const commitRename = (id: string) => {
    const title = renameDraft.trim();
    if (title) renameBoard(id, title);
    setRenamingId(null);
  };

  const addBoard = () => {
    const id = createBoard('New board');
    setActive(id);
  };

  return (
    <div className="pb-app">
      <aside className="pb-sidebar">
        <header className="pb-sidebar__header">
          <h1 className="pb-sidebar__title">{file.title}</h1>
          <button
            type="button"
            className="pb-new-board"
            data-testid="pb-new-board"
            onClick={addBoard}
          >
            <Plus size={14} />
            New board
          </button>
        </header>

        <ul className="pb-boards">
          {file.boards.map((board) => (
            <li
              key={board.id}
              className={
                board.id === active?.id ? 'pb-board pb-board--active' : 'pb-board'
              }
              data-testid={`pb-board-item-${board.id}`}
            >
              {renamingId === board.id ? (
                <input
                  className="pb-rename-input"
                  data-testid="pb-rename-input"
                  aria-label="Board name"
                  autoFocus
                  value={renameDraft}
                  onChange={(event) => setRenameDraft(event.target.value)}
                  onBlur={() => commitRename(board.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') commitRename(board.id);
                    if (event.key === 'Escape') setRenamingId(null);
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="pb-board__title"
                  onClick={() => setActive(board.id)}
                  onDoubleClick={() => startRename(board.id, board.title)}
                >
                  {board.title}
                </button>
              )}

              {confirmId === board.id ? (
                <span className="pb-board__confirm">
                  <button
                    type="button"
                    className="pb-board__danger"
                    data-testid="pb-delete-confirm"
                    onClick={() => {
                      deleteBoard(board.id);
                      setConfirmId(null);
                    }}
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    className="pb-board__cancel"
                    data-testid="pb-delete-cancel"
                    onClick={() => setConfirmId(null)}
                  >
                    Cancel
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className="pb-board__delete"
                  data-testid="pb-delete-board"
                  aria-label={`Delete ${board.title}`}
                  onClick={() => setConfirmId(board.id)}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>

        <footer className="pb-sidebar__footer" data-testid="pb-file-name">
          {fileName ?? 'Not saved yet'}
        </footer>
      </aside>

      <div className="pb-main">
        <header className="pb-topbar">
          <button
            type="button"
            className="pb-button"
            data-testid="pb-open"
            onClick={() => void openNow()}
          >
            Open
          </button>
          <button
            type="button"
            className="pb-button pb-button--primary"
            data-testid="pb-save"
            onClick={() => void saveNow()}
          >
            Save
          </button>
          {dirty && (
            <span
              className="pb-dirty"
              data-testid="pb-dirty"
              role="status"
              aria-label="Unsaved changes"
            />
          )}
          <span className="pb-topbar__name">{fileName ?? 'Unsaved changes'}</span>
          <Settings />
        </header>

        <div className="pb-board-host">
          {active ? (
            <BoardView
              boardId={active.id}
              title={active.title}
              board={active.board}
              onChange={(fn) => updateBoard(active.id, fn)}
              onRename={(title) => renameBoard(active.id, title)}
            />
          ) : (
            <div className="pb-empty" data-testid="pb-no-board">
              <p>No boards yet.</p>
              <button type="button" className="pb-button pb-button--primary" onClick={addBoard}>
                New board
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
