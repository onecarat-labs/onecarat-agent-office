// Shared logic of the hook forwarder (kept dependency-free and fast to load).
import os from 'node:os';
import path from 'node:path';

/** KEEP IN SYNC with packages/event-bridge/src/runtime-file.ts (runtimeDir). */
export function runtimeFilePath(env = process.env, platform = process.platform) {
  let dir = env.ONECARAT_OFFICE_RUNTIME_DIR;
  if (!dir) {
    const home = os.homedir();
    if (platform === 'win32') dir = path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'onecarat-agent-office');
    else if (platform === 'darwin') dir = path.join(home, 'Library', 'Application Support', 'onecarat-agent-office');
    else dir = path.join(env.XDG_STATE_HOME || path.join(home, '.local', 'state'), 'onecarat-agent-office');
  }
  return path.join(dir, 'bridge.json');
}

const clip = (v, n) => (typeof v === 'string' ? (v.length > n ? v.slice(0, n) : v) : undefined);

const TOP = {
  hook_event_name: 100, session_id: 200, cwd: 1000, agent_id: 200, agent_type: 200, source: 50, reason: 50,
  prompt: 4000, tool_name: 200, tool_use_id: 200, error: 600, notification_type: 100, message: 600,
  last_assistant_message: 4000, permission_mode: 50,
};
// tool_input fields the adapter reads. File CONTENTS (content, old_string, new_string, edits ...) are never forwarded.
const TOOL_INPUT = { file_path: 1000, path: 1000, notebook_path: 1000, pattern: 300, command: 600, url: 1000, query: 300, description: 300, subagent_type: 200, message: 4000 };

/**
 * Data minimization at the source: keep only what Office displays, clipped.
 * Everything else in the hook input (transcript paths, tool outputs, file contents) is dropped here.
 */
export function pickHookFields(input) {
  if (!input || typeof input !== 'object') return null;
  const out = {};
  for (const [k, n] of Object.entries(TOP)) {
    const v = clip(input[k], n);
    if (v !== undefined) out[k] = v;
  }
  if (typeof input.duration_ms === 'number') out.duration_ms = input.duration_ms;
  if (typeof input.is_interrupt === 'boolean') out.is_interrupt = input.is_interrupt;
  if (input.tool_input && typeof input.tool_input === 'object') {
    const ti = {};
    for (const [k, n] of Object.entries(TOOL_INPUT)) {
      const v = clip(input.tool_input[k], n);
      if (v !== undefined) ti[k] = v;
    }
    out.tool_input = ti;
  }
  // Only the Agent/Task result tells us which agent id a request became.
  if ((input.tool_name === 'Agent' || input.tool_name === 'Task') && input.tool_response && typeof input.tool_response === 'object') {
    const r = input.tool_response;
    out.tool_response = { agentId: clip(r.agentId, 200), isAsync: r.isAsync === true, status: clip(r.status, 50) };
  }
  return out;
}
