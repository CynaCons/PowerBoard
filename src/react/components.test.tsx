import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { BoardCard, BoardColumnId, BoardData, BoardEvent } from '../contract';
import { BoardCardFace } from './BoardCardFace';
import { BoardColumn } from './BoardColumn';
import { AgentsStrip, type AgentChipModel } from './AgentsStrip';
import {
  ActivityPanel,
  readActivityCollapsed,
  writeActivityCollapsed,
} from './ActivityPanel';
import { defaultRenderMarkdown } from './markdown';
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

describe('BoardCardFace', () => {
  it('REQ-BOARD-004 renders number, title, labels, assignee and checklist meta', () => {
    const card = makeCard({
      number: 7,
      title: 'Ship it',
      labels: ['bug', 'urgent'],
      assignee: 'agent-1',
      checklist: [
        { id: 'k1', text: 'one', done: true },
        { id: 'k2', text: 'two', done: false },
      ],
      updatedAt: Date.now(),
    });

    render(
      <BoardCardFace
        card={card}
        dragging={false}
        onOpen={() => undefined}
        onPointerDown={() => undefined}
        onKeyDown={() => undefined}
      />,
    );

    expect(screen.getByText('#7')).toBeTruthy();
    expect(screen.getByText('Ship it')).toBeTruthy();
    expect(screen.getByText('bug')).toBeTruthy();
    expect(screen.getByText('urgent')).toBeTruthy();
    expect(screen.getByLabelText('agent-1')).toBeTruthy();
    expect(screen.getByText('1/2')).toBeTruthy();
    expect(screen.getByTestId('board-card-7').textContent).toContain('agent-1');
  });

  it('REQ-BOARD-004 shows note count meta when the card has no checklist', () => {
    const card = makeCard({
      number: 2,
      title: 'Notes only',
      notes: [
        { id: 'n1', author: 'agent-1', at: NOW, text: 'a' },
        { id: 'n2', author: 'agent-1', at: NOW, text: 'b' },
      ],
    });

    render(
      <BoardCardFace
        card={card}
        dragging={false}
        onOpen={() => undefined}
        onPointerDown={() => undefined}
        onKeyDown={() => undefined}
      />,
    );

    expect(screen.getByText('2 notes')).toBeTruthy();
  });
});

describe('BoardColumn', () => {
  const column: { id: BoardColumnId; title: string } = { id: 'todo', title: 'To do' };

  it('REQ-BOARD-003/005 renders the column title and cards, adds on Enter, cancels on Escape', () => {
    const onCreate = vi.fn();
    const card = makeCard({ number: 7, title: 'Ship it' });

    render(
      <BoardColumn
        lanes={[{ key: '__none__', label: null, cards: [card], collapsed: false, total: 1 }]}
        count={1}
        column={column}
        onCreate={onCreate}
        onOpen={() => undefined}
        onCardPointerDown={() => undefined}
        onCardPointerUp={() => undefined}
        onCardKeyDown={() => undefined}
      />,
    );

    expect(screen.getByText('To do')).toBeTruthy();
    expect(screen.getByTestId('board-card-7')).toBeTruthy();

    fireEvent.click(screen.getByTestId('board-add-card-todo'));
    const input = screen.getByPlaceholderText('Card title');
    fireEvent.change(input, { target: { value: 'New task' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCreate).toHaveBeenCalledWith('New task');
    expect(onCreate).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('board-add-card-todo'));
    const escaped = screen.getByPlaceholderText('Card title');
    fireEvent.change(escaped, { target: { value: 'Discarded' } });
    fireEvent.keyDown(escaped, { key: 'Escape' });
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(screen.queryByPlaceholderText('Card title')).toBeNull();
    expect(screen.getByTestId('board-add-card-todo')).toBeTruthy();
  });
});

describe('AgentsStrip', () => {
  it('REQ-BOARD-024/025c renders a chip per recent actor and dismisses via the × button', () => {
    const onDismiss = vi.fn();
    const onToggleSpotlight = vi.fn();
    const chips: AgentChipModel[] = [
      { name: 'agent-1', color: '#2563eb', active: true, subtitle: 'working on #7' },
      { name: 'agent-2', color: '#0f766e', active: false, subtitle: 'on #8' },
    ];

    render(
      <AgentsStrip
        chips={chips}
        spotlight={null}
        onToggleSpotlight={onToggleSpotlight}
        onDismiss={onDismiss}
      />,
    );

    expect(screen.getByTestId('board-agent-agent-1')).toBeTruthy();
    expect(screen.getByTestId('board-agent-agent-2')).toBeTruthy();
    expect(screen.getByText('working on #7')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('agent-1'));
    expect(onToggleSpotlight).toHaveBeenCalledWith('agent-1');

    fireEvent.click(screen.getByTestId('board-agent-dismiss-agent-1'));
    expect(onDismiss).toHaveBeenCalledWith('agent-1');
    fireEvent.click(screen.getByTestId('board-agent-dismiss-agent-2'));
    expect(onDismiss).toHaveBeenCalledWith('agent-2');
  });

  it('REQ-BOARD-019/024 renders nothing when there are no chips', () => {
    const { container } = render(
      <AgentsStrip
        chips={[]}
        spotlight={null}
        onToggleSpotlight={() => undefined}
        onDismiss={() => undefined}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});

describe('ActivityPanel', () => {
  function makeEvents(count: number): BoardEvent[] {
    return Array.from({ length: count }, (_, index) => ({
      seq: index + 1,
      at: Date.now(),
      actor: 'agent-1',
      type: 'left' as const,
      text: `[evt-${index + 1}]`,
    }));
  }

  it('REQ-BOARD-012 shows at most the 50 newest events, newest first', () => {
    const board: BoardData = {
      cards: [],
      events: makeEvents(55),
      nextNumber: 1,
      nextSeq: 56,
    };

    const { container } = render(
      <ActivityPanel board={board} collapsed={false} collapsedKey="k" onToggle={() => undefined} />,
    );

    const items = [...container.querySelectorAll('.board-activity__item')];
    expect(items).toHaveLength(50);
    const seqs = items.map((item) => Number(/evt-(\d+)\]/.exec(item.textContent ?? '')?.[1]));
    expect(seqs[0]).toBe(55);
    expect(seqs).toEqual(Array.from({ length: 50 }, (_, index) => 55 - index));
  });

  it('REQ-BOARD-028 renders the collapsed rail and toggles', () => {
    const onToggle = vi.fn();
    const board: BoardData = { cards: [], events: makeEvents(3), nextNumber: 1, nextSeq: 4 };

    render(
      <ActivityPanel board={board} collapsed collapsedKey="k" onToggle={onToggle} />,
    );

    const panel = screen.getByTestId('board-activity');
    expect(panel.getAttribute('data-collapsed')).toBe('true');
    fireEvent.click(screen.getByTestId('board-activity-toggle'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('REQ-BOARD-028 stores the collapsed state under collapsedKey', () => {
    localStorage.clear();

    expect(readActivityCollapsed('powerboard-activity-collapsed')).toBe(false);
    writeActivityCollapsed('powerboard-activity-collapsed', true);
    expect(localStorage.getItem('powerboard-activity-collapsed')).toBe('1');
    expect(readActivityCollapsed('powerboard-activity-collapsed')).toBe(true);
    writeActivityCollapsed('powerboard-activity-collapsed', false);
    expect(readActivityCollapsed('powerboard-activity-collapsed')).toBe(false);
    expect(localStorage.getItem('powerscroll-board-activity-collapsed')).toBeNull();
  });
});

describe('defaultRenderMarkdown', () => {
  it('REQ-BOARD-008 renders a GFM task list with clickable (non-disabled) checkboxes', () => {
    const html = defaultRenderMarkdown('- [ ] todo\n- [x] done');

    const container = document.createElement('div');
    container.innerHTML = html;
    const boxes = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];

    expect(boxes).toHaveLength(2);
    expect(boxes[0].checked).toBe(false);
    expect(boxes[1].checked).toBe(true);
    for (const box of boxes) {
      expect(box.disabled).toBe(false);
    }
    expect(html).not.toContain('disabled');
  });

  it('REQ-BOARD-008 renders headings, emphasis and breaks', () => {
    const html = defaultRenderMarkdown('# Title\n\nsome **bold** text');
    expect(html).toContain('<h1');
    expect(html).toContain('<strong>bold</strong>');
  });
});

describe('useAgentPresenceStore', () => {
  function reset(): void {
    useAgentPresenceStore.setState({
      connected: [],
      presenceSeen: false,
      actors: {},
      left: {},
    });
    useAgentPresenceStore.getState().clearNow();
  }

  beforeEach(reset);

  it('REQ-BOARD-018 setConnected keeps valid labels and marks presenceSeen', () => {
    const store = useAgentPresenceStore.getState();
    store.setNow(NOW);
    store.setConnected([
      { label: 'agent-1', role: 'peer', connectedAt: NOW - 5 },
      { label: '', role: 'peer', connectedAt: NOW },
    ]);

    const state = useAgentPresenceStore.getState();
    expect(state.presenceSeen).toBe(true);
    expect(state.connected).toEqual([{ label: 'agent-1', role: 'peer', connectedAt: NOW - 5 }]);
  });

  it('REQ-BOARD-025 setConnected marks a vanished label as left but never you', () => {
    const store = useAgentPresenceStore.getState();
    store.setNow(NOW);
    store.setConnected([{ label: 'agent-1', role: 'peer', connectedAt: NOW }]);
    store.setConnected([{ label: 'you', role: 'owner', connectedAt: NOW }]);

    const state = useAgentPresenceStore.getState();
    expect(state.left['agent-1']).toBe(NOW);
    expect(state.left['you']).toBeUndefined();
  });

  it('REQ-BOARD-014 recordAction stamps the actor, keeps earlier fields and clears left', () => {
    const store = useAgentPresenceStore.getState();
    store.setNow(NOW);
    store.recordAction('agent-1', { cardId: 'c1', boardId: 'b1', status: 'busy' });

    expect(useAgentPresenceStore.getState().actors['agent-1']).toEqual({
      lastActionAt: NOW,
      cardId: 'c1',
      boardId: 'b1',
      status: 'busy',
    });

    store.setNow(NOW + 1_000);
    store.recordAction('agent-1', { status: 'idle' });
    expect(useAgentPresenceStore.getState().actors['agent-1']).toEqual({
      lastActionAt: NOW + 1_000,
      cardId: 'c1',
      boardId: 'b1',
      status: 'idle',
    });

    store.leave('agent-1');
    expect(useAgentPresenceStore.getState().left['agent-1']).toBe(NOW + 1_000);
    store.recordAction('agent-1');
    expect(useAgentPresenceStore.getState().left['agent-1']).toBeUndefined();

    store.recordAction('');
    expect(Object.keys(useAgentPresenceStore.getState().actors)).toEqual(['agent-1']);
  });

  it('REQ-BOARD-025 leave records the time and ignores you and empty names', () => {
    const store = useAgentPresenceStore.getState();
    store.setNow(NOW);
    store.leave('agent-1');
    expect(useAgentPresenceStore.getState().left['agent-1']).toBe(NOW);

    store.leave('you');
    store.leave('');
    expect(useAgentPresenceStore.getState().left['you']).toBeUndefined();
    expect(Object.keys(useAgentPresenceStore.getState().left)).toEqual(['agent-1']);
  });

  it('exposes the store on the PowerScroll and PowerBoard window hooks', () => {
    const hooks = window as unknown as {
      __POWERNOTE_AGENT_PRESENCE__: unknown;
      __POWERBOARD_AGENT_PRESENCE__: unknown;
    };
    expect(hooks.__POWERNOTE_AGENT_PRESENCE__).toBe(useAgentPresenceStore);
    expect(hooks.__POWERBOARD_AGENT_PRESENCE__).toBe(useAgentPresenceStore);
  });
});
