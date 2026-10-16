/**
 * Public surface of `powerboard/react`.
 *
 * BoardView is fully props-driven (REQ-PB-104): it reads the board from
 * `BoardViewProps`, never from a host store. The presence store is the only
 * module-level state and is exported so hosts can feed it `agents` frames.
 */
export { BoardView } from './BoardView';

export {
  ActivityPanel,
  readActivityCollapsed,
  writeActivityCollapsed,
} from './ActivityPanel';
export { AgentsStrip, agentChips, type AgentChipModel } from './AgentsStrip';
export { BoardCardFace } from './BoardCardFace';
export { BoardColumn } from './BoardColumn';
export { CardOverlay } from './CardOverlay';
export { QuestionPrompt } from './QuestionPrompt';

export {
  AGENT_ACTIVE_MS,
  AGENT_RECENT_MS,
  AGENT_TICK_MS,
  useAgentPresenceStore,
  type AgentActorState,
  type ConnectedAgent,
} from './presence';

export { defaultRenderMarkdown } from './markdown';

/** Types from the pinned contract (BoardViewProps, BoardData, BoardCard, …). */
export type * from '../contract';
