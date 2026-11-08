// Environment for processes Office starts (the bridge, the embedded `claude`).
// When Office is started from a Claude Code session (the skill), it inherits that session's own markers and
// private channels (session id, messaging socket + token, entrypoint…). Those must not leak into a new,
// independent `claude`, or it would think it is a child of the old session. The user's own configuration
// (CLAUDE_CONFIG_DIR, CLAUDE_CODE_USE_BEDROCK, ANTHROPIC_* …) is kept untouched: Office never reads it.

const DROP_EXACT = new Set(['CLAUDECODE', 'AI_AGENT', 'CLAUDE_PID', 'CLAUDE_EFFORT', 'CLAUDE_PROJECT_DIR', 'CLAUDE_ENV_FILE']);
const DROP_PREFIX = [
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION',
  'CLAUDE_CODE_MESSAGING_',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_CODE_SSE_PORT',
  'CLAUDE_PLUGIN_',
];

export function isSessionMarker(name: string): boolean {
  const k = name.toUpperCase();
  return DROP_EXACT.has(k) || DROP_PREFIX.some((p) => k.startsWith(p));
}

export function childEnv(env: NodeJS.ProcessEnv = process.env, extra: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined || isSessionMarker(k)) continue;
    // Claude Code sets GIT_EDITOR=true for its own tool calls; an interactive session should get the user's editor.
    if (k.toUpperCase() === 'GIT_EDITOR' && v === 'true') continue;
    out[k] = v;
  }
  return { ...out, ...extra };
}
