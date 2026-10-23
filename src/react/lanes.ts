import type { BoardCard } from '../contract';

/** The lane of cards without labels. */
export const NO_LABEL = '__none__';

/** A swim lane: a label's cards across the four columns (REQ-BOARD-043). */
export interface Lane {
  key: string;
  /** The label, or null for the lane of cards without labels. */
  label: string | null;
  cards: BoardCard[];
}

export function sameLabel(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

export function inLane(card: BoardCard, key: string): boolean {
  return key === NO_LABEL ? card.labels.length === 0 : card.labels.some((label) => sameLabel(label, key));
}

/**
 * One lane per label, in the order the labels were first used on the board's
 * live cards (so lanes do not jump as counts change), then "No label". A card
 * with several labels is in each of their lanes. Empty lanes are left out; a
 * board without labels has the one lane, shown without a title. With a label
 * filter on, only the chosen labels' lanes show.
 */
export function boardLanes(live: BoardCard[], visible: BoardCard[], only: string[] = []): Lane[] {
  const order: string[] = [];
  for (const card of [...live].sort((left, right) => left.createdAt - right.createdAt)) {
    for (const label of card.labels) {
      if (!order.some((seen) => sameLabel(seen, label))) order.push(label);
    }
  }
  const lanes: Lane[] = order
    .filter((label) => !only.length || only.some((chosen) => sameLabel(chosen, label)))
    .map((label) => ({ key: label, label, cards: visible.filter((card) => inLane(card, label)) }));
  lanes.push({ key: NO_LABEL, label: null, cards: visible.filter((card) => inLane(card, NO_LABEL)) });
  const shown = lanes.filter((lane) => lane.cards.length > 0);
  return shown.length ? shown : [{ key: NO_LABEL, label: null, cards: [] }];
}

/** The labels a card has after being dragged from one lane to another. */
export function relabel(labels: string[], from: string, to: string): string[] {
  if (to === NO_LABEL) return [];
  const kept = from === NO_LABEL ? labels : labels.filter((label) => !sameLabel(label, from));
  return kept.some((label) => sameLabel(label, to)) ? kept : [...kept, to];
}
