import type { BoardColumnId, BoardEvent } from '../contract';

export const AVATAR_PALETTE = [
  '#2563eb',
  '#0f766e',
  '#7c3aed',
  '#c2410c',
  '#0e7490',
  '#a21caf',
  '#4d7c0f',
];

export function displayName(name?: string): string {
  return name === 'you' ? 'You' : name ?? 'Unassigned';
}

export function avatarColor(name?: string): string {
  if (!name) return '#C3CBC9';
  if (name === 'you') return '#14181A';

  const hash = Array.from(name).reduce(
    (total, character) => total + character.charCodeAt(0),
    0,
  );

  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

export function avatarInitial(name?: string): string {
  return name ? displayName(name).slice(0, 1).toUpperCase() : '·';
}

export function relativeTime(at: number): string {
  const minutes = Math.max(0, Math.floor((Date.now() - at) / 60_000));

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;

  return `${Math.floor(hours / 24)} d ago`;
}

export function statusClass(column: BoardColumnId): string {
  return `board-status--${column}`;
}

export function colorWithAlpha(hex: string, alpha: number): string {
  const raw = hex.replace('#', '');
  const full = raw.length === 3 ? raw.split('').map((char) => char + char).join('') : raw;
  const value = Number.parseInt(full, 16);
  if (!Number.isFinite(value)) return `rgba(20, 24, 26, ${alpha})`;
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

/**
 * Keeps only the last of each run of adjacent 'updated' events by the same actor
 * on the same card. Boards edited before v0.86.1 logged one per keystroke.
 */
export function collapseEditRuns(events: BoardEvent[]): BoardEvent[] {
  return events.filter((event, index) => {
    const next = events[index + 1];
    return !(
      next
      && event.type === 'updated'
      && next.type === 'updated'
      && next.actor === event.actor
      && next.cardId === event.cardId
    );
  });
}
