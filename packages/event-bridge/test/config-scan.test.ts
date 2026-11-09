import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createBridge, HIDDEN, projectSlug, sanitize, scanConfig } from '../src/index.ts';

// A fake home, project and managed folder.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'office-cfg-'));
const home = path.join(root, 'home');
const cwd = path.join(root, 'work', 'proj');
const managed = path.join(root, 'managed');
for (const d of [path.join(home, '.claude', 'agents'), path.join(home, '.claude', 'skills', 'release'), path.join(cwd, '.claude'), managed]) fs.mkdirSync(d, { recursive: true });
const SECRET = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789';
fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({ model: 'opus', env: { ANTHROPIC_API_KEY: SECRET, DEBUG: '1' }, apiKeyHelper: '/bin/key', permissions: { allow: ['Bash(npm test)'] } }));
fs.writeFileSync(path.join(home, '.claude', 'agents', 'reviewer.md'), '---\nname: reviewer\ndescription: Reviews code\n---\nBody');
fs.writeFileSync(path.join(home, '.claude', 'skills', 'release', 'SKILL.md'), '---\nname: release\ndescription: "Release steps"\n---\n');
fs.writeFileSync(path.join(home, '.claude', '.credentials.json'), JSON.stringify({ token: SECRET }));
fs.writeFileSync(
  path.join(home, '.claude.json'),
  JSON.stringify({
    oauthAccount: { emailAddress: 'someone@example.com' },
    primaryApiKey: SECRET,
    userID: 'u-123',
    mcpServers: { gh: { command: 'gh-mcp', env: { GITHUB_TOKEN: 'ghp_abcdefghijklmnop' } } },
    projects: { [cwd.replace(/\\/g, '/')]: { allowedTools: ['Read'], lastCost: 1.23, hasTrustDialogAccepted: true }, '/other': { allowedTools: ['X'] } },
  }),
);
const memory = path.join(home, '.claude', 'projects', projectSlug(cwd), 'memory');
fs.mkdirSync(memory, { recursive: true });
fs.writeFileSync(path.join(memory, 'MEMORY.md'), '- [A](a.md) — hook');
fs.writeFileSync(path.join(memory, 'a.md'), '---\nname: a\ndescription: fact\n---\n');
fs.writeFileSync(path.join(cwd, 'CLAUDE.md'), '# Proj\nUse npm.');
fs.writeFileSync(path.join(cwd, '.mcp.json'), '{ broken');
fs.writeFileSync(path.join(root, 'work', 'CLAUDE.md'), 'parent');

after(() => fs.rmSync(root, { recursive: true, force: true }));

const scan = () => scanConfig({ cwd, home, managedDir: managed });
const get = (id: string) => scan().entries.find((e) => e.id === id)!;

test('sanitize hides secret-looking keys and everything under env/headers/args, keeps keys', () => {
  const s = sanitize({ env: { DEBUG: '1' }, headers: { X: 'y' }, apiKeyHelper: 'cmd', nested: { authToken: 'x', note: `Bearer ${'a'.repeat(20)}` }, author: 'me' }) as any;
  assert.deepEqual(s.env, { DEBUG: HIDDEN });
  assert.deepEqual(s.headers, { X: HIDDEN });
  assert.equal(s.apiKeyHelper, HIDDEN);
  assert.equal(s.nested.authToken, HIDDEN);
  assert.ok(!s.nested.note.includes('aaaa'));
  assert.equal(s.author, 'me');
});

test('sanitize: MCP servers and hooks as users really write them leak nothing', () => {
  const s = sanitize({
    mcpServers: {
      a: { command: 'npx', args: ['srv', '--token', 'tok-111', '--port', '3'] },
      b: { url: 'https://mcp.example.com/sse?token=tok-222&x=1', headers: { Authorization: 'tok-333' } },
      c: { command: 'curl -H "X-API-Key: tok-444" https://h/', credentials: { user: 'u', pass: 'tok-555' }, authorization: 'tok-666', authTokens: ['tok-777'] },
    },
    hooks: { Stop: [{ hooks: [{ type: 'command', command: 'deploy --api-key tok-888' }] }] },
    permissions: { allow: ['Bash(npm test)'] },
  }) as any;
  const out = JSON.stringify(s);
  for (let i = 1; i <= 8; i++) assert.ok(!out.includes(`tok-${i}${i}${i}`), `tok-${i}${i}${i} leaked: ${out}`);
  assert.equal(s.mcpServers.a.command, 'npx');
  assert.deepEqual(s.mcpServers.a.args, [HIDDEN, HIDDEN, HIDDEN, HIDDEN, HIDDEN]);
  assert.equal(s.mcpServers.b.url, 'https://mcp.example.com/sse?***');
  assert.deepEqual(s.mcpServers.c.credentials, { user: HIDDEN, pass: HIDDEN });
  assert.deepEqual(s.mcpServers.c.authTokens, [HIDDEN]);
  assert.deepEqual(s.permissions.allow, ['Bash(npm test)']);
});

test('settings.json is parsed with secrets hidden', () => {
  const e = get('user-settings');
  assert.equal(e.exists, true);
  const j = e.json as any;
  assert.equal(j.model, 'opus');
  assert.deepEqual(j.permissions.allow, ['Bash(npm test)']);
  assert.equal(j.env.ANTHROPIC_API_KEY, HIDDEN);
});

test('~/.claude.json: only MCP servers and this project\'s config fields leave the scanner', () => {
  const e = get('user-claude-json');
  const out = JSON.stringify(e.json);
  for (const leak of ['someone@example.com', 'oauthAccount', 'primaryApiKey', 'u-123', 'lastCost', '/other', 'ghp_']) assert.ok(!out.includes(leak), leak);
  const j = e.json as any;
  assert.deepEqual(j.project.allowedTools, ['Read']);
  assert.equal(j.mcpServers.gh.command, 'gh-mcp');
  assert.equal(j.projectsKnown, 2);
});

test('credentials are never read and secrets never appear anywhere in a scan', () => {
  const out = JSON.stringify(scan());
  assert.ok(!out.includes(SECRET));
  assert.ok(!out.includes('.credentials.json'));
});

test('folders, memory, markdown, ancestors, missing and broken files', () => {
  assert.deepEqual(get('user-agents').items, [{ name: 'reviewer', file: 'reviewer.md', description: 'Reviews code' }]);
  assert.deepEqual(get('user-skills').items, [{ name: 'release', file: 'release/SKILL.md', description: 'Release steps' }]);
  const m = get('user-memory');
  assert.equal(m.text, '- [A](a.md) — hook');
  assert.deepEqual(m.items?.map((i) => i.file), ['a.md']);
  assert.equal(get('project-claude-md').text, '# Proj\nUse npm.');
  assert.ok(get('project-ancestors').items?.some((i) => i.file === path.join(root, 'work', 'CLAUDE.md')));
  assert.equal(get('project-settings').exists, false);
  assert.equal(get('managed-settings').exists, false);
  assert.equal(get('project-mcp').error, 'invalid-json');
});

test('/api/config needs the token and validates cwd', async () => {
  const PORT = 47913;
  const TOKEN = 'b'.repeat(48);
  const bridge = createBridge({ port: PORT, token: TOKEN, version: 'test', config: { home, defaultCwd: cwd, managedDir: managed } });
  await new Promise<void>((r) => bridge.server.listen(PORT, '127.0.0.1', () => r()));
  const req = (p: string, headers: Record<string, string> = {}) =>
    new Promise<{ status: number; body: string }>((resolve, reject) => {
      http.get({ host: '127.0.0.1', port: PORT, path: p, headers }, (res) => {
        let s = '';
        res.on('data', (d) => (s += d));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: s }));
      }).on('error', reject);
    });
  try {
    assert.equal((await req('/api/config')).status, 401);
    const ok = await req('/api/config', { 'x-office-token': TOKEN });
    assert.equal(ok.status, 200);
    assert.equal(JSON.parse(ok.body).cwd, path.resolve(cwd));
    assert.equal((await req('/api/config?cwd=relative', { 'x-office-token': TOKEN })).status, 400);
    assert.equal((await req(`/api/config?cwd=${encodeURIComponent(path.join(root, 'nope'))}`, { 'x-office-token': TOKEN })).status, 400);
  } finally {
    await bridge.close();
  }
});
