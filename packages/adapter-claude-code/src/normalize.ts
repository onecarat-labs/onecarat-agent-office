// Claude Code hook input (the JSON a command/http hook receives) -> normalized Office events.
// Field names verified on Claude Code 2.1.319 (docs/event-support-matrix.md).
import type { Activity, DataSource, OfficeEvent, OfficeEventBody } from '@onecarat/domain';
import { clip, displayPath, maskSecrets } from './mask.ts';

/** The subset of hook input fields we read. Everything else is ignored (and never stored). */
export interface HookInput {
  hook_event_name?: string;
  session_id?: string;
  cwd?: string;
  permission_mode?: string;
  agent_id?: string;
  agent_type?: string;
  source?: string;
  reason?: string;
  prompt?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: unknown;
  tool_use_id?: string;
  duration_ms?: number;
  error?: string;
  is_interrupt?: boolean;
  notification_type?: string;
  message?: string;
  last_assistant_message?: string;
  [k: string]: unknown;
}

export interface NormalizeContext {
  source: DataSource;
  /** Receive time (ms). Hooks carry no timestamp of their own. */
  at: number;
  /** Unique per received hook; used to build event ids. */
  seq: number;
}

const READ_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS', 'NotebookRead', 'LSP']);
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);
const WEB_TOOLS = new Set(['WebFetch', 'WebSearch']);
const REPORT_TOOLS = new Set(['SubagentHandback', 'SendMessage']);
const TEST_CMD = /(^|[\s;&|(])(npm|pnpm|yarn|bun)\s+(run\s+)?(test|lint|typecheck|check)\b|\b(jest|vitest|pytest|mocha|playwright|cargo\s+test|go\s+test|dotnet\s+test|tsc|eslint|ruff|mypy)\b|node\s+--test\b/i;

export function classifyTool(toolName: string, input: Record<string, unknown> | undefined): { activity: Activity; detail: string } {
  const i = input ?? {};
  if (READ_TOOLS.has(toolName)) {
    const target = displayPath(i.file_path ?? i.path) || (typeof i.pattern === 'string' ? clip(maskSecrets(i.pattern), 60) : '');
    return { activity: 'reading', detail: target };
  }
  if (EDIT_TOOLS.has(toolName)) return { activity: 'editing', detail: displayPath(i.file_path ?? i.notebook_path) };
  if (SHELL_TOOLS.has(toolName)) {
    const cmd = typeof i.command === 'string' ? i.command : '';
    return { activity: TEST_CMD.test(cmd) ? 'testing' : 'executing', detail: clip(maskSecrets(cmd), 80) };
  }
  if (WEB_TOOLS.has(toolName)) {
    const target = typeof i.url === 'string' ? safeHost(i.url) : typeof i.query === 'string' ? clip(maskSecrets(i.query), 60) : '';
    return { activity: 'researching', detail: target };
  }
  if (REPORT_TOOLS.has(toolName)) return { activity: 'reporting', detail: '' };
  if (toolName === 'Agent' || toolName === 'Task') return { activity: 'other', detail: clip(String(i.description ?? ''), 60) };
  // Desktop app's own turn bookkeeping (update_plan, wrap_up): planning, not running a command.
  if (toolName.startsWith('mcp__ccd_turn__')) return { activity: 'thinking', detail: '' };
  if (toolName.startsWith('mcp__')) return { activity: 'other', detail: toolName.split('__').slice(1).join(' / ') };
  return { activity: 'other', detail: '' };
}

function safeHost(u: string): string {
  try {
    return new URL(u).host;
  } catch {
    return '';
  }
}

/** Turns Claude Code started itself arrive as UserPromptSubmit (documented). Detect the wrappers we have seen. */
export function classifyPrompt(text: string): { injected: false } | { injected: true; kind: string; fromAgentId?: string } {
  const t = text.trimStart();
  const m = /^<([a-z][a-z0-9-]*)\b([^>]*)>/i.exec(t);
  if (!m) return { injected: false };
  const tag = m[1]!.toLowerCase();
  if (!['agent-message', 'task-notification', 'system-reminder', 'scheduled-task', 'channel-message', 'session-message'].includes(tag)) {
    return { injected: false };
  }
  // agent-message carries from="<agent id>"; a background subagent's task-notification carries <task-id><agent id></task-id>.
  const from = /\bfrom="([^"]+)"/.exec(m[2] ?? '')?.[1] ?? (tag === 'task-notification' ? /<task-id>\s*([^<\s]+)\s*<\/task-id>/.exec(t)?.[1] : undefined);
  return { injected: true, kind: tag, fromAgentId: from };
}

export function normalizeHook(input: HookInput, ctx: NormalizeContext): OfficeEvent[] {
  const sessionId = typeof input.session_id === 'string' ? input.session_id : undefined;
  const name = input.hook_event_name;
  if (!sessionId || !name) return [];
  const agentId = typeof input.agent_id === 'string' && input.agent_id ? input.agent_id : undefined;
  const out: OfficeEvent[] = [];
  const emit = (body: OfficeEventBody, actor: string | undefined = agentId) => {
    out.push({ id: `${ctx.seq}.${out.length}`, at: ctx.at, sessionId, source: ctx.source, agentId: actor, cwd: typeof input.cwd === 'string' ? input.cwd : undefined, permissionMode: typeof input.permission_mode === 'string' ? input.permission_mode : undefined, ...body } as OfficeEvent);
  };
  const toolName = String(input.tool_name ?? '');
  const toolUseId = String(input.tool_use_id ?? '');

  switch (name) {
    case 'SessionStart':
      emit({ type: 'session.started', cwd: input.cwd, origin: input.source }, undefined);
      break;
    case 'SessionEnd':
      emit({ type: 'session.ended', reason: input.reason }, undefined);
      break;
    case 'UserPromptSubmit': {
      const text = typeof input.prompt === 'string' ? input.prompt : '';
      const c = classifyPrompt(text);
      if (c.injected) emit({ type: 'injected.prompt', kind: c.kind, fromAgentId: c.fromAgentId, preview: clip(maskSecrets(text.replace(/<[^>]+>/g, ' ')), 100) }, undefined);
      else emit({ type: 'user.prompt', text }, undefined);
      break;
    }
    case 'PreToolUse': {
      if (!agentId && (toolName === 'Agent' || toolName === 'Task')) {
        const ti = input.tool_input ?? {};
        emit({ type: 'subagent.requested', toolUseId, description: clip(String(ti.description ?? ''), 80), subagentType: String(ti.subagent_type ?? 'general-purpose') });
      }
      if (agentId && toolName === 'SubagentHandback') {
        const msg = input.tool_input?.message;
        emit({ type: 'subagent.reported', message: typeof msg === 'string' ? msg : '' });
      }
      const { activity, detail } = classifyTool(toolName, input.tool_input);
      emit({ type: 'tool.started', toolUseId, toolName, activity, detail });
      break;
    }
    case 'PostToolUse': {
      emit({ type: 'tool.finished', toolUseId, toolName, durationMs: typeof input.duration_ms === 'number' ? input.duration_ms : undefined });
      if (!agentId && (toolName === 'Agent' || toolName === 'Task')) {
        const r = input.tool_response as Record<string, unknown> | undefined;
        const childId = typeof r?.agentId === 'string' ? r.agentId : undefined;
        if (childId) emit({ type: 'subagent.linked', toolUseId, childId, finished: r?.isAsync !== true });
      }
      break;
    }
    case 'PostToolUseFailure':
      emit({ type: 'tool.failed', toolUseId: toolUseId || undefined, toolName, error: clip(maskSecrets(String(input.error ?? '')), 160), interrupted: input.is_interrupt === true });
      break;
    case 'PermissionRequest': {
      const { detail } = classifyTool(toolName, input.tool_input);
      emit({ type: 'permission.requested', toolName, detail });
      break;
    }
    case 'Notification':
      emit({ type: 'notification', kind: String(input.notification_type ?? 'unknown'), message: clip(maskSecrets(String(input.message ?? '')), 120) });
      break;
    case 'SubagentStart':
      if (agentId) emit({ type: 'subagent.started', childId: agentId, agentType: String(input.agent_type ?? '') }, undefined);
      break;
    case 'SubagentStop':
      if (agentId) {
        const last = typeof input.last_assistant_message === 'string' && input.last_assistant_message ? input.last_assistant_message : undefined;
        emit({ type: 'subagent.stopped', childId: agentId, agentType: String(input.agent_type ?? ''), lastMessage: last }, undefined);
      }
      break;
    case 'Stop': {
      const last = typeof input.last_assistant_message === 'string' && input.last_assistant_message ? input.last_assistant_message : undefined;
      emit({ type: 'turn.stopped', lastMessage: last }, undefined);
      break;
    }
    default:
      break;
  }
  return out;
}
