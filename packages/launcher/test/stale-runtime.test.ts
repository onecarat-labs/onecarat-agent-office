// Integration test of the launcher against a stale runtime file whose pid was reused by an unrelated process:
// `stop` must not signal that process, and `start` must not be blocked by it. Runs the real launcher and the
// real bridge (from source, --no-terminal, --no-open) on test ports with a private runtime folder.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const cli = path.resolve(import.meta.dirname, '../src/cli.ts');
const rtDir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-launcher-'));
const rtFile = path.join(rtDir, 'bridge.json');
const env = { ...process.env, ONECARAT_OFFICE_RUNTIME_DIR: rtDir, ONECARAT_OFFICE_NO_TERMINAL: '1' };
const PORT = '47931'; // the bridge we start
const DEAD_PORT = 47932; // nothing listens here

// An unrelated long-lived process whose pid we put into a stale runtime file.
const bystander = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const office = (...args: string[]) => {
  const r = spawnSync(process.execPath, [cli, ...args], { env, encoding: 'utf8', timeout: 20000 });
  return { status: r.status, out: (r.stdout + r.stderr).trim() };
};
const stale = () => fs.writeFileSync(rtFile, JSON.stringify({ port: DEAD_PORT, token: 'x'.repeat(48), pid: bystander.pid, startedAt: 0, version: 't' }));

after(() => {
  office('stop', '--no-open');
  bystander.kill();
  fs.rmSync(rtDir, { recursive: true, force: true });
});

test('stop with a stale runtime file (pid reused): file removed, the bystander process is left alone', () => {
  stale();
  const r = office('stop');
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /stale runtime file was removed/);
  assert.equal(fs.existsSync(rtFile), false);
  assert.equal(alive(bystander.pid!), true);
});

test('start with a stale runtime file (pid reused) is not blocked; a second start says already running; stop works twice', () => {
  stale();
  const s1 = office('start', '--no-open', '--port', PORT);
  assert.equal(s1.status, 0, s1.out);
  assert.match(s1.out, /Started Onecarat Agent Office: http:\/\/127\.0\.0\.1:47931\//);
  const info = JSON.parse(fs.readFileSync(rtFile, 'utf8'));
  assert.notEqual(info.pid, bystander.pid);
  assert.equal(alive(bystander.pid!), true);

  const s2 = office('start', '--no-open', '--port', PORT);
  assert.match(s2.out, /Already running/);

  const st = office('status');
  assert.match(st.out, /Running: http:\/\/127\.0\.0\.1:47931\//);

  const p1 = office('stop');
  assert.match(p1.out, /Stopped/);
  assert.equal(fs.existsSync(rtFile), false);
  for (let i = 0; i < 20 && alive(info.pid); i++) spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},150)']);
  assert.equal(alive(info.pid), false, 'bridge exited');

  const p2 = office('stop');
  assert.match(p2.out, /Not running/);

  // and once more, to show the cycle is repeatable
  const s3 = office('start', '--no-open', '--port', PORT);
  assert.match(s3.out, /Started/);
  const p3 = office('stop');
  assert.match(p3.out, /Stopped/);
  assert.equal(alive(bystander.pid!), true);
});
