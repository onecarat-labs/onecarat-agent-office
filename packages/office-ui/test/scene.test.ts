import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialOfficeState } from '@onecarat/domain';
import { deskSlots, folderName, stageLayout, timeOfDay, STAGE_H } from '../src/scene.ts';
import { applyItems } from '../src/feed.ts';

test('time of day follows the hour, and every hour has one', () => {
  const want: Record<number, string> = { 0: 'night', 4: 'night', 5: 'morning', 9: 'morning', 10: 'day', 15: 'day', 16: 'evening', 18: 'evening', 19: 'night', 23: 'night' };
  for (const [h, tod] of Object.entries(want)) assert.equal(timeOfDay(Number(h)), tod, `hour ${h}`);
  for (let h = 0; h < 24; h++) assert.ok(['morning', 'day', 'evening', 'night'].includes(timeOfDay(h)));
  // the borders: one minute before and at the hour
  assert.equal(timeOfDay(new Date(2026, 10, 21, 15, 59).getHours()), 'day');
  assert.equal(timeOfDay(new Date(2026, 10, 21, 16, 0).getHours()), 'evening');
  // not an hour: never throws
  assert.equal(timeOfDay(NaN), 'day');
  assert.equal(timeOfDay(24), 'night');
  assert.equal(timeOfDay(-1), 'night');
});

test('the number of desks follows the window size, and is never zero', () => {
  const small = stageLayout(420, 262);
  assert.equal(small.capacity, 2);
  assert.ok(stageLayout(900, 262).capacity > small.capacity, 'a wider window shows more');
  assert.equal(stageLayout(220, 140).capacity >= 1, true);
  assert.equal(stageLayout(200, 600).capacity, 1, 'a tall narrow window still shows one');
  for (const [w, h] of [[0, 0], [NaN, 10], [10, -5], [100000, 10]] as const) {
    const l = stageLayout(w, h);
    assert.ok(Number.isFinite(l.w) && l.w >= 600 && l.capacity >= 1, `${w}x${h}`);
  }
});

test('desks stay inside the drawing and apart from each other', () => {
  for (const [w, h] of [[420, 262], [640, 300], [1200, 300], [300, 300]] as const) {
    const { w: stageW, capacity } = stageLayout(w, h);
    for (let n = 1; n <= capacity; n++) {
      const { xs, deskW } = deskSlots(stageW, n);
      assert.equal(xs.length, n);
      assert.ok(deskW >= 100, `desk width ${deskW}`);
      assert.ok(xs[0]! - deskW / 2 >= 340, 'first desk is right of the manager');
      assert.ok(xs[n - 1]! + deskW / 2 <= stageW, 'last desk is inside');
      for (let i = 1; i < n; i++) assert.ok(xs[i]! - xs[i - 1]! >= 170, 'room for a figure and its label');
    }
  }
  assert.equal(STAGE_H, 480);
});

test('folder name is the last part of the path, whatever it is given', () => {
  assert.equal(folderName('C:\\proj\\my-app'), 'my-app');
  assert.equal(folderName('C:\\proj\\my-app\\'), 'my-app');
  assert.equal(folderName('/home/u/proj'), 'proj');
  assert.equal(folderName(''), '');
  assert.equal(folderName(undefined), '');
  assert.equal(folderName(42), '');
  assert.equal([...folderName('C:\\' + 'あ'.repeat(80))].length, 40);
});

const hook = (o: Record<string, unknown>) => ({ session_id: 's1', cwd: 'C:\\proj\\app', ...o });

test('a window keeps to the first session it hears from', () => {
  let st = applyItems({ office: initialOfficeState }, [
    [1, 1000, hook({ hook_event_name: 'SessionStart', source: 'startup' })],
    [2, 1100, hook({ hook_event_name: 'UserPromptSubmit', prompt: 'hello' })],
    [3, 1200, { session_id: 'other', hook_event_name: 'UserPromptSubmit', prompt: 'x' }],
  ]);
  assert.equal(st.sessionId, 's1');
  assert.deepEqual(Object.keys(st.office.sessions), ['s1']);
  assert.equal(st.office.sessions.s1!.agents.main!.status, 'working');
  st = applyItems(st, [[4, 1300, hook({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'rm -rf x' } })]]);
  assert.equal(st.office.sessions.s1!.agents.main!.status, 'waiting_permission');
});

test('unknown events and broken items change nothing and never throw', () => {
  const start = applyItems({ office: initialOfficeState }, [[1, 1000, hook({ hook_event_name: 'UserPromptSubmit', prompt: 'hi' })]]);
  const junk: unknown[] = [
    null,
    42,
    'text',
    [],
    [2],
    [2, 'when', null],
    [3, 1000, null],
    [4, 1000, 'not an object'],
    [5, 1000, [1, 2, 3]],
    [6, 1000, {}],
    [7, 1000, { session_id: 's1' }],
    [8, 1000, hook({ hook_event_name: 'EventFromTheFuture', some_new_field: { deep: [1, 2] } })],
    [9, 1000, hook({ hook_event_name: 12345 })],
    [10, 1000, { session_id: { not: 'a string' }, hook_event_name: 'Stop' }],
  ];
  const after = applyItems(start, junk as never);
  assert.equal(after, start, 'the state object is the very same');

  // Known event names with wrongly shaped fields: no throw, and the session is still there.
  const odd = applyItems(start, [
    [20, 2000, hook({ hook_event_name: 'PreToolUse', tool_name: 99, tool_input: 'rm -rf', tool_use_id: [] })],
    [21, 2000, hook({ hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_response: 'oops', duration_ms: 'fast' })],
    [22, 2000, hook({ hook_event_name: 'PostToolUseFailure', error: { code: 1 }, is_interrupt: 'yes' })],
    [23, 2000, hook({ hook_event_name: 'PermissionRequest', tool_input: null })],
    [24, 2000, hook({ hook_event_name: 'Notification', notification_type: 7, message: [] })],
    [25, 2000, hook({ hook_event_name: 'SubagentStart', agent_id: 5 })],
    [26, 2000, hook({ hook_event_name: 'SubagentStart', agent_id: 'a1', agent_type: {} })],
    [27, 2000, hook({ hook_event_name: 'SubagentStop', agent_id: 'a1', last_assistant_message: 1 })],
    [28, 2000, hook({ hook_event_name: 'Stop', background_tasks: 'none', last_assistant_message: {} })],
    [29, 2000, hook({ hook_event_name: 'SessionStart', cwd: 12, source: [] })],
    [30, 2000, hook({ hook_event_name: 'SessionEnd', reason: { x: 1 } })],
    [31, 2000, hook({ hook_event_name: 'UserPromptSubmit', prompt: 404 })],
  ] as never);
  const s = odd.office.sessions.s1!;
  assert.ok(s.agents.main);
  assert.equal(typeof s.cwd, 'string');
  assert.equal(folderName(s.cwd), 'app');
});
