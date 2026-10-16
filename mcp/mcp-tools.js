/**
 * powerboard/mcp-tools — the board MCP tool definitions and argument helpers.
 *
 * Two servers import this module: PowerScroll's powerscroll-mcp (boards embedded
 * in a notebook) and powerboard-mcp (the standalone app). So it is plain ESM
 * JavaScript with no dependencies at all — no TypeScript, no imports from `src/`
 * and no build step (REQ-PB-101).
 *
 * Everything here is ported verbatim from powerscroll-mcp
 * (powernote-mcp/server.js): the tool names, descriptions and JSON schemas, the
 * agent-name rules, the workflow blurb and the `board_updates` long-poll, so both
 * servers list the same tools and behave the same way (REQ-PB-103, REQ-PB-131).
 *
 * Only what the two servers cannot share has been parameterised:
 *  - `withAgentMe` takes the environment agent name as an argument instead of
 *    reading the `ENV_AGENT_NAME` global, and its INVALID message says
 *    "(agent-name convention)" rather than naming one server's convention.
 *  - `pollBoardUpdates` takes the app call (and `sleep`/`now`) as arguments, so a
 *    server supplies its own transport and tests run without real timers.
 */

/**
 * Valid agent names: lowercase, one letter or digit first, then up to 39 of
 * `[a-z0-9._-]`, so a name is safe to show on a card and to compare literally.
 */
export const AGENT_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,39}$/;

/** Names a server used to generate (agent-<8 hex>) or labels it gives unnamed processes. */
export const GENERATED_NAME_RE = /^(agent|unnamed)-[0-9a-f]{8}$/;

export const NAME_REQUIRED_MESSAGE =
  'NAME_REQUIRED: tell PowerScroll who you are. Pass "me" with your agent name ' +
  '(e.g. "feature-1", ^[a-z0-9][a-z0-9._-]{0,39}$) on every board call, and reuse the ' +
  'same name every session so the board shows you once. Or set POWERNOTE_AGENT_NAME in ' +
  'this MCP server environment.';

/**
 * The blurb appended to every board tool description. It is the shortest text
 * that tells a model the whole cycle: read, claim, move to doing, work with
 * checks and notes, say what you are doing, ask the owner through waiting, then
 * listen with board_updates and finish in done.
 */
export const BOARD_WORKFLOW =
  'Workflow: board_read the board, card_claim a card, card_move it to doing, ' +
  'work and call card_check/card_note as you go, agent_status for what you are doing now, ' +
  'card_move to waiting WITH a question when you need the owner, ' +
  'board_updates {mine:true, wait_seconds} to hear back, then card_move to done.';

export const ME_PROP = {
  type: 'string',
  description:
    'Required: your agent name (^[a-z0-9][a-z0-9._-]{0,39}$, e.g. "feature-1"). Use the same ' +
    'name every session; PowerScroll never invents one. Only POWERNOTE_AGENT_NAME in the ' +
    'server environment can stand in for it. Recorded on cards, notes and events.',
};

/**
 * Board tools that take `me`. The app records the name as the actor on every
 * card, note and event they write (REQ-BOARD-014).
 */
export const BOARD_ME_TOOLS = new Set([
  'board_create',
  'card_create',
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
]);

/**
 * Board tools that only look. A server lets these bypass its write lease: a
 * blocked agent must still be able to read, and above all to find out why it is
 * blocked. These are the four board names from powerscroll-mcp's READ_ONLY set.
 */
export const BOARD_READ_ONLY_TOOLS = new Set([
  'board_list',
  'board_read',
  'card_get',
  'board_updates',
]);

/**
 * The 17 board tools, in source order, exactly as powerscroll-mcp lists them.
 * `me` is added to `required` below for the BOARD_ME_TOOLS entries.
 */
export const BOARD_TOOLS = [
  {
    name: 'board_list',
    description:
      'List every board page in the notebook: id, title, section, and card counts per column. ' +
      BOARD_WORKFLOW,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'board_create',
    description:
      'Create a new board page. Does NOT switch the owner\'s active page. ' + BOARD_WORKFLOW,
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Board title.' },
        sectionId: {
          type: 'string',
          description: 'Section to create the board in. Defaults to the active section.',
        },
        me: ME_PROP,
      },
      required: ['title'],
      additionalProperties: false,
    },
  },
  {
    name: 'board_read',
    description:
      'Read cards on a board: number, id, title, column, order, assignee, labels, ' +
      'checklist done/total, question, last note, updatedAt. Filter with column or assignee. ' +
      'Archived cards are omitted unless include_archived is true. ' +
      BOARD_WORKFLOW,
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string', description: 'Board page id from board_list.' },
        column: {
          type: 'string',
          enum: ['todo', 'doing', 'waiting', 'done'],
          description: 'If set, only cards in this column.',
        },
        assignee: { type: 'string', description: 'If set, only cards assigned to this name.' },
        include_archived: {
          type: 'boolean',
          description: 'If true, include archived cards. Default false.',
        },
      },
      required: ['boardId'],
      additionalProperties: false,
    },
  },
  {
    name: 'card_create',
    description:
      'Create a card on a board. Returns the card including its number. Default column is todo. ' +
      BOARD_WORKFLOW,
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        column: { type: 'string', enum: ['todo', 'doing', 'waiting', 'done'] },
        labels: { type: 'array', items: { type: 'string' } },
        checklist: {
          type: 'array',
          items: { type: 'string' },
          description: 'Checklist item titles, all unchecked.',
        },
        me: ME_PROP,
      },
      required: ['boardId', 'title'],
      additionalProperties: false,
    },
  },
  {
    name: 'card_get',
    description:
      'Read one card in full, including notes, checklist and history events. ' +
      '`card` accepts the id or the number (15 or "#15"). ' +
      BOARD_WORKFLOW,
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        card: { description: 'Card id, number, or "#15".' },
      },
      required: ['boardId', 'card'],
      additionalProperties: false,
    },
  },
  {
    name: 'card_update',
    description: 'Update a card title, description or labels. ' + BOARD_WORKFLOW,
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        card: { description: 'Card id, number, or "#15".' },
        title: { type: 'string' },
        description: { type: 'string' },
        labels: { type: 'array', items: { type: 'string' } },
        me: ME_PROP,
      },
      required: ['boardId', 'card'],
      additionalProperties: false,
    },
  },
  {
    name: 'card_claim',
    description: 'Assign the card to me. ' + BOARD_WORKFLOW,
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        card: { description: 'Card id, number, or "#15".' },
        me: ME_PROP,
      },
      required: ['boardId', 'card'],
      additionalProperties: false,
    },
  },
  {
    name: 'card_release',
    description: 'Clear the card assignee. ' + BOARD_WORKFLOW,
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        card: { description: 'Card id, number, or "#15".' },
        me: ME_PROP,
      },
      required: ['boardId', 'card'],
      additionalProperties: false,
    },
  },
  {
    name: 'card_move',
    description:
      'Move a card to todo, doing, waiting or done. `question` is required when moving to waiting. ' +
      BOARD_WORKFLOW,
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        card: { description: 'Card id, number, or "#15".' },
        to: { type: 'string', enum: ['todo', 'doing', 'waiting', 'done'] },
        position: { type: 'integer', minimum: 0, description: 'Index in the destination column.' },
        question: {
          type: 'string',
          description: 'Required when `to` is waiting. Shown to the owner.',
        },
        me: ME_PROP,
      },
      required: ['boardId', 'card', 'to'],
      additionalProperties: false,
    },
  },
  {
    name: 'card_note',
    description: 'Add a signed note on a card. ' + BOARD_WORKFLOW,
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        card: { description: 'Card id, number, or "#15".' },
        text: { type: 'string' },
        me: ME_PROP,
      },
      required: ['boardId', 'card', 'text'],
      additionalProperties: false,
    },
  },
  {
    name: 'card_check',
    description:
      'Tick or untick a checklist item. `item` is the item id or a 1-based index. ' +
      BOARD_WORKFLOW,
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        card: { description: 'Card id, number, or "#15".' },
        item: { description: 'Checklist item id or 1-based index.' },
        done: { type: 'boolean' },
        me: ME_PROP,
      },
      required: ['boardId', 'card', 'item', 'done'],
      additionalProperties: false,
    },
  },
  {
    name: 'card_checklist_add',
    description: 'Append a checklist item to a card. ' + BOARD_WORKFLOW,
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        card: { description: 'Card id, number, or "#15".' },
        text: { type: 'string' },
        me: ME_PROP,
      },
      required: ['boardId', 'card', 'text'],
      additionalProperties: false,
    },
  },
  {
    name: 'card_archive',
    description:
      'Archive a card (hide it from columns; it stays in the notebook and can be restored). ' +
      BOARD_WORKFLOW,
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        card: { description: 'Card id, number, or "#15".' },
        me: ME_PROP,
      },
      required: ['boardId', 'card'],
      additionalProperties: false,
    },
  },
  {
    name: 'card_restore',
    description:
      'Restore an archived card into its previous column, at the end. ' +
      BOARD_WORKFLOW,
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        card: { description: 'Card id, number, or "#15".' },
        me: ME_PROP,
      },
      required: ['boardId', 'card'],
      additionalProperties: false,
    },
  },
  {
    name: 'agent_status',
    description:
      'Set the one-line status shown in the board agents strip. Naming a card marks you active on it. ' +
      'Does not change the board. ' +
      BOARD_WORKFLOW,
    inputSchema: {
      type: 'object',
      properties: {
        me: ME_PROP,
        text: { type: 'string', description: 'What you are doing now.' },
        boardId: { type: 'string' },
        card: { description: 'Card id, number, or "#15". Marks you active on that card.' },
      },
      required: ['text'],
      additionalProperties: false,
    },
  },
  {
    name: 'agent_leave',
    description:
      'Sign off: remove me from the board\'s active agents. Call when you finish or stop working. ' +
      BOARD_WORKFLOW,
    inputSchema: {
      type: 'object',
      properties: {
        me: ME_PROP,
        boardId: {
          type: 'string',
          description: 'Board to record the leave event on. Defaults to the last board you acted on.',
        },
        note: { type: 'string', description: 'Optional sign-off note stored on the leave event.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'board_updates',
    description:
      'Events with seq > since (omit since to receive only the cursor). ' +
      'mine:true limits to cards assigned to you. If none and wait_seconds > 0, this server ' +
      're-asks the app every 1 s until something arrives or the wait (max 300 s) ends. ' +
      'Returns {events, cursor}. This is how you hear the owner\'s replies and moves. ' +
      BOARD_WORKFLOW,
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        since: { type: 'integer', minimum: 0, description: 'Return events with seq greater than this.' },
        mine: { type: 'boolean', description: 'Only events on cards currently assigned to me.' },
        wait_seconds: {
          type: 'integer',
          minimum: 0,
          maximum: 300,
          description: 'Long-poll up to this many seconds (max 300) when there are no events.',
        },
        me: ME_PROP,
      },
      required: ['boardId'],
      additionalProperties: false,
    },
  },
];

// Board tools require `me`: the schema says so, so clients prompt for it.
for (const tool of BOARD_TOOLS) {
  if (!BOARD_ME_TOOLS.has(tool.name)) continue;
  const required = tool.inputSchema.required || [];
  if (!required.includes('me')) tool.inputSchema.required = [...required, 'me'];
}

/**
 * The 17 board tool names, in the same order as BOARD_TOOLS. Servers use this to
 * decide which calls to route to the app, and to advertise them consistently.
 */
export const BOARD_TOOL_NAMES = BOARD_TOOLS.map((tool) => tool.name);

/**
 * Fills in `me` (and the `actor` the app records) for a board tool call.
 *
 * `envAgentName` is the name the server took from its environment, or null when
 * it has none: without one a caller must pass `me` itself, because a server never
 * invents a name (REQ-PB-131). Board tools that do not take `me` are returned as
 * a copy, unchanged.
 *
 * @param {string} name Tool name.
 * @param {Record<string, unknown>} params Tool arguments.
 * @param {string | null} [envAgentName] The server's environment agent name, if valid.
 * @returns {Record<string, unknown>} A new params object carrying `me` and `actor`.
 * @throws {Error} NAME_REQUIRED when `me` is missing and there is no env name, or
 *   when `me` is a generated/unnamed name; INVALID when `me` is not a valid name.
 */
export function withAgentMe(name, params, envAgentName) {
  if (!BOARD_ME_TOOLS.has(name)) return { ...params };
  const next = { ...params };
  if (next.me === undefined || next.me === null || next.me === '') {
    if (!envAgentName) throw new Error(NAME_REQUIRED_MESSAGE);
    next.me = envAgentName;
  }
  if (typeof next.me !== 'string' || !AGENT_NAME_RE.test(next.me)) {
    throw new Error(
      'INVALID: "me" must match ^[a-z0-9][a-z0-9._-]{0,39}$ (agent-name convention)',
    );
  }
  if (GENERATED_NAME_RE.test(next.me)) throw new Error(NAME_REQUIRED_MESSAGE);
  next.actor = next.me;
  return next;
}

/**
 * The timeout budget `board_updates` needs: the server's base request timeout
 * plus one second per `wait_seconds` (clamped to 300, the schema maximum) plus a
 * 2 s margin so the app's own long-poll answers before the server gives up.
 *
 * @param {{ wait_seconds?: unknown } | null | undefined} args Tool arguments.
 * @param {number} baseMs The server's base request timeout in milliseconds.
 * @returns {number} Timeout in milliseconds.
 */
export function boardUpdatesTimeoutMs(args, baseMs) {
  const wait = Math.min(Math.max(0, Number(args && args.wait_seconds) || 0), 300);
  return wait * 1000 + baseMs + 2000;
}

/** How long pollBoardUpdates waits between asks (the app is asked, not pushed). */
const POLL_INTERVAL_MS = 1000;

/**
 * Long-polls `board_updates` until an event arrives or the wait runs out
 * (REQ-BOARD-022).
 *
 * `callBoardUpdates(params)` is the server's own transport: an async function
 * that performs the command and resolves to the app's RESULT, already unwrapped
 * from any envelope. `options.sleep`/`options.now` default to real timers and
 * exist so tests run without waiting.
 *
 * @param {Record<string, unknown>} args Tool arguments (uses `wait_seconds`, `since`).
 * @param {(params: Record<string, unknown>) => Promise<{ events?: unknown[]; cursor?: number } | null | undefined>} callBoardUpdates
 * @param {{ sleep?: (ms: number) => Promise<void>; now?: () => number }} [options]
 * @returns {Promise<{ events: unknown[]; cursor: number }>} Events and the cursor to pass next time.
 */
export async function pollBoardUpdates(args, callBoardUpdates, options = {}) {
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = options.now || (() => Date.now());
  const wait = Math.min(Math.max(0, Number(args.wait_seconds) || 0), 300);
  const started = now();
  const params = { ...args };
  delete params.wait_seconds;
  let since = params.since;

  while (true) {
    const result = await callBoardUpdates({ ...params, since });
    if (result && Array.isArray(result.events) && result.events.length > 0) {
      return result;
    }
    if (since === undefined && result && typeof result.cursor === 'number') {
      since = result.cursor;
    }
    if (wait <= 0) return result;
    if (now() - started >= wait * 1000) {
      return result || { events: [], cursor: since ?? 0 };
    }
    await sleep(POLL_INTERVAL_MS);
  }
}
