// "Continue last session" and "pick a past session" in the built-in terminal.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import { WebSocket } from 'ws';
import { claudeCommand, createBridge, Terminal, whenTerminalEnds, type PtyModule, type PtyProcess, type TerminalMessage } from '../src/index.ts';
// @ts-expect-error plain .mjs without types
import { terminalMarker } from '../../../plugin/onecarat-agent-office/scripts/forward-lib.mjs';

const PORT = 47951;
const TOKEN = 'd'.repeat(48);
const UUID = /^[0-9a-f-]{36}$/;

const spawned: { args: string[] | string; env: Record<string, string> }[] = [];
let exit: (c: number) => void = () => {};
const fakePty: PtyModule = {
  spawn(_file, args, o) {
    spawned.push({ args, env: o.env });
    let onExit: (e: { exitCode: number }) => void = () => {};
    const p: PtyProcess = { pid: 1, onData: () => {}, onExit: (cb) => (onExit = cb), write: () => {}, resize: () => {}, kill: () => onExit({ exitCode: 0 }) };
    exit = (c) => onExit({ exitCode: c });
    return p;
  },
};
// The real argument builder, with a fixed path instead of a PATH lookup.
const newTerminal = () => new Terminal({ load: { ok: true, pty: fakePty, from: 'fake' }, cwd: os.tmpdir(), command: (sid, mode) => claudeCommand('/bin/claude', sid, {}, 'linux', mode), env: { PATH: '' } });

const term = newTerminal();
const bridge = createBridge({ port: PORT, token: TOKEN, version: 'test', terminal: term, reorderWindowMs: 5 });
await new Promise<void>((r) => bridge.server.listen(PORT, '127.0.0.1', () => r()));
after(() => bridge.close());

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function hook(body: object, headers: Record<string, string> = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body));
    const r = http.request({ host: '127.0.0.1', port: PORT, path: '/hook', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': data.length, 'x-office-token': TOKEN, ...headers } }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode ?? 0));
    });
    r.on('error', reject);
    r.end(data);
  });
}

function connect(): Promise<{ ws: WebSocket; msgs: TerminalMessage[] }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/pty`, ['office.v1', `office-token.${TOKEN}`], { origin: `http://127.0.0.1:${PORT}` });
    const msgs: TerminalMessage[] = [];
    ws.on('message', (d) => msgs.push(JSON.parse(String(d))));
    ws.on('open', () => resolve({ ws, msgs }));
    ws.on('error', reject);
  });
}
const lastState = (msgs: TerminalMessage[]) => {
  const m = msgs.filter((x) => x.t === 'state').at(-1);
  assert.ok(m && m.t === 'state');
  return m.state;
};

test('the three start modes map to fixed arguments; nothing else can be passed', () => {
  const sid = '123e4567-e89b-12d3-a456-426614174000';
  assert.deepEqual(claudeCommand('/bin/claude', sid, {}, 'linux', 'new').args, ['--session-id', sid]);
  assert.deepEqual(claudeCommand('/bin/claude', sid, {}, 'linux', 'continue').args, ['--continue']);
  assert.deepEqual(claudeCommand('/bin/claude', sid, {}, 'linux', 'resume').args, ['--resume']);
  assert.equal(claudeCommand('C:\\npm\\claude.cmd', sid, { ComSpec: 'C:\\Windows\\System32\\cmd.exe' }, 'win32', 'continue').args, '/d /s /c ""C:\\npm\\claude.cmd" --continue"');
  assert.equal(claudeCommand('C:\\npm\\claude.cmd', sid, { ComSpec: 'C:\\Windows\\System32\\cmd.exe' }, 'win32', 'resume').args, '/d /s /c ""C:\\npm\\claude.cmd" --resume"');
  assert.throws(() => claudeCommand('/bin/claude', sid, {}, 'linux', '--dangerously-skip-permissions' as never));
});

test('the page chooses a mode by name only; an unknown mode starts nothing', async () => {
  const c = await connect();
  const before = spawned.length;
  for (const mode of ['--dangerously-skip-permissions', '--resume x; calc', 7, null, ['resume']]) c.ws.send(JSON.stringify({ t: 'start', mode }));
  await sleep(60);
  assert.equal(spawned.length, before);
  const st = lastState(c.msgs);
  assert.equal(st.running, false);
  assert.equal(st.reason, 'unknown start mode');
  c.ws.close();
});

test('a continued session is followed from its own SessionStart hook, and only from this run', async () => {
  const c = await connect();
  c.ws.send(JSON.stringify({ t: 'start', mode: 'continue' }));
  await sleep(60);
  const s = spawned.at(-1)!;
  assert.deepEqual(s.args, ['--continue']);
  const run = s.env.ONECARAT_OFFICE_TERMINAL!;
  assert.match(run, UUID);
  let st = lastState(c.msgs);
  assert.equal(st.running, true);
  assert.equal(st.mode, 'continue');
  assert.equal(st.sessionId, undefined, 'not known before the hook says so');

  const start = (session_id: string) => ({ hook_event_name: 'SessionStart', session_id, cwd: os.tmpdir(), source: 'resume' });
  // A session in some other terminal (no marker), a stale run, and a non-SessionStart event do not bind.
  assert.equal(await hook(start('other-terminal')), 200);
  assert.equal(await hook(start('old-run'), { 'x-office-terminal': '00000000-0000-4000-8000-000000000000' }), 200);
  assert.equal(await hook({ hook_event_name: 'UserPromptSubmit', session_id: 'not-a-start', prompt: 'hi' }, { 'x-office-terminal': run }), 200);
  await sleep(40);
  assert.equal(term.state.sessionId, undefined);

  assert.equal(await hook(start('resumed-1'), { 'x-office-terminal': run }), 200);
  await sleep(40);
  st = lastState(c.msgs);
  assert.equal(st.sessionId, 'resumed-1');
  // Switching conversation inside the terminal (/resume, /clear) is followed too.
  await hook(start('resumed-2'), { 'x-office-terminal': run });
  await sleep(40);
  assert.equal(term.state.sessionId, 'resumed-2');

  // After it ends, late hooks of that run change nothing.
  exit(0);
  await hook(start('late'), { 'x-office-terminal': run });
  await sleep(40);
  assert.equal(term.state.sessionId, 'resumed-2');
  assert.equal(term.state.running, false);

  // A new session still gets the id made by the bridge, and a fresh marker.
  c.ws.send(JSON.stringify({ t: 'start' }));
  await sleep(60);
  const n = spawned.at(-1)!;
  assert.ok(Array.isArray(n.args) && n.args[0] === '--session-id');
  assert.equal(term.state.sessionId, (n.args as string[])[1]);
  assert.equal(term.state.mode, 'new');
  assert.notEqual(n.env.ONECARAT_OFFICE_TERMINAL, run);
  term.stop();
  c.ws.close();
});

test('the picker opens with --resume', () => {
  const t = newTerminal();
  assert.equal(t.start(undefined, 'resume'), undefined);
  assert.deepEqual(spawned.at(-1)!.args, ['--resume']);
  assert.equal(t.state.mode, 'resume');
  assert.equal(t.start(undefined, 'bogus' as never), 'already running');
  t.stop();
  assert.equal(t.start(undefined, 'bogus' as never), 'unknown start mode');
});

test('Office keeps running when nothing was continued, and stops after a continued session ends', async () => {
  // "No conversation found to continue" / picker closed with Esc: claude exits before any session opened.
  for (const mode of ['continue', 'resume'] as const) {
    const t = newTerminal();
    let ended = 0;
    const cancel = whenTerminalEnds(t, 20, () => ended++);
    t.start(undefined, mode);
    exit(mode === 'continue' ? 1 : 0);
    await sleep(60);
    assert.equal(ended, 0, mode);
    // The user starts again, a conversation opens, then ends: now Office stops.
    t.start(undefined, mode);
    t.adoptSession(spawned.at(-1)!.env.ONECARAT_OFFICE_TERMINAL!, 'sess');
    exit(0);
    await sleep(60);
    assert.equal(ended, 1, mode);
    cancel();
  }
});

test('the forwarder passes the terminal marker only when it is a run id', () => {
  const id = '123e4567-e89b-12d3-a456-426614174000';
  assert.deepEqual(terminalMarker({ ONECARAT_OFFICE_TERMINAL: id }), { 'x-office-terminal': id });
  assert.deepEqual(terminalMarker({}), {});
  assert.deepEqual(terminalMarker({ ONECARAT_OFFICE_TERMINAL: 'x\r\nx-office-token: y' }), {});
});
