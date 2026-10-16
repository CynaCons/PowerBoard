import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import type { BoardCard, BoardColumnId, BoardData, BoardViewProps } from '../contract';
import { OWNER_ACTOR } from '../contract';
import {
  BOARD_COLUMNS,
  clearDone,
  createCard,
  liveCards,
  moveCard,
  restoreCard,
} from '../core';
import { displayName, relativeTime } from './boardUi';
import {
  AGENT_ACTIVE_MS,
  AGENT_TICK_MS,
  useAgentPresenceStore,
} from './presence';
import { ActivityPanel, readActivityCollapsed, writeActivityCollapsed } from './ActivityPanel';
import { agentChips, AgentsStrip } from './AgentsStrip';
import { BoardColumn } from './BoardColumn';
import { CardOverlay } from './CardOverlay';
import { QuestionPrompt } from './QuestionPrompt';
import { defaultRenderMarkdown } from './markdown';
import './BoardView.css';

interface DragState {
  active: boolean;
  cardId: string;
  startX: number;
  startY: number;
}

interface DropState {
  column: BoardColumnId;
  index: number;
}

interface QuestionDrop extends DropState {
  cardId: string;
}

function cardsIn(cards: BoardCard[], column: BoardColumnId): BoardCard[] {
  return cards
    .filter((card) => card.column === column)
    .sort((left, right) => left.order - right.order);
}

export function BoardView(props: BoardViewProps) {
  const { board, boardId, title } = props;
  const collapsedKey = props.activityCollapsedKey ?? 'powerboard-activity-collapsed';
  const renderMarkdown = props.renderMarkdown ?? defaultRenderMarkdown;
  const connected = useAgentPresenceStore((state) => state.connected);
  const presenceSeen = useAgentPresenceStore((state) => state.presenceSeen);
  const actors = useAgentPresenceStore((state) => state.actors);
  const left = useAgentPresenceStore((state) => state.left);
  const now = useAgentPresenceStore((state) => state.now);
  const [needsMe, setNeedsMe] = useState(false);
  const [spotlight, setSpotlight] = useState<string | null>(null);
  const [activityCollapsed, setActivityCollapsed] = useState(() => readActivityCollapsed(collapsedKey));
  const [showArchived, setShowArchived] = useState(false);
  const [opened, setOpened] = useState<BoardCard | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [drop, setDrop] = useState<DropState | null>(null);
  const [questionDrop, setQuestionDrop] = useState<QuestionDrop | null>(null);
  const [flashing, setFlashing] = useState<Set<string>>(() => new Set());
  const [fading, setFading] = useState<Set<string>>(() => new Set());
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(title);
  const suppressOpen = useRef(false);
  const seenSeq = useRef<number | null>(null);
  const wasActive = useRef<Set<string>>(new Set());

  useEffect(() => {
    const id = window.setInterval(() => useAgentPresenceStore.getState().tick(), AGENT_TICK_MS);
    useAgentPresenceStore.getState().tick();
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    setOpened((previous) => {
      if (!previous) return null;
      const found = board.cards.find((card) => card.id === previous.id);
      if (!found || found.archivedAt) return null;
      return found;
    });
  }, [board]);

  useEffect(() => {
    const latest = board.events[board.events.length - 1]?.seq ?? 0;
    if (seenSeq.current === null) {
      seenSeq.current = latest;
      return;
    }
    const fresh = board.events.filter((event) => event.seq > (seenSeq.current ?? 0));
    seenSeq.current = latest;
    const ids = fresh
      .filter((event) => event.actor !== 'you' && event.cardId)
      .map((event) => event.cardId as string);
    if (!ids.length) return;
    setFlashing((current) => new Set([...current, ...ids]));
    const timer = window.setTimeout(() => {
      setFlashing((current) => {
        const next = new Set(current);
        for (const id of ids) next.delete(id);
        return next;
      });
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [board]);

  // Agents act under the `me` name they pass on each call, which need not match
  // their MCP process label, so presence cannot be matched per name. Activity
  // in the last minute is what lights a card; only an empty agent list (every
  // agent gone) puts the lights out early.
  const agentsGone = presenceSeen && connected.length === 0;
  const activeIdList = board.cards
    .filter((card) => {
      // The highlight shows agents at work; the owner's own edits never light a card.
      if (!card.assignee || card.assignee === 'you') return false;
      const actor = actors[card.assignee];
      if (!actor || actor.cardId !== card.id) return false;
      if (now - actor.lastActionAt > AGENT_ACTIVE_MS) return false;
      if (agentsGone) return false;
      if (left[card.assignee]) return false;
      return true;
    })
    .map((card) => card.id);
  const activeCardIds = new Set(activeIdList);
  const activeKey = activeIdList.slice().sort().join(',');
  const chips = agentChips(
    board.cards,
    connected,
    actors,
    now,
    boardId,
    presenceSeen,
    left,
  );
  const chipNames = chips.map((chip) => chip.name).join(',');

  useEffect(() => {
    if (spotlight && !(chipNames ? chipNames.split(',') : []).includes(spotlight)) {
      setSpotlight(null);
    }
  }, [spotlight, chipNames]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (opened || questionDrop) return;
      setSpotlight(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [opened, questionDrop]);

  useEffect(() => {
    const nextActive = new Set(activeKey ? activeKey.split(',') : []);
    const lost = [...wasActive.current].filter((id) => !nextActive.has(id));
    wasActive.current = nextActive;
    if (!lost.length) return;
    setFading((current) => new Set([...current, ...lost]));
    const timer = window.setTimeout(() => {
      setFading((current) => {
        const next = new Set(current);
        for (const id of lost) next.delete(id);
        return next;
      });
    }, 600);
    return () => window.clearTimeout(timer);
  }, [activeKey]);

  const edit = (fn: (current: BoardData) => BoardData) => props.onChange(fn);
  const live = liveCards(board.cards);
  const archivedCards = board.cards
    .filter((card) => card.archivedAt)
    .slice()
    .sort((leftCard, rightCard) => (rightCard.archivedAt ?? 0) - (leftCard.archivedAt ?? 0));
  const visibleCards = needsMe
    ? live.filter((card) => card.column === 'waiting')
    : live;
  const waitingCount = live.filter((card) => card.column === 'waiting').length;
  const spotlightActive = spotlight && chips.some((chip) => chip.name === spotlight)
    ? spotlight
    : null;

  const commitTitle = () => {
    const value = titleDraft.trim();
    if (value && value !== title) props.onRename?.(value);
    setEditingTitle(false);
  };

  const archivedBy = (card: BoardCard) => {
    const event = [...board.events]
      .reverse()
      .find((item) => item.type === 'archived' && item.cardId === card.id);
    return event?.actor;
  };

  const updateDrop = (event: React.PointerEvent<HTMLElement>, current: DragState) => {
    const columnElement = (document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null)
      ?.closest<HTMLElement>('[data-board-column]');

    if (!columnElement) return;

    const column = columnElement.dataset.boardColumn as BoardColumnId;
    const cardElements = [...columnElement.querySelectorAll<HTMLElement>('[data-board-card]')]
      .filter((element) => element.dataset.boardCard !== current.cardId);
    let index = cardElements.findIndex((element) => {
      const rectangle = element.getBoundingClientRect();
      return event.clientY < rectangle.top + rectangle.height / 2;
    });

    if (index < 0) index = cardElements.length;
    setDrop({ column, index });
  };

  const finishDrag = () => {
    if (!drag?.active || !drop) {
      setDrag(null);
      setDrop(null);
      return;
    }

    const currentCard = board.cards.find((card) => card.id === drag.cardId);

    if (
      currentCard
      && drop.column === 'waiting'
      && currentCard.column !== 'waiting'
      && !currentCard.question
    ) {
      setQuestionDrop({ cardId: currentCard.id, ...drop });
    } else {
      edit((current) => moveCard(current, {
        cardId: drag.cardId,
        to: drop.column,
        index: drop.index,
      }, OWNER_ACTOR, Date.now()));
    }

    setDrag(null);
    setDrop(null);
  };

  const moveWithKeyboard = (
    card: BoardCard,
    event: React.KeyboardEvent<HTMLButtonElement>,
  ) => {
    if (!event.altKey) return;

    const columnIndex = BOARD_COLUMNS.findIndex((column) => column.id === card.column);
    let target: BoardColumnId | undefined;
    let index = card.order;

    if (event.key === 'ArrowLeft') target = BOARD_COLUMNS[columnIndex - 1]?.id;
    if (event.key === 'ArrowRight') target = BOARD_COLUMNS[columnIndex + 1]?.id;
    if (event.key === 'ArrowUp') {
      target = card.column;
      index = card.order - 1;
    }
    if (event.key === 'ArrowDown') {
      target = card.column;
      index = card.order + 1;
    }
    if (!target) return;

    event.preventDefault();

    if (target === 'waiting' && card.column !== 'waiting' && !card.question) {
      setQuestionDrop({ cardId: card.id, column: target, index });
      return;
    }

    edit((current) => moveCard(current, {
      cardId: card.id,
      to: target,
      index,
    }, OWNER_ACTOR, Date.now()));
  };

  return (
    <main
      className="board-view"
      data-testid="board-view"
      data-spotlight={spotlightActive ?? undefined}
      onPointerMove={(event) => {
        if ((event.target as HTMLElement).closest('.board-overlay')) return;
        if (!drag) return;

        const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
        const current = drag.active || distance >= 5 ? { ...drag, active: true } : drag;

        if (!current.active) return;
        setDrag(current);
        updateDrop(event, current);
      }}
      onPointerUpCapture={(event) => {
        if ((event.target as HTMLElement).closest('.board-overlay')) return;
        suppressOpen.current = Boolean(drag?.active);
        finishDrag();
      }}
      onPointerCancel={(event) => {
        if ((event.target as HTMLElement).closest('.board-overlay')) return;
        finishDrag();
      }}
    >
      <header className="board-view__header">
        <div>
          <h1>
            {props.onRename ? (
              editingTitle ? (
                <input
                  className="board-title-input"
                  data-testid="board-title-input"
                  aria-label="Board title"
                  autoFocus
                  value={titleDraft}
                  onChange={(event) => setTitleDraft(event.target.value)}
                  onBlur={commitTitle}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') commitTitle();
                    if (event.key === 'Escape') {
                      setTitleDraft(title);
                      setEditingTitle(false);
                    }
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="board-title"
                  data-testid="board-title"
                  onClick={() => {
                    setTitleDraft(title);
                    setEditingTitle(true);
                  }}
                >
                  {title}
                </button>
              )
            ) : (
              title
            )}
          </h1>
          <p>Board · {live.length} cards</p>
        </div>
        <div className="board-view__controls">
          <button
            type="button"
            className={!needsMe ? 'board-filter board-filter--active' : 'board-filter'}
            onClick={() => setNeedsMe(false)}
          >
            All
          </button>
          <button
            type="button"
            className={needsMe ? 'board-filter board-filter--active' : 'board-filter'}
            data-testid="board-filter-needs-me"
            onClick={() => setNeedsMe(true)}
          >
            Needs me
            {waitingCount > 0 && (
              <span className="board-filter__badge" data-testid="board-needs-me-count">
                {waitingCount}
              </span>
            )}
          </button>
          {archivedCards.length > 0 && (
            <button
              type="button"
              className={showArchived ? 'board-filter board-filter--active' : 'board-filter'}
              data-testid="board-archived-toggle"
              aria-pressed={showArchived}
              onClick={() => setShowArchived((current) => !current)}
            >
              Archived ({archivedCards.length})
            </button>
          )}
          <button
            type="button"
            className="board-button board-button--primary"
            data-testid="board-new-card"
            onClick={() => {
              setNeedsMe(false);
              document.querySelector<HTMLButtonElement>('[data-testid="board-add-card-todo"]')?.click();
            }}
          >
            <Plus size={16} />
            Card
          </button>
        </div>
      </header>
      <AgentsStrip
        chips={chips}
        spotlight={spotlightActive}
        onToggleSpotlight={(name) => setSpotlight((current) => (current === name ? null : name))}
        onDismiss={(name) => useAgentPresenceStore.getState().leave(name)}
      />
      {showArchived && archivedCards.length > 0 && (
        <div className="board-archived" data-testid="board-archived-list">
          {archivedCards.map((card) => (
            <div key={card.id} className="board-archived__row">
              <span className="board-card__number">#{card.number}</span>
              <strong className="board-archived__title">{card.title}</strong>
              <span className="board-archived__meta">
                {relativeTime(card.archivedAt ?? 0)}
                {archivedBy(card) ? ` · ${displayName(archivedBy(card))}` : ''}
              </span>
              <button
                type="button"
                className="board-button"
                data-testid={`board-restore-${card.number}`}
                onClick={() => edit((current) => restoreCard(current, {
                  cardId: card.id,
                }, OWNER_ACTOR, Date.now()))}
              >
                Restore
              </button>
            </div>
          ))}
        </div>
      )}
      <div
        className={`board-view__content${
          activityCollapsed ? ' board-view__content--activity-collapsed' : ''
        }`}
      >
        <div className="board-view__columns">
          {BOARD_COLUMNS.map((column) => {
            const cards = cardsIn(visibleCards, column.id);
            const isDropColumn = drop?.column === column.id;

            return (
              <BoardColumn
                key={column.id}
                column={column}
                cards={cards}
                draggingCardId={drag?.active ? drag.cardId : undefined}
                dropIndex={isDropColumn ? drop.index : undefined}
                activeCardIds={activeCardIds}
                fadingCardIds={fading}
                flashingCardIds={flashing}
                onCreate={(title) => edit((current) => createCard(current, {
                  title,
                  column: column.id,
                }, OWNER_ACTOR, Date.now()))}
                onOpen={(card) => {
                  if (!suppressOpen.current) setOpened(card);
                  suppressOpen.current = false;
                }}
                onCardPointerDown={(card, event) => {
                  if ((event.target as HTMLElement).closest('input, button[data-no-drag]')) return;
                  event.currentTarget.setPointerCapture(event.pointerId);
                  setDrag({
                    cardId: card.id,
                    startX: event.clientX,
                    startY: event.clientY,
                    active: false,
                  });
                }}
                onCardPointerUp={() => undefined}
                onCardKeyDown={moveWithKeyboard}
                spotlightName={spotlightActive}
                onClearDone={column.id === 'done'
                  ? () => edit((current) => clearDone(current, OWNER_ACTOR, Date.now()))
                  : undefined}
              />
            );
          })}
        </div>
        <ActivityPanel
          board={board}
          collapsed={activityCollapsed}
          collapsedKey={collapsedKey}
          onToggle={() => {
            const next = !activityCollapsed;
            setActivityCollapsed(next);
            writeActivityCollapsed(collapsedKey, next);
          }}
        />
      </div>
      {questionDrop && (
        <QuestionPrompt
          onCancel={() => setQuestionDrop(null)}
          onSubmit={(question) => {
            edit((current) => moveCard(current, {
              cardId: questionDrop.cardId,
              to: questionDrop.column,
              index: questionDrop.index,
              question,
            }, OWNER_ACTOR, Date.now()));
            setQuestionDrop(null);
          }}
        />
      )}
      {opened && (
        <CardOverlay
          card={opened}
          cards={board.cards}
          events={board.events}
          edit={edit}
          renderMarkdown={renderMarkdown}
          onClose={() => setOpened(null)}
        />
      )}
    </main>
  );
}
