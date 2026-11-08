import {
  MANAGER_ID,
  type AgentState,
  type EvidenceLine,
  type OfficeEvent,
  type OfficeState,
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
    finishedTools: [],
  };
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
    const created = newAgent(ev.agentId, 'subagent', 'unknown', 'Subagent', ev.at);
    s = { ...s, order: [...s.order, ev.agentId], knownChildren: [...s.knownChildren, ev.agentId] };
    return created;
  };

  switch (ev.type) {
    case 'session.started': {
      setAgent(pushEvidence({ ...manager(), status: 'idle' }, ev, `Session started${ev.origin ? ` (${ev.origin})` : ''}`));
      return { ...s, agents, sawStart: true, cwd: ev.cwd ?? s.cwd, endedAt: undefined };
    }
    case 'session.ended': {
      setAgent(pushEvidence({ ...manager(), status: 'idle', activity: undefined }, ev, `Session ended${ev.reason ? ` (${ev.reason})` : ''}`));
      return { ...s, agents, endedAt: ev.at };
    }
    case 'user.prompt': {
      setAgent(pushEvidence({ ...manager(), status: 'working', activity: 'thinking', activityDetail: undefined }, ev, `User: ${preview(ev.text)}`));
      const chat = [...s.chat, { id: ev.id, at: ev.at, from: 'user' as const, text: ev.text }].slice(-MAX_CHAT);
      return { ...s, agents, chat };
    }
    case 'injected.prompt': {
      setAgent(pushEvidence({ ...manager(), status: 'working', activity: 'thinking' }, ev, `Received ${ev.kind}: ${ev.preview}`));
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
      setAgent(
        pushEvidence(
          { ...a, status: delegating ? 'delegating' : 'working', activity: ev.activity, activityDetail: ev.detail },
          ev,
          `> ${ev.toolName}${ev.detail ? ` ${ev.detail}` : ''}`,
        ),
      );
      return { ...s, agents };
    }
    case 'tool.finished': {
      const a = actor();
      if (!a) return s;
      const status = a.status === 'waiting_permission' || a.status === 'blocked' ? 'working' : a.status;
      // SubagentHandback finishing = the report was delivered to the main agent (documented hand-back path).
      const delivered = a.role === 'subagent' && ev.toolName === 'SubagentHandback';
      setAgent(pushEvidence({ ...a, status, failureStreak: 0, acknowledged: a.acknowledged || delivered }, ev, `  ${ev.toolName} done${ev.durationMs != null ? ` (${ev.durationMs} ms)` : ''}`, 'ok'));
      return { ...markFinished(s, ev.toolUseId), agents };
    }
    case 'tool.failed': {
      const a = actor();
      if (!a) return s;
      setAgent(
        pushEvidence(
          { ...a, status: ev.interrupted ? 'blocked' : 'working', failureStreak: a.failureStreak + 1 },
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
      setAgent(pushEvidence({ ...a, status: 'waiting_permission' }, ev, `Waiting for permission: ${ev.toolName} ${ev.detail}`.trim(), 'warn'));
      return { ...s, agents };
    }
    case 'notification': {
      const target = ev.agentId && agents[ev.agentId] ? agents[ev.agentId]! : manager();
      const someoneWaiting = Object.values(agents).some((x) => x.status === 'waiting_permission');
      let updated = target;
      if (ev.kind === 'permission_prompt' && !someoneWaiting) updated = { ...target, status: 'waiting_permission' };
      if (ev.kind === 'idle_prompt' && target.role === 'manager') updated = { ...target, status: 'idle', activity: undefined };
      setAgent(pushEvidence(updated, ev, `Notification (${ev.kind}): ${preview(ev.message)}`, ev.kind === 'permission_prompt' ? 'warn' : 'normal'));
      return { ...s, agents };
    }
    case 'subagent.requested': {
      setAgent(pushEvidence({ ...manager(), status: 'delegating', activity: 'other', activityDetail: ev.description }, ev, `Delegating "${ev.description}" (${ev.subagentType})`));
      return { ...s, agents, pendingRequests: [...s.pendingRequests, { toolUseId: ev.toolUseId, description: ev.description, subagentType: ev.subagentType }] };
    }
    case 'subagent.started': {
      if (agents[ev.childId]) return s;
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
        if (ev.finished) c = pushEvidence({ ...c, acknowledged: true }, ev, 'Manager received the result');
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
          { ...known, status: outcome === 'failure_estimated' ? 'failed' : 'completed', outcome, activity: 'reporting', activityDetail: undefined },
          ev,
          `Stopped — outcome: ${outcome}`,
          outcome === 'failure_estimated' ? 'error' : 'ok',
        ),
      );
      return { ...s, agents };
    }
    case 'turn.stopped': {
      setAgent(pushEvidence({ ...manager(), status: 'idle', activity: undefined, activityDetail: undefined }, ev, 'Turn finished'));
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
}

export function summarize(s: SessionState): SessionSummary {
  let active = 0;
  let completed = 0;
  let failed = 0;
  for (const id of s.order) {
    const a = s.agents[id];
    if (!a) continue;
    if (a.status === 'completed') completed++;
    else if (a.status === 'failed') failed++;
    else active++;
  }
  return { active, completed, failed };
}
