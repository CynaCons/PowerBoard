/**
 * List-aware indent / unindent for the text editor.
 *
 * Markdown (CommonMark) only treats a line as a *nested* list item when its
 * indent reaches the parent item's content column — the column just after the
 * marker and the space that follows it. That is 2 for `- item` and 3+ for
 * `1. item`. The editor used to insert 2 spaces on every Tab, so bullets
 * nested and numbered lists flattened into the same <ol>.
 *
 * Tab on a list item therefore nests it under the previous sibling: +2 under
 * a bullet/checkbox, +max(4, markerWidth) under a numbered parent (4 covers
 * `1.`…`99.`). Shift+Tab walks back to that parent indent. Numbered items in
 * the contiguous list region are then re-sequenced so a nested list restarts
 * at 1 and the parent list stays consecutive.
 */

export const TEXT_INDENT = 2;

export type ListKind = 'bullet' | 'checkbox' | 'numbered';

export interface ListLine {
  indent: number;
  kind: ListKind;
  /** Width of the CommonMark marker including the following space (`- ` = 2, `1. ` = 3). */
  markerWidth: number;
  number?: number;
  content: string;
}

export interface IndentResult {
  text: string;
  selStart: number;
  selEnd: number;
}

const CHECKBOX_RE = /^(\s*)(- \[[ x]\])(\s+)(.*)$/;
const NUMBERED_RE = /^(\s*)(\d+)(\.)(\s+)(.*)$/;
const BULLET_RE = /^(\s*)([-*•])(\s+)(.*)$/;

export function leadingSpaces(line: string): number {
  const match = line.match(/^ */);
  return match ? match[0].length : 0;
}

export function parseListLine(line: string): ListLine | null {
  const checkbox = line.match(CHECKBOX_RE);
  if (checkbox) {
    return {
      indent: checkbox[1].length,
      kind: 'checkbox',
      // GFM task markers sit on a bullet; CommonMark's marker is still `- `.
      markerWidth: 2,
      content: checkbox[4],
    };
  }
  const numbered = line.match(NUMBERED_RE);
  if (numbered) {
    return {
      indent: numbered[1].length,
      kind: 'numbered',
      markerWidth: numbered[2].length + 1 + numbered[4].length,
      number: parseInt(numbered[2], 10),
      content: numbered[5],
    };
  }
  const bullet = line.match(BULLET_RE);
  if (bullet) {
    return {
      indent: bullet[1].length,
      kind: 'bullet',
      markerWidth: 1 + bullet[3].length,
      content: bullet[4],
    };
  }
  return null;
}

function nestStep(parent: ListLine): number {
  if (parent.kind === 'numbered') return Math.max(4, parent.markerWidth);
  return Math.max(TEXT_INDENT, parent.markerWidth);
}

function isBlank(line: string): boolean {
  return line.trim() === '';
}

/** Line index containing `offset`. `offset === text.length` is the last line. */
export function lineIndexAt(text: string, offset: number): number {
  let line = 0;
  const limit = Math.min(offset, text.length);
  for (let i = 0; i < limit; i++) {
    if (text.charCodeAt(i) === 10) line++;
  }
  return line;
}

function lineStartsOf(lines: string[]): number[] {
  const starts: number[] = new Array(lines.length);
  let pos = 0;
  for (let i = 0; i < lines.length; i++) {
    starts[i] = pos;
    pos += lines[i].length + (i < lines.length - 1 ? 1 : 0);
  }
  return starts;
}

function selectedLineRange(text: string, selStart: number, selEnd: number): { from: number; to: number } {
  const from = lineIndexAt(text, selStart);
  let to = lineIndexAt(text, selEnd);
  // A selection that ends at column 0 of a line does not include that line.
  if (selEnd > selStart && selEnd > 0 && text.charCodeAt(selEnd - 1) === 10) {
    to = Math.max(from, to - 1);
  }
  return { from, to };
}

function findPrevListItem(
  lines: string[],
  before: number,
  indent: number,
): ListLine | null {
  for (let i = before - 1; i >= 0; i--) {
    const parsed = parseListLine(lines[i]);
    if (!parsed) {
      if (isBlank(lines[i])) continue;
      return null;
    }
    if (parsed.indent === indent) return parsed;
    if (parsed.indent < indent) return parsed;
  }
  return null;
}

function extraIndent(lines: string[], from: number): number {
  const indent = leadingSpaces(lines[from]);
  const prev = findPrevListItem(lines, from, indent);
  if (!prev) return TEXT_INDENT;
  if (prev.indent === indent) return nestStep(prev);
  // Already nested under prev; step further using this line's own marker.
  const current = parseListLine(lines[from]);
  if (current) return nestStep(current);
  return TEXT_INDENT;
}

function extraUnindent(lines: string[], from: number): number {
  const indent = leadingSpaces(lines[from]);
  if (indent <= 0) return 0;
  const current = parseListLine(lines[from]);
  if (!current && !findPrevListItem(lines, from, indent)) {
    return Math.min(TEXT_INDENT, indent);
  }
  const prev = findPrevListItem(lines, from, indent);
  if (prev && prev.indent < indent) return indent - prev.indent;
  return Math.min(TEXT_INDENT, indent);
}

function rewriteNumber(line: string, parsed: ListLine, n: number): string {
  const rest = line.slice(parsed.indent);
  return ' '.repeat(parsed.indent) + rest.replace(/^\d+\./, `${n}.`);
}

function expandListRegion(lines: string[], from: number, to: number): { from: number; to: number } {
  let start = from;
  let end = to;
  while (start > 0 && parseListLine(lines[start - 1])) start--;
  while (end < lines.length - 1 && parseListLine(lines[end + 1])) end++;
  return { from: start, to: end };
}

interface NumberStackEntry {
  indent: number;
  next: number;
  kind: ListKind;
}

export function renumberListRegion(lines: string[], from: number, to: number): string[] {
  const region = expandListRegion(lines, from, to);
  const next = lines.slice();
  const stack: NumberStackEntry[] = [];

  for (let i = region.from; i <= region.to; i++) {
    const parsed = parseListLine(next[i]);
    if (!parsed) continue;

    while (stack.length && stack[stack.length - 1].indent > parsed.indent) {
      stack.pop();
    }

    if (parsed.kind !== 'numbered') {
      while (stack.length && stack[stack.length - 1].indent >= parsed.indent) {
        stack.pop();
      }
      stack.push({ indent: parsed.indent, next: 1, kind: parsed.kind });
      continue;
    }

    const top = stack.length ? stack[stack.length - 1] : null;
    if (top && top.indent === parsed.indent && top.kind === 'numbered') {
      next[i] = rewriteNumber(next[i], parsed, top.next);
      top.next += 1;
    } else {
      while (stack.length && stack[stack.length - 1].indent >= parsed.indent) {
        stack.pop();
      }
      next[i] = rewriteNumber(next[i], parsed, 1);
      stack.push({ indent: parsed.indent, next: 2, kind: 'numbered' });
    }
  }
  return next;
}

function prefixLength(line: string): number {
  const parsed = parseListLine(line);
  if (!parsed) return leadingSpaces(line);
  return line.length - parsed.content.length;
}

function mapCol(oldLine: string, newLine: string, col: number): number {
  if (oldLine === newLine) return Math.min(col, newLine.length);
  const oldPrefix = prefixLength(oldLine);
  const newPrefix = prefixLength(newLine);
  if (col >= oldPrefix) return Math.min(newPrefix + (col - oldPrefix), newLine.length);
  if (oldPrefix === 0) return Math.min(col, newLine.length);
  const ratio = col / oldPrefix;
  return Math.min(Math.round(ratio * newPrefix), newLine.length);
}

function mapOffset(oldText: string, newLines: string[], offset: number): number {
  const oldLines = oldText.split('\n');
  const starts = lineStartsOf(oldLines);
  const line = lineIndexAt(oldText, offset);
  const col = offset - starts[line];
  const newStarts = lineStartsOf(newLines);
  const newCol = mapCol(oldLines[line] ?? '', newLines[line] ?? '', col);
  return (newStarts[line] ?? 0) + newCol;
}

function applyLeadingDelta(line: string, delta: number): string {
  if (delta > 0) return ' '.repeat(delta) + line;
  if (delta < 0) {
    const remove = Math.min(-delta, leadingSpaces(line));
    return line.slice(remove);
  }
  return line;
}

export function applyListIndent(
  text: string,
  selStart: number,
  selEnd: number,
  direction: 'in' | 'out',
): IndentResult {
  const lines = text.split('\n');
  const { from, to } = selectedLineRange(text, selStart, selEnd);
  const extra = direction === 'in' ? extraIndent(lines, from) : -extraUnindent(lines, from);

  if (extra === 0) {
    return { text, selStart, selEnd };
  }

  const next = lines.slice();
  for (let i = from; i <= to; i++) {
    next[i] = applyLeadingDelta(next[i], extra);
  }
  const numbered = renumberListRegion(next, from, to);
  const newText = numbered.join('\n');
  return {
    text: newText,
    selStart: mapOffset(text, numbered, selStart),
    selEnd: mapOffset(text, numbered, selEnd),
  };
}

/**
 * Pad list children whose indent is greater than the parent but short of the
 * CommonMark content column, so `1. A\\n  2. B` (2 spaces) still nests.
 * Source is not mutated — this runs on the copy handed to marked.
 */
export function normalizeListIndents(markdown: string): string {
  const lines = markdown.split('\n');
  let inFence = false;
  const stack: { indent: number; contentCol: number }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      stack.length = 0;
      continue;
    }
    if (inFence) continue;

    const parsed = parseListLine(line);
    if (!parsed) {
      if (isBlank(line)) continue;
      stack.length = 0;
      continue;
    }

    while (stack.length && stack[stack.length - 1].indent >= parsed.indent) {
      stack.pop();
    }
    if (stack.length) {
      const parent = stack[stack.length - 1];
      if (parsed.indent > parent.indent && parsed.indent < parent.contentCol) {
        const pad = parent.contentCol - parsed.indent;
        lines[i] = ' '.repeat(pad) + line;
        parsed.indent += pad;
      }
    }
    stack.push({
      indent: parsed.indent,
      contentCol: parsed.indent + parsed.markerWidth,
    });
  }
  return lines.join('\n');
}
