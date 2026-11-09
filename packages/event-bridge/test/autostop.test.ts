import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import { createBridge, Terminal, whenTerminalEnds, type PtyModule, type PtyProcess } from '../src/index.ts';

function fakeTerminal() {
  let exit: (c: number) => void = () => {};
  const pty: PtyModule = {
    spawn() {
      let onExit: (e: { exitCode: number }) => void = () => {};
      const p: PtyProcess = { pid: 1, onData: () => {}, onExit: (cb) => (onExit = cb), write: () => {}, resize: () => {}, kill: () => onExit({ exitCode: 0 }) };
      exit = (c) => onExit({ exitCode: c });
      return p;
    },
  };
  const term = new Terminal({ load: { ok: true, pty, from: 'fake' }, cwd: os.tmpdir(), command: (sid) => ({ file: 'claude', args: ['--session-id', sid] }), env: { PATH: '' } });
  return { term, exit: (c: number) => exit(c) };
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('Office stops after the built-in claude ends (/exit, Stop, or a crash)', async () => {
  for (const end of ['exit', 'stop', 'crash'] as const) {
    const { term, exit } = fakeTerminal();
    let ended = 0;
    whenTerminalEnds(term, 30, () => ended++);
    assert.equal(term.start(), undefined);
    if (end === 'exit') exit(0);
    else if (end === 'stop') term.stop();
    else exit(1);
    assert.equal(ended, 0, 'waits for the last hooks first');
    await wait(80);
    assert.equal(ended, 1, end);
  }
});

test('never-started terminal and "restart in this folder" do not stop Office', async () => {
  const { term } = fakeTerminal();
  let ended = 0;
  const cancel = whenTerminalEnds(term, 30, () => ended++);
  term.clearScrollback(); // other messages are ignored
  await wait(60);
  assert.equal(ended, 0);
  term.start();
  term.stop();
  term.start(); // restarted at once
  await wait(80);
  assert.equal(ended, 0);
  term.stop();
  cancel();
  await wait(80);
  assert.equal(ended, 0, 'cancel() stops watching');
});

test('closing the bridge tells the page why before the stream ends', async () => {
  const PORT = 47925;
  const TOKEN = 'c'.repeat(48);
  const bridge = createBridge({ port: PORT, token: TOKEN, version: 'test' });
  await new Promise<void>((r) => bridge.server.listen(PORT, '127.0.0.1', () => r()));
  const body = await new Promise<string>((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/events', headers: { 'x-office-token': TOKEN, 'sec-fetch-site': 'same-origin' } }, (res) => {
      assert.equal(res.statusCode, 200);
      let s = '';
      res.on('data', (d) => {
        s += d;
        if (s.includes('event: snapshot')) void bridge.close('claude-ended');
      });
      res.on('end', () => resolve(s));
      res.on('error', reject);
    });
    req.on('error', reject);
  });
  assert.match(body, /event: closing\ndata: \{"reason":"claude-ended"\}\n\n$/);
});
