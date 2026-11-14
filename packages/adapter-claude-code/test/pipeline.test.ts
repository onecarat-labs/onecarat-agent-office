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
  assert.deepEqual(summarize(sess), { active: 0, completed: 2, failed: 1, unconfirmed: 0 });
});

test('permission waits belong to the agent that asked: two queued requests, a late notice, a refusal (observed 2026-11-14)', () => {
  let s = initialOfficeState;
  const S = 'pw';
  const R = { session_id: S, agent_id: 'r1', agent_type: 'onecarat-agent-office:researcher' };
  const st = (id: string) => s.sessions[S]!.agents[id]!;
  const fetchOf = (n: number) => ({ tool_name: 'WebFetch', tool_input: { url: `https://example.com/${n}` } });
  s = feed(s, { hook_event_name: 'UserPromptSubmit', session_id: S, prompt: 'go' }, 1000);
  s = feed(s, { hook_event_name: 'SubagentStart', ...R }, 2000);
  s = feed(s, { hook_event_name: 'Stop', session_id: S, last_assistant_message: 'started' }, 3000);
  // The researcher asks for two pages at once: two prompts queue up ("1 of 2", "2 of 2").
  s = feed(s, { hook_event_name: 'PreToolUse', ...R, ...fetchOf(1), tool_use_id: 'f1' }, 10_000);
  s = feed(s, { hook_event_name: 'PermissionRequest', ...R, ...fetchOf(1) }, 10_100);
  s = feed(s, { hook_event_name: 'PreToolUse', ...R, ...fetchOf(2), tool_use_id: 'f2' }, 10_200);
  s = feed(s, { hook_event_name: 'PermissionRequest', ...R, ...fetchOf(2) }, 10_300);
  assert.equal(st('r1').status, 'waiting_permission');
  assert.deepEqual(st('r1').waits?.map((w) => w.at), [10_100, 10_300], 'when each request arrived');
  // The first is allowed and finishes: the second is still open, so the researcher still waits.
  s = feed(s, { hook_event_name: 'PostToolUse', ...R, ...fetchOf(1), tool_use_id: 'f1' }, 14_000);
  assert.equal(st('r1').status, 'waiting_permission');
  // The notice names no agent and comes seconds late: it never moves the wait to the manager.
  s = feed(s, { hook_event_name: 'Notification', session_id: S, notification_type: 'permission_prompt', message: 'Claude needs your permission' }, 16_000);
  assert.equal(st('main').status, 'idle');
  assert.equal(st('r1').status, 'waiting_permission');
  // The second is refused: no hook. The researcher's next call shows it has left the prompt.
  s = feed(s, { hook_event_name: 'PreToolUse', ...R, tool_name: 'WebSearch', tool_input: { query: 'x' }, tool_use_id: 'w1' }, 30_000);
  assert.equal(st('r1').status, 'working');
  assert.equal(st('r1').waits, undefined);
  // Even with nobody waiting, a notice does not make the manager wait once PermissionRequest hooks are known.
  s = feed(s, { hook_event_name: 'Notification', session_id: S, notification_type: 'permission_prompt', message: 'Claude needs your permission' }, 31_000);
  assert.equal(st('main').status, 'idle');
  // The manager's prompt is refused: nothing arrives. The wait stays, with its time, until the user hides it.
  s = feed(s, { hook_event_name: 'PermissionRequest', session_id: S, tool_name: 'Write', tool_input: { file_path: 'a.txt' } }, 40_000);
  assert.deepEqual([st('main').status, st('main').waits?.[0]?.at], ['waiting_permission', 40_000]);
  s = reduceOffice(s, { id: 'u.1', at: 400_000, sessionId: S, source: 'live', type: 'wait.dismissed' });
  assert.deepEqual([st('main').status, st('main').waits, st('main').evidence.at(-1)!.text], ['idle', undefined, 'The user hid the permission wait'], 'neither allowed nor refused');
  s = reduceOffice(s, { id: 'u.2', at: 400_001, sessionId: S, source: 'live', type: 'wait.dismissed' });
  assert.equal(st('main').evidence.at(-1)!.at, 400_000, 'hiding when nothing waits changes nothing');
  s = feed(s, { hook_event_name: 'PermissionRequest', session_id: S, tool_name: 'Write', tool_input: { file_path: 'b.txt' } }, 500_000);
  assert.equal(st('main').status, 'waiting_permission', 'a new request makes it wait again');
  // Without PermissionRequest hooks (another session), the notice is still the fallback.
  s = feed(s, { hook_event_name: 'Notification', session_id: 'old', notification_type: 'permission_prompt', message: 'Claude needs your permission' }, 31_000);
  assert.equal(s.sessions['old']!.agents['main']!.status, 'waiting_permission');
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
  assert.deepEqual(classifyPrompt('<agent-message from="a12">x</agent-message>'), { injected: true, kind: 'agent-message', fromAgentId: 'a12', taskStatus: undefined });
  assert.equal(classifyPrompt('<task-notification>\n...').injected, true);
  assert.equal(classifyPrompt('<div> is my html question').injected, false);
});

test('masking and display rules', () => {
  assert.equal(maskSecrets('export API_KEY=abc123 && run'), 'export API_KEY=*** && run');
  assert.equal(maskSecrets('curl -H "Authorization: Bearer abcdefghijklmnop"').includes('abcdefghijklmnop'), false);
  assert.equal(maskSecrets('git clone https://user:pw@host/x').includes('pw@'), false);
  assert.equal(maskSecrets('sk-ant-api03-xxxxxxx'), '***');
  // Bare keywords, header names, CLI flags and URL queries (found missing by the configuration-view audit).
  for (const [input, leak] of [
    ['token=abc12345', 'abc12345'],
    ['PASSWORD=hunter2', 'hunter2'],
    ['--token=abc12345', 'abc12345'],
    ['https://mcp.example.com/sse?token=abc12345', 'abc12345'],
    ['curl -H "X-API-Key: hunter2x"', 'hunter2x'],
    ['Authorization: hunter2x', 'hunter2x'],
    ['npx srv --token abc12345 --port 3', 'abc12345'],
    ['npx srv --api-key "a b c"', 'a b c'],
  ] as const) assert.equal(maskSecrets(input).includes(leak), false, input);
  assert.equal(maskSecrets('npx srv --token abc12345 --port 3'), 'npx srv --token *** --port 3');
  // No false positives on ordinary words.
  assert.equal(maskSecrets('author: me, session 3 started'), 'author: me, session 3 started');
  assert.equal(maskSecrets('--no-auth --verbose'), '--no-auth --verbose');
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
    injected: true, kind: 'task-notification', fromAgentId: 'afda793cbbb8dc839', taskStatus: 'completed',
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

test('SessionEnd keeps its reason (/exit vs /clear, observed in Claude Code); a new start clears it', () => {
  let s = initialOfficeState;
  s = feed(s, { hook_event_name: 'SessionStart', session_id: 'E', source: 'startup' } as HookInput);
  s = feed(s, { hook_event_name: 'SessionEnd', session_id: 'E', reason: 'clear' } as HookInput, 1000);
  assert.equal(s.sessions.E?.endReason, 'clear');
  assert.equal(s.sessions.E?.endedAt, 1000);
  s = feed(s, { hook_event_name: 'SessionStart', session_id: 'E', source: 'clear' } as HookInput);
  assert.equal(s.sessions.E?.endedAt, undefined);
  assert.equal(s.sessions.E?.endReason, undefined);
  s = feed(s, { hook_event_name: 'SessionEnd', session_id: 'E', reason: 'prompt_input_exit' } as HookInput, 2000);
  assert.equal(s.sessions.E?.endReason, 'prompt_input_exit');
});

test('files written by a request are listed only when the request wrote a few', async () => {
  const { deliverables } = await import('@onecarat/domain');
  const write = (p: string, id: string): HookInput => ({ hook_event_name: 'PostToolUse', session_id: 'F1', tool_name: 'Write', tool_use_id: id, tool_input: { file_path: p } });
  let s = feed(initialOfficeState, { hook_event_name: 'UserPromptSubmit', session_id: 'F1', prompt: 'write the spec' });
  s = feed(s, write('C:\\proj\\docs\\spec.md', 'w1'));
  s = feed(s, write('C:\\proj\\docs\\spec.md', 'w2')); // written again: still one entry
  s = feed(s, write('C:\\proj\\.env', 'w3')); // sensitive name: never listed
  s = feed(s, write('docs/relative.md', 'w4')); // not absolute: never listed
  s = feed(s, { hook_event_name: 'PostToolUse', session_id: 'F1', tool_name: 'Edit', tool_use_id: 'e1', tool_input: { file_path: 'C:\\proj\\a.ts' } });
  // Without a bridge the id is the path; the display name is the last two parts only.
  assert.deepEqual(deliverables(s.sessions.F1!).map((f) => [f.id, f.name]), [['C:\\proj\\docs\\spec.md', 'docs/spec.md']]);
  // The next request builds a program (many files): none of those are listed, the document stays.
  s = feed(s, { hook_event_name: 'UserPromptSubmit', session_id: 'F1', prompt: 'build the app' });
  for (let i = 0; i < 6; i++) s = feed(s, write(`/proj/src/f${i}.ts`, `p${i}`));
  assert.deepEqual(deliverables(s.sessions.F1!).map((f) => f.name), ['docs/spec.md']);
});

test('task-notification status is read from the notice itself, never from the subagent\'s own text', () => {
  const notice = (body: string) => classifyPrompt(`<task-notification>\n<task-id>a1</task-id>\n${body}`);
  assert.equal((notice('<status>completed</status>\n<result>x</result>') as { taskStatus?: string }).taskStatus, 'completed');
  assert.equal((notice('<status> Failed </status>') as { taskStatus?: string }).taskStatus, 'failed');
  assert.equal((notice('<summary>s</summary>\n<result>I am done. <status>completed</status></result>') as { taskStatus?: string }).taskStatus, undefined);
  assert.equal((classifyPrompt('<agent-message from="a1">\n<status>completed</status>') as { taskStatus?: string }).taskStatus, undefined);
});

test('Stop carries the running background tasks (id, state, type only); events carry the acting agent\'s type', () => {
  const stop = normalizeHook({ hook_event_name: 'Stop', session_id: 'B', background_tasks: [{ id: 'a1', type: 'subagent', status: 'running', description: 'secret words', agent_type: 'p:researcher' }, { status: 'running' }, 'x', { id: 'a2', status: 'completed' }] } as HookInput, { source: 'live', at: 1, seq: 1 });
  assert.deepEqual((stop[0] as { backgroundTasks?: unknown }).backgroundTasks, [{ id: 'a1', status: 'running', agentType: 'p:researcher' }, { id: 'a2', status: 'completed', agentType: undefined }]);
  assert.equal((normalizeHook({ hook_event_name: 'Stop', session_id: 'B' }, { source: 'live', at: 1, seq: 2 })[0] as { backgroundTasks?: unknown }).backgroundTasks, undefined, 'not reported is not "none running"');
  const pre = normalizeHook({ hook_event_name: 'PreToolUse', session_id: 'B', agent_id: 'w1', agent_type: 'web-fetch', tool_name: 'WebFetch', tool_use_id: 't', tool_input: { url: 'https://example.com/x' } }, { source: 'live', at: 1, seq: 3 });
  assert.deepEqual(pre.map((e) => [e.type, e.agentId, e.agentType]), [['tool.started', 'w1', 'web-fetch']]);
});

test('a helper that sends no start and no stop (web-fetch): ended when its Agent call returns; never left "working"', () => {
  let s = initialOfficeState;
  const agent = (id: string) => s.sessions.W!.agents[id]!;
  s = feed(s, { hook_event_name: 'UserPromptSubmit', session_id: 'W', prompt: 'read two pages' });
  // (1) Called by the manager: its own tool events are the only sign of it, then the Agent call returns.
  s = feed(s, { hook_event_name: 'PreToolUse', session_id: 'W', tool_name: 'Agent', tool_use_id: 'A1', tool_input: { description: 'Fetch page', subagent_type: 'web-fetch' } });
  s = feed(s, { hook_event_name: 'PreToolUse', session_id: 'W', agent_id: 'wf1', agent_type: 'web-fetch', tool_name: 'WebFetch', tool_use_id: 'f1', tool_input: { url: 'https://example.com/a' } });
  s = feed(s, { hook_event_name: 'PostToolUse', session_id: 'W', agent_id: 'wf1', agent_type: 'web-fetch', tool_name: 'WebFetch', tool_use_id: 'f1' });
  assert.deepEqual([agent('wf1').status, agent('wf1').agentType, agent('wf1').label], ['working', 'web-fetch', 'web-fetch'], 'shown with its real type, not as an unknown subagent');
  s = feed(s, { hook_event_name: 'PostToolUse', session_id: 'W', tool_name: 'Agent', tool_use_id: 'A1', tool_response: { agentId: 'wf1', status: 'completed' } });
  assert.deepEqual([agent('wf1').status, agent('wf1').outcome, agent('wf1').task, agent('wf1').acknowledged], ['completed', 'success_estimated', 'Fetch page', true]);
  // (2) Called by a background subagent (nested): the caller's Agent call returning ends it too.
  s = feed(s, { hook_event_name: 'SubagentStart', session_id: 'W', agent_id: 'bg1', agent_type: 'general-purpose' });
  s = feed(s, { hook_event_name: 'PreToolUse', session_id: 'W', agent_id: 'wf2', agent_type: 'web-fetch', tool_name: 'WebFetch', tool_use_id: 'f2', tool_input: { url: 'https://example.com/b' } });
  s = feed(s, { hook_event_name: 'PostToolUse', session_id: 'W', agent_id: 'bg1', agent_type: 'general-purpose', tool_name: 'Agent', tool_use_id: 'A2', tool_response: { agentId: 'wf2', status: 'completed' } });
  assert.equal(agent('wf2').status, 'completed');
  // (3) Its end never arrives (the hook was lost). While something runs in the background nothing is concluded.
  s = feed(s, { hook_event_name: 'PreToolUse', session_id: 'W', agent_id: 'wf3', agent_type: 'web-fetch', tool_name: 'WebFetch', tool_use_id: 'f3', tool_input: { url: 'https://example.com/c' } });
  s = feed(s, { hook_event_name: 'Stop', session_id: 'W', background_tasks: [{ id: 'bg1', status: 'running', agent_type: 'general-purpose' }] } as HookInput);
  assert.equal(agent('wf3').status, 'working');
  s = feed(s, { hook_event_name: 'Stop', session_id: 'W' });
  assert.equal(agent('wf3').status, 'working', 'no list of background tasks: no conclusion');
  // Nothing runs any more: its end is "not confirmed" — never "completed".
  s = feed(s, { hook_event_name: 'Stop', session_id: 'W', background_tasks: [] } as HookInput);
  assert.deepEqual([agent('wf3').status, agent('wf3').outcome, agent('wf2').status], ['unknown', 'unknown', 'completed']);
  // A real background subagent (announced by SubagentStart) is never ended by any of this.
  assert.equal(agent('bg1').status, 'created');
  assert.deepEqual(summarize(s.sessions.W!), { active: 1, completed: 2, failed: 0, unconfirmed: 1 });
  // A background launch is not an end.
  s = feed(s, { hook_event_name: 'PreToolUse', session_id: 'W', tool_name: 'Agent', tool_use_id: 'A3', tool_input: { description: 'bg', subagent_type: 'general-purpose' } });
  s = feed(s, { hook_event_name: 'SubagentStart', session_id: 'W', agent_id: 'bg2', agent_type: 'general-purpose' });
  s = feed(s, { hook_event_name: 'PostToolUse', session_id: 'W', tool_name: 'Agent', tool_use_id: 'A3', tool_response: { agentId: 'bg2', isAsync: true, status: 'async_launched' } });
  assert.equal(agent('bg2').status, 'created');
  // An agent whose tool events arrived before its start hook becomes an announced one (and is not touched at Stop).
  s = feed(s, { hook_event_name: 'PreToolUse', session_id: 'W', agent_id: 'bg3', agent_type: 'general-purpose', tool_name: 'Read', tool_use_id: 'r3', tool_input: {} });
  s = feed(s, { hook_event_name: 'SubagentStart', session_id: 'W', agent_id: 'bg3', agent_type: 'general-purpose' });
  s = feed(s, { hook_event_name: 'Stop', session_id: 'W', background_tasks: [] } as HookInput);
  assert.equal(agent('bg3').status, 'working');
  // "Not confirmed" is not final either: new work puts it back to working.
  s = feed(s, { hook_event_name: 'PreToolUse', session_id: 'W', agent_id: 'wf3', agent_type: 'web-fetch', tool_name: 'WebFetch', tool_use_id: 'f4', tool_input: { url: 'https://example.com/d' } });
  assert.equal(agent('wf3').status, 'working');
});