/**
 * Unit tests for powerboard/mcp-tools (plain ESM JS, ported from powerscroll-mcp).
 *
 * Run with `npm run test:mcp-tools` (node --test). Covers:
 *  - REQ-PB-101: the module is plain ESM JS with no dependencies.
 *  - REQ-PB-103: the 17 board tool definitions, verbatim from the source.
 *  - REQ-PB-131: the agent-name rules (NAME_REQUIRED / INVALID / generated names).
 *  - REQ-BOARD-014: `withAgentMe` records the actor.
 *  - REQ-BOARD-022: `board_updates` polling and its timeout.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import {
  AGENT_NAME_RE,
  BOARD_ME_TOOLS,
  BOARD_READ_ONLY_TOOLS,
  BOARD_TOOL_NAMES,
  BOARD_TOOLS,
  BOARD_WORKFLOW,
  GENERATED_NAME_RE,
  ME_PROP,
  NAME_REQUIRED_MESSAGE,
  boardUpdatesTimeoutMs,
  pollBoardUpdates,
  withAgentMe,
} from '../index.js';

/** The 17 board tools, in the order powerscroll-mcp lists them. */
const EXPECTED_TOOL_NAMES = [
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

/** The board tools that only look (the four board names from READ_ONLY). */
const EXPECTED_READ_ONLY = ['board_list', 'board_read', 'card_get', 'board_updates'];

/** Where the read-only source lives. Overridable for a checkout elsewhere. */
const SOURCE_CANDIDATES = [
  process.env.POWERNOTE_MCP_SERVER,
  'C:/dev/private-repo/PowerNote/powernote-mcp/server.js',
].filter((p) => typeof p === 'string' && p.length > 0);

/** First candidate source path that exists, or null. */
function findSource() {
  for (const path of SOURCE_CANDIDATES) {
    if (existsSync(path)) return path;
  }
  return null;
}

/**
 * Rebuilds the source's board tool objects by evaluating the slice of
 * powernote-mcp/server.js between `board_list` and the closing `]` of TOOLS.
 * Only BOARD_WORKFLOW and ME_PROP are needed from this module.
 */
function loadSourceBoardTools(src) {
  const nameAt = src.indexOf("name: 'board_list'");
  assert.ok(nameAt > -1, 'source should define board_list');
  const start = src.lastIndexOf('{', nameAt);
  const loopAt = src.indexOf('// Board tools require `me`', nameAt);
  assert.ok(loopAt > -1, 'source should have the me-required loop');
  const end = src.lastIndexOf(']', loopAt);
  // eslint-disable-next-line no-new-func -- it is test code reading a trusted file
  const factory = new Function('BOARD_WORKFLOW', 'ME_PROP', 'return [' + src.slice(start, end) + '];');
  const tools = factory(BOARD_WORKFLOW, ME_PROP);
  // The source adds `me` in a loop after the array; this module does it inline.
  for (const tool of tools) {
    if (!BOARD_ME_TOOLS.has(tool.name)) continue;
    const required = tool.inputSchema.required || [];
    if (!required.includes('me')) tool.inputSchema.required = [...required, 'me'];
  }
  return tools;
}

test('REQ-PB-101 exports the shared constants', () => {
  assert.ok(AGENT_NAME_RE instanceof RegExp);
  assert.ok(GENERATED_NAME_RE instanceof RegExp);
  assert.equal(typeof NAME_REQUIRED_MESSAGE, 'string');
  assert.ok(NAME_REQUIRED_MESSAGE.startsWith('NAME_REQUIRED:'));
  assert.equal(typeof BOARD_WORKFLOW, 'string');
  assert.ok(BOARD_WORKFLOW.startsWith('Workflow:'));
  assert.equal(ME_PROP.type, 'string');
  assert.match(ME_PROP.description, /agent name/);
  assert.equal(AGENT_NAME_RE.test('feature-1'), true);
  assert.equal(AGENT_NAME_RE.test('Bad Name'), false);
  assert.equal(GENERATED_NAME_RE.test('agent-1a2b3c4d'), true);
  assert.equal(GENERATED_NAME_RE.test('unnamed-1a2b3c4d'), true);
});

test('REQ-PB-103 defines the 17 board tools in source order with unique names', () => {
  assert.equal(BOARD_TOOLS.length, 17);
  assert.deepEqual(BOARD_TOOL_NAMES, EXPECTED_TOOL_NAMES);
  assert.deepEqual(
    BOARD_TOOLS.map((tool) => tool.name),
    EXPECTED_TOOL_NAMES,
  );
  assert.equal(new Set(BOARD_TOOL_NAMES).size, 17);
  for (const tool of BOARD_TOOLS) {
    assert.equal(typeof tool.description, 'string');
    assert.ok(tool.description.length > 0);
    assert.equal(tool.inputSchema.type, 'object');
    assert.equal(tool.inputSchema.additionalProperties, false);
  }
});

test('REQ-PB-131 every BOARD_ME tool has me in required, and only those do', () => {
  assert.equal(BOARD_ME_TOOLS.size, 14);
  for (const tool of BOARD_TOOLS) {
    const required = tool.inputSchema.required || [];
    if (BOARD_ME_TOOLS.has(tool.name)) {
      assert.ok(required.includes('me'), tool.name + ' should require me');
      assert.ok('me' in tool.inputSchema.properties, tool.name + ' should declare me');
    } else {
      assert.ok(!required.includes('me'), tool.name + ' should not require me');
    }
  }
  // board_list takes no arguments at all.
  assert.deepEqual(BOARD_TOOLS.find((t) => t.name === 'board_list').inputSchema.required, undefined);
});

test('REQ-PB-103 the read-only set is exactly the four board read tools', () => {
  assert.equal(BOARD_READ_ONLY_TOOLS.size, 4);
  assert.deepEqual([...BOARD_READ_ONLY_TOOLS].sort(), [...EXPECTED_READ_ONLY].sort());
  for (const name of BOARD_READ_ONLY_TOOLS) {
    assert.ok(BOARD_TOOL_NAMES.includes(name), name + ' should be a board tool');
  }
});

test('REQ-BOARD-014 withAgentMe fills me and actor from the environment name', () => {
  assert.deepEqual(withAgentMe('card_claim', { boardId: 'b', card: 1 }, 'feature-1'), {
    boardId: 'b',
    card: 1,
    me: 'feature-1',
    actor: 'feature-1',
  });
  // An empty me counts as missing.
  assert.deepEqual(withAgentMe('card_note', { boardId: 'b', card: 2, text: 'x', me: '' }, 'feature-1'), {
    boardId: 'b',
    card: 2,
    text: 'x',
    me: 'feature-1',
    actor: 'feature-1',
  });
  // An explicit valid me wins; actor always mirrors it.
  assert.deepEqual(withAgentMe('card_note', { me: 'feature-2' }, 'feature-1'), {
    me: 'feature-2',
    actor: 'feature-2',
  });
});

test('REQ-PB-131 withAgentMe rejects missing, generated and bad names', () => {
  assert.throws(() => withAgentMe('card_claim', { boardId: 'b', card: 1 }, null), (err) => {
    assert.ok(err instanceof Error);
    assert.ok(err.message.startsWith('NAME_REQUIRED'));
    return true;
  });
  assert.throws(() => withAgentMe('card_claim', {}, undefined), /NAME_REQUIRED/);
  assert.throws(() => withAgentMe('card_claim', { me: 'agent-1a2b3c4d' }, null), /NAME_REQUIRED/);
  assert.throws(() => withAgentMe('card_claim', { me: 'unnamed-1a2b3c4d' }, 'feature-1'), /NAME_REQUIRED/);
  assert.throws(() => withAgentMe('card_claim', { me: 'Bad Name' }, null), (err) => {
    assert.ok(err instanceof Error);
    assert.ok(err.message.startsWith('INVALID:'));
    assert.ok(err.message.endsWith('(agent-name convention)'));
    return true;
  });
  assert.throws(() => withAgentMe('card_claim', { me: 42 }, null), /INVALID/);
});

test('REQ-PB-101 withAgentMe leaves non-board tools untouched', () => {
  const params = { pageId: 'p1', markdown: '# hi' };
  const out = withAgentMe('update_block', params, 'feature-1');
  assert.deepEqual(out, { pageId: 'p1', markdown: '# hi' });
  assert.notEqual(out, params);
  assert.ok(!('actor' in out));
});

test('REQ-BOARD-022 boardUpdatesTimeoutMs adds the wait plus the margin', () => {
  assert.equal(boardUpdatesTimeoutMs({ wait_seconds: 5 }, 10_000), 17_000);
  assert.equal(boardUpdatesTimeoutMs({}, 10_000), 12_000);
  assert.equal(boardUpdatesTimeoutMs(null, 10_000), 12_000);
  assert.equal(boardUpdatesTimeoutMs({ wait_seconds: -3 }, 10_000), 12_000);
  assert.equal(boardUpdatesTimeoutMs({ wait_seconds: 'nope' }, 10_000), 12_000);
  // The wait is clamped to the schema maximum of 300 s.
  assert.equal(boardUpdatesTimeoutMs({ wait_seconds: 1_000 }, 10_000), 312_000);
});

test('REQ-BOARD-022 pollBoardUpdates returns at once when events exist', async () => {
  const calls = [];
  const result = await pollBoardUpdates(
    { boardId: 'b', since: 1, wait_seconds: 10 },
    async (params) => {
      calls.push(params);
      return { events: [{ seq: 2 }], cursor: 2 };
    },
    { sleep: async () => assert.fail('should not sleep'), now: () => 0 },
  );
  assert.deepEqual(result, { events: [{ seq: 2 }], cursor: 2 });
  assert.equal(calls.length, 1);
  // wait_seconds is a server-side knob; the app never sees it.
  assert.deepEqual(calls[0], { boardId: 'b', since: 1 });
});

test('REQ-BOARD-022 pollBoardUpdates adopts the cursor when since is missing', async () => {
  let clock = 0;
  const sleeps = [];
  const seen = [];
  const result = await pollBoardUpdates(
    { boardId: 'b', wait_seconds: 5 },
    async (params) => {
      seen.push(params.since);
      return seen.length === 1
        ? { events: [], cursor: 7 }
        : { events: [{ seq: 8 }], cursor: 8 };
    },
    { sleep: async (ms) => { sleeps.push(ms); clock += ms; }, now: () => clock },
  );
  assert.deepEqual(seen, [undefined, 7]);
  assert.deepEqual(sleeps, [1000]);
  assert.deepEqual(result, { events: [{ seq: 8 }], cursor: 8 });
});

test('REQ-BOARD-022 pollBoardUpdates with wait_seconds 0 asks once and returns', async () => {
  const calls = [];
  const result = await pollBoardUpdates(
    { boardId: 'b' },
    async (params) => {
      calls.push(params);
      return { events: [], cursor: 3 };
    },
    { sleep: async () => assert.fail('should not sleep'), now: () => 0 },
  );
  assert.equal(calls.length, 1);
  assert.deepEqual(result, { events: [], cursor: 3 });
});

test('REQ-BOARD-022 pollBoardUpdates times out with an empty events list', async () => {
  let clock = 0;
  const sleeps = [];
  let calls = 0;
  const result = await pollBoardUpdates(
    { boardId: 'b', wait_seconds: 3 },
    async () => {
      calls += 1;
      return { events: [], cursor: 9 };
    },
    { sleep: async (ms) => { sleeps.push(ms); clock += ms; }, now: () => clock },
  );
  assert.deepEqual(result, { events: [], cursor: 9 });
  assert.equal(calls, 4);
  assert.deepEqual(sleeps, [1000, 1000, 1000]);

  let emptyClock = 0;
  const empty = await pollBoardUpdates(
    { boardId: 'b', wait_seconds: 2 },
    async () => null,
    { sleep: async (ms) => { emptyClock += ms; }, now: () => emptyClock },
  );
  assert.deepEqual(empty, { events: [], cursor: 0 });
});

test('REQ-PB-103 the tool definitions match the source file', (t) => {
  const path = findSource();
  if (!path) {
    t.skip('powernote-mcp/server.js not found; set POWERNOTE_MCP_SERVER to check');
    return;
  }
  const src = readFileSync(path, 'utf8');
  const sourceTools = loadSourceBoardTools(src);

  assert.deepEqual(sourceTools.map((tool) => tool.name), BOARD_TOOL_NAMES);
  assert.equal(sourceTools.length, BOARD_TOOLS.length);
  for (let i = 0; i < sourceTools.length; i += 1) {
    const mine = BOARD_TOOLS[i];
    const theirs = sourceTools[i];
    assert.deepEqual(
      mine.inputSchema.required,
      theirs.inputSchema.required,
      mine.name + ' required array',
    );
    // The whole definition, not just the schema: names, descriptions, JSON Schema.
    assert.equal(JSON.stringify(mine), JSON.stringify(theirs), mine.name + ' definition');
  }
});
