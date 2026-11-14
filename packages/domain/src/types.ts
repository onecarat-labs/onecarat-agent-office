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
  /** The acting subagent's type as the hook reports it (e.g. "web-fetch", "plugin:name"). Only with agentId. */
  agentType?: string;
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
  /** taskStatus: the <status> of a task-notification ("completed" ...), as Claude Code wrote it. */
  | { type: 'injected.prompt'; kind: string; fromAgentId?: string; taskStatus?: string; preview: string }
  | { type: 'tool.started'; toolUseId: string; toolName: string; activity: Activity; detail: string }
  | { type: 'tool.finished'; toolUseId: string; toolName: string; durationMs?: number }
  | { type: 'tool.failed'; toolUseId?: string; toolName: string; error: string; interrupted: boolean }
  | { type: 'permission.requested'; toolName: string; detail: string }
  | { type: 'notification'; kind: string; message: string }
  /**
   * Not a hook: the user pressed "hide this wait" on the Office page for the event's agent. Only the display
   * changes. Nothing is sent to Claude Code, and it says nothing about how the prompt was answered.
   */
  | { type: 'wait.dismissed' }
  /** Main agent asked for a subagent (before it exists). */
  | { type: 'subagent.requested'; toolUseId: string; description: string; subagentType: string }
  /**
   * Claude Code confirmed which agent id belongs to a request (PostToolUse of the Agent tool; the event's agentId
   * is the caller). finished = the call returned with the result (not a background launch): that child has ended.
   */
  | { type: 'subagent.linked'; toolUseId: string; childId: string; finished: boolean }
  | { type: 'subagent.started'; childId: string; agentType: string }
  | { type: 'subagent.reported'; message: string }
  | { type: 'subagent.stopped'; childId: string; agentType: string; lastMessage?: string }
  /** backgroundTasks: what was still running in the background when the main turn ended (absent = not reported). */
  | { type: 'turn.stopped'; lastMessage?: string; backgroundTasks?: BackgroundTask[] }
  /**
   * A file was written as a whole (Write finished). `name` is the display name (last two parts of the path).
   * `path` (the full path) is set by the adapter and never leaves the bridge: before an event is stored or sent
   * to the page, the bridge replaces it by `fileId`, which is all the page needs to ask for "open folder".
   */
  | { type: 'file.created'; name: string; fileId?: string; path?: string };

export interface BackgroundTask {
  id: string;
  status: string;
  agentType?: string;
}

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
  /**
   * Permission requests of this agent that no later event has closed, oldest first (absent when none).
   * A refusal sends no hook, so an entry can outlive its prompt; `at` tells how old it is.
   */
  waits?: PermissionWait[];
}

export interface PermissionWait {
  at: number;
  toolName: string;
}

export interface ChatMessage {
  id: string;
  at: number;
  from: 'user' | 'manager';
  text: string;
}

/** A file Claude Code wrote in this session. `turn` = which user request it belongs to. */
export interface CreatedFile {
  /** The bridge's id for the file (the page never has the full path). */
  id: string;
  /** Display name: the last two parts of the path. */
  name: string;
  at: number;
  turn: number;
  agentId?: string;
}

export interface SessionState {
  id: string;
  source: DataSource;
  cwd?: string;
  /** The main agent's current permission mode, as last reported by a hook. Office never sets it. */
  permissionMode?: string;
  startedAt: number;
  endedAt?: number;
  /** SessionEnd's reason as Claude Code reported it (e.g. "prompt_input_exit" for /exit, "clear" for /clear). */
  endReason?: string;
  /** True when we saw the session's start; false when we joined mid-session. */
  sawStart: boolean;
  agents: Record<string, AgentState>;
  /** Subagent ids in order of appearance (desk order). */
  order: string[];
  chat: ChatMessage[];
  pendingRequests: { toolUseId: string; description: string; subagentType: string; childId?: string }[];
  /** Agent ids whose SubagentStart we saw. Stops without a start are internal agents and are ignored. */
  knownChildren: string[];
  /** Agent ids known only from their own tool events (no SubagentStart: e.g. web-fetch helpers). */
  unannounced: string[];
  /** A PermissionRequest hook was seen: permission waits come from those, not from the notice (which names no agent). */
  permissionHooks?: boolean;
  /**
   * tool_use_ids that already finished. Async hooks can arrive out of order, so a late PreToolUse
   * for a finished call must not put the agent back to "working".
   */
  finishedTools: string[];
  /** Number of user requests seen so far. */
  turn: number;
  /** Files written (Write), newest last, one entry per file. */
  files: CreatedFile[];
}

export interface OfficeState {
  sessions: Record<string, SessionState>;
  sessionOrder: string[];
}

export const MANAGER_ID = 'main';
