// Tool-agnostic domain model for Onecarat Agent Office.
// These are INTERNAL UI classifications, not Claude Code event names.

export type AgentStatus =
  | 'created'
  | 'idle'
  | 'delegating'
  | 'working'
  | 'waiting_permission'
  | 'blocked'
  | 'completed'
  | 'failed'
  | 'unknown';

export type Activity = 'reading' | 'editing' | 'executing' | 'testing' | 'researching' | 'reporting' | 'thinking' | 'other';

/** Outcome of a finished subagent. Claude Code sends no success flag, so success is always an estimate. */
export type Outcome = 'success_estimated' | 'failure_estimated' | 'unknown';

/** Progress values must say where they came from. MVP uses stages only. */
export type Progress =
  | { kind: 'measured'; ratio: number }
  | { kind: 'estimated'; ratio: number; basis: string }
  | { kind: 'unavailable' };

export type DataSource = 'live' | 'demo';

/** One normalized event. `agentId` undefined = the main agent (Manager). */
export type OfficeEvent = {
  id: string;
  at: number;
  sessionId: string;
  source: DataSource;
  agentId?: string;
  /** Working directory reported by the hook (any event). Used to label sessions joined mid-way. */
  cwd?: string;
  /** permission_mode reported by the hook (default, acceptEdits, plan, auto, bypassPermissions…). Display only. */
  permissionMode?: string;
} & OfficeEventBody;

export type OfficeEventBody =
  | { type: 'session.started'; cwd?: string; origin?: string }
  | { type: 'session.ended'; reason?: string }
  | { type: 'user.prompt'; text: string }
  /** A turn Claude Code started itself (subagent report, task notification, /loop ...). Not shown as a user message. */
  | { type: 'injected.prompt'; kind: string; fromAgentId?: string; preview: string }
  | { type: 'tool.started'; toolUseId: string; toolName: string; activity: Activity; detail: string }
  | { type: 'tool.finished'; toolUseId: string; toolName: string; durationMs?: number }
  | { type: 'tool.failed'; toolUseId?: string; toolName: string; error: string; interrupted: boolean }
  | { type: 'permission.requested'; toolName: string; detail: string }
  | { type: 'notification'; kind: string; message: string }
  /** Main agent asked for a subagent (before it exists). */
  | { type: 'subagent.requested'; toolUseId: string; description: string; subagentType: string }
  /** Claude Code confirmed which agent id belongs to a request (PostToolUse of the Agent tool). */
  | { type: 'subagent.linked'; toolUseId: string; childId: string; finished: boolean }
  | { type: 'subagent.started'; childId: string; agentType: string }
  | { type: 'subagent.reported'; message: string }
  | { type: 'subagent.stopped'; childId: string; agentType: string; lastMessage?: string }
  | { type: 'turn.stopped'; lastMessage?: string };

export type OfficeEventType = OfficeEventBody['type'];

export interface EvidenceLine {
  eventId: string;
  at: number;
  type: OfficeEventType;
  text: string;
  tone: 'normal' | 'warn' | 'error' | 'ok';
}

export interface AgentState {
  id: string;
  role: 'manager' | 'subagent';
  agentType: string;
  /** Human label, e.g. "Explore" or the task description. */
  label: string;
  task?: string;
  status: AgentStatus;
  activity?: Activity;
  activityDetail?: string;
  progress: Progress;
  outcome?: Outcome;
  /** Consecutive tool failures since the last success. */
  failureStreak: number;
  reported: boolean;
  /** Manager has received this agent's report (evidence-based). */
  acknowledged: boolean;
  createdAt: number;
  updatedAt: number;
  evidence: EvidenceLine[];
}

export interface ChatMessage {
  id: string;
  at: number;
  from: 'user' | 'manager';
  text: string;
}

export interface SessionState {
  id: string;
  source: DataSource;
  cwd?: string;
  /** The main agent's current permission mode, as last reported by a hook. Office never sets it. */
  permissionMode?: string;
  startedAt: number;
  endedAt?: number;
  /** True when we saw the session's start; false when we joined mid-session. */
  sawStart: boolean;
  agents: Record<string, AgentState>;
  /** Subagent ids in order of appearance (desk order). */
  order: string[];
  chat: ChatMessage[];
  pendingRequests: { toolUseId: string; description: string; subagentType: string; childId?: string }[];
  /** Agent ids whose SubagentStart we saw. Stops without a start are internal agents and are ignored. */
  knownChildren: string[];
  /**
   * tool_use_ids that already finished. Async hooks can arrive out of order, so a late PreToolUse
   * for a finished call must not put the agent back to "working".
   */
  finishedTools: string[];
}

export interface OfficeState {
  sessions: Record<string, SessionState>;
  sessionOrder: string[];
}

export const MANAGER_ID = 'main';
