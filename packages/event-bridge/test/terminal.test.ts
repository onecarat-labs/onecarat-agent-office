import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import fs from 'node:fs';
import { claudeCommand, createBridge, childEnv, loadPty, resolveClaude, Terminal, type PtyModule, type PtyProcess, type TerminalMessage } from '../src/index.ts';

const PORT = 47921;
const TOKEN = 'b'.repeat(48);
const ORIGIN = `http://127.0.0.1:${PORT}`;

// A fake pseudo-terminal: records what the bridge asked for, echoes input back as output.
const spawned: { file: string; args: string[] | string; cwd: string; env: Record<string, string> }[] = [];
let live: { write: (d: string) => void; exit: (c: number) => void } | undefined;
const fakePty: PtyModule = {
  spawn(file, args, o) {
    spawned.push({ file, args, cwd: o.cwd, env: o.env });
    let onData: (d: string) => void = () => {};
    let onExit: (e: { exitCode: number }) => void = () => {};
    const p: PtyProcess = {
      pid: 4242,
      onData: (cb) => (onData = cb),
      onExit: (cb) => (onExit = cb),
      write: (d) => onData(`echo:${d}`),
      resize: () => {},
      kill: () => onExit({ exitCode: 0 }),
    };
    live = { write: (d) => onData(d), exit: (c) => onExit({ exitCode: c }) };
    return p;
  },
};

const term = new Terminal({
  load: { ok: true, pty: fakePty, from: 'fake' },
  cwd: os.tmpdir(),
  command: (sid) => ({ file: 'claude', args: ['--session-id', sid] }),
  env: { PATH: '/bin', CLAUDECODE: '1', CLAUDE_CODE_MESSAGING_TOKEN: 'secret', CLAUDE_CODE_SESSION_ID: 'old', CLAUDE_CONFIG_DIR: '/cfg', GIT_EDITOR: 'true' },
});
const bridge = createBridge({ port: PORT, token: TOKEN, version: 'test', terminal: term });
await new Promise<void>((r) => bridge.server.listen(PORT, '127.0.0.1', () => r()));
after(() => bridge.close());

function get(p: string, headers: Record<string, string> = {}, method = 'GET'): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method, headers }, (res) => {
      const c: Buffer[] = [];
      res.on('data', (d) => c.push(d));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(c).toString() }));
    });
    r.on('error', reject);
    r.end();
  });
}

/** Open /pty and collect messages; resolves "refused:<status>" if the handshake is rejected. */
function connect(opts: { origin?: string; protocols?: string[] }): Promise<{ ws: WebSocket; msgs: TerminalMessage[] } | string> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/pty`, opts.protocols ?? ['office.v1', `office-token.${TOKEN}`], { origin: opts.origin ?? ORIGIN });
    const msgs: TerminalMessage[] = [];
    ws.on('message', (d) => msgs.push(JSON.parse(String(d))));
    ws.on('open', () => resolve({ ws, msgs }));
    ws.on('unexpected-response', (_req, res) => resolve(`refused:${res.statusCode}`));
    ws.on('error', () => resolve('refused:error'));
  });
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('event stream and data APIs need the token; health without it reveals nothing', async () => {
  assert.equal((await get('/events')).status, 401);
  assert.equal((await get('/api/clear', {}, 'POST')).status, 401);
  const anon = JSON.parse((await get('/api/health')).body);
  assert.deepEqual(Object.keys(anon).sort(), ['app', 'authed', 'ok', 'version']);
  assert.equal(anon.authed, false);
  const authed = JSON.parse((await get('/api/health', { 'x-office-token': TOKEN })).body);
  assert.equal(authed.terminal.available, true);
  assert.equal((await get('/api/clear', { 'x-office-token': TOKEN }, 'POST')).status, 200);
});

test('/pty refuses wrong origin, missing or wrong token, and never echoes the token', async () => {
  assert.equal(await connect({ origin: 'https://evil.example' }), 'refused:403');
  assert.equal(await connect({ origin: 'http://localhost:47921' }), 'refused:403');
  assert.equal(await connect({ protocols: ['office.v1'] }), 'refused:403');
  assert.equal(await connect({ protocols: ['office.v1', 'office-token.' + 'c'.repeat(48)] }), 'refused:403');
  assert.equal(await connect({ protocols: [`office-token.${TOKEN}`] }), 'refused:403');
  const ok = await connect({});
  assert.ok(typeof ok !== 'string');
  assert.equal(ok.ws.protocol, 'office.v1');
  ok.ws.close();
});

test('start runs only the bridge-defined command, with session markers removed from env', async () => {
  const c = await connect({});
  assert.ok(typeof c !== 'string');
  // A client cannot choose what runs: extra fields are ignored.
  c.ws.send(JSON.stringify({ t: 'start', file: 'powershell', args: ['-c', 'evil'] }));
  await sleep(50);
  const s = spawned.at(-1)!;
  assert.equal(s.file, 'claude');
  // Only --session-id: Office passes no permission mode, model or other flag; claude uses the user's own settings.
  assert.ok(Array.isArray(s.args) && s.args.length === 2);
  assert.equal(s.args[0], '--session-id');
  assert.match(s.args[1]!, /^[0-9a-f-]{36}$/);
  if (process.platform === 'win32') assert.equal(s.env.NoDefaultCurrentDirectoryInExePath, '1');
  assert.equal(s.cwd, os.tmpdir());
  assert.equal(s.env.CLAUDECODE, undefined);
  assert.equal(s.env.CLAUDE_CODE_MESSAGING_TOKEN, undefined);
  assert.equal(s.env.CLAUDE_CODE_SESSION_ID, undefined);
  assert.equal(s.env.GIT_EDITOR, undefined);
  assert.equal(s.env.CLAUDE_CONFIG_DIR, '/cfg');
  const st = c.msgs.filter((m) => m.t === 'state').at(-1);
  assert.ok(st && st.t === 'state' && st.state.running && st.state.sessionId === s.args[1]);

  // keystrokes in, output out
  c.ws.send(JSON.stringify({ t: 'in', d: 'hi' }));
  await sleep(50);
  assert.ok(c.msgs.some((m) => m.t === 'out' && m.d === 'echo:hi'));

  // a second tab gets the in-memory scrollback
  const c2 = await connect({});
  assert.ok(typeof c2 !== 'string');
  await sleep(50);
  assert.ok(c2.msgs.some((m) => m.t === 'out' && m.d.includes('echo:hi')));

  // "clear history" also clears the terminal scrollback
  await get('/api/clear', { 'x-office-token': TOKEN }, 'POST');
  assert.equal(term.scrollback(), '');

  // exit is reported
  live!.exit(3);
  await sleep(50);
  const st2 = c.msgs.filter((m) => m.t === 'state').at(-1);
  assert.ok(st2 && st2.t === 'state' && !st2.state.running && st2.state.exitCode === 3);
  c.ws.close();
  c2.ws.close();
});

test('start in a missing folder is refused', () => {
  const t = new Terminal({ load: { ok: true, pty: fakePty, from: 'fake' }, cwd: os.tmpdir(), command: (sid) => ({ file: 'claude', args: ['--session-id', sid] }) });
  assert.equal(t.start(path.join(os.tmpdir(), 'no-such-folder-office')), 'folder not found');
});

test('without node-pty Office stays read-only and the rest keeps working', async () => {
  const P = PORT + 1;
  const t = new Terminal({ load: loadPty([path.join(os.tmpdir(), 'no-node-pty-here')]), cwd: os.tmpdir() });
  assert.equal(t.state.available, false);
  assert.match(t.state.reason!, /node-pty/);
  assert.equal(t.start(), t.state.reason);
  const b = createBridge({ port: P, token: TOKEN, version: 'test', terminal: t });
  await new Promise<void>((r) => b.server.listen(P, '127.0.0.1', () => r()));
  const h = await new Promise<string>((resolve) => {
    http.get({ host: '127.0.0.1', port: P, path: '/api/health', headers: { 'x-office-token': TOKEN } }, (res) => {
      let s = '';
      res.on('data', (d) => (s += d));
      res.on('end', () => resolve(s));
    });
  });
  assert.equal(JSON.parse(h).terminal.available, false);
  await b.close();
});

test('the vendored node-pty loads on platforms with an upstream prebuild', { skip: !['win32', 'darwin'].includes(process.platform) }, () => {
  const dir = path.resolve(import.meta.dirname, '../../../plugin/onecarat-agent-office/dist/vendor/node-pty');
  const r = loadPty([dir]);
  assert.equal(r.ok, true, r.ok ? '' : r.reason);
});

test('childEnv keeps user configuration and drops only session markers', () => {
  const e = childEnv({ CLAUDE_CONFIG_DIR: 'x', CLAUDE_CODE_USE_BEDROCK: '1', ANTHROPIC_MODEL: 'm', CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_PLUGIN_ROOT: 'p', AI_AGENT: 'a', PATH: 'p' });
  assert.deepEqual(Object.keys(e).sort(), ['ANTHROPIC_MODEL', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CONFIG_DIR', 'PATH']);
});

test('claude is resolved from absolute PATH entries only, never from the working folder', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'office-path-'));
  const bin = path.join(base, 'bin');
  const repo = path.join(base, 'repo');
  fs.mkdirSync(bin);
  fs.mkdirSync(repo);
  fs.writeFileSync(path.join(bin, 'claude.cmd'), '@echo real');
  fs.writeFileSync(path.join(bin, 'claude'), '#!/bin/sh\necho real');
  fs.chmodSync(path.join(bin, 'claude'), 0o755);
  fs.writeFileSync(path.join(repo, 'claude.cmd'), '@echo HIJACK');
  fs.writeFileSync(path.join(repo, 'claude'), '#!/bin/sh\necho HIJACK');
  fs.chmodSync(path.join(repo, 'claude'), 0o755);
  const prev = process.cwd();
  process.chdir(repo);
  try {
    // "." and relative entries are skipped on both platforms; the shim in the working folder is never picked.
    assert.equal(resolveClaude({ PATH: ['.', 'bin', bin].join(';'), PATHEXT: '.COM;.EXE;.BAT;.CMD' }, 'win32'), path.join(bin, 'claude.cmd'));
    // (a Windows path contains ':' and cannot be put in a POSIX PATH; CI's Linux job runs this line)
    if (process.platform !== 'win32') assert.equal(resolveClaude({ PATH: ['.', 'bin', bin].join(':') }, 'linux'), path.join(bin, 'claude'));
    assert.equal(resolveClaude({ PATH: '.;bin', PATHEXT: '.CMD' }, 'win32'), undefined);
    assert.equal(resolveClaude({ PATH: '' }, 'linux'), undefined);
  } finally {
    process.chdir(prev);
    fs.rmSync(base, { recursive: true, force: true });
  }
  // A missing claude makes the terminal unavailable instead of falling back to a PATH lookup at spawn time.
  const term = new Terminal({ load: { ok: true, pty: fakePty, from: 'fake' }, cwd: os.tmpdir(), env: { PATH: '' } });
  assert.equal(term.state.available, false);
  assert.match(term.state.reason!, /claude/);
  assert.equal(term.start(), term.state.reason);
});

test('the spawn spec quotes the absolute path and only adds --session-id', () => {
  const sid = '123e4567-e89b-12d3-a456-426614174000';
  assert.deepEqual(claudeCommand('/usr/local/bin/claude', sid, {}, 'linux'), { file: '/usr/local/bin/claude', args: ['--session-id', sid] });
  assert.deepEqual(claudeCommand('C:\\Users\\u\\.local\\bin\\claude.exe', sid, {}, 'win32'), { file: 'C:\\Users\\u\\.local\\bin\\claude.exe', args: ['--session-id', sid] });
  assert.deepEqual(claudeCommand('C:\\Program Files\\npm\\claude.cmd', sid, { ComSpec: 'C:\\Windows\\System32\\cmd.exe' }, 'win32'), {
    file: 'C:\\Windows\\System32\\cmd.exe',
    args: '/d /s /c ""C:\\Program Files\\npm\\claude.cmd" --session-id ' + sid + '"',
  });
  assert.throws(() => claudeCommand('/bin/claude', 'x; rm -rf /', {}, 'linux'));
});
