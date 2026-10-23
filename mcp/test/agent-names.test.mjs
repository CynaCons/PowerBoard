/**
 * Agents must name themselves: no generated names (REQ-PB-131).
 * A server started WITHOUT POWERBOARD_AGENT_NAME (and no POWERNOTE_AGENT_NAME
 * fallback) refuses board calls that do not carry `me`, refuses generated-looking
 * names, and lists its own process as unnamed.
 *
 * Ported from powerscroll-mcp's agent-names.test.mjs.
 *
 * Run: npm test --prefix mcp
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freePort, startServer, connectApp, waitUntil } from './helpers.mjs';

const BOARD_WRITE_TOOLS = [
  'board_create',
  'card_create',
  'card_update',
  'card_claim',
  'card_release',
  'card_move',
  'card_note',
  'card_check',
  'card_checklist_add',
  'card_checklist_update',
  'card_checklist_remove',
  'card_checklist_move',
  'card_checklist_set',
  'card_archive',
  'card_restore',
  'agent_status',
  'agent_leave',
];

let proc;
let port;

before(async () => {
  port = await freePort();
  // No server-side name at all: blank both the PowerBoard variable and the
  // PowerScroll fallback the server also accepts.
  proc = startServer({
    port,
    env: { POWERBOARD_AGENT_NAME: '', POWERNOTE_AGENT_NAME: '' },
  });
  await proc.ready();
});

after(() => {
  proc?.stop();
});

test('REQ-PB-131 every board write tool requires me in its schema', async () => {
  const tools = await proc.listTools();
  for (const name of BOARD_WRITE_TOOLS) {
    const tool = tools.find((item) => item.name === name);
    assert.ok(tool, `missing tool ${name}`);
    assert.ok(tool.inputSchema.required.includes('me'), `${name} does not require me`);
  }
});

test('REQ-PB-131 a board call without me is refused with NAME_REQUIRED, never given a made-up name', async () => {
  const result = await proc.call('card_create', { boardId: 'b1', title: 'No name' });
  assert.equal(result.isError, true);
  assert.match(result.text, /NAME_REQUIRED/);
});

test('REQ-PB-131 generated-looking names are refused', async () => {
  for (const me of ['agent-1a2b3c4d', 'unnamed-0f9e8d7c']) {
    const result = await proc.call('card_create', { boardId: 'b1', title: 'Fake', me });
    assert.equal(result.isError, true, me);
    assert.match(result.text, /NAME_REQUIRED/, me);
  }
});

test('REQ-PB-131 the agents frame lists an unnamed process as unnamed', async () => {
  const board = connectApp(port);
  const frame = await waitUntil(() => board.control.find((item) => item.type === 'agents'));
  board.close();
  const hub = frame.agents.find((agent) => agent.role === 'hub');
  assert.match(hub.label, /^unnamed-[0-9a-f]{8}$/);
  assert.equal(hub.named, false);
});
