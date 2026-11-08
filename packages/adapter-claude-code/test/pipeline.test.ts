import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { initialOfficeState, reduceOffice, expressionOf, summarize, type OfficeState } from '@onecarat/domain';
import { normalizeHook, maskSecrets, classifyPrompt, classifyTool, displayPath, type HookInput } from '../src/index.ts';

let seq = 0;
function feed(state: OfficeState, hook: HookInput, at = Date.now(), source: 'live' | 'demo' = 'live'): OfficeState {
  for (const e of normalizeHook(hook, { source, at, seq: ++seq })) state = reduceOffice(state, e);
  return state;
}

const demo = JSON.parse(fs.readFileSync(new URL('../../../examples/demo-events/office-demo.json', import.meta.url), 'utf8')) as {
  events: { at: number; hook: HookInput }[];
};

test('demo replay: success, permission wait, estimated failure', () => {
  let s = initialOfficeState;
  let sawPermissionWait = false;
  for (const { at, hook } of demo.events) {
    s = feed(s, hook, at, 'demo');
    const b = s.sessions['demo-session-0001']?.agents['demo-builder'];
    if (b?.status === 'waiting_permission') sawPermissionWait = true;
  }
  const sess = s.sessions['demo-session-0001']!;
  assert.equal(sess.source, 'demo');
  assert.deepEqual(sess.order, ['demo-researcher', 'demo-builder', 'demo-tester']);
  assert.equal(sess.agents['demo-researcher']!.outcome, 'success_estimated');
  assert.equal(sess.agents['demo-researcher']!.acknowledged, true);
  assert.equal(sess.agents['demo-researcher']!.task, 'Research current layout');
  assert.equal(sess.agents['demo-builder']!.status, 'completed');
  assert.equal(sess.agents['demo-tester']!.status, 'failed');
  assert.equal(sess.agents['demo-tester']!.outcome, 'failure_estimated');
  assert.ok(sawPermissionWait, 'builder should wait for permission');
  // Injected turns (subagent reports) are not user chat messages.
  assert.deepEqual(sess.chat.map((m) => m.from), ['user', 'manager', 'manager']);
  assert.deepEqual(summarize(sess), { active: 0, completed: 2, failed: 1 });
});

test('no subagent appears without real evidence; internal SubagentStop is ignored', () => {
  let s = initialOfficeState;
  s = feed(s, { hook_event_name: 'UserPromptSubmit', session_id: 's1', prompt: 'hello' });
  s = feed(s, { hook_event_name: 'PreToolUse', session_id: 's1', tool_name: 'Read', tool_input: { file_path: 'a.ts' }, tool_use_id: 't1' });
  s = feed(s, { hook_event_name: 'SubagentStop', session_id: 's1', agent_id: 'internal1', agent_type: '' });
  s = feed(s, { hook_event_name: 'Stop', session_id: 's1', last_assistant_message: 'done' });
  assert.deepEqual(s.sessions['s1']!.order, []);
  assert.deepEqual(Object.keys(s.sessions['s1']!.agents), ['main']);
});

test('tool event from an unseen agent id (joined mid-session) creates that agent', () => {
  let s = initialOfficeState;
  s = feed(s, { hook_event_name: 'PreToolUse', session_id: 's2', agent_id: 'a1', agent_type: 'Explore', tool_name: 'Grep', tool_input: { pattern: 'x' }, tool_use_id: 't' });
  assert.deepEqual(s.sessions['s2']!.order, ['a1']);
});

test('sessions do not mix', () => {
  let s = initialOfficeState;
  s = feed(s, { hook_event_name: 'SubagentStart', session_id: 'A', agent_id: 'x', agent_type: 'Explore' });
  s = feed(s, { hook_event_name: 'SubagentStart', session_id: 'B', agent_id: 'y', agent_type: 'Plan' });
  assert.deepEqual(s.sessions['A']!.order, ['x']);
  assert.deepEqual(s.sessions['B']!.order, ['y']);
});

test('never celebrates a failure or an unacknowledged success', () => {
  let s = initialOfficeState;
  const sid = 'c';
  s = feed(s, { hook_event_name: 'SubagentStart', session_id: sid, agent_id: 'a', agent_type: 'Explore' });
  s = feed(s, { hook_event_name: 'PostToolUseFailure', session_id: sid, agent_id: 'a', tool_name: 'Bash', error: 'boom', is_interrupt: false });
  s = feed(s, { hook_event_name: 'SubagentStop', session_id: sid, agent_id: 'a', agent_type: 'Explore' });
  const failed = s.sessions[sid]!.agents['a']!;
  assert.equal(failed.status, 'failed');
  assert.notEqual(expressionOf(failed).pose, 'cheer');

  s = feed(s, { hook_event_name: 'SubagentStart', session_id: sid, agent_id: 'b', agent_type: 'Explore' });
  s = feed(s, { hook_event_name: 'PreToolUse', session_id: sid, agent_id: 'b', tool_name: 'SubagentHandback', tool_input: { message: 'ok' }, tool_use_id: 'h' });
  s = feed(s, { hook_event_name: 'SubagentStop', session_id: sid, agent_id: 'b', agent_type: 'Explore' });
  const unack = s.sessions[sid]!.agents['b']!;
  assert.equal(unack.outcome, 'success_estimated');
  assert.notEqual(expressionOf(unack).pose, 'cheer');
  s = feed(s, { hook_event_name: 'UserPromptSubmit', session_id: sid, prompt: '<agent-message from="b">\nok\n</agent-message>' });
  assert.equal(expressionOf(s.sessions[sid]!.agents['b']!).pose, 'cheer');
});

test('progress is never a made-up number', () => {
  let s = initialOfficeState;
  s = feed(s, { hook_event_name: 'SubagentStart', session_id: 'p', agent_id: 'a', agent_type: 'Explore' });
  s = feed(s, { hook_event_name: 'PreToolUse', session_id: 'p', agent_id: 'a', tool_name: 'Edit', tool_input: { file_path: 'x.ts' }, tool_use_id: 't' });
  assert.deepEqual(s.sessions['p']!.agents['a']!.progress, { kind: 'unavailable' });
});

test('prompt classification', () => {
  assert.deepEqual(classifyPrompt('fix the bug'), { injected: false });
  assert.deepEqual(classifyPrompt('<agent-message from="a12">x</agent-message>'), { injected: true, kind: 'agent-message', fromAgentId: 'a12' });
  assert.equal(classifyPrompt('<task-notification>\n...').injected, true);
  assert.equal(classifyPrompt('<div> is my html question').injected, false);
});

test('masking and display rules', () => {
  assert.equal(maskSecrets('export API_KEY=abc123 && run'), 'export API_KEY=*** && run');
  assert.equal(maskSecrets('curl -H "Authorization: Bearer abcdefghijklmnop"').includes('abcdefghijklmnop'), false);
  assert.equal(maskSecrets('git clone https://user:pw@host/x').includes('pw@'), false);
  assert.equal(maskSecrets('sk-ant-api03-xxxxxxx'), '***');
  assert.equal(displayPath('C:\\repo\\.env'), '(sensitive file)');
  assert.equal(displayPath('/home/u/.claude/.credentials.json'), '(sensitive file)');
  assert.equal(displayPath('C:\\repo\\src\\Dashboard.tsx'), 'src/Dashboard.tsx');
  // Edit/Write show only the path, never content.
  const w = classifyTool('Write', { file_path: 'a/b/c.ts', content: 'SECRET_CONTENT' });
  assert.equal(w.detail.includes('SECRET'), false);
  assert.equal(classifyTool('Bash', { command: 'npm test' }).activity, 'testing');
  assert.equal(classifyTool('PowerShell', { command: 'Get-ChildItem' }).activity, 'executing');
});

test('a delivered SubagentHandback counts as the manager receiving the report (no UserPromptSubmit mid-turn)', () => {
  let s = initialOfficeState;
  const sid = 'h';
  s = feed(s, { hook_event_name: 'SubagentStart', session_id: sid, agent_id: 'k', agent_type: 'Explore', cwd: 'C:\projects\proj' });
  s = feed(s, { hook_event_name: 'PreToolUse', session_id: sid, agent_id: 'k', tool_name: 'SubagentHandback', tool_input: { message: 'ok' }, tool_use_id: 'hb' });
  s = feed(s, { hook_event_name: 'PostToolUse', session_id: sid, agent_id: 'k', tool_name: 'SubagentHandback', tool_use_id: 'hb' });
  s = feed(s, { hook_event_name: 'SubagentStop', session_id: sid, agent_id: 'k', agent_type: 'Explore' });
  assert.equal(expressionOf(s.sessions[sid]!.agents['k']!).pose, 'cheer');
  assert.equal(s.sessions[sid]!.cwd, 'C:\projects\proj');
});

test('late PreToolUse after its PostToolUse does not revive "working"', () => {
  let s = initialOfficeState;
  s = feed(s, { hook_event_name: 'SubagentStart', session_id: 'o', agent_id: 'z', agent_type: 'Explore' });
  s = feed(s, { hook_event_name: 'PostToolUse', session_id: 'o', agent_id: 'z', tool_name: 'Read', tool_use_id: 'r1' });
  s = feed(s, { hook_event_name: 'PreToolUse', session_id: 'o', agent_id: 'z', tool_name: 'Read', tool_use_id: 'r1', tool_input: {} });
  assert.notEqual(s.sessions['o']!.agents['z']!.status, 'working');
});

test('masking keeps readable long paths but hides token-like strings', () => {
  const p = 'cat C:/projects/example-app/packages/frontend/components/settings/README.md';
  assert.equal(maskSecrets(p), p);
  assert.equal(maskSecrets('curl -d a3f9c2e81b7d4f60a9e2c4b8d1f7e3a5b6c9d0e1'), 'curl -d ***');
});

test('task-notification (non-handback subagent, seen in Desktop app) acknowledges via <task-id>', () => {
  assert.deepEqual(classifyPrompt('<task-notification>\n<task-id>afda793cbbb8dc839</task-id>\n<status>completed</status>'), {
    injected: true, kind: 'task-notification', fromAgentId: 'afda793cbbb8dc839',
  });
  let s = initialOfficeState;
  s = feed(s, { hook_event_name: 'SubagentStart', session_id: 'd', agent_id: 'afda793cbbb8dc839', agent_type: 'Explore' });
  s = feed(s, { hook_event_name: 'SubagentStop', session_id: 'd', agent_id: 'afda793cbbb8dc839', agent_type: 'Explore', last_assistant_message: 'The first line is ...' });
  s = feed(s, { hook_event_name: 'UserPromptSubmit', session_id: 'd', prompt: '<task-notification>\n<task-id>afda793cbbb8dc839</task-id>\n</task-notification>' });
  const a = s.sessions['d']!.agents['afda793cbbb8dc839']!;
  assert.equal(a.outcome, 'success_estimated');
  assert.equal(expressionOf(a).pose, 'cheer');
});

test('permission mode comes from the main agent hooks only (display only)', () => {
  let s = initialOfficeState;
  s = feed(s, { hook_event_name: 'SessionStart', session_id: 'PM', permission_mode: 'auto', source: 'startup' } as HookInput);
  assert.equal(s.sessions.PM?.permissionMode, 'auto');
  s = feed(s, { hook_event_name: 'PreToolUse', session_id: 'PM', agent_id: 'sub1', agent_type: 'Plan', permission_mode: 'plan', tool_name: 'Read', tool_use_id: 't1', tool_input: {} } as HookInput);
  assert.equal(s.sessions.PM?.permissionMode, 'auto');
  s = feed(s, { hook_event_name: 'UserPromptSubmit', session_id: 'PM', permission_mode: 'default', prompt: 'x' } as HookInput);
  assert.equal(s.sessions.PM?.permissionMode, 'default');
});
