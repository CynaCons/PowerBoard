import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { BoardData, BoardEvent } from '../contract';
import { BOARD_COLUMNS } from '../core';
import { avatarColor, avatarInitial, collapseEditRuns, displayName, relativeTime } from './boardUi';

function eventText(event: BoardEvent, board: BoardData): string {
  const card = board.cards.find((item) => item.id === event.cardId);
  const cardNumber = card ? `#${card.number}` : 'a card';
  const destination = BOARD_COLUMNS.find((column) => column.id === event.to)?.title;

  switch (event.type) {
    case 'created':
      return `created ${cardNumber}`;
    case 'moved':
      return `moved ${cardNumber} to ${destination}`;
    case 'noted':
      return `noted on ${cardNumber}`;
    case 'checked':
      return `ticked ${event.text ?? 'a checklist item'} on ${cardNumber}`;
    case 'claimed':
      return `claimed ${cardNumber}`;
    case 'released':
      return `released ${cardNumber}`;
    case 'deleted':
      return `deleted ${cardNumber}`;
    case 'archived':
      return `archived ${cardNumber}`;
    case 'restored':
      return `restored ${cardNumber}`;
    case 'left':
      return event.text ? `left — ${event.text}` : 'left';
    default:
      return `updated ${cardNumber}`;
  }
}

/** Device preference, like touch drawing: not saved in the notebook. */
export function readActivityCollapsed(collapsedKey: string): boolean {
  try {
    return localStorage.getItem(collapsedKey) === '1';
  } catch {
    return false;
  }
}

export function writeActivityCollapsed(collapsedKey: string, collapsed: boolean): void {
  try {
    localStorage.setItem(collapsedKey, collapsed ? '1' : '0');
  } catch {
    // Private mode or blocked storage: the panel still toggles for this session.
  }
}

interface ActivityPanelProps {
  board: BoardData;
  collapsed: boolean;
  collapsedKey: string;
  onToggle: () => void;
}

export function ActivityPanel({ board, collapsed, onToggle }: ActivityPanelProps) {
  const baseline = useRef<number | null>(null);
  const [fresh, setFresh] = useState<Set<number>>(() => new Set());
  const latestSeq = board.events[board.events.length - 1]?.seq ?? 0;
  // Events that arrive while the panel is collapsed are counted on the rail.
  const [seenSeq, setSeenSeq] = useState(latestSeq);
  useEffect(() => {
    if (!collapsed) setSeenSeq(latestSeq);
  }, [collapsed, latestSeq]);
  const unread = collapsed
    ? board.events.filter((event) => event.seq > seenSeq).length
    : 0;

  useEffect(() => {
    const latest = board.events[board.events.length - 1]?.seq ?? 0;
    if (baseline.current === null) {
      baseline.current = latest;
      return;
    }
    const arrived = board.events
      .filter((event) => event.seq > (baseline.current ?? 0))
      .map((event) => event.seq);
    baseline.current = latest;
    if (!arrived.length) return;
    setFresh((current) => new Set([...current, ...arrived]));
  }, [board.events]);

  if (collapsed) {
    return (
      <aside
        className="board-activity board-activity--collapsed"
        aria-label="Activity"
        data-testid="board-activity"
        data-collapsed="true"
      >
        <button
          type="button"
          className="board-activity__rail"
          onClick={onToggle}
          aria-expanded="false"
          aria-label={unread > 0 ? `Show activity, ${unread} new` : 'Show activity'}
          title="Show activity"
          data-testid="board-activity-toggle"
        >
          <ChevronLeft size={16} aria-hidden="true" />
          <span className="board-live-dot" data-testid="board-activity-live" />
          {unread > 0 && (
            <span className="board-activity__unread" data-testid="board-activity-unread">
              {unread}
            </span>
          )}
          <span className="board-activity__rail-label">Activity</span>
        </button>
      </aside>
    );
  }

  return (
    <aside
      className="board-activity"
      aria-label="Activity"
      data-testid="board-activity"
      data-collapsed="false"
    >
      <header className="board-activity__header">
        <h2>Activity</h2>
        <span className="board-live-dot" data-testid="board-activity-live" title="Live" />
        <button
          type="button"
          className="board-activity__collapse"
          onClick={onToggle}
          aria-expanded="true"
          aria-label="Collapse activity"
          title="Collapse activity"
          data-testid="board-activity-toggle"
        >
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </header>
      <ol className="board-activity__list">
        {collapseEditRuns(board.events)
          .slice(-50)
          .reverse()
          .map((event) => (
            <li
              key={event.seq}
              className={`board-activity__item${fresh.has(event.seq) ? ' board-activity__item--new' : ''}`}
            >
              <span
                className="board-avatar board-avatar--small"
                style={{ backgroundColor: avatarColor(event.actor) }}
              >
                {avatarInitial(event.actor)}
              </span>
              <p>
                <strong>{displayName(event.actor)}</strong> {eventText(event, board)}
                <time>{relativeTime(event.at)}</time>
              </p>
            </li>
          ))}
      </ol>
    </aside>
  );
}
