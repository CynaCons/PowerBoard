/**
 * Type declarations for powerboard/mcp-tools, the board MCP tool definitions and
 * helpers shared by powerscroll-mcp and powerboard-mcp (REQ-PB-101).
 *
 * The implementation is plain ESM JavaScript (mcp-tools/index.js); these
 * declarations exist so TypeScript consumers and editors get the same shapes.
 */

/** Valid agent names: lowercase, one letter or digit first, then `[a-z0-9._-]`. */
export declare const AGENT_NAME_RE: RegExp;

/** Names a server used to generate (`agent-<8 hex>`) or gives unnamed processes. */
export declare const GENERATED_NAME_RE: RegExp;

/** The NAME_REQUIRED error text a board call raises when it has no valid `me`. */
export declare const NAME_REQUIRED_MESSAGE: string;

/** The workflow blurb appended to every board tool description. */
export declare const BOARD_WORKFLOW: string;

/** Schema for the `me` property shared by every board tool that takes one. */
export declare const ME_PROP: { type: 'string'; description: string };

/** Board tool names that take `me` (the app records it as the actor). */
export declare const BOARD_ME_TOOLS: Set<string>;

/** Board tool names that only look; a server lets these bypass its write lease. */
export declare const BOARD_READ_ONLY_TOOLS: Set<string>;

/** A JSON Schema object as MCP tool definitions carry it. */
export interface BoardToolInputSchema {
  type: 'object';
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

/** One MCP tool definition. */
export interface BoardToolDefinition {
  name: string;
  description: string;
  inputSchema: BoardToolInputSchema;
}

/** The 17 board tools, in source order, with `me` already required where it applies. */
export declare const BOARD_TOOLS: BoardToolDefinition[];

/** The 17 board tool names, in the same order as BOARD_TOOLS. */
export declare const BOARD_TOOL_NAMES: string[];

/**
 * Fills in `me` (and the `actor` the app records) for a board tool call.
 * Non-board tools are returned as a copy, unchanged.
 *
 * @throws NAME_REQUIRED when `me` is missing and `envAgentName` is not given, or
 *   when `me` is a generated name; INVALID when `me` is not a valid agent name.
 */
export declare function withAgentMe(
  name: string,
  params: Record<string, unknown>,
  envAgentName?: string | null,
): Record<string, unknown>;

/**
 * The timeout budget `board_updates` needs: `baseMs` plus one second per
 * `wait_seconds` (clamped to 300) plus a 2 s margin.
 */
export declare function boardUpdatesTimeoutMs(
  args: { wait_seconds?: unknown } | null | undefined,
  baseMs: number,
): number;

/** The result `board_updates` returns. */
export interface BoardUpdatesResult {
  events: unknown[];
  cursor: number;
}

/** Options for {@link pollBoardUpdates}; defaults are real timers. */
export interface PollBoardUpdatesOptions {
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/**
 * Long-polls `board_updates` until an event arrives or the wait runs out.
 * `callBoardUpdates` performs the command and resolves to the app's result.
 */
export declare function pollBoardUpdates(
  args: Record<string, unknown>,
  callBoardUpdates: (
    params: Record<string, unknown>,
  ) => Promise<BoardUpdatesResult | null | undefined>,
  options?: PollBoardUpdatesOptions,
): Promise<BoardUpdatesResult | null | undefined>;
