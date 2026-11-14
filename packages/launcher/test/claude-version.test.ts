import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { parseVersion, readClaudeVersion, researchLines, researchSupport } from '../src/claude-version.ts';

test('only "N.N.N" is read from the output of claude --version', () => {
  assert.deepEqual(parseVersion('2.1.325 (Claude Code)\n'), [2, 1, 325]);
  assert.deepEqual(parseVersion('claude v2.1.198'), [2, 1, 198]);
  assert.equal(parseVersion('no version here'), undefined);
  assert.equal(parseVersion('1.2'), undefined);
  assert.equal(parseVersion(undefined), undefined);
  assert.equal(parseVersion('x'.repeat(500) + '2.1.325'), undefined, 'only the start of the output is looked at');
});

test('the three stages: does not work / untested / checked (and newer than checked is untested too)', () => {
  assert.equal(researchSupport([2, 1, 197]), 'too-old');
  assert.equal(researchSupport([2, 0, 999]), 'too-old');
  assert.equal(researchSupport([2, 1, 198]), 'untested');
  assert.equal(researchSupport([2, 1, 322]), 'untested');
  assert.equal(researchSupport([2, 1, 323]), 'checked');
  assert.equal(researchSupport([2, 1, 325]), 'checked');
  assert.equal(researchSupport([2, 1, 326]), 'newer');
  assert.equal(researchSupport([3, 0, 0]), 'newer');
  const lines = researchLines([2, 1, 150], true).join('\n');
  assert.match(lines, /checked on Claude Code 2\.1\.323 to 2\.1\.325/);
  assert.match(lines, /does not work below 2\.1\.198/);
  assert.match(lines, /in between are untested/);
  assert.match(lines, /2\.1\.150 — too old for the Research Lab/);
  assert.match(researchLines(undefined, false).join('\n'), /claude was not found/);
});

test('claude is run as "<absolute path> --version" only: no shell, a timeout, never anything else', () => {
  const abs = path.resolve('claude-bin');
  const calls: { file: string; args: string[]; opts: Record<string, unknown> }[] = [];
  const run = (file: string, args: string[], opts: Record<string, unknown>) => { calls.push({ file, args, opts }); return '2.1.324 (Claude Code)'; };
  assert.deepEqual(readClaudeVersion(abs, { PATH: 'x' }, run as never, 'linux'), [2, 1, 324]);
  assert.equal(calls.length, 1);
  assert.deepEqual([calls[0]!.file, calls[0]!.args], [abs, ['--version']]);
  assert.deepEqual([calls[0]!.opts.shell, calls[0]!.opts.timeout, calls[0]!.opts.stdio, calls[0]!.opts.env], [false, 5000, ['ignore', 'pipe', 'ignore'], { PATH: 'x' }]);
  // Not an absolute path, nothing found, or a script that would need a shell on Windows: claude is not run at all.
  assert.equal(readClaudeVersion('claude', {}, run as never, 'linux'), undefined);
  assert.equal(readClaudeVersion(undefined, {}, run as never, 'linux'), undefined);
  assert.equal(readClaudeVersion(path.resolve('claude.cmd'), {}, run as never, 'win32'), undefined);
  assert.equal(calls.length, 1);
  // A failure (timeout, exit code, missing file) is "not read", never an error of check.
  assert.equal(readClaudeVersion(abs, {}, (() => { throw new Error('ETIMEDOUT'); }) as never, 'linux'), undefined);
});
