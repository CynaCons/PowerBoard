import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { BoardData } from '../contract';
import { claimCard, createBoard, createCard, moveCard } from '../core';
import { BoardView } from '../react';

/**
 * A few sample cards so `npm run dev` opens a board that works end to end. The
 * standalone app (task B8) replaces this with real file persistence.
 */
function demoBoard(): BoardData {
  const now = Date.now();
  let board = createBoard();
  board = createCard(
    board,
    { title: 'Sketch the board layout', column: 'todo', labels: ['design'] },
    'you',
    now,
  );
  board = createCard(
    board,
    {
      title: 'Port BoardView to props',
      column: 'doing',
      description: '- [x] read the contract\n- [ ] wire onChange',
    },
    'you',
    now,
  );
  board = claimCard(board, { cardId: board.cards[board.cards.length - 1].id }, 'agent-1', now);
  board = createCard(
    board,
    { title: 'Confirm the column names', column: 'todo' },
    'you',
    now,
  );
  board = moveCard(
    board,
    {
      cardId: board.cards[board.cards.length - 1].id,
      to: 'waiting',
      index: 0,
      question: 'Is “In progress” the label you want?',
    },
    'you',
    now,
  );
  board = createCard(board, { title: 'Ship the standalone build', column: 'done' }, 'you', now);
  return board;
}

function App() {
  const [board, setBoard] = useState<BoardData>(demoBoard);
  const [title, setTitle] = useState('PowerBoard');

  return (
    <BoardView
      boardId="demo"
      title={title}
      board={board}
      onChange={(fn) => setBoard(fn)}
      onRename={setTitle}
    />
  );
}

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('PowerBoard: #root element is missing');

createRoot(rootEl).render(<App />);
