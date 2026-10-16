import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { BoardCard, BoardColumnId, BoardData } from '../contract';
import {
  addChecklistItem,
  addNote,
  archiveCard,
  claimCard,
  moveCard,
  releaseCard,
  removeChecklistItem,
  setChecklistItem,
  updateCard,
  BOARD_COLUMNS,
} from '../core';
import { avatarColor, avatarInitial, collapseEditRuns, displayName, relativeTime, statusClass } from './boardUi';

const ACTOR = 'you';

/** Typed text waits here until the card closes; null means the field is untouched. */
interface Drafts {
  title: string | null;
  description: string | null;
  assignee: string | null;
}

const NO_DRAFTS: Drafts = { title: null, description: null, assignee: null };

interface CardOverlayProps {
  card: BoardCard;
  cards: BoardCard[];
  events: BoardData['events'];
  edit: (fn: (board: BoardData) => BoardData) => void;
  renderMarkdown: (markdown: string) => string;
  onClose: () => void;
}

function EventHistory({ card, events }: Pick<CardOverlayProps, 'card' | 'events'>) {
  const history = collapseEditRuns(events.filter((event) => event.cardId === card.id)).reverse();

  return (
    <ol className="board-history">
      {history.map((event) => (
        <li key={event.seq}>
          <strong>{displayName(event.actor)}</strong>
          <span>
            {event.type === 'moved'
              ? ` moved to ${BOARD_COLUMNS.find((column) => column.id === event.to)?.title}`
              : ` ${event.type}`}
          </span>
          <time>{relativeTime(event.at)}</time>
        </li>
      ))}
    </ol>
  );
}

export function CardOverlay({ card, cards, events, edit, renderMarkdown, onClose }: CardOverlayProps) {
  const dialog = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(document.activeElement as HTMLElement);
  const [descriptionEditing, setDescriptionEditing] = useState(false);
  const [note, setNote] = useState('');
  const [checklistItem, setChecklistDraft] = useState('');
  const [label, setLabel] = useState('');
  const [question, setQuestion] = useState(card.question ?? '');
  const [askingQuestion, setAskingQuestion] = useState(false);
  const [drafts, setDrafts] = useState<Drafts>(NO_DRAFTS);
  const draftsRef = useRef<Drafts>(NO_DRAFTS);
  const setDraft = (field: keyof Drafts, value: string) => {
    draftsRef.current = { ...draftsRef.current, [field]: value };
    setDrafts(draftsRef.current);
  };
  const names = useMemo(
    () => [...new Set(['you', ...cards.map((item) => item.assignee).filter(Boolean) as string[]])],
    [cards],
  );

  useEffect(() => {
    dialog.current?.focus();
    const previousFocus = restoreFocus.current;

    return () => previousFocus?.focus();
  }, []);

  // Saves typed text in one go: one 'updated' entry for title and description,
  // one claim or release for the assignee. Never one entry per keystroke.
  const saveDrafts = () => {
    const pending = draftsRef.current;
    draftsRef.current = NO_DRAFTS;
    const title = pending.title?.trim() ? pending.title : null;
    const changes = {
      ...(title !== null && title !== card.title ? { title } : {}),
      ...(pending.description !== null && pending.description !== card.description
        ? { description: pending.description }
        : {}),
    };
    try {
      if (Object.keys(changes).length) {
        edit((board) => updateCard(board, { cardId: card.id, ...changes }, ACTOR, Date.now()));
      }
      if (pending.assignee !== null) {
        const value = pending.assignee.trim();
        const assignee = value.toLowerCase() === 'you' ? 'you' : value;
        if (assignee && assignee !== card.assignee) {
          edit((board) => claimCard(board, { cardId: card.id }, assignee, Date.now()));
        } else if (!assignee && card.assignee) {
          edit((board) => releaseCard(board, { cardId: card.id }, ACTOR, Date.now()));
        }
      }
    } catch {
      // The card was archived or deleted meanwhile: nothing left to save to.
    }
  };
  const saveDraftsRef = useRef(saveDrafts);
  saveDraftsRef.current = saveDrafts;

  // Every way out (X, Escape, backdrop, switching page) unmounts the overlay.
  useEffect(() => {
    const saveBeforeLeaving = () => {
      if (document.visibilityState === 'hidden') saveDraftsRef.current();
    };
    document.addEventListener('visibilitychange', saveBeforeLeaving);
    return () => {
      document.removeEventListener('visibilitychange', saveBeforeLeaving);
      saveDraftsRef.current();
    };
  }, []);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose();
    };

    window.addEventListener('keydown', closeOnEscape, true);
    return () => window.removeEventListener('keydown', closeOnEscape, true);
  }, [onClose]);

  const move = (to: BoardColumnId) => {
    if (to === 'waiting' && card.column !== 'waiting' && !question.trim()) {
      setAskingQuestion(true);
      return;
    }

    edit((board) => moveCard(board, {
      cardId: card.id,
      to,
      index: card.order,
      question,
    }, ACTOR, Date.now()));
    setAskingQuestion(false);
  };

  const trapFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;

    const focusable = [
      ...(dialog.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled)',
      ) ?? []),
    ];

    if (!focusable.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const addLabel = () => {
    if (!label.trim() || card.labels.includes(label.trim())) return;

    edit((board) => updateCard(board, {
      cardId: card.id,
      labels: [...card.labels, label.trim()],
    }, ACTOR, Date.now()));
    setLabel('');
  };

  const reply = (moveAfterReply = false) => {
    if (!note.trim()) return;

    edit((board) => {
      const withNote = addNote(board, { cardId: card.id, text: note }, ACTOR, Date.now());

      return moveAfterReply
        ? moveCard(withNote, { cardId: card.id, to: 'doing', index: card.order }, ACTOR, Date.now())
        : withNote;
    });
    setNote('');
  };

  return (
    <div
      className="board-overlay"
      data-testid="board-card-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialog}
        className="board-overlay__dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Card ${card.number}`}
        tabIndex={-1}
        onKeyDown={trapFocus}
      >
        <header className="board-overlay__header">
          <div className="board-overlay__heading">
            <div className="board-overlay__eyebrow">
              <span className="board-card__number">#{card.number}</span>
              {card.column === 'waiting' && <span className="board-card__needs">Needs you</span>}
            </div>
            <input
              className="board-overlay__title"
              aria-label="Card title"
              value={drafts.title ?? card.title}
              onChange={(event) => setDraft('title', event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
              }}
            />
            <div className="board-overlay__chips">
              <label className={`board-status ${statusClass(card.column)}`}>
                <span />
                <select
                  value={card.column}
                  aria-label="Status"
                  onChange={(event) => move(event.target.value as BoardColumnId)}
                >
                  {BOARD_COLUMNS.map((column) => (
                    <option key={column.id} value={column.id}>
                      {column.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className="board-assignee-chip">
                <span
                  className="board-avatar board-avatar--medium"
                  style={{ backgroundColor: avatarColor(card.assignee) }}
                >
                  {avatarInitial(card.assignee)}
                </span>
                <input
                  list="board-assignees"
                  aria-label="Assignee"
                  value={drafts.assignee ?? (card.assignee ? displayName(card.assignee) : '')}
                  placeholder="Unassigned"
                  onChange={(event) => setDraft('assignee', event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur();
                  }}
                />
                <datalist id="board-assignees">
                  {names.map((name) => <option key={name} value={displayName(name)} />)}
                </datalist>
              </label>
              {card.labels.map((item) => (
                <button
                  key={item}
                  type="button"
                  className="board-label"
                  onClick={() => edit((board) => updateCard(board, {
                    cardId: card.id,
                    labels: card.labels.filter((value) => value !== item),
                  }, ACTOR, Date.now()))}
                >
                  {item} ×
                </button>
              ))}
              <input
                className="board-label-add"
                aria-label="Add label"
                value={label}
                placeholder="+ label"
                onChange={(event) => setLabel(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') addLabel();
                }}
              />
            </div>
          </div>
          <div className="board-overlay__header-actions">
            <button
              type="button"
              className="board-button"
              data-testid="card-archive"
              onClick={() => {
                saveDrafts();
                edit((board) => archiveCard(board, { cardId: card.id }, ACTOR, Date.now()));
                onClose();
              }}
            >
              Archive
            </button>
            <button type="button" className="board-overlay__close" aria-label="Close card" onClick={onClose}>
              <X size={19} />
            </button>
          </div>
        </header>
        <div className="board-overlay__body">
          <main className="board-overlay__main">
            {askingQuestion && (
              <div className="board-overlay__question">
                <label>
                  What feedback is needed?
                  <input autoFocus value={question} onChange={(event) => setQuestion(event.target.value)} />
                </label>
                <button type="button" className="board-button" onClick={() => setAskingQuestion(false)}>
                  Cancel
                </button>
                <button type="button" className="board-button board-button--primary" onClick={() => move('waiting')}>
                  Move
                </button>
              </div>
            )}
            <section className="board-overlay__section">
              <h2>Description</h2>
              {descriptionEditing ? (
                <textarea
                  autoFocus
                  aria-label="Description"
                  value={drafts.description ?? card.description}
                  onChange={(event) => setDraft('description', event.target.value)}
                  onBlur={() => setDescriptionEditing(false)}
                />
              ) : (
                <button
                  type="button"
                  className="board-description powernote-markdown"
                  onClick={() => setDescriptionEditing(true)}
                  dangerouslySetInnerHTML={{
                    __html: renderMarkdown(
                      (drafts.description ?? card.description) || 'Click to add a description',
                    ),
                  }}
                />
              )}
            </section>
            <section className="board-overlay__section">
              <div className="board-overlay__section-heading">
                <h2>Checklist</h2>
                <span>{card.checklist.filter((item) => item.done).length} of {card.checklist.length}</span>
              </div>
              <ul className="board-checklist">
                {card.checklist.map((item) => (
                  <li key={item.id}>
                    <input
                      type="checkbox"
                      checked={item.done}
                      aria-label={item.text}
                      onChange={() => edit((board) => setChecklistItem(board, {
                        cardId: card.id,
                        itemId: item.id,
                        done: !item.done,
                      }, ACTOR, Date.now()))}
                    />
                    <span className={item.done ? 'board-checklist__done' : ''}>{item.text}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${item.text}`}
                      onClick={() => edit((board) => removeChecklistItem(board, {
                        cardId: card.id,
                        itemId: item.id,
                      }, ACTOR, Date.now()))}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
              <input
                className="board-add-input"
                aria-label="Add checklist item"
                value={checklistItem}
                placeholder="Add item"
                onChange={(event) => setChecklistDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' || !checklistItem.trim()) return;
                  edit((board) => addChecklistItem(board, {
                    cardId: card.id,
                    text: checklistItem,
                  }, ACTOR, Date.now()));
                  setChecklistDraft('');
                }}
              />
            </section>
            <section className="board-overlay__section">
              <h2>Notes</h2>
              <div className="board-notes">
                {card.notes.map((item) => (
                  <article key={item.id}>
                    <span
                      className="board-avatar board-avatar--note"
                      style={{ backgroundColor: avatarColor(item.author) }}
                    >
                      {avatarInitial(item.author)}
                    </span>
                    <div className="board-note__bubble">
                      <p><strong>{displayName(item.author)}</strong> · {relativeTime(item.at)}</p>
                      <div>{item.text}</div>
                    </div>
                  </article>
                ))}
              </div>
              <textarea
                className="board-reply"
                aria-label="Reply"
                value={note}
                placeholder="Write a reply"
                onChange={(event) => setNote(event.target.value)}
              />
              <div className="board-reply__actions">
                <button
                  type="button"
                  className="board-button"
                  disabled={!note.trim()}
                  onClick={() => reply()}
                >
                  Reply
                </button>
                {card.column === 'waiting' && (
                  <button
                    type="button"
                    className="board-button board-button--primary"
                    disabled={!note.trim()}
                    onClick={() => reply(true)}
                  >
                    Reply and move to In progress
                  </button>
                )}
              </div>
              {card.assignee && (
                <p className="board-overlay__hint">
                  {displayName(card.assignee)} sees replies on its next check.
                </p>
              )}
            </section>
          </main>
          <aside className="board-overlay__sidebar">
            <section className="board-overlay__section">
              <h2>Details</h2>
              <dl className="board-details">
                <div><dt>Created</dt><dd>by {displayName(card.createdBy)}, {relativeTime(card.createdAt)}</dd></div>
                <div><dt>Updated</dt><dd>{relativeTime(card.updatedAt)}</dd></div>
              </dl>
            </section>
            <section className="board-overlay__section">
              <h2>History</h2>
              <EventHistory card={card} events={events} />
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
