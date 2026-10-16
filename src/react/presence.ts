import { create } from 'zustand';
import { AGENT_ACTIVE_MS, AGENT_RECENT_MS, AGENT_TICK_MS } from '../contract';

export { AGENT_ACTIVE_MS, AGENT_RECENT_MS, AGENT_TICK_MS };

export interface ConnectedAgent {
  label: string;
  role: string;
  connectedAt: number;
}

export interface AgentActorState {
  lastActionAt: number;
  cardId?: string;
  boardId?: string;
  status?: string;
}

interface AgentPresenceState {
  connected: ConnectedAgent[];
  /** True once the bridge hub has sent at least one agent list. */
  presenceSeen: boolean;
  actors: Record<string, AgentActorState>;
  /** Names that have left; chip hidden and their cards go dark until they act again. */
  left: Record<string, number>;
  /** Clock used by the live board. Overridable from tests via `setNow`. */
  now: number;
  clockOverride: number | null;
  setConnected: (agents: ConnectedAgent[]) => void;
  recordAction: (
    actor: string,
    info?: { cardId?: string; boardId?: string; status?: string },
  ) => void;
  leave: (name: string) => void;
  setNow: (ms: number) => void;
  clearNow: () => void;
  tick: () => void;
}

function wallClock(): number {
  return Date.now();
}

export const useAgentPresenceStore = create<AgentPresenceState>((set, get) => ({
  connected: [],
  presenceSeen: false,
  actors: {},
  left: {},
  now: wallClock(),
  clockOverride: null,

  setConnected: (agents) => {
    const at = get().clockOverride ?? wallClock();
    const next = agents
      .filter((agent) => typeof agent?.label === 'string' && agent.label.length > 0)
      .map((agent) => ({
        label: agent.label,
        role: typeof agent.role === 'string' ? agent.role : 'agent',
        connectedAt: typeof agent.connectedAt === 'number' ? agent.connectedAt : wallClock(),
      }));
    const incoming = new Set(next.map((agent) => agent.label));
    const left = { ...get().left };
    for (const previous of get().connected) {
      if (!incoming.has(previous.label) && previous.label !== 'you') {
        left[previous.label] = at;
      }
    }
    set({
      presenceSeen: true,
      connected: next,
      left,
      now: at,
    });
  },

  recordAction: (actor, info = {}) => {
    if (!actor) return;
    const at = get().clockOverride ?? wallClock();
    set((state) => {
      const previous = state.actors[actor] ?? { lastActionAt: at };
      const nextLeft = { ...state.left };
      delete nextLeft[actor];
      return {
        now: at,
        left: nextLeft,
        actors: {
          ...state.actors,
          [actor]: {
            lastActionAt: at,
            cardId: info.cardId !== undefined ? info.cardId : previous.cardId,
            boardId: info.boardId !== undefined ? info.boardId : previous.boardId,
            status: info.status !== undefined ? info.status : previous.status,
          },
        },
      };
    });
  },

  leave: (name) => {
    if (!name || name === 'you') return;
    const at = get().clockOverride ?? wallClock();
    set((state) => ({
      now: at,
      left: { ...state.left, [name]: at },
    }));
  },

  setNow: (ms) => set({ clockOverride: ms, now: ms }),
  clearNow: () => set({ clockOverride: null, now: wallClock() }),
  tick: () => {
    const { clockOverride } = get();
    set({ now: clockOverride ?? wallClock() });
  },
}));

if (typeof window !== 'undefined') {
  (window as unknown as { __POWERNOTE_AGENT_PRESENCE__: typeof useAgentPresenceStore })
    .__POWERNOTE_AGENT_PRESENCE__ = useAgentPresenceStore;
  (window as unknown as { __POWERBOARD_AGENT_PRESENCE__: typeof useAgentPresenceStore })
    .__POWERBOARD_AGENT_PRESENCE__ = useAgentPresenceStore;
}
