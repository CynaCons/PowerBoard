import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import type { BoardCard, BoardData } from '../contract';
import { BoardView } from './BoardView';
import { useAgentPresenceStore } from './presence';

afterEach(cleanup);

const NOW = 1_700_000_000_000;

function makeCard(overrides: Partial<BoardCard> = {}): BoardCard {
  return {
    id: 'c1',
    number: 1,
    title: 'Untitled card',
    description: '',
    column: 'todo',
    order: 0,
    labels: [],
    checklist: [],
    notes: [],
    createdBy: 'you',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeBoard(cards: BoardCard[]): BoardData {
  return {
    cards,
    events: [],
    nextNumber: cards.reduce((max, card) => Math.max(max, card.number), 0) + 1,
    nextSeq: 1,
  };
}

interface HarnessProps {
  initial: BoardData;
  title?: string;
  onRename?: (title: string) => void;
  renderMarkdown?: (markdown: string) => string;
  onChange?: (fn: (board: BoardData) => BoardData) => void;
}

/** Holds the board in state and applies every onChange — how a host embeds it. */
function Harness({
  initial,
  title = 'Dashboard',
  onRename,
  renderMarkdown,
  onChange,
}: HarnessProps) {
  const [board, setBoard] = useState(initial);
  const apply = (fn: (current: BoardData) => BoardData) => {
    onChange?.(fn);
    setBoard(fn);
  };

  return (
    <BoardView
      boardId="board-1"
      title={title}
      board={board}
      onChange={apply}
      onRename={onRename}
      renderMarkdown={renderMarkdown}
    />
  );
}

describe('BoardView', () => {
  beforeEach(() => {
    useAgentPresenceStore.setState({
      connected: [],
      presenceSeen: false,
      actors: {},
      left: {},
    });
    useAgentPresenceStore.getState().clearNow();
    localStorage.clear();
  });

  it('REQ-BOARD-003 renders the four fixed columns and the live card count', () => {
    const board = makeBoard([
      makeCard({ id: 'c1', number: 1, column: 'todo', title: 'One' }),
      makeCard({ id: 'c2', number: 2, column: 'done', title: 'Two' }),
      makeCard({ id: 'c3', number: 3, column: 'todo', title: 'Archived', archivedAt: NOW }),
    ]);

    render(<Harness initial={board} />);

    expect(screen.getByTestId('board-column-todo')).toBeTruthy();
    expect(screen.getByTestId('board-column-doing')).toBeTruthy();
    expect(screen.getByTestId('board-column-waiting')).toBeTruthy();
    expect(screen.getByTestId('board-column-done')).toBeTruthy();

    expect(screen.getByText('To do')).toBeTruthy();
    expect(screen.getByText('In progress')).toBeTruthy();
    expect(screen.getByText('Waiting for feedback')).toBeTruthy();
    expect(screen.getByText('Done')).toBeTruthy();
    expect(screen.getByText('Board · 2 cards')).toBeTruthy();
  });

  it('REQ-BOARD-005 quick add in To do calls onChange and applies to a new card', () => {
    const onChange = vi.fn();
    render(<Harness initial={makeBoard([])} onChange={onChange} />);

    fireEvent.click(screen.getByTestId('board-add-card-todo'));
    const input = screen.getByPlaceholderText('Card title');
    fireEvent.change(input, { target: { value: 'New task' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(screen.getByText('New task')).toBeTruthy();
    expect(screen.getByTestId('board-card-1')).toBeTruthy();
  });

  it('REQ-BOARD-006 Alt+ArrowRight moves a focused card to the next column', () => {
    const onChange = vi.fn();
    render(
      <Harness
        initial={makeBoard([makeCard({ id: 'c1', number: 1, column: 'todo', title: 'Move me' })])}
        onChange={onChange}
      />,
    );

    fireEvent.keyDown(screen.getByTestId('board-card-1'), { key: 'ArrowRight', altKey: true });

    expect(onChange).toHaveBeenCalledTimes(1);
    const card = screen.getByTestId('board-card-1');
    expect(card.closest('[data-board-column]')?.getAttribute('data-board-column')).toBe('doing');
  });

  it('REQ-BOARD-007 moving into Waiting asks for a question', () => {
    const onChange = vi.fn();
    render(
      <Harness
        initial={makeBoard([makeCard({ id: 'c1', number: 1, column: 'doing', title: 'Almost' })])}
        onChange={onChange}
      />,
    );

    fireEvent.keyDown(screen.getByTestId('board-card-1'), { key: 'ArrowRight', altKey: true });

    expect(screen.getByRole('dialog', { name: 'Feedback question' })).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Ship it?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const card = screen.getByTestId('board-card-1');
    expect(card.closest('[data-board-column]')?.getAttribute('data-board-column')).toBe('waiting');
    expect(screen.getByText('Ship it?')).toBeTruthy();
  });

  it('REQ-PB-104 keeps the title read-only when onRename is absent', () => {
    render(<Harness initial={makeBoard([])} />);

    expect(screen.queryByTestId('board-title')).toBeNull();
    expect(screen.queryByTestId('board-title-input')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeTruthy();
  });

  it('REQ-PB-104 renames through onRename when provided', () => {
    const onRename = vi.fn();
    render(<Harness initial={makeBoard([])} onRename={onRename} />);

    fireEvent.click(screen.getByTestId('board-title'));
    const input = screen.getByTestId('board-title-input');
    fireEvent.change(input, { target: { value: 'Roadmap' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onRename).toHaveBeenCalledWith('Roadmap');
  });

  it('REQ-PB-104 uses a custom renderMarkdown for the card description', () => {
    const renderMarkdown = vi.fn((markdown: string) => `<p>custom:${markdown}</p>`);
    render(
      <Harness
        initial={makeBoard([
          makeCard({
            id: 'c1',
            number: 1,
            title: 'Has description',
            description: '# Hello',
          }),
        ])}
        renderMarkdown={renderMarkdown}
      />,
    );

    fireEvent.pointerUp(screen.getByTestId('board-card-1'));

    expect(screen.getByTestId('board-card-overlay')).toBeTruthy();
    expect(renderMarkdown).toHaveBeenCalledWith('# Hello');
    expect(screen.getByText('custom:# Hello')).toBeTruthy();
  });
});
