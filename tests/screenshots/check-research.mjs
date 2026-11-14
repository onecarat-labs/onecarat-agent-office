// Check of the Research Lab view and of the "open folder" list in the console, with screenshots.
// Runs its own in-process bridge on another port with a FAKE terminal and TEST data in a temporary folder: no
// Claude Code is started and no model is used. The cards in these screenshots are test data, not research.
// Usage: node tests/screenshots/check-research.mjs <outDir> [uiDir]
import { chromium } from 'playwright-core';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createBridge, Terminal } from '../../packages/event-bridge/src/index.ts';

const [outDir = 'tests/screenshots/out', uiArg = 'plugin/onecarat-agent-office/dist/ui'] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const PORT = 47843;
const token = 'e'.repeat(48);
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'office-research-shot-'));
const typed = [];
let emit = () => {};
const pty = {
  spawn() {
    return { pid: 1, onData: (cb) => (emit = cb), onExit: () => {}, write: (d) => { typed.push(d); emit(d.replace(/\r/g, '\r\n')); }, resize: () => {}, kill: () => {} };
  },
};
const mk = () => new Terminal({ load: { ok: true, pty, from: 'fake' }, cwd, command: () => ({ file: 'claude', args: [] }) });
// The Office terminal: the only terminal there is. The research runs in it.
const terminal = mk();
const shown = [];
const bridge = createBridge({ port: PORT, token, uiDir: path.resolve(uiArg), version: 'shot', terminal, reorderWindowMs: 30, reveal: (p) => (shown.push(p), true) });
await new Promise((r) => bridge.server.listen(PORT, '127.0.0.1', r));

const hook = (body) => new Promise((resolve, reject) => {
  const data = JSON.stringify(body);
  const r = http.request({ host: '127.0.0.1', port: PORT, path: '/hook', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), 'x-office-token': token } }, (res) => { res.resume(); res.on('end', resolve); });
  r.on('error', reject);
  r.end(data);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(ok ? 'ok  ' : 'FAIL', name, detail);
};

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ja-JP', colorScheme: 'light' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`http://127.0.0.1:${PORT}/#t=${token}`);
await page.waitForSelector('.splitter.h');

// ---- Office: files written by a request are listed in the console, with a link to their folder ----
const doc = path.join(cwd, 'docs', 'spec.md');
await hook({ hook_event_name: 'SessionStart', session_id: 'office-1', cwd });
await hook({ hook_event_name: 'UserPromptSubmit', session_id: 'office-1', prompt: '実装仕様書を作成してください。' });
await hook({ hook_event_name: 'PostToolUse', session_id: 'office-1', tool_name: 'Write', tool_use_id: 'w1', tool_input: { file_path: doc } });
await page.waitForSelector('.agent-row:has-text("spec.md")');
await page.click('.agent-row:has-text("spec.md")');
await sleep(200);
check('console lists the written file and opens its folder through the bridge', shown.length === 1 && shown[0] === doc, JSON.stringify(shown));
await page.screenshot({ path: path.join(outDir, 'research-0-office-files.png') });

// ---- switch to Research Lab ----
check('Office is the first view', (await page.locator('.mode-name').innerText()) === 'Office');
await page.click('.mode-arrow.right');
check('the arrow switches to Research Lab', (await page.locator('.mode-name').innerText()) === 'Research Lab');
check('the office picture is hidden, the lab is shown', !(await page.locator('.stage-scroll').isVisible()) && (await page.locator('.lab').isVisible()));
check('the save location is shown before starting', (await page.locator('.lab-form').innerText()).includes('research'));
check('start is disabled without a theme', await page.locator('.lab-form button[type=submit]').isDisabled());
check('there is one terminal (the Office terminal); the Research Lab view does not show it, nor the console', (await page.locator('.panel.term-slot').count()) === 1 && !(await page.locator('.bottom').isVisible()));
check('the permission mode is not invented before a hook reported it', (await page.locator('.lab-perm').innerText()).includes('まだ届いていません'));
await page.screenshot({ path: path.join(outDir, 'research-1-idle.png') });

const modeName = () => page.locator('.mode-name').innerText();
// The board may be in the view that is not shown: wait for the pill to exist, not to be visible.
const pill = (text) => page.waitForSelector(`.lab-board-head .pill:has-text("${text}")`, { state: 'attached' });
const startWith = async (theme) => {
  await page.fill('#lab-theme', theme);
  await page.selectOption('.lab-row select >> nth=0', '3');
  await page.selectOption('.lab-row select >> nth=1', '2');
  await page.click('.lab-form button[type=submit]');
  await pill('Enter 待ち');
};

// ---- Claude Code is not running in the Office terminal: nothing is started for the research, the command is shown ----
await startWith('（テストデータ）軽量LLMの特徴と用途');
check('a research never starts Claude Code', terminal.state.running === false && typed.length === 0);
let board = await page.locator('.lab-board').innerText();
check('the command is shown for copying, with the reason', board.includes('コマンドは貼り付けていません') && /\/onecarat-agent-office:research 3 2 r-\d{8}-\d{6}-[0-9a-f]{4} （テストデータ）軽量LLMの特徴と用途/.test(board), board.slice(0, 160).replace(/\s+/g, ' '));
check('nothing was pasted, so the view stays in the Research Lab', (await modeName()) === 'Research Lab');
await page.screenshot({ path: path.join(outDir, 'research-2-copy-command.png') });
await page.click('.lab-board-head button:has-text("取り消す")');
await page.waitForFunction(() => !document.querySelector('.lab-board-head .pill'));

// ---- the user's Claude Code runs in the Office terminal (fake); before its first hook nothing is pasted ----
terminal.start();
const sid = terminal.state.sessionId;
await startWith('（テストデータ）軽量LLMの特徴と用途');
check('nothing is pasted before the session reported its start', typed.length === 0, JSON.stringify(typed).slice(0, 80));
await page.click('.lab-board-head button:has-text("取り消す")');
await page.waitForFunction(() => !document.querySelector('.lab-board-head .pill'));
await hook({ hook_event_name: 'SessionStart', session_id: sid, cwd, permission_mode: 'default' });
await sleep(200);

// ---- start: the command is pasted once; Enter is never pressed by Office ----
await startWith('（テストデータ）軽量LLMの特徴と用途');
await sleep(900);
const run = bridge.research.info().current;
check('the command was pasted once, as a paste, and no Enter followed', typed.length === 1 && typed[0] === `\x1b[200~${run.command}\x1b[201~` && !typed.join('').includes('\r'), JSON.stringify(typed).slice(0, 120));
// The first of the two automatic view changes: to the Office view, where the terminal is and Enter is pressed.
await page.waitForSelector('.mode-banner');
check('after the paste the page shows the Office view', (await modeName()) === 'Office' && (await page.locator('.bottom').isVisible()));
const banner = await page.locator('.mode-banner').innerText();
check('the Office view says where to press Enter, and what to do when nothing starts', banner.includes('下のターミナルで Enter を押すと') && banner.includes('Unknown command') && banner.includes('取り消す'), banner.replace(/\s+/g, ' '));
check('the mode is stated as reported, with what happens in it, and without advice', (await page.locator('.lab-perm').evaluate((el) => el.textContent)).includes('(default)') && (await page.locator('.lab-perm').evaluate((el) => el.textContent)).includes('5〜10回'));
await page.screenshot({ path: path.join(outDir, 'research-3-press-enter.png') });

// ---- the user presses Enter (its hook arrives); the manager opens the research and starts two researchers ----
const RESEARCHER = 'onecarat-agent-office:researcher';
await hook({ hook_event_name: 'UserPromptSubmit', session_id: sid, prompt: run.command, permission_mode: 'default' });
await pill('調査中');
fs.mkdirSync(run.dir, { recursive: true });
/** Test data written the way Claude Code would write it: the file, then the Write hook with the writer's id. */
const write = async (dir, name, value, by, session = sid) => {
  const file = path.join(dir, name);
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
  await hook({ hook_event_name: 'PostToolUse', session_id: session, cwd, tool_name: 'Write', tool_use_id: `w-${name}-${by ?? 'main'}`, tool_input: { file_path: file }, ...(by ? { agent_id: by, agent_type: RESEARCHER } : {}) });
};
await write(run.dir, 'request.json', { researchId: run.id, theme: run.theme, requestedCount: 3, researchers: 2 });
for (const id of ['a1', 'a2']) await hook({ hook_event_name: 'SubagentStart', session_id: sid, agent_id: id, agent_type: RESEARCHER });
await hook({ hook_event_name: 'Stop', session_id: sid, background_tasks: [{ id: 'a1', status: 'running', agent_type: RESEARCHER }, { id: 'a2', status: 'running', agent_type: RESEARCHER }] });
await sleep(300);
check('the manager is free, the research goes on; two researchers are known', bridge.research.info().current.status === 'researching' && bridge.research.info().current.researchers.length === 2);
await page.waitForFunction(() => [...document.querySelectorAll('.stage-scroll .nameplate text')].filter((x) => x.textContent === 'リサーチャー').length === 2);
check('in the Office view the researchers have desks, named "リサーチャー"', true);
await page.screenshot({ path: path.join(outDir, 'research-3b-office-researchers.png') });
// The second automatic view change: back to the Research Lab once they have appeared (nothing waits for approval).
await page.waitForFunction(() => document.querySelector('.mode-name')?.textContent === 'Research Lab', undefined, { timeout: 12000 });
check('the page goes back to the Research Lab by itself, once', true);
check('everyone of the research is listed at the top: the manager and two researchers', (await page.locator('.lab-person').count()) === 3 && (await page.locator('.lab-people').innerText()).includes('リサーチャー 2'));

// ---- a researcher waits for the user's approval ----
await hook({ hook_event_name: 'PreToolUse', session_id: sid, agent_id: 'a1', agent_type: RESEARCHER, tool_name: 'WebSearch', tool_use_id: 'ws1', tool_input: { query: 'x' } });
await hook({ hook_event_name: 'PermissionRequest', session_id: sid, agent_id: 'a1', agent_type: RESEARCHER, tool_name: 'WebSearch', tool_input: { query: 'x' } });
await pill('承認待ち');
check('who is waiting is known: the researcher, not the manager', JSON.stringify(bridge.research.info().current.waiting.map(({ at, ...w }) => w)) === JSON.stringify([{ agentId: 'a1', toolName: 'WebSearch', detail: 'x' }]));
await page.waitForSelector('.lab-wait .wait-rows li');
const waitBox = await page.locator('.lab-wait').innerText();
check('the Research Lab marks the wait, says who and since when, and offers the Office view', waitBox.includes('リサーチャー 1: 許可待ち（たった今）') && waitBox.includes('Office 画面へ'), waitBox.replace(/\s+/g, ' '));
await sleep(1500);
check('the page never moves to the Office view by itself', (await modeName()) === 'Research Lab');
await page.screenshot({ path: path.join(outDir, 'research-4-waiting.png') });
await hook({ hook_event_name: 'PostToolUse', session_id: sid, agent_id: 'a1', agent_type: RESEARCHER, tool_name: 'WebSearch', tool_use_id: 'ws1' });
await pill('調査中');

// ---- the manager's prompt is refused: Claude Code sends nothing, the wait stays until the user hides it ----
await hook({ hook_event_name: 'PreToolUse', session_id: sid, tool_name: 'Write', tool_use_id: 'wm1', tool_input: { file_path: path.join(cwd, 'notes.txt') } });
await hook({ hook_event_name: 'PermissionRequest', session_id: sid, tool_name: 'Write', tool_input: { file_path: path.join(cwd, 'notes.txt') } });
await page.waitForSelector('.lab-wait .wait-rows li:has-text("マネージャー")');
check('the hide button says that only the display changes', (await page.locator('.lab-wait .wait-hide').innerText()) === 'この表示を消す（Claude Code には何も送りません）');
await page.click('.lab-wait .wait-hide');
await page.waitForFunction(() => !document.querySelector('.lab-wait'));
const mgrNow = (await (await fetch(`http://127.0.0.1:${PORT}/api/research`, { headers: { 'x-office-token': token } })).json()).current.waiting;
check('hiding a wait removes it from the page and writes nothing to the terminal', mgrNow.length === 0 && typed.length === 1 && !typed.join('').includes('\r'));

// ---- results arrive one by one, each from its researcher ----
await write(run.dir, 'r1-001.json', { researchId: run.id, id: 'r1-001', title: '（テストデータ）1枚目のカード', summary: 'これは画面確認用のテストデータです。実際の調査結果ではありません。', details: '詳細の本文。\n<b>HTML は解釈されません</b>', findings: ['発見事項 A', '発見事項 B'], sources: [{ title: 'Example', url: 'https://example.com/a' }, { title: 'リンクにならない', url: 'javascript:alert(1)' }], caveats: ['未検証の点があります'], status: 'completed' }, 'a1');
await page.waitForSelector('.lab-card:not(.ghost)');
check('the first card is on the board and two places are still open', (await page.locator('.lab-card:not(.ghost)').count()) === 1 && (await page.locator('.lab-card.ghost').count()) === 2);
await write(run.dir, 'r2-001.json', { researchId: run.id, id: 'r2-001', title: '（テストデータ）2枚目のカード', summary: '参照元のないカード。', sources: [], status: 'partial' }, 'a2');
await write(run.dir, 'r1-002.json', '{ broken json', 'a1');
await page.waitForFunction(() => document.querySelectorAll('.lab-card:not(.ghost)').length === 2);
check('each card has its writer from the hook', JSON.stringify(bridge.research.info().current.cards.map((c) => c.agentId)) === JSON.stringify(['a1', 'a2']));

// ---- the manager checks what came back ----
await hook({ hook_event_name: 'UserPromptSubmit', session_id: sid, prompt: '<task-notification>\n<task-id>a1</task-id>\n<status>completed</status>\n<summary>done</summary>\n</task-notification>' });
await write(run.dir, 'review-r1-001.json', { researchId: run.id, resultId: 'r1-001', verdict: 'confirmed', note: '（テストデータ）参照元があり、矛盾はありません。' });
await page.waitForSelector('.lab-card .pill:has-text("確認済み")');
await hook({ hook_event_name: 'UserPromptSubmit', session_id: sid, prompt: '<agent-message from="a2">\nreport\n</agent-message>' });
await write(run.dir, 'review-r2-001.json', { researchId: run.id, resultId: 'r2-001', verdict: 'needs-check', note: '（テストデータ）参照元がありません。' });
await page.waitForSelector('.lab-card .pill:has-text("要確認")');
check('a report alone is not an end', JSON.stringify(bridge.research.info().current.researchers.map((r) => r.status)) === JSON.stringify(['completed', 'reported']));

// ---- the manager's turn ends without summary.json: never shown as done ----
await hook({ hook_event_name: 'Stop', session_id: sid, last_assistant_message: '2件を保存しました。', background_tasks: [] });
await pill('完了を確認できず');
check('the second researcher is completed now (reported, and no longer running)', bridge.research.info().current.researchers[1].status === 'completed');
await page.screenshot({ path: path.join(outDir, 'research-5-unconfirmed.png') });
// ---- summary.json is written: completed ----
await write(run.dir, 'summary.json', { researchId: run.id, saved: 2, missing: 1, reason: '（テストデータ）1件は根拠が見つかりませんでした。' });
await page.waitForSelector('.lab-board-head .pill:text-is("完了")');
board = await page.locator('.lab-board').innerText();
check('the shortfall is stated, not filled in', board.includes('2 / 3') && board.includes('不足 1件'), board.slice(0, 120).replace(/\s+/g, ' '));
check('a broken file is reported, not shown as a card', board.includes('r1-002.json'));
check('still pasted only once, and never Enter', typed.length === 1 && !typed.join('').includes('\r'));
await page.screenshot({ path: path.join(outDir, 'research-6-done.png') });

// ---- card detail ----
await page.locator('.lab-card:not(.ghost)').first().click();
await page.waitForSelector('dialog.dlg-card[open]');
const links = await page.locator('dialog.dlg-card a').evaluateAll((els) => els.map((a) => a.getAttribute('href')));
check('only the http(s) source is a link', JSON.stringify(links) === JSON.stringify(['https://example.com/a']), JSON.stringify(links));
check('card text is not interpreted as HTML', (await page.locator('dialog.dlg-card b').count()) === 0 && (await page.locator('dialog.dlg-card').innerText()).includes('<b>HTML は解釈されません</b>'));
check('the manager\'s check is shown with its note', (await page.locator('dialog.dlg-card').innerText()).includes('矛盾はありません'));
await page.screenshot({ path: path.join(outDir, 'research-7-detail.png') });
await page.keyboard.press('Escape');

// ---- switching views and reloading keep the board ----
await page.click('.mode-arrow.left');
await page.click('.mode-arrow.right');
check('the cards are still there after switching', (await page.locator('.lab-card:not(.ghost)').count()) === 2);
await page.reload();
await page.waitForSelector('.splitter.h');
await page.click('.mode-arrow.right');
await page.waitForFunction(() => document.querySelectorAll('.lab-card:not(.ghost)').length === 2);
check('the cards are still there after a reload', true);
check('the Office terminal was not stopped by any of this', terminal.state.running === true);

// ---- a second research: a prompt is open when the view would go back, so it does not; the user is offered a button ----
await page.fill('#lab-theme', '（テストデータ）承認待ちのある調査');
await page.click('.lab-form button[type=submit]');
await page.waitForSelector('.mode-banner');
const run2 = bridge.research.info().current;
check('the second research was pasted too (two pastes in all, still no Enter)', typed.length === 2 && !typed.join('').includes('\r') && run2.id !== run.id);
await hook({ hook_event_name: 'UserPromptSubmit', session_id: sid, prompt: run2.command, permission_mode: 'default' });
await hook({ hook_event_name: 'SubagentStart', session_id: sid, agent_id: 'b1', agent_type: RESEARCHER });
await hook({ hook_event_name: 'PreToolUse', session_id: sid, agent_id: 'b1', agent_type: RESEARCHER, tool_name: 'WebFetch', tool_use_id: 'wf1', tool_input: { url: 'https://example.com/page' } });
await hook({ hook_event_name: 'PermissionRequest', session_id: sid, agent_id: 'b1', agent_type: RESEARCHER, tool_name: 'WebFetch', tool_input: { url: 'https://example.com/page' } });
await page.waitForSelector('.mode-banner:has-text("自動で戻りません")', { timeout: 12000 });
check('with a prompt open the view stays in the Office view, and a button to the Research Lab is offered', (await modeName()) === 'Office' && (await page.locator('.mode-banner').innerText()).includes('Research Lab を見る'));
const officeWait = await page.locator('.stage-status .wait-rows').innerText();
check('the Office view shows who waits and since when, with the same hide button', officeWait.includes('リサーチャー: 許可待ち（たった今）') && officeWait.includes('この表示を消す'), officeWait.replace(/\s+/g, ' '));
await page.screenshot({ path: path.join(outDir, 'research-7b-return-held.png') });
await page.click('.stage-status .wait-hide');
await page.waitForFunction(() => !document.querySelector('.stage-status .wait-rows'));
const ev = bridge.store.snapshot().filter((e) => e.type === 'wait.dismissed').at(-1);
check('hiding in the Office view is recorded as the user\'s act on that agent, not as an answer', ev?.agentId === 'b1' && typed.length === 2);
await sleep(1500);
check('after that nothing switches the view by itself any more', (await modeName()) === 'Office');
await page.click('.mode-banner button:has-text("Research Lab を見る")');
check('the button shows the Research Lab', (await modeName()) === 'Research Lab');
const pastes = typed.length;

// ---- a research the user typed themselves in another terminal: shown the same way; files written all at once ----
const ownId = 'r-20261114-002500-f854';
const ownDir = path.join(cwd, 'research', ownId);
fs.mkdirSync(ownDir, { recursive: true });
await hook({ hook_event_name: 'SessionStart', session_id: 'outside-1', cwd });
await write(ownDir, 'request.json', { researchId: ownId, theme: '（テストデータ）自分で打った調査', requestedCount: 3, researchers: 1 }, undefined, 'outside-1');
await hook({ hook_event_name: 'SubagentStart', session_id: 'outside-1', agent_id: 'o1', agent_type: RESEARCHER });
const batch = ['r1-003.json', 'r1-001.json', 'r1-002.json'];
for (const name of batch) fs.writeFileSync(path.join(ownDir, name), JSON.stringify({ researchId: ownId, title: `（テストデータ）まとめ書き ${name.slice(3, 6)}` }));
await Promise.all(batch.map((name) => hook({ hook_event_name: 'PostToolUse', session_id: 'outside-1', cwd, agent_id: 'o1', agent_type: RESEARCHER, tool_name: 'Write', tool_use_id: `b-${name}`, tool_input: { file_path: path.join(ownDir, name) } })));
await page.waitForFunction(() => document.querySelectorAll('.lab-card:not(.ghost)').length === 3, undefined, { timeout: 10000 });
const order = await page.locator('.lab-card:not(.ghost) b').allInnerTexts();
check('typed by the user elsewhere and written all at once: all three cards, in file order', JSON.stringify(order.map((x) => x.slice(-3))) === JSON.stringify(['001', '002', '003']), JSON.stringify(order));
check('Office pasted nothing for it', typed.length === pastes);
await page.selectOption('.lab-board-head select', run.id);
await page.waitForFunction(() => document.querySelectorAll('.lab-card:not(.ghost)').length === 2);

// ---- narrow window ----
await page.setViewportSize({ width: 420, height: 800 });
await sleep(300);
check('no horizontal overflow on a narrow window', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
await page.screenshot({ path: path.join(outDir, 'research-8-narrow.png') });
await page.setViewportSize({ width: 1440, height: 900 });

// ---- a new Office reads the saved researches back from disk; Office itself wrote nothing there ----
check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
await bridge.close();
const again = createBridge({ port: PORT, token, version: 'shot', research: { cwd } });
const past = again.research.info().past;
const back = past.find((p) => p.id === run.id);
check('after a restart the saved research is restored from disk, with its reviews', !!back && back.cards.length === 2 && back.theme === run.theme && back.status === 'completed' && back.cards[0].review?.verdict === 'confirmed');
check('a research without summary.json is restored as "not confirmed"', past.find((p) => p.id === ownId)?.status === 'unconfirmed');
check('the run folder holds only what the test wrote as Claude Code', JSON.stringify(fs.readdirSync(run.dir).sort()) === JSON.stringify(['r1-001.json', 'r1-002.json', 'r2-001.json', 'request.json', 'review-r1-001.json', 'review-r2-001.json', 'summary.json']));
await again.close();
fs.rmSync(cwd, { recursive: true, force: true });
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
