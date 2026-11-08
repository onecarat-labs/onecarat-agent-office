// Builds office-demo.json: a SCRIPTED replay in raw Claude Code hook-input shape.
// It is demo data only (session id starts with "demo-"); it never mixes with live events.
// Field shapes follow what Claude Code 2.1.319 actually sent (docs/event-support-matrix.md).
// Run: node examples/demo-events/build-office-demo.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const S = 'demo-session-0001';
const base = { session_id: S, cwd: 'C:\\demo\\dashboard-app', permission_mode: 'default' };
const ev = [];
const at = (ms, hook_event_name, extra = {}) => ev.push({ at: ms, hook: { ...base, hook_event_name, ...extra } });
const sub = (id, type) => ({ agent_id: id, agent_type: type });
let tu = 0;
const tool = (ms, durMs, agent, tool_name, tool_input, { fail, failMsg } = {}) => {
  const tool_use_id = `toolu_demo_${++tu}`;
  at(ms, 'PreToolUse', { ...agent, tool_name, tool_input, tool_use_id });
  if (fail) at(ms + durMs, 'PostToolUseFailure', { ...agent, tool_name, tool_input, tool_use_id, error: failMsg, is_interrupt: false, duration_ms: durMs });
  else at(ms + durMs, 'PostToolUse', { ...agent, tool_name, tool_input, tool_use_id, tool_response: {}, duration_ms: durMs });
  return tool_use_id;
};
const launch = (ms, id, type, description) => {
  const tool_use_id = `toolu_demo_${++tu}`;
  const tool_input = { description, prompt: '(demo)', subagent_type: type };
  at(ms, 'PreToolUse', { tool_name: 'Agent', tool_input, tool_use_id });
  at(ms + 300, 'SubagentStart', sub(id, type));
  at(ms + 400, 'PostToolUse', { tool_name: 'Agent', tool_input, tool_use_id, tool_response: { isAsync: true, status: 'async_launched', agentId: id } });
};
const report = (ms, id, type, message) => {
  at(ms, 'PreToolUse', { ...sub(id, type), tool_name: 'SubagentHandback', tool_input: { message }, tool_use_id: `toolu_demo_${++tu}` });
  at(ms + 400, 'SubagentStop', { ...sub(id, type), stop_hook_active: false, last_assistant_message: '' });
};
const delivered = (ms, id, text) => at(ms, 'UserPromptSubmit', { prompt: `<agent-message from="${id}">\n[Subagent hand-back] ${text}\n</agent-message>` });

const R = sub('demo-researcher', 'researcher');
const B = sub('demo-builder', 'builder');
const T = sub('demo-tester', 'tester');

at(0, 'SessionStart', { source: 'startup' });
at(1500, 'UserPromptSubmit', { prompt: 'Start the service and update the dashboard layout.' });
tool(2600, 700, {}, 'Read', { file_path: 'C:\\demo\\dashboard-app\\src\\Dashboard.tsx' });
launch(4000, 'demo-researcher', 'researcher', 'Research current layout');
launch(5000, 'demo-builder', 'builder', 'Update dashboard layout');
launch(6000, 'demo-tester', 'tester', 'Run checks');
at(7200, 'Stop', { stop_hook_active: false, last_assistant_message: 'I delegated research, implementation, and testing. I will report back when they finish.' });

// Researcher: reads, succeeds.
tool(9000, 1800, R, 'Glob', { pattern: 'src/**/*.tsx' });
tool(11200, 1500, R, 'Read', { file_path: 'C:\\demo\\dashboard-app\\src\\Dashboard.tsx' });
tool(13000, 1800, R, 'Grep', { pattern: 'grid-template' });
report(15500, 'demo-researcher', 'researcher', 'Dashboard uses a 3-column grid; the sidebar width is hard-coded.');
delivered(16400, 'demo-researcher', 'Dashboard uses a 3-column grid; the sidebar width is hard-coded.');

// Builder: edits, needs permission once (the user answers it in Claude Code, not in Office), succeeds.
tool(9500, 1600, B, 'Read', { file_path: 'C:\\demo\\dashboard-app\\src\\Dashboard.tsx' });
tool(11800, 2400, B, 'Edit', { file_path: 'C:\\demo\\dashboard-app\\src\\Dashboard.tsx', old_string: '(demo)', new_string: '(demo)' });
tool(14800, 2000, B, 'Edit', { file_path: 'C:\\demo\\dashboard-app\\src\\layout.css', old_string: '(demo)', new_string: '(demo)' });
{
  const tool_use_id = `toolu_demo_${++tu}`;
  const tool_input = { command: 'npm run dev -- --port 5180' };
  at(17500, 'PreToolUse', { ...B, tool_name: 'Bash', tool_input, tool_use_id });
  at(17600, 'PermissionRequest', { ...B, tool_name: 'Bash', tool_input });
  at(17700, 'Notification', { notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' });
  at(23500, 'PostToolUse', { ...B, tool_name: 'Bash', tool_input, tool_use_id, tool_response: {}, duration_ms: 1200 });
}
report(25500, 'demo-builder', 'builder', 'Layout updated: sidebar is now resizable; dev server running on :5180.');
delivered(26400, 'demo-builder', 'Layout updated: sidebar is now resizable; dev server running on :5180.');

// Tester: runs tests, fails, retries, fails again -> stops without a report (estimated failure, no high-five).
tool(12500, 3000, T, 'Bash', { command: 'npm test' }, { fail: true, failMsg: 'Exit code 1\n1 failing: Dashboard renders sidebar (expected 240px, got 200px)' });
tool(16500, 1200, T, 'Read', { file_path: 'C:\\demo\\dashboard-app\\src\\Dashboard.test.tsx' });
tool(19000, 3500, T, 'Bash', { command: 'npm test -- Dashboard' }, { fail: true, failMsg: 'Exit code 1\n1 failing: Dashboard renders sidebar (expected 240px, got 200px)' });
at(28000, 'SubagentStop', { ...T, stop_hook_active: false, last_assistant_message: '' });
delivered(28600, 'demo-tester', 'Stopped: 1 test still failing (sidebar width).');

at(31000, 'Stop', {
  stop_hook_active: false,
  last_assistant_message: 'Layout is updated and the dev server is running. One test still fails (sidebar width 200px vs 240px) — should I update the test or the layout?',
});

ev.sort((a, b) => a.at - b.at);
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), 'office-demo.json');
fs.writeFileSync(out, JSON.stringify({ name: 'office-demo', note: 'Scripted demo replay. Not a real session.', durationMs: 36000, events: ev }, null, 1));
console.log('wrote', out, ev.length, 'events');
