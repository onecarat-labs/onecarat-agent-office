import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { bridgeArgs, parseLauncherArgs } from '../src/args.ts';

const exists = (d: string) => d === path.resolve('/proj');

test('only the allow-listed options are accepted; bridge-only and unknown flags are refused', () => {
  assert.deepEqual(parseLauncherArgs(['start'], exists), { cmd: 'start', noTerminal: false, noOpen: false });
  assert.deepEqual(parseLauncherArgs(['start', '--port', '47822', '--cwd', '/proj', '--no-terminal', '--no-open'], exists), {
    cmd: 'start', port: 47822, cwd: path.resolve('/proj'), noTerminal: true, noOpen: true,
  });
  for (const bad of [
    ['start', '--ui-dir', '/tmp/evil'],
    ['start', '--open'],
    ['start', '--open-base', 'https://evil.example/'],
    ['start', '--dev-origin', 'https://evil.example'],
    ['start', '--port', '80'],
    ['start', '--port', 'abc'],
    ['start', '--cwd', '/nope'],
    ['start', '--cwd'],
    ['start', 'extra'],
    ['restart'],
  ]) {
    const r = parseLauncherArgs(bad, exists);
    assert.ok('error' in r, `should refuse: ${bad.join(' ')}`);
  }
});

test('bridge arguments are built from parsed values only', () => {
  const a = parseLauncherArgs(['start', '--port', '47822'], exists);
  assert.ok(!('error' in a));
  assert.deepEqual(bridgeArgs(a, '/here'), ['--cwd', '/here', '--port', '47822']);
  const b = parseLauncherArgs(['start', '--cwd', '/proj', '--no-terminal'], exists);
  assert.ok(!('error' in b));
  assert.deepEqual(bridgeArgs(b, '/here'), ['--cwd', path.resolve('/proj'), '--no-terminal']);
});
