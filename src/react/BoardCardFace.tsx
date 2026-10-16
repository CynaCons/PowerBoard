import { CheckSquare, MessageSquare } from 'lucide-react';
import type { BoardCard } from '../contract';
import {
  avatarColor,
  avatarInitial,
  colorWithAlpha,
  displayName,
  relativeTime,
} from './boardUi';

interface BoardCardFaceProps {
  card: BoardCard;
  dragging: boolean;
  active?: boolean;
  fading?: boolean;
  flashing?: boolean;
  spotlight?: boolean;
  dimmed?: boolean;
  spotlightColor?: string;
  onOpen: () => void;
  onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
}

export function BoardCardFace({
  card,
  dragging,
  active = false,
  fading = false,
  flashing = false,
  spotlight = false,
  dimmed = false,
  spotlightColor,
  onOpen,
  onPointerDown,
  onKeyDown,
}: BoardCardFaceProps) {
  const complete = card.checklist.filter((item) => item.done).length;
  const metadata = card.checklist.length
    ? `${complete}/${card.checklist.length}`
    : card.notes.length
      ? `${card.notes.length} notes`
      : '';
  const agentColor = avatarColor(card.assignee);
  const className = [
    'board-card',
    dragging ? 'board-card--dragging' : '',
    active ? 'board-card--active' : '',
    fading ? 'board-card--fading' : '',
    flashing ? 'board-card--flash' : '',
    spotlight ? 'board-card--spotlight' : '',
    dimmed ? 'board-card--dimmed' : '',
  ].filter(Boolean).join(' ');

  return (
    <button
      type="button"
      className={className}
      data-testid={`board-card-${card.number}`}
      data-board-card={card.id}
      data-active={active ? 'true' : 'false'}
      data-spotlighted={spotlight ? 'true' : 'false'}
      style={active || fading || spotlight ? {
        ['--agent-color' as string]: agentColor,
        ['--agent-glow' as string]: colorWithAlpha(agentColor, 0.22),
        ['--spotlight-color' as string]: spotlightColor ?? agentColor,
      } : undefined}
      onPointerDown={onPointerDown}
      onPointerUp={onOpen}
      onKeyDown={onKeyDown}
    >
      <div className="board-card__meta">
        <span className="board-card__number">#{card.number}</span>
        <span className="board-card__labels">
          {card.labels.map((label) => (
            <span key={label} className="board-label">
              {label}
            </span>
          ))}
        </span>
      </div>
      {card.column === 'waiting' && (
        <>
          <span className="board-card__needs">Needs you</span>
          {card.question && <p className="board-card__question">{card.question}</p>}
        </>
      )}
      <strong className="board-card__title">{card.title}</strong>
      <footer className="board-card__footer">
        <span
          className="board-avatar board-avatar--small"
          style={{ backgroundColor: avatarColor(card.assignee) }}
          aria-label={displayName(card.assignee)}
        >
          {avatarInitial(card.assignee)}
        </span>
        <span className="board-card__assignee">
          {active && card.assignee ? (
            <>
              <span className="board-agent-dot board-agent-dot--active" />
              {`${displayName(card.assignee)} · working now`}
            </>
          ) : (
            <>
              {card.assignee ? `${displayName(card.assignee)} · ` : ''}
              {relativeTime(card.updatedAt)}
            </>
          )}
        </span>
        {metadata && (
          <span className="board-card__counts">
            {card.checklist.length > 0 ? <CheckSquare size={13} /> : <MessageSquare size={13} />}
            {metadata}
          </span>
        )}
      </footer>
    </button>
  );
}
