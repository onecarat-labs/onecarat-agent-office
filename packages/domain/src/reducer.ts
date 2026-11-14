import {
  MANAGER_ID,
  type AgentState,
  type CreatedFile,
  type EvidenceLine,
  type OfficeEvent,
  type OfficeState,
  type PermissionWait,
  type SessionState,
} from './types.ts';

const MAX_EVIDENCE = 300;
const MAX_CHAT = 200;

export const initialOfficeState: OfficeState = { sessions: {}, sessionOrder: [] };

function newAgent(id: string, role: AgentState['role'], agentType: string, label: string, at: number): AgentState {
  return {
    id,
    role,
    agentType,
    label,
    status: role === 'manager' ? 'idle' : 'created',
    progress: { kind: 'unavailable' },
    failureStreak: 0,
    reported: false,
    acknowledged: false,
    createdAt: at,
    updatedAt: at,
    evidence: [],
  };
}

function newSession(ev: OfficeEvent): SessionState {
  return {
    id: ev.sessionId,
    source: ev.source,
    startedAt: ev.at,
    sawStart: false,
    agents: { [MANAGER_ID]: newAgent(MANAGER_ID, 'manager', 'main', 'Manager', ev.at) },
    order: [],
    chat: [],
    pendingRequests: [],
    knownChildren: [],
    unannounced: [],
    finishedTools: [],
    turn: 0,
    files: [],
  };
}

const MAX_FILES = 100;
/** A request that wrote more files than this built a program, not a document: its files are not listed. */
export const DELIVERABLES_PER_TURN = 5;
const MAX_DELIVERABLES = 8;

/**
 * Files worth a "open folder" link: those of requests that wrote only a few files (a document, a report).
 * Requests that wrote many (a whole program) are left out. Newest last.
 */
export function deliverables(s: SessionState): CreatedFile[] {
  const perTurn = new Map<number, number>();
  for (const f of s.files) perTurn.set(f.turn, (perTurn.get(f.turn) ?? 0) + 1);
  return s.files.filter((f) => (perTurn.get(f.turn) ?? 0) <= DELIVERABLES_PER_TURN).slice(-MAX_DELIVERABLES);
}

const MAX_FINISHED = 200;
function markFinished(s: SessionState, toolUseId: string | undefined): SessionState {
  if (!toolUseId) return s;
  const list = s.finishedTools.length >= MAX_FINISHED ? s.finishedTools.slice(1) : s.finishedTools;
  return { ...s, finishedTools: [...list, toolUseId] };
}

function pushEvidence(agent: AgentState, ev: OfficeEvent, text: string, tone: EvidenceLine['tone'] = 'normal'): AgentState {
  const line: EvidenceLine = { eventId: ev.id, at: ev.at, type: ev.type, text, tone };
  const evidence = agent.evidence.length >= MAX_EVIDENCE ? [...agent.evidence.slice(1), line] : [...agent.evidence, line];
  return { ...agent, evidence, updatedAt: ev.at };
}

const MAX_WAITS = 20;
/**
 * A refused permission request sends no hook. An agent that starts another call this long after a request has
 * left that prompt behind (calls asked together arrive within about a second of each other).
 */
const ANSWERED_AFTER_MS = 3000;

/** The agent with this list of open permission requests (the field is absent when there are none). */
function withWaits(a: AgentState, waits: PermissionWait[]): AgentState {
  const { waits: _old, ...rest } = a;
  return waits.length ? { ...rest, waits } : rest;
}

/** One call of this tool ended: its request (the oldest of that tool) is answered. */
function answered(a: AgentState, toolName: string): AgentState {
  const waits = a.waits ?? [];
  const i = waits.findIndex((w) => w.toolName === toolName);
  return i < 0 ? a : withWaits(a, [...waits.slice(0, i), ...waits.slice(i + 1)]);
}

function preview(s: string, n = 120): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > n ? one.slice(0, n) + '…' : one;
}

/** Pure reducer: (state, normalized event) -> state. Never invents agents or progress. */
export function reduceOffice(state: OfficeState, ev: OfficeEvent): OfficeState {
  const prev = state.sessions[ev.sessionId];
  let session = prev ?? newSession(ev);
  if (!session.cwd && ev.cwd) session = { ...session, cwd: ev.cwd };
  // Only the main agent's mode describes the session (a subagent may run in its own mode).
  if (!ev.agentId && ev.permissionMode && ev.permissionMode !== session.permissionMode) session = { ...session, permissionMode: ev.permissionMode };
  const next = reduceSession(session, ev);
  if (next === prev) return state;
  return {
    sessions: { ...state.sessions, [ev.sessionId]: next },
    sessionOrder: prev ? state.sessionOrder : [...state.sessionOrder, ev.sessionId],
  };
}

function reduceSession(s: SessionState, ev: OfficeEvent): SessionState {
  const agents = { ...s.agents };
  const setAgent = (a: AgentState) => {
    agents[a.id] = a;
  };
  const manager = () => agents[MANAGER_ID]!;
  /** The acting agent. A tool event carrying an unknown agent id is real evidence of a subagent (we joined late). */
  const actor = (): AgentState | undefined => {
    if (!ev.agentId) return manager();
    const found = agents[ev.agentId];
    if (found) return found;
    const created = newAgent(ev.agentId, 'subagent', ev.agentType || 'unknown', ev.agentType || 'Subagent', ev.at);
    s = { ...s, order: [...s.order, ev.agentId], knownChildren: [...s.knownChildren, ev.agentId], unannounced: [...s.unannounced, ev.agentId] };
    return created;
  };

  switch (ev.type) {
    case 'session.started': {
      setAgent(pushEvidence({ ...manager(), status: 'idle' }, ev, `Session started${ev.origin ? ` (${ev.origin})` : ''}`));
      return { ...s, agents, sawStart: true, cwd: ev.cwd ?? s.cwd, endedAt: undefined, endReason: undefined };
    }
    case 'session.ended': {
      setAgent(pushEvidence({ ...withWaits(manager(), []), status: 'idle', activity: undefined }, ev, `Session ended${ev.reason ? ` (${ev.reason})` : ''}`));
      return { ...s, agents, endedAt: ev.at, endReason: ev.reason };
    }
    case 'user.prompt': {
      setAgent(pushEvidence({ ...withWaits(manager(), []), status: 'working', activity: 'thinking', activityDetail: undefined }, ev, `User: ${preview(ev.text)}`));
      const chat = [...s.chat, { id: ev.id, at: ev.at, from: 'user' as const, text: ev.text }].slice(-MAX_CHAT);
      return { ...s, agents, chat, turn: s.turn + 1 };
    }
    case 'file.created': {
      // Written again = the same file, moved to the newest place.
      const id = ev.fileId ?? ev.path ?? ev.name;
      const files = [...s.files.filter((f) => f.id !== id), { id, name: ev.name, at: ev.at, turn: s.turn, agentId: ev.agentId }].slice(-MAX_FILES);
      return { ...s, files };
    }
    case 'injected.prompt': {
      setAgent(pushEvidence({ ...withWaits(manager(), []), status: 'working', activity: 'thinking' }, ev, `Received ${ev.kind}: ${ev.preview}`));
      if (ev.fromAgentId && agents[ev.fromAgentId]) {
        const child = agents[ev.fromAgentId]!;
        setAgent(pushEvidence({ ...child, acknowledged: true }, ev, 'Manager received the report'));
      }
      return { ...s, agents };
    }
    case 'tool.started': {
      const a = actor();
      if (!a) return s;
      if (ev.toolUseId && s.finishedTools.includes(ev.toolUseId)) {
        // Arrived after its own PostToolUse: keep it as evidence only.
        setAgent(pushEvidence(a, ev, `> ${ev.toolName}${ev.detail ? ` ${ev.detail}` : ''} (late)`));
        return { ...s, agents };
      }
      const delegating = a.role === 'manager' && (ev.toolName === 'Agent' || ev.toolName === 'Task');
      // It goes on with another call: its older requests were answered (or refused) before that. Requests asked
      // together with this call stay open, and so does the wait.
      const b = withWaits(a, (a.waits ?? []).filter((w) => w.at >= ev.at - ANSWERED_AFTER_MS));
      setAgent(
        pushEvidence(
          { ...b, status: b.waits ? 'waiting_permission' : delegating ? 'delegating' : 'working', activity: ev.activity, activityDetail: ev.detail },
          ev,
          `> ${ev.toolName}${ev.detail ? ` ${ev.detail}` : ''}`,
        ),
      );
      return { ...s, agents };
    }
    case 'tool.finished': {
      const a0 = actor();
      if (!a0) return s;
      const a = answered(a0, ev.toolName);
      // Another request of this agent is still open (several can queue up): it keeps waiting.
      const status = a.waits ? 'waiting_permission' : a.status === 'waiting_permission' || a.status === 'blocked' ? 'working' : a.status;
      // SubagentHandback finishing = the report was delivered to the main agent (documented hand-back path).
      const delivered = a.role === 'subagent' && ev.toolName === 'SubagentHandback';
      setAgent(pushEvidence({ ...a, status, failureStreak: 0, acknowledged: a.acknowledged || delivered }, ev, `  ${ev.toolName} done${ev.durationMs != null ? ` (${ev.durationMs} ms)` : ''}`, 'ok'));
      return { ...markFinished(s, ev.toolUseId), agents };
    }
    case 'tool.failed': {
      const a0 = actor();
      if (!a0) return s;
      const a = answered(a0, ev.toolName);
      setAgent(
        pushEvidence(
          { ...a, status: a.waits ? 'waiting_permission' : ev.interrupted ? 'blocked' : 'working', failureStreak: a.failureStreak + 1 },
          ev,
          `  ${ev.toolName} ${ev.interrupted ? 'interrupted' : 'failed'}: ${preview(ev.error)}`,
          'error',
        ),
      );
      return { ...markFinished(s, ev.toolUseId), agents };
    }
    case 'permission.requested': {
      const a = actor();
      if (!a) return s;
      const waits = [...(a.waits ?? []), { at: ev.at, toolName: ev.toolName }].slice(-MAX_WAITS);
      setAgent(pushEvidence({ ...withWaits(a, waits), status: 'waiting_permission' }, ev, `Waiting for permission: ${ev.toolName} ${ev.detail}`.trim(), 'warn'));
      return { ...s, agents, permissionHooks: true };
    }
    case 'wait.dismissed': {
      const a = ev.agentId ? agents[ev.agentId] : manager();
      if (!a || (!a.waits && a.status !== 'waiting_permission')) return s;
      // Neither "allowed" nor "refused": Office does not know. The agent is shown as it is without the wait
      // (the manager at its desk, a subagent still at work); the next event says more.
      setAgent(pushEvidence({ ...withWaits(a, []), status: a.role === 'manager' ? 'idle' : 'working', activity: undefined, activityDetail: undefined }, ev, 'The user hid the permission wait'));
      return { ...s, agents };
    }
    case 'notification': {
      const target = ev.agentId && agents[ev.agentId] ? agents[ev.agentId]! : manager();
      const someoneWaiting = Object.values(agents).some((x) => x.status === 'waiting_permission');
      let updated = target;
      // "Claude needs your permission" names no agent and arrives seconds after the prompt, possibly after it was
      // answered. Where PermissionRequest hooks arrive, they alone say who waits; the notice is only a fallback.
      if (ev.kind === 'permission_prompt' && !someoneWaiting && !s.permissionHooks) updated = { ...target, status: 'waiting_permission' };
      if (ev.kind === 'idle_prompt' && target.role === 'manager') updated = { ...withWaits(target, []), status: 'idle', activity: undefined };
      setAgent(pushEvidence(updated, ev, `Notification (${ev.kind}): ${preview(ev.message)}`, ev.kind === 'permission_prompt' ? 'warn' : 'normal'));
      return { ...s, agents };
    }
    case 'subagent.requested': {
      setAgent(pushEvidence({ ...manager(), status: 'delegating', activity: 'other', activityDetail: ev.description }, ev, `Delegating "${ev.description}" (${ev.subagentType})`));
      return { ...s, agents, pendingRequests: [...s.pendingRequests, { toolUseId: ev.toolUseId, description: ev.description, subagentType: ev.subagentType }] };
    }
    case 'subagent.started': {
      const seen = agents[ev.childId];
      if (seen) {
        // Its own tool events arrived first (async hooks): now it is announced, and its type is known.
        if (!s.unannounced.includes(ev.childId)) return s;
        setAgent(pushEvidence({ ...seen, agentType: ev.agentType || seen.agentType, label: seen.label === 'Subagent' && ev.agentType ? ev.agentType : seen.label }, ev, `Started (${ev.agentType})`));
        return { ...s, agents, unannounced: s.unannounced.filter((x) => x !== ev.childId) };
      }
      const pending = [...s.pendingRequests];
      let idx = pending.findIndex((p) => !p.childId && p.subagentType === ev.agentType);
      if (idx < 0) idx = pending.findIndex((p) => !p.childId);
      let task: string | undefined;
      if (idx >= 0) {
        task = pending[idx]!.description;
        pending[idx] = { ...pending[idx]!, childId: ev.childId };
      }
      const child = pushEvidence({ ...newAgent(ev.childId, 'subagent', ev.agentType, ev.agentType || 'Subagent', ev.at), task }, ev, `Started (${ev.agentType})`);
      setAgent(child);
      return { ...s, agents, order: [...s.order, ev.childId], knownChildren: [...s.knownChildren, ev.childId], pendingRequests: pending };
    }
    case 'subagent.linked': {
      const pending = s.pendingRequests.map((p) => (p.toolUseId === ev.toolUseId ? { ...p, childId: ev.childId } : p));
      const req = pending.find((p) => p.toolUseId === ev.toolUseId);
      const child = agents[ev.childId];
      if (child) {
        let c = child;
        if (req && c.task !== req.description) c = { ...c, task: req.description };
        if (ev.finished && c.role === 'subagent') {
          // The Agent call returned with the result (not a background launch): this agent has ended. That is
          // the only end such helpers (e.g. web-fetch) ever report; they send no SubagentStop.
          const outcome = c.failureStreak > 0 && !c.reported ? 'failure_estimated' : 'success_estimated';
          c = pushEvidence(
            { ...withWaits(c, []), acknowledged: true, status: outcome === 'failure_estimated' ? 'failed' : 'completed', outcome, activity: 'reporting', activityDetail: undefined },
            ev,
            `${ev.agentId ? 'Caller' : 'Manager'} received the result — outcome: ${outcome}`,
            outcome === 'failure_estimated' ? 'error' : 'ok',
          );
        }
        setAgent(c);
      }
      return { ...s, agents, pendingRequests: ev.finished ? pending.filter((p) => p.toolUseId !== ev.toolUseId) : pending };
    }
    case 'subagent.reported': {
      const a = actor();
      if (!a || a.role !== 'subagent') return s;
      setAgent(pushEvidence({ ...a, reported: true, activity: 'reporting', activityDetail: undefined }, ev, `Report: ${preview(ev.message)}`, 'ok'));
      return { ...s, agents };
    }
    case 'subagent.stopped': {
      const known = agents[ev.childId];
      // A stop without a start is an internal agent (prompt suggestions, /btw). Ignore it.
      if (!known || known.role !== 'subagent') return s;
      const outcome =
        known.failureStreak > 0 && !known.reported ? 'failure_estimated' : known.reported || ev.lastMessage ? 'success_estimated' : 'unknown';
      setAgent(
        pushEvidence(
          { ...withWaits(known, []), status: outcome === 'failure_estimated' ? 'failed' : 'completed', outcome, activity: 'reporting', activityDetail: undefined },
          ev,
          `Stopped — outcome: ${outcome}`,
          outcome === 'failure_estimated' ? 'error' : 'ok',
        ),
      );
      return { ...s, agents };
    }
    case 'turn.stopped': {
      setAgent(pushEvidence({ ...withWaits(manager(), []), status: 'idle', activity: undefined, activityDetail: undefined }, ev, 'Turn finished'));
      // The main turn ended and Claude Code reports nothing running in the background: an agent known only from
      // its own tool events, whose end never arrived, cannot still be working. Its end is "not confirmed"
      // (never "completed": there is no evidence of that). Announced agents (SubagentStart) are never touched here.
      if (ev.backgroundTasks && !ev.backgroundTasks.some((t) => t.status === 'running')) {
        for (const id of s.unannounced) {
          const a = agents[id];
          if (a && a.role === 'subagent' && a.status !== 'completed' && a.status !== 'failed' && a.status !== 'unknown') {
            setAgent(pushEvidence({ ...a, status: 'unknown', outcome: 'unknown', activity: undefined, activityDetail: undefined }, ev, 'End not confirmed (no end event arrived)', 'warn'));
          }
        }
      }
      const chat = ev.lastMessage
        ? [...s.chat, { id: ev.id, at: ev.at, from: 'manager' as const, text: ev.lastMessage }].slice(-MAX_CHAT)
        : s.chat;
      return { ...s, agents, chat };
    }
  }
}

export interface SessionSummary {
  active: number;
  completed: number;
  failed: number;
  /** Ended without any end event: neither working nor known to have finished. */
  unconfirmed: number;
}

export function summarize(s: SessionState): SessionSummary {
  let active = 0;
  let completed = 0;
  let failed = 0;
  let unconfirmed = 0;
  for (const id of s.order) {
    const a = s.agents[id];
    if (!a) continue;
    if (a.status === 'completed') completed++;
    else if (a.status === 'failed') failed++;
    else if (a.status === 'unknown') unconfirmed++;
    else active++;
  }
  return { active, completed, failed, unconfirmed };
}
