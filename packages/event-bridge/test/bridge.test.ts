import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { createBridge, runtimeFilePath, writeRuntimeFile } from '../src/index.ts';
// @ts-expect-error plain .mjs without types
import { pickHookFields, runtimeFilePath as fwdRuntimeFilePath } from '../../../plugin/onecarat-agent-office/scripts/forward-lib.mjs';

const PORT = 47911;
const TOKEN = 'a'.repeat(48);
// A tiny static UI so the file-serving branch (and its path handling) is exercised.
const uiDir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-ui-'));
fs.writeFileSync(path.join(uiDir, 'index.html'), '<!doctype html><title>t</title>');
const bridge = createBridge({ port: PORT, token: TOKEN, version: 'test', reorderWindowMs: 50, uiDir });
await new Promise<void>((r) => bridge.server.listen(PORT, '127.0.0.1', () => r()));
after(async () => {
  await bridge.close();
  fs.rmSync(uiDir, { recursive: true, force: true });
});

function req(opts: { method?: string; path: string; headers?: Record<string, string>; body?: string }): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: PORT, method: opts.method ?? 'GET', path: opts.path, headers: opts.headers }, (res) => {
      const c: Buffer[] = [];
      res.on('data', (d) => c.push(d));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(c).toString() }));
    });
    r.on('error', reject);
    r.end(opts.body);
  });
}
const hook = (body: object, headers: Record<string, string> = {}) =>
  req({ method: 'POST', path: '/hook', headers: { 'content-type': 'application/json', 'x-office-token': TOKEN, ...headers }, body: JSON.stringify(body) });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('accepts an authenticated hook post and stores normalized events only', async () => {
  const r = await hook({ hook_event_name: 'UserPromptSubmit', session_id: 'S1', prompt: 'hello' });
  assert.equal(r.status, 200);
  await sleep(120);
  const snap = bridge.store.snapshot();
  assert.equal(snap.at(-1)?.type, 'user.prompt');
  assert.equal(snap.at(-1)?.source, 'live');
});

test('rejects missing/wrong token, browser-origin posts, wrong Host, non-JSON', async () => {
  assert.equal((await hook({ a: 1 }, { 'x-office-token': 'nope' })).status, 403);
  assert.equal((await req({ method: 'POST', path: '/hook', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 403);
  assert.equal((await hook({ a: 1 }, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await hook({ a: 1 }, { 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await hook({ a: 1 }, { host: 'evil.example:47911' })).status, 421);
  assert.equal((await req({ method: 'POST', path: '/hook', headers: { 'content-type': 'text/plain', 'x-office-token': TOKEN }, body: '{}' })).status, 415);
});

test('UI endpoints refuse cross-site requests (DNS rebinding / CSRF)', async () => {
  assert.equal((await req({ path: '/api/health' })).status, 200);
  assert.equal((await req({ path: '/api/health', headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
  assert.equal((await req({ path: '/api/health', headers: { origin: 'http://localhost:9999' } })).status, 403);
  assert.equal((await req({ method: 'POST', path: '/api/clear', headers: { origin: 'https://evil.example' } })).status, 403);
  assert.equal((await req({ method: 'POST', path: '/api/shutdown' })).status, 401);
});

test('a malformed %-escape or odd path is answered, not a crash', async () => {
  assert.equal((await req({ path: '/%E0%A4%A' })).status, 400);
  assert.equal((await req({ path: '/%00' })).status, 400);
  assert.equal((await req({ path: '/' })).status, 200);
  assert.equal((await req({ path: '/..%2f..%2fetc%2fpasswd' })).status, 404);
  assert.equal((await req({ path: '/%5c..%5c..%5cwindows%5cwin.ini' })).status, 404);
  assert.equal((await req({ path: '/api/health' })).status, 200);
});

test('reorders out-of-order async hook posts by hook start time', async () => {
  bridge.store.clear();
  const t = Date.now();
  await hook({ hook_event_name: 'PostToolUse', session_id: 'S2', tool_name: 'Read', tool_use_id: 'x' }, { 'x-office-hook-time': String(t + 5) });
  await hook({ hook_event_name: 'PreToolUse', session_id: 'S2', tool_name: 'Read', tool_use_id: 'x', tool_input: {} }, { 'x-office-hook-time': String(t) });
  await sleep(150);
  assert.deepEqual(bridge.store.snapshot().map((e) => e.type), ['tool.started', 'tool.finished']);
});

test('forwarder strips file contents and unknown fields', () => {
  const p = pickHookFields({
    hook_event_name: 'PreToolUse', session_id: 's', transcript_path: 'C:/x.jsonl', tool_name: 'Write',
    tool_input: { file_path: 'a.ts', content: 'SECRET' }, tool_response: { big: 'x' }, extra: 1,
  });
  assert.deepEqual(p, { hook_event_name: 'PreToolUse', session_id: 's', tool_name: 'Write', tool_input: { file_path: 'a.ts' } });
  const ag = pickHookFields({ hook_event_name: 'PostToolUse', session_id: 's', tool_name: 'Agent', tool_response: { agentId: 'a1', isAsync: true, prompt: 'long' } });
  assert.deepEqual(ag.tool_response, { agentId: 'a1', isAsync: true, status: undefined });
  // Stop: which background tasks still run. Id, state and type only: never the description, the output or paths.
  const stop = pickHookFields({ hook_event_name: 'Stop', session_id: 's', background_tasks: [{ id: 'a1', type: 'subagent', status: 'running', description: 'what the user asked', agent_type: 'p:researcher', output_file: 'C:/x' }, 'junk', { status: 'running' }], session_crons: [{ id: 'c' }], agent_transcript_path: 'C:/t' });
  assert.deepEqual(stop, { hook_event_name: 'Stop', session_id: 's', background_tasks: [{ id: 'a1', status: 'running', agent_type: 'p:researcher' }] });
  // Only on Stop (a subagent's own stop still lists itself as running, so it says nothing).
  assert.equal(pickHookFields({ hook_event_name: 'SubagentStop', session_id: 's', agent_id: 'a1', background_tasks: [{ id: 'a1', status: 'running' }] }).background_tasks, undefined);
});

test('forwarder and bridge agree on the runtime file path', () => {
  for (const platform of ['win32', 'darwin', 'linux'] as const) {
    const env = { LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local', XDG_STATE_HOME: '/x/state' };
    assert.equal(fwdRuntimeFilePath(env, platform), runtimeFilePath(env, platform));
  }
});

test('forwarder end-to-end: delivers when bridge runs, silent exit 0 when not', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-rt-'));
  const fwd = path.resolve(import.meta.dirname, '../../../plugin/onecarat-agent-office/scripts/forward.mjs');
  const run = () =>
    new Promise<{ code: number | null; out: string }>((resolve) => {
      const p = spawn(process.execPath, [fwd], { env: { ...process.env, ONECARAT_OFFICE_RUNTIME_DIR: dir } });
      let out = '';
      p.stdout.on('data', (d) => (out += d));
      p.stderr.on('data', (d) => (out += d));
      p.on('exit', (code) => resolve({ code, out }));
      p.stdin.end(JSON.stringify({ hook_event_name: 'Stop', session_id: 'FWD', last_assistant_message: 'bye' }));
    });
  // 1) no runtime file -> exit 0, no output
  assert.deepEqual(await run(), { code: 0, out: '' });
  // 2) runtime file pointing at a dead port -> still exit 0, no output
  writeRuntimeFile({ port: 47912, token: TOKEN, pid: process.pid, startedAt: Date.now(), version: 't' }, path.join(dir, 'bridge.json'));
  assert.deepEqual(await run(), { code: 0, out: '' });
  // 3) live bridge -> delivered
  writeRuntimeFile({ port: PORT, token: TOKEN, pid: process.pid, startedAt: Date.now(), version: 't' }, path.join(dir, 'bridge.json'));
  bridge.store.clear();
  assert.deepEqual(await run(), { code: 0, out: '' });
  await sleep(150);
  assert.equal(bridge.store.snapshot().find((e) => e.sessionId === 'FWD')?.type, 'turn.stopped');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('E: the page gets a file id and a display name, never the path; /api/reveal takes the id only', async () => {
  const shown: string[] = [];
  const P = 47913;
  const b = createBridge({ port: P, token: TOKEN, version: 'test', reorderWindowMs: 20, reveal: (p) => (shown.push(p), true) });
  await new Promise<void>((r) => b.server.listen(P, '127.0.0.1', () => r()));
  try {
    const call = (method: string, p: string, headers: Record<string, string>, body: string) =>
      new Promise<number>((resolve, reject) => {
        const r = http.request({ host: '127.0.0.1', port: P, method, path: p, headers }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode ?? 0)); });
        r.on('error', reject);
        r.end(body);
      });
    const auth = { 'content-type': 'application/json', 'x-office-token': TOKEN };
    const file = process.platform === 'win32' ? 'C:\\proj\\docs\\spec.md' : '/proj/docs/spec.md';
    await call('POST', '/hook', auth, JSON.stringify({ hook_event_name: 'PostToolUse', session_id: 'R1', tool_name: 'Write', tool_use_id: 'w1', tool_input: { file_path: file } }));
    await sleep(80);
    // What is stored (and so sent to the page): no path anywhere, a name of two parts and an id.
    const stored = b.store.snapshot();
    const made = stored.find((e) => e.type === 'file.created');
    assert.ok(made && made.type === 'file.created');
    assert.deepEqual([made.name, made.path, typeof made.fileId], ['docs/spec.md', undefined, 'string']);
    assert.ok(!JSON.stringify(stored).includes('proj'), 'the folder above the last two parts is not in any event');
    const id = made.fileId!;
    assert.equal(await call('POST', '/api/reveal', { 'content-type': 'application/json' }, JSON.stringify({ id })), 401);
    assert.equal(await call('POST', '/api/reveal', { ...auth, origin: 'https://evil.example' }, JSON.stringify({ id })), 403);
    assert.equal(await call('POST', '/api/reveal', { ...auth, 'sec-fetch-site': 'cross-site' }, JSON.stringify({ id })), 403);
    // A path is not accepted, not even the recorded one; nor an unknown id.
    assert.equal(await call('POST', '/api/reveal', auth, JSON.stringify({ id: file })), 404);
    assert.equal(await call('POST', '/api/reveal', auth, JSON.stringify({ path: file })), 400);
    assert.equal(await call('POST', '/api/reveal', auth, JSON.stringify({ id: 'f'.repeat(24) })), 404);
    assert.equal(await call('POST', '/api/reveal', auth, 'not json'), 400);
    assert.deepEqual(shown, []);
    assert.equal(await call('POST', '/api/reveal', auth, JSON.stringify({ id })), 200);
    assert.deepEqual(shown, [file]);
  } finally {
    await b.close();
  }
});

test('reveal: the file manager is started by absolute path with the path quoted', async () => {
  const { revealCommand } = await import('../src/reveal.ts');
  const w = revealCommand('C:/proj/my docs/spec.md', true, 'win32', { SystemRoot: 'C:\\Windows' })!;
  assert.equal(w.file, 'C:\\Windows\\explorer.exe');
  assert.deepEqual(w.args, ['/select,"C:\\proj\\my docs\\spec.md"']);
  assert.equal(revealCommand('C:\\a"b\\c.md', true, 'win32', {}), undefined);
  assert.deepEqual(revealCommand('/p/a.md', true, 'darwin'), { file: '/usr/bin/open', args: ['-R', '/p/a.md'] });
  // Linux: xdg-open is resolved to an absolute path from absolute PATH entries; a bare name is never run.
  const { findOnPath } = await import('../src/reveal.ts');
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'office-bin-'));
  try {
    const opener = path.join(bin, 'xdg-open');
    fs.writeFileSync(opener, '#!/bin/sh\n', { mode: 0o755 });
    const PATH = ['.', 'relative/bin', path.join(bin, 'missing'), bin].join(path.delimiter);
    assert.equal(findOnPath('xdg-open', PATH), opener);
    assert.equal(findOnPath('xdg-open', ['.', 'relative/bin'].join(path.delimiter)), undefined, 'the working folder and relative entries are never used');
    assert.equal(findOnPath('xdg-open', undefined), undefined);
    assert.deepEqual(revealCommand('/p/a.md', true, 'linux', { PATH }), { file: opener, args: ['/p'] });
    assert.deepEqual(revealCommand('/p', false, 'linux', { PATH }), { file: opener, args: ['/p'] });
    assert.equal(revealCommand('/p/a.md', true, 'linux', { PATH: '.' }), undefined, 'no xdg-open found: nothing is started');
  } finally {
    fs.rmSync(bin, { recursive: true, force: true });
  }
});
