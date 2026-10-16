/**
 * The standalone file format: one self-contained `PowerBoard.html` whose data
 * rides in `<script id="powerboard-data" type="application/json">…</script>`.
 *
 * Ported from PowerScroll's `src/utils/serialization.ts` (`powernote-data`),
 * keeping the same script-injection shape so the embedded file stays a plain
 * HTML document that opens offline (REQ-PB-110, REQ-PB-111).
 */

import type { BoardData, PowerBoardFile } from '../contract';
import { createBoard, generateId } from '../core';

export const DATA_SCRIPT_ID = 'powerboard-data';

/** Serial one-file representation. */
const FORMAT = 'powerboard';
const VERSION = 1;

/** A brand-new file: title "PowerBoard", one empty active board (REQ-PB-111). */
export function emptyFile(): PowerBoardFile {
  const id = generateId();
  return {
    format: FORMAT,
    version: VERSION,
    title: 'PowerBoard',
    boards: [{ id, title: 'My board', board: createBoard() }],
    activeBoardId: id,
  };
}

/**
 * Serialize the file to pretty JSON with every `<` escaped as `\u003c`, so a
 * card title (or any other text) can never close the hosting `<script>` tag
 * (REQ-PB-111).
 */
export function serializeFile(file: PowerBoardFile): string {
  return JSON.stringify(file, null, 2).replace(/</g, '\\u003c');
}

/** Normalize a board's data, tolerating fields an older writer left out. */
function normalizeBoard(raw: unknown): BoardData | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Partial<BoardData>;
  return {
    cards: Array.isArray(value.cards) ? value.cards : [],
    events: Array.isArray(value.events) ? value.events : [],
    nextNumber: typeof value.nextNumber === 'number' ? value.nextNumber : 1,
    nextSeq: typeof value.nextSeq === 'number' ? value.nextSeq : 1,
    ...(value.schemaVersion === 1 ? { schemaVersion: 1 } : {}),
  };
}

function normalizeEntry(
  raw: unknown,
): { id: string; title: string; board: BoardData } | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as { id?: unknown; title?: unknown; board?: unknown };
  if (typeof value.id !== 'string' || value.id.length === 0) return null;
  const board = normalizeBoard(value.board);
  if (!board) return null;
  return {
    id: value.id,
    title: typeof value.title === 'string' ? value.title : 'Board',
    board,
  };
}

/**
 * Parse a serialized file. Returns null on anything that is not a PowerBoard
 * file of this version; optional fields (title, activeBoardId, each board's
 * schemaVersion) may be missing (REQ-PB-114).
 */
export function parseFile(json: string): PowerBoardFile | null {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;

  const value = data as Record<string, unknown>;
  if (value.format !== FORMAT) return null;
  if (value.version !== VERSION) return null;
  if (!Array.isArray(value.boards)) return null;

  const boards = value.boards
    .map(normalizeEntry)
    .filter((entry): entry is { id: string; title: string; board: BoardData } => entry !== null);

  const file: PowerBoardFile = {
    format: FORMAT,
    version: VERSION,
    title: typeof value.title === 'string' ? value.title : 'PowerBoard',
    boards,
  };
  if (typeof value.activeBoardId === 'string') file.activeBoardId = value.activeBoardId;
  return file;
}

/** Read the embedded data script from a parsed document, if any. */
export function readEmbedded(doc: Document): PowerBoardFile | null {
  const script = doc.getElementById(DATA_SCRIPT_ID);
  if (!script) return null;
  const json = script.textContent?.trim();
  if (!json) return null;
  return parseFile(json);
}

/** Read embedded data out of a raw HTML string. */
export function readEmbeddedHtml(html: string): PowerBoardFile | null {
  if (typeof DOMParser === 'undefined') {
    const match = html.match(
      new RegExp(`<script id="${DATA_SCRIPT_ID}" type="application/json">([\\s\\S]*?)</script>`),
    );
    return match ? parseFile(match[1].trim()) : null;
  }
  return readEmbedded(new DOMParser().parseFromString(html, 'text/html'));
}

/**
 * Build a self-contained HTML file with `file` embedded. Replaces the existing
 * data script, or inserts one before `</head>` when the template has none
 * (mirrors PowerScroll's `buildExportHtml`).
 */
export function buildHtml(currentHtml: string, file: PowerBoardFile): string {
  const json = serializeFile(file);
  const dataScript = `<script id="${DATA_SCRIPT_ID}" type="application/json">\n${json}\n</script>`;

  const pattern = new RegExp(
    `<script id="${DATA_SCRIPT_ID}" type="application/json">[\\s\\S]*?</script>`,
  );

  if (pattern.test(currentHtml)) {
    // A function replacer keeps `$` sequences in the data literal.
    return currentHtml.replace(pattern, () => dataScript);
  }

  const doctype = currentHtml.startsWith('<!') ? '' : '<!DOCTYPE html>\n';
  if (currentHtml.includes('</head>')) {
    return doctype + currentHtml.replace('</head>', `${dataScript}\n</head>`);
  }
  return doctype + currentHtml + '\n' + dataScript;
}
