import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { bubbleShort, builtinAlias, dict, langOf, launcherText } from '@onecarat/domain';
import { appArgs, parseLauncherArgs } from '../src/args.ts';
import { detectLang, firstLanguageInRegOutput, windowsDisplayLanguage } from '../src/lang.ts';
import { askApp, healthProof, readRuntimeFile, removeRuntimeFile, runtimeFilePath } from '../src/runtime.ts';
// The forwarder is plain JavaScript shipped as it is; these are the same functions the hooks run.
// @ts-expect-error no type declarations: it is not TypeScript
import { healthProof as forwarderProof, looksStale, pickHookFields, promptHead, runtimeFilePath as forwarderPath } from '../../../plugin/onecarat-agent-office/scripts/forward-lib.mjs';

test('the launcher accepts a command and a port, and nothing else', () => {
  assert.deepEqual(parseLauncherArgs([]), { cmd: 'status' });
  assert.deepEqual(parseLauncherArgs(['start']), { cmd: 'start' });
  assert.deepEqual(parseLauncherArgs(['start', '--port', '47822']), { cmd: 'start', port: 47822 });
  assert.deepEqual(appArgs({ cmd: 'start', port: 47822 }), ['--port', '47822']);
  assert.deepEqual(appArgs({ cmd: 'start' }), []);
  for (const bad of [['open'], ['run'], ['start', '--cwd', 'C:\\'], ['start', '--no-terminal'], ['start', '--port'], ['start', '--port', '80'], ['start', '--port', '99999'], ['start', '--ui', 'x'], ['start', 'extra']]) {
    assert.ok('error' in parseLauncherArgs(bad), bad.join(' '));
  }
  assert.deepEqual(parseLauncherArgs(['open']), { error: 'unknownCommand', arg: 'open' });
  assert.deepEqual(parseLauncherArgs(['start', '--ui', 'x']), { error: 'unknownOption', arg: '--ui' });
  assert.deepEqual(parseLauncherArgs(['start', '--port', '80']), { error: 'badPort', arg: '80' });
});

test('Japanese display language gives Japanese, everything else English', () => {
  for (const tag of ['ja', 'ja-JP', 'JA-jp', 'ja_JP', ' ja-JP ']) assert.equal(langOf(tag), 'ja', tag);
  for (const tag of ['en-US', 'en', 'fr-FR', 'zh-CN', 'jav', 'jam-JM', '', undefined, null, 42]) assert.equal(langOf(tag), 'en', String(tag));
});

test('the launcher reads the Windows display language, the user\'s own choice first', () => {
  const user = '\r\nHKEY_CURRENT_USER\\Control Panel\\Desktop\r\n    PreferredUILanguages    REG_MULTI_SZ    en-US\\0ja-JP\r\n\r\n';
  const machine = '\r\nHKEY_CURRENT_USER\\Control Panel\\Desktop\\MuiCached\r\n    MachinePreferredUILanguages    REG_MULTI_SZ    ja-JP\r\n\r\n';
  assert.equal(firstLanguageInRegOutput(user, 'PreferredUILanguages'), 'en-US');
  assert.equal(firstLanguageInRegOutput(machine, 'MachinePreferredUILanguages'), 'ja-JP');
  assert.equal(firstLanguageInRegOutput(machine, 'PreferredUILanguages'), undefined, 'another value is not read');
  assert.equal(firstLanguageInRegOutput('ERROR: The system was unable to find the specified registry key or value.', 'PreferredUILanguages'), undefined);
  assert.equal(firstLanguageInRegOutput('    PreferredUILanguages    REG_MULTI_SZ    12345', 'PreferredUILanguages'), undefined);

  const reg = (answers: Record<string, string | undefined>) => (_key: string, value: string) => answers[value];
  // The usual PC: no choice of the user's own, the PC is Japanese.
  assert.equal(windowsDisplayLanguage('win32', reg({ MachinePreferredUILanguages: machine })), 'ja-JP');
  assert.equal(detectLang('win32', reg({ MachinePreferredUILanguages: machine }), () => 'en-US'), 'ja');
  // The user chose English on a Japanese PC: English, whatever the regional format says.
  assert.equal(detectLang('win32', reg({ PreferredUILanguages: user, MachinePreferredUILanguages: machine }), () => 'ja-JP'), 'en');
  // Nothing readable in the registry: the regional format decides.
  assert.equal(detectLang('win32', reg({}), () => 'ja-JP'), 'ja');
  assert.equal(detectLang('win32', reg({}), () => 'de-DE'), 'en');
  assert.equal(detectLang('win32', reg({}), () => { throw new Error('no Intl'); }), 'en');
  // Not Windows: the registry is not asked at all.
  assert.equal(detectLang('linux', () => { throw new Error('must not be called'); }, () => 'ja-JP'), 'ja');
});

test('both languages have every word, and no word is empty', () => {
  const shape = (o: Record<string, unknown>) => Object.entries(o).map(([k, v]) => `${k}:${typeof v}`).sort();
  for (const table of [dict, bubbleShort, builtinAlias, launcherText] as Record<'en' | 'ja', Record<string, unknown>>[]) {
    assert.deepEqual(shape(table.ja), shape(table.en));
    for (const lang of ['en', 'ja'] as const) {
      for (const [k, v] of Object.entries(table[lang])) {
        const text = typeof v === 'function' ? (v as (...a: unknown[]) => string)('X', 7, 8, 'Y') : v;
        assert.ok(typeof text === 'string' && text.trim().length > 0, `${lang}.${k}`);
      }
    }
  }
  // English is plain ASCII apart from the dash and the ellipsis, so it also reads in a console without Japanese fonts.
  for (const v of Object.values(launcherText.en)) {
    const text = typeof v === 'function' ? (v as (...a: unknown[]) => string)('X', 7, 8, 'Y') : v;
    assert.match(text, /^[\x20-\x7e—]+$/);
  }
  // scripts/build-plugin.mjs looks for this in the output of "check", in either language.
  for (const lang of ['en', 'ja'] as const) assert.ok(launcherText[lang].checkNodeOk('24.0.0').includes('Node.js'));
});

test('launcher, forwarder and app agree on the runtime file and the proof', () => {
  const env = { LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' };
  assert.equal(runtimeFilePath(env), path.join('C:\\Users\\u\\AppData\\Local', 'onecarat-agent-office', 'bridge.json'));
  assert.equal(forwarderPath(env), runtimeFilePath(env));
  assert.equal(forwarderPath({ ONECARAT_OFFICE_RUNTIME_DIR: 'D:\\tmp\\x' }), path.join('D:\\tmp\\x', 'bridge.json'));
  assert.equal(healthProof('key', '00ff'), forwarderProof('key', '00ff'));
  // Known answer, also pinned in src-tauri/src/server.rs.
  assert.equal(healthProof('key', '00ff'), '0884d92b18b8a98f9e33d75c799a00d5c9523cd19b49ea4207d4b176b79a110a');
});

test('askApp trusts only a listener that proves the token', async () => {
  const token = 'a'.repeat(48);
  const make = (answer: (nonce: string) => unknown) =>
    new Promise<http.Server>((resolve) => {
      const s = http.createServer((req, res) => res.end(JSON.stringify(answer(String(req.headers['x-office-nonce'])))));
      s.listen(0, '127.0.0.1', () => resolve(s));
    });
  const good = await make((n) => ({ app: 'onecarat-agent-office', proof: healthProof(token, n), version: '1.0.0', windows: 2 }));
  const liar = await make(() => ({ app: 'onecarat-agent-office', proof: 'f'.repeat(64) }));
  const other = await make(() => ({ hello: 'world' }));
  try {
    assert.deepEqual(await askApp((good.address() as AddressInfo).port, token), { ok: true, version: '1.0.0', windows: 2 });
    assert.deepEqual(await askApp((liar.address() as AddressInfo).port, token), { ok: false });
    assert.deepEqual(await askApp((other.address() as AddressInfo).port, token), { ok: false });
  } finally {
    for (const s of [good, liar, other]) s.close();
  }
  // nothing listens there
  assert.deepEqual(await askApp(1, token, 300), { ok: false });
});

test('a runtime file is removed only by its own process, and a broken one reads as none', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-rt-'));
  const file = path.join(dir, 'bridge.json');
  try {
    assert.equal(readRuntimeFile(file), undefined);
    fs.writeFileSync(file, '{ not json');
    assert.equal(readRuntimeFile(file), undefined);
    fs.writeFileSync(file, JSON.stringify({ port: 47821, token: 't', pid: 111 }));
    removeRuntimeFile(222, file);
    assert.ok(fs.existsSync(file), 'another process must not remove it');
    removeRuntimeFile(111, file);
    assert.ok(!fs.existsSync(file));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the forwarder does nothing for a stale runtime file', () => {
  const alive = () => true;
  const now = 1_000_000_000;
  assert.equal(looksStale(undefined), true);
  assert.equal(looksStale({ port: '47821', token: 't' }), true);
  assert.equal(looksStale({ port: 47821, token: 't', pid: 1 }, { alive: () => false }), true, 'its process is gone');
  assert.equal(looksStale({ port: 47821, token: 't', pid: 1, startedAt: now - 3_600_000 }, { now, uptimeSec: 600, alive }), true, 'written before this boot');
  assert.equal(looksStale({ port: 47821, token: 't', pid: 1, startedAt: now - 60_000 }, { now, uptimeSec: 600, alive }), false);
});

test('the forwarder sends only what the window draws from', () => {
  const picked = pickHookFields({
    hook_event_name: 'PostToolUse',
    session_id: 's1',
    cwd: 'C:\\proj\\app',
    transcript_path: 'C:\\Users\\u\\.claude\\projects\\x.jsonl',
    prompt: 'p'.repeat(5000),
    last_assistant_message: 'the whole answer',
    tool_name: 'Write',
    tool_use_id: 'tu1',
    tool_input: { file_path: 'C:\\proj\\app\\a.txt', content: 'SECRET FILE CONTENT', old_string: 'x', new_string: 'y', command: 'c'.repeat(1000), message: 'a long report' },
    tool_response: { filePath: 'C:\\proj\\app\\a.txt', content: 'SECRET FILE CONTENT' },
    some_future_field: { anything: true },
  });
  const text = JSON.stringify(picked);
  assert.ok(!text.includes('SECRET'), 'file contents never leave the hook');
  assert.ok(!text.includes('transcript'), 'the transcript path is dropped');
  assert.ok(!text.includes('some_future_field'), 'unknown fields are dropped');
  assert.equal(picked.prompt, '', 'nothing of what the user wrote is sent');
  assert.equal(picked.last_assistant_message, 't');
  assert.deepEqual(picked.tool_input, { message: 'a' }, 'no path and no command: only that a report exists');
  assert.equal(picked.tool_response, undefined, 'only the Agent tool\'s result is read');
  assert.equal(pickHookFields(null), null);
  assert.equal(pickHookFields('text'), null);
  // The Agent tool's result: which agent id the request became, nothing of its output.
  const agent = pickHookFields({ hook_event_name: 'PostToolUse', session_id: 's1', tool_name: 'Agent', tool_response: { agentId: 'a1', isAsync: true, content: [{ text: 'RESULT TEXT' }] } });
  assert.deepEqual(agent.tool_response, { agentId: 'a1', isAsync: true, status: undefined });
});

test('the forwarder sends no text: no command, path, URL, search words or error, and no prompt of the user (audit 2026-11-21)', () => {
  const base = { session_id: 's1', cwd: 'C:\\proj\\app' };
  const sent = (input: Record<string, unknown>) => pickHookFields({ ...base, ...input });
  // A command: only whether it runs tests.
  const run = (tool_name: string, command: string) => sent({ hook_event_name: 'PreToolUse', tool_name, tool_input: { command, description: 'WORDS-OF-THE-MODEL' } });
  assert.deepEqual(run('Bash', 'curl -H "Authorization: Bearer TOPSECRET" https://example.com').tool_input, { is_test: false });
  assert.deepEqual(run('Bash', 'cd app && npm test -- --token TOPSECRET').tool_input, { is_test: true });
  assert.deepEqual(run('PowerShell', 'cargo test').tool_input, { is_test: true });
  assert.deepEqual(run('Read', 'npm test').tool_input, {}, 'only a shell tool has a command');
  // Paths, URLs, search words, errors, the task given to a subagent: nothing.
  const all = JSON.stringify([
    sent({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: 'C:\\proj\\app\\PRIVATE-NAME.txt', path: 'PRIVATE-DIR', pattern: 'PRIVATE-PATTERN' } }),
    sent({ hook_event_name: 'PreToolUse', tool_name: 'WebFetch', tool_input: { url: 'https://private.example/PRIVATE-PATH?k=v', query: 'PRIVATE-QUERY' } }),
    sent({ hook_event_name: 'PreToolUse', tool_name: 'NotebookEdit', tool_input: { notebook_path: 'PRIVATE-NOTEBOOK.ipynb' } }),
    sent({ hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', error: 'PRIVATE-ERROR', is_interrupt: false, tool_input: { command: 'PRIVATE-COMMAND' } }),
    sent({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { description: 'PRIVATE-TASK', prompt: 'PRIVATE-PROMPT', subagent_type: 'Explore' } }),
    sent({ hook_event_name: 'UserPromptSubmit', prompt: 'PRIVATE words of the user' }),
    sent({ hook_event_name: 'UserPromptSubmit', prompt: '<div> PRIVATE html question' }),
    sent({ hook_event_name: 'UserPromptSubmit', prompt: '<agent-message from="a12">\nPRIVATE words of the subagent\n</agent-message>' }),
    sent({ hook_event_name: 'UserPromptSubmit', prompt: '<task-notification>\n<task-id>a1</task-id>\n<status>completed</status>\n<result>PRIVATE result</result>' }),
  ]);
  assert.ok(!all.includes('PRIVATE') && !all.includes('private'), all);
  // What is sent of the turns Claude Code starts itself: the wrapper it wrote, which names the subagent and the status.
  assert.equal(promptHead('fix the bug'), '');
  assert.equal(promptHead('  <agent-message from="a12">\nreport'), '<agent-message from="a12">');
  assert.equal(promptHead('<task-notification>\n<task-id>a1</task-id>\n<status>completed</status>\n<result>words</result>'), '<task-notification>\n<task-id>a1</task-id>\n<status>completed</status>\n');
  assert.equal(promptHead('<system-reminder>' + 'x'.repeat(5000)), '<system-reminder>');
  assert.equal(promptHead('<task-notification>' + 'x'.repeat(5000)).length, 400);
  assert.equal(promptHead(undefined), undefined);
  assert.equal(sent({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { subagent_type: 'Explore' } }).tool_input.subagent_type, 'Explore');
});

test('a runtime file with a port the app cannot have written is not used (Node would throw on it)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-rt-'));
  const file = path.join(dir, 'bridge.json');
  try {
    for (const port of [99999999, 1.5, 80, -1, '47821', null]) {
      assert.equal(looksStale({ port, token: 't' }), true, `forwarder: ${port}`);
      fs.writeFileSync(file, JSON.stringify({ port, token: 't', pid: 1 }));
      assert.equal(readRuntimeFile(file), undefined, `launcher: ${port}`);
    }
    assert.equal(looksStale({ port: 47821, token: 't' }), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('askApp tells a listener that is silent from one that is not the app', async () => {
  // accepts the connection and never answers (a busy app looks like this)
  const mute = await new Promise<http.Server>((resolve) => {
    const s = http.createServer(() => undefined);
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    assert.deepEqual(await askApp((mute.address() as AddressInfo).port, 't', 200), { ok: false, silent: true });
  } finally {
    mute.closeAllConnections();
    mute.close();
  }
  assert.deepEqual(await askApp(1, 't', 300), { ok: false }, 'nothing listens there: not "silent"');
});
