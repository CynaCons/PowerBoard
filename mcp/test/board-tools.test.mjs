/**
 * Board MCP tools: schemas, `me` fill/validation, board_updates polling,
 * and the agents presence frame (REQ-PB-130, REQ-PB-131).
 *
 * Ported from powerscroll-mcp's board-tools.test.mjs; the app is faked over the
 * WebSocket and the server binds a freshly allocated free port.
 *
 * Run: npm test --prefix mcp
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freePort, startServer, connectApp, waitUntil } from './helpers.mjs';

const BOARD_TOOLS = [
  'board_list',
  'board_create',
  'board_read',
  'card_create',
  'card_get',
  'card_update',
  'card_claim',
  'card_release',
  'card_move',
  'card_note',
  'card_check',
  'card_checklist_add',
  'card_archive',
  'card_restore',
  'agent_status',
  'agent_leave',
  'board_updates',
];

let proc;
let port;

before(async () => {
  port = await freePort();
  proc = startServer({ port, agentName: 'feature-1' });
  await proc.ready();
});

after(() => {
  proc?.stop();
});

test('REQ-PB-130 board tools plus bridge_status are offered and teach the workflow', async () => {
  const tools = await proc.listTools();
  const names = tools.map((tool) => tool.name);
  for (const name of BOARD_TOOLS) {
    assert.ok(names.includes(name), `missing tool ${name}`);
  }
  assert.ok(names.includes('bridge_status'), 'missing tool bridge_status');
  const read = tools.find((tool) => tool.name === 'board_read');
  assert.match(read.description, /card_claim/);
  assert.match(read.description, /wait_seconds/);
  const updates = tools.find((tool) => tool.name === 'board_updates');
  assert.equal(updates.inputSchema.properties.me.type, 'string');
});

test('REQ-PB-130 connecting the app receives an agents frame naming the hub', async () => {
  const board = connectApp(port);
  const frame = await waitUntil(() => board.control.find((item) => item.type === 'agents'));
  assert.equal(frame.type, 'agents');
  assert.ok(frame.agents.some((agent) => agent.label === 'feature-1' && agent.role === 'hub'));
  board.close();
});

test('REQ-PB-131 agent_leave, card_archive and card_restore schemas include me and fill the default', async () => {
  const tools = await proc.listTools();
  for (const name of ['agent_leave', 'card_archive', 'card_restore']) {
    const tool = tools.find((item) => item.name === name);
    assert.ok(tool, `missing tool ${name}`);
    assert.equal(tool.inputSchema.properties.me.type, 'string');
  }
  const leave = tools.find((item) => item.name === 'agent_leave');
  assert.match(leave.description, /Sign off/);
  const read = tools.find((item) => item.name === 'board_read');
  assert.equal(read.inputSchema.properties.include_archived.type, 'boolean');

  const board = connectApp(port);
  await waitUntil(() => board.control.some((item) => item.type === 'agents'));
  const result = await proc.call('agent_leave', { boardId: 'board-1' });
  assert.equal(result.isError, false, result.text);
  const frame = board.frames.find((item) => item.cmd === 'agent_leave');
  assert.ok(frame, 'agent_leave did not reach the app');
  assert.equal(frame.params.me, 'feature-1');
  assert.equal(frame.params.actor, 'feature-1');
  board.close();
});

test('REQ-PB-131 omitted me is filled from POWERBOARD_AGENT_NAME and sent as actor', async () => {
  const board = connectApp(port);
  await waitUntil(() => board.control.some((item) => item.type === 'agents'));
  const result = await proc.call('card_create', { boardId: 'board-1', title: 'Task' });
  assert.equal(result.isError, false, result.text);
  const frame = board.frames.find((item) => item.cmd === 'card_create');
  assert.ok(frame, 'card_create did not reach the app');
  assert.equal(frame.params.me, 'feature-1');
  assert.equal(frame.params.actor, 'feature-1');
  board.close();
});

test('REQ-PB-131 invalid me is INVALID and never reaches the app', async () => {
  const board = connectApp(port);
  await waitUntil(() => board.control.some((item) => item.type === 'agents'));
  const result = await proc.call('card_create', {
    boardId: 'board-1',
    title: 'Bad',
    me: 'Feature One',
  });
  assert.equal(result.isError, true);
  assert.match(result.text, /INVALID/);
  assert.equal(
    board.frames.some((item) => item.cmd === 'card_create'),
    false,
  );
  board.close();
});

test('REQ-PB-130 board_updates long-polls until events arrive', async () => {
  let polls = 0;
  const board = connectApp(port, (msg) => {
    if (msg.cmd !== 'board_updates') return { ran: msg.cmd };
    polls += 1;
    if (polls < 3) return { events: [], cursor: msg.params.since ?? 4 };
    return { events: [{ seq: 5, actor: 'you', type: 'noted' }], cursor: 5 };
  });
  await waitUntil(() => board.control.some((item) => item.type === 'agents'));
  const started = Date.now();
  const result = await proc.call('board_updates', {
    boardId: 'board-1',
    wait_seconds: 5,
  });
  const elapsed = Date.now() - started;
  assert.equal(result.isError, false, result.text);
  const payload = JSON.parse(result.text);
  assert.equal(payload.events[0].seq, 5);
  assert.ok(polls >= 3, `expected at least 3 polls, got ${polls}`);
  assert.ok(elapsed >= 1500, `poll loop should wait ~1s between tries, took ${elapsed}ms`);
  board.close();
});
