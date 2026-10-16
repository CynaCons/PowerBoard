import { describe, expect, it } from 'vitest';
import type { PowerBoardFile } from '../contract';
import { createCard } from '../core';
import {
  DATA_SCRIPT_ID,
  buildHtml,
  emptyFile,
  parseFile,
  readEmbedded,
  serializeFile,
} from './fileFormat';

function withTitle(title: string): PowerBoardFile {
  const base = emptyFile();
  return { ...base, title };
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe('fileFormat', () => {
  it('REQ-PB-111 round-trips a file', () => {
    const file = emptyFile();
    expect(parseFile(serializeFile(file))).toEqual(file);
  });

  it('REQ-PB-111 a new file opens with one empty active board', () => {
    const file = emptyFile();
    expect(file.title).toBe('PowerBoard');
    expect(file.boards).toHaveLength(1);
    expect(file.boards[0].title).toBe('My board');
    expect(file.boards[0].board.cards).toEqual([]);
    expect(file.activeBoardId).toBe(file.boards[0].id);
  });

  it('REQ-PB-111 a </script> in a title cannot break out of the data script', () => {
    const base = emptyFile();
    const board = createCard(
      base.boards[0].board,
      { title: 'x</script><script>alert(1)</script>' },
      'you',
      Date.now(),
    );
    const file: PowerBoardFile = {
      format: 'powerboard',
      version: 1,
      title: 'Trap',
      boards: [{ id: base.boards[0].id, title: base.boards[0].title, board }],
    };

    const json = serializeFile(file);
    expect(json).not.toContain('</script>');
    expect(json).toContain('\\u003c/script>');

    const parsed = parseFile(json);
    expect(parsed?.boards[0].board.cards[0].title).toBe('x</script><script>alert(1)</script>');
  });

  it('returns null for invalid JSON, format or version', () => {
    expect(parseFile('not json')).toBeNull();
    expect(parseFile(JSON.stringify({ format: 'powernote', version: 1, boards: [] }))).toBeNull();
    expect(parseFile(JSON.stringify({ format: 'powerboard', version: 2, boards: [] }))).toBeNull();
    expect(parseFile(JSON.stringify({ format: 'powerboard', version: 1 }))).toBeNull();
  });

  it('REQ-PB-114 tolerates missing optional fields', () => {
    const parsed = parseFile(
      JSON.stringify({
        format: 'powerboard',
        version: 1,
        boards: [{ id: 'b1', board: { cards: [], events: [] } }],
      }),
    );
    expect(parsed).not.toBeNull();
    expect(parsed?.title).toBe('PowerBoard');
    expect(parsed?.boards[0].title).toBe('Board');
    expect(parsed?.boards[0].board.nextNumber).toBe(1);
    expect(parsed?.boards[0].board.nextSeq).toBe(1);
  });

  it('buildHtml inserts a data script before </head> when missing', () => {
    const html = '<!doctype html>\n<html><head><title>x</title></head><body></body></html>';
    const out = buildHtml(html, withTitle('Inserted'));
    expect(out).toContain(`<script id="${DATA_SCRIPT_ID}" type="application/json">`);
    expect(out.indexOf(DATA_SCRIPT_ID)).toBeLessThan(out.indexOf('</head>'));
    expect(count(out, DATA_SCRIPT_ID)).toBe(1);
  });

  it('buildHtml replaces an existing data script', () => {
    const first = buildHtml(
      '<!doctype html>\n<html><head></head><body></body></html>',
      withTitle('First'),
    );
    const second = buildHtml(first, withTitle('Changed'));

    expect(count(second, DATA_SCRIPT_ID)).toBe(1);
    const doc = new DOMParser().parseFromString(second, 'text/html');
    expect(readEmbedded(doc)?.title).toBe('Changed');
  });

  it('readEmbedded returns null when the file carries no data', () => {
    const doc = new DOMParser().parseFromString('<html><body></body></html>', 'text/html');
    expect(readEmbedded(doc)).toBeNull();
  });
});
