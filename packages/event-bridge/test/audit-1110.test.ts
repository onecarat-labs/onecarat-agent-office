// Regression tests for the 2026-11-10 security audit (see docs/security.md).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import { maskSecrets } from '@onecarat/adapter-claude-code';
import { claudeCommand, createBridge, scanConfig, systemRoot, Terminal, type PtyModule } from '../src/index.ts';
import { askOffice, healthProof } from '../src/proof.ts';
import { browserCommand, handoffHtml, writeHandoff } from '../src/open-browser.ts';
import { isLocalAbsolute } from '../src/local-dir.ts';
// @ts-expect-error plain .mjs without types
import { healthProof as fwdProof, looksStale } from '../../../plugin/onecarat-agent-office/scripts/forward-lib.mjs';

const PORT = 47941;
const TOKEN = 'd'.repeat(48);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'office-audit-'));
const fakePty: PtyModule = {
  spawn: () => ({ pid: 1, onData: () => {}, onExit: () => {}, write: () => {}, resize: () => {}, kill: () => {} }),
};
const term = new Terminal({ load: { ok: true, pty: fakePty, from: 'fake' }, cwd: tmp, command: (sid) => ({ file: 'claude', args: ['--session-id', sid] }) });
const bridge = createBridge({ port: PORT, token: TOKEN, version: 'test', terminal: term, config: { home: tmp, defaultCwd: tmp, managedDir: tmp } });
await new Promise<void>((r) => bridge.server.listen(PORT, '127.0.0.1', () => r()));
after(async () => {
  await bridge.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const get = (port: number, p: string, headers: Record<string, string> = {}) =>
  new Promise<{ status: number; body: string }>((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: p, headers }, (res) => {
      let s = '';
      res.on('data', (d) => (s += d));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: s }));
    }).on('error', reject);
  });

test('the browser opener is an absolute system path on Windows, never a bare name', () => {
  const w = browserCommand('http://127.0.0.1:47821/#t=x', 'win32', { SystemRoot: 'D:\\Win' });
  assert.equal(w.file, 'D:\\Win\\System32\\rundll32.exe');
  assert.deepEqual(w.args, ['url.dll,FileProtocolHandler', 'http://127.0.0.1:47821/#t=x']);
  // A missing or relative SystemRoot must not turn the path into something resolved from the working folder.
  assert.equal(systemRoot({}), 'C:\\Windows');
  assert.equal(systemRoot({ SystemRoot: '.' }), 'C:\\Windows');
  assert.equal(systemRoot({ SYSTEMROOT: '\\\\evil\\share' }), 'C:\\Windows');
  assert.equal(browserCommand('x', 'darwin').file, '/usr/bin/open');
});

test('a .cmd claude is started through cmd.exe by absolute path even without COMSPEC', () => {
  const sid = '123e4567-e89b-12d3-a456-426614174000';
  assert.equal(claudeCommand('C:\\npm\\claude.cmd', sid, {}, 'win32').file, 'C:\\Windows\\System32\\cmd.exe');
  assert.equal(claudeCommand('C:\\npm\\claude.cmd', sid, { ComSpec: 'cmd.exe' }, 'win32').file, 'C:\\Windows\\System32\\cmd.exe');
  assert.equal(claudeCommand('C:\\npm\\claude.cmd', sid, { ComSpec: 'C:\\WINDOWS\\system32\\cmd.exe' }, 'win32').file, 'C:\\WINDOWS\\system32\\cmd.exe');
});

test('macOS/Linux hand-off: the key is in a private file, not on a command line', () => {
  const url = `http://127.0.0.1:47821/#t=${TOKEN}`;
  const file = writeHandoff(url, path.join(tmp, 'handoff'), false);
  assert.ok(!file.includes(TOKEN));
  const html = fs.readFileSync(file, 'utf8');
  assert.ok(html.includes(`location.replace("${url}")`));
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o077, 0);
  // Not overwritten or followed: the name is random and created exclusively.
  assert.notEqual(writeHandoff(url, path.join(tmp, 'handoff'), false), file);
  assert.ok(!handoffHtml('http://x/#</script><script>alert(1)').includes('</script><script>'));
});

test('health proves it holds the token only to a caller that sends a nonce; an impostor is not Office', async () => {
  const nonce = 'ab'.repeat(16);
  const j = JSON.parse((await get(PORT, '/api/health', { 'x-office-nonce': nonce })).body);
  assert.equal(j.proof, healthProof(TOKEN, nonce));
  assert.equal(j.proof, fwdProof(TOKEN, nonce)); // forwarder and bridge agree
  assert.equal(j.authed, false);
  assert.equal(JSON.parse((await get(PORT, '/api/health', { 'x-office-nonce': 'short' })).body).proof, undefined);
  assert.equal((await askOffice(PORT, TOKEN)).ok, true);
  assert.equal((await askOffice(PORT, 'e'.repeat(48))).ok, false); // a file with another token: not that Office

  // Something else on the port that answers with the app name (and even "authed") is refused.
  const fake = http.createServer((_q, s) => s.end(JSON.stringify({ ok: true, app: 'onecarat-agent-office', authed: true, proof: '0'.repeat(64) })));
  await new Promise<void>((r) => fake.listen(47942, '127.0.0.1', () => r()));
  try {
    assert.equal((await askOffice(47942, TOKEN)).ok, false);
  } finally {
    fake.close();
  }
});

test('forwarder: a stale runtime file or an unproven listener receives nothing', async () => {
  assert.equal(looksStale({ port: 1, token: 't', pid: process.pid, startedAt: Date.now() }), false);
  assert.equal(looksStale({ port: 1, token: 't', pid: 4242, startedAt: Date.now() }, { alive: () => false }), true);
  assert.equal(looksStale({ port: 1, token: 't', pid: process.pid, startedAt: Date.now() - 3_600_000 }, { uptimeSec: 60 }), true); // from before this boot
  assert.equal(looksStale({ port: 1, token: 't', pid: process.pid, startedAt: Date.now() - 3_600_000 }, { uptimeSec: 7200 }), false);
  assert.equal(looksStale({ port: '1', token: 't' }), true);

  const seen: string[] = [];
  const fake = http.createServer((q, s) => {
    let b = '';
    q.on('data', (d) => (b += d));
    q.on('end', () => {
      seen.push(`${q.method} ${q.url} token=${q.headers['x-office-token'] ?? '-'} ${b}`);
      s.end(JSON.stringify({ ok: true, app: 'onecarat-agent-office', authed: true }));
    });
  });
  await new Promise<void>((r) => fake.listen(47943, '127.0.0.1', () => r()));
  const dir = path.join(tmp, 'rt');
  fs.mkdirSync(dir);
  const fwd = path.resolve(import.meta.dirname, '../../../plugin/onecarat-agent-office/scripts/forward.mjs');
  const run = (info: object) =>
    new Promise<number | null>((resolve) => {
      fs.writeFileSync(path.join(dir, 'bridge.json'), JSON.stringify(info));
      const p = spawn(process.execPath, [fwd], { env: { ...process.env, ONECARAT_OFFICE_RUNTIME_DIR: dir }, stdio: ['pipe', 'ignore', 'ignore'] });
      p.on('exit', resolve);
      p.stdin.end(JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 'S', prompt: 'PRIVATE-PROMPT' }));
    });
  try {
    // dead pid: no connection at all
    assert.equal(await run({ port: 47943, token: TOKEN, pid: 2 ** 22 + 12345, startedAt: Date.now(), version: 't' }), 0);
    assert.deepEqual(seen, []);
    // live pid (reused), fresh file, but the listener cannot prove it holds the token: asked once, sent nothing
    assert.equal(await run({ port: 47943, token: TOKEN, pid: process.pid, startedAt: Date.now(), version: 't' }), 0);
    assert.equal(seen.length, 1);
    assert.match(seen[0]!, /^GET \/api\/health token=- $/);
    assert.ok(!seen.join('\n').includes('PRIVATE-PROMPT') && !seen.join('\n').includes(TOKEN));
  } finally {
    fake.close();
  }
});

test('masking stays fast on repetitive input (ReDoS) and still masks', () => {
  for (const s of ['x://a:'.repeat(10000), '-'.repeat(60000) + 'a', 'key-'.repeat(16000), '--' + 'key-'.repeat(16000), 'token_'.repeat(10000) + '=x', 'a-'.repeat(32000), 'key ' .repeat(16000), 'key=" '.repeat(10000)]) {
    const t = Date.now();
    maskSecrets(s);
    assert.ok(Date.now() - t < 1500, `maskSecrets took ${Date.now() - t} ms on ${s.slice(0, 12)}…`);
  }
  assert.equal(maskSecrets('MY_API_KEY=abc123'), 'MY_API_KEY=***');
  assert.equal(maskSecrets('X-Api-Key: abc'), 'X-Api-Key=***');
  assert.equal(maskSecrets('curl --token abc123 http://x'), 'curl --token *** http://x');
  assert.equal(maskSecrets('password   =   "a b"'), 'password=***');

  // The config view reads CLAUDE.md of any folder the user points it at.
  const repo = path.join(tmp, 'repo');
  fs.mkdirSync(repo);
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), '# notes\n' + 'key-'.repeat(16000));
  const t = Date.now();
  scanConfig({ cwd: repo, home: tmp, managedDir: tmp });
  assert.ok(Date.now() - t < 3000, `scanConfig took ${Date.now() - t} ms`);
});

test('a malformed terminal message is ignored, not a crash', async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/pty`, ['office.v1', `office-token.${TOKEN}`], { origin: `http://127.0.0.1:${PORT}` });
  await new Promise<void>((r, j) => {
    ws.on('open', () => r());
    ws.on('error', j);
  });
  for (const m of ['null', '1', '"x"', '[]', '{', '{"t":"resize"}', '{"t":"in","d":{}}', '{"t":"start","cwd":{}}']) ws.send(m);
  await sleep(150);
  assert.equal((await get(PORT, '/api/health')).status, 200);
  ws.close();
});

test('folders named by the page must be absolute and local (no UNC, no relative)', async () => {
  assert.equal(isLocalAbsolute('C:\\proj', 'win32'), true);
  assert.equal(isLocalAbsolute('\\\\host\\share\\x', 'win32'), false);
  assert.equal(isLocalAbsolute('//host/share/x', 'win32'), false);
  assert.equal(isLocalAbsolute('\\\\?\\UNC\\host\\share', 'win32'), false);
  assert.equal(isLocalAbsolute('\\rooted', 'win32'), false);
  assert.equal(isLocalAbsolute('C:relative', 'win32'), false);
  assert.equal(isLocalAbsolute('/srv/x', 'linux'), true);
  assert.equal(isLocalAbsolute('x/y', 'linux'), false);
  term.stop();
  assert.equal(term.start('relative/folder'), 'not a local folder');
  if (process.platform === 'win32') {
    assert.equal(term.start('\\\\127.0.0.1\\c$'), 'not a local folder');
    assert.equal((await get(PORT, `/api/config?cwd=${encodeURIComponent('\\\\127.0.0.1\\c$')}`, { 'x-office-token': TOKEN })).status, 400);
  }
  assert.equal((await get(PORT, `/api/config?cwd=${encodeURIComponent(tmp)}`, { 'x-office-token': TOKEN })).status, 200);
});
