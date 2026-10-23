import { describe, expect, it } from 'vitest';
import { createBoardCommands, createMemoryAdapter, type CardGetResult, type ChecklistEditResult } from './index';
import { createBoard, parseChecklistText } from '../core';

// Owner request 2026-10-23 (ported from PowerScroll v0.90.0, T237): checklists
// nest like PowerPlan, and agents add, read, edit, tick, move and remove items.

type Item = CardGetResult['card']['checklist'][number];
const outline = (list: Item[]) => list.map((item) => `${'  '.repeat(item.depth)}${item.done ? 'x' : 'o'} ${item.text}`);

function setup(checklist: unknown[]) {
  const adapter = createMemoryAdapter([{ id: 'b1', title: 'Board', board: createBoard() }]);
  const commands = createBoardCommands(adapter);
  commands.card_create({ boardId: 'b1', title: 'Feature', checklist, actor: 'planner' });
  const call = (name: keyof typeof commands, params: Record<string, unknown>) =>
    commands[name]({ boardId: 'b1', card: 1, actor: 'worker-1', ...params }) as ChecklistEditResult;
  const items = () => (commands.card_get({ boardId: 'b1', card: 1 }) as CardGetResult).card.checklist;
  return { commands, call, items, adapter };
}

describe('nested checklists edited by agents REQ-BOARD-040 REQ-BOARD-041 REQ-BOARD-042', () => {
  it('adds under an item, at a position and at the end', () => {
    const { call, items } = setup(['Engine', 'App']);
    expect(call('card_checklist_add', { text: 'Parser', under: 1 }).item).toMatchObject({ index: 2, depth: 1 });
    call('card_checklist_add', { text: 'Tests', under: 1 });
    call('card_checklist_add', { text: 'Edge cases', under: 3 });
    call('card_checklist_add', { text: 'Plan', position: 1 });
    call('card_checklist_add', { text: 'Release' });
    expect(outline(items())).toEqual([
      'o Plan', 'o Engine', '  o Parser', '  o Tests', '    o Edge cases', 'o App', 'o Release',
    ]);
  });

  it('updates text, done and depth; indenting moves the sub-items; remove keeps them one level up', () => {
    const { call, items } = setup(['Plan', 'Engine', { text: 'Parser', depth: 1 }, { text: 'Tests', depth: 1 }, { text: 'Edge', depth: 2 }, 'App']);
    call('card_checklist_update', { item: items()[2].id, text: 'Lexer', done: true });
    call('card_checklist_update', { item: 2, depth: 3 });
    expect(outline(items())).toEqual(['o Plan', '  o Engine', '    x Lexer', '    o Tests', '      o Edge', 'o App']);
    call('card_checklist_move', { item: 6, position: 1 });
    call('card_checklist_remove', { item: 5 });
    expect(outline(items())).toEqual(['o App', 'o Plan', '  o Engine', '    x Lexer', '    o Edge']);
  });

  it('sets the whole list from PowerPlan-style text or items; unchanged text keeps its id', () => {
    const { call, items } = setup(['Engine', 'App']);
    const engine = items()[0].id;
    call('card_checklist_set', { text: '- [x] Engine\n  - [ ] Parser\n    - [x] Lexer\n- [ ] App' });
    expect(outline(items())).toEqual(['x Engine', '  o Parser', '    x Lexer', 'o App']);
    expect(items()[0].id).toBe(engine);
    call('card_checklist_set', { items: ['One', { text: 'Two', depth: 2, done: true }] });
    expect(outline(items())).toEqual(['o One', '  x Two']);
    expect(parseChecklistText('\t- [X] tab\n\nplain')).toEqual([
      { text: 'tab', done: true, depth: 1 },
      { text: 'plain', done: false, depth: 0 },
    ]);
  });

  it('names the problem and records the agent', () => {
    const { commands, call, adapter } = setup(['One']);
    expect(() => call('card_checklist_remove', { item: 9 })).toThrow(/not found/);
    expect(() => call('card_checklist_update', { item: 1 })).toThrow(/text", "done" or "depth/);
    expect(() => commands.card_checklist_set({ boardId: 'b1', card: 1, text: 'x' })).toThrow(/who you are/);
    call('card_checklist_add', { text: 'Two' });
    const board = adapter.getBoard('b1')!.board;
    expect(board.events.at(-1)?.actor).toBe('worker-1');
  });
});
