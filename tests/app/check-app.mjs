// Check of the real app: starts its OWN instance of the built exe and feeds it sample hook inputs through the
// real forwarder. It does not touch an Office the user is running:
//   - its own port (47841) and its own runtime folder (a temporary one), so no hook of a real Claude Code
//     session can reach it and it cannot reach a running app;
//   - no `claude` is started, and nothing is typed anywhere.
// What it does on the screen: up to five small windows open at the top right for about two minutes, then close.
//
//   npm run build:inspect            (once, and after every change of the app or the page)
//   node tests/app/check-app.mjs [outDir] [--lang en|ja]
//
// The window speaks Japanese or English after the Windows display language. Without --lang the check looks at
// whichever this PC gives; with --lang it asks the inspect build for that language, so both can be checked on
// one PC (the shipped app has no such choice).
//
// It runs the "inspect" build: the same app, plus a local debugging port through which this check reads what the
// windows show. The shipped exe has no such port, so it cannot be checked this way; the two differ in that only.
import { chromium } from 'playwright-core';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { askApp, readRuntimeFile } from '../../packages/launcher/src/runtime.ts';
import { bubbleShort, dict } from '../../packages/domain/src/i18n.ts';

const root = path.resolve(import.meta.dirname, '../..');
const EXE = 'onecarat-agent-office.exe';
const exe = path.join(root, 'src-tauri/target/inspect/release', EXE);
const cli = process.argv.slice(2);
const langAt = cli.indexOf('--lang');
const forced = langAt >= 0 ? cli.splice(langAt, 2)[1] : undefined;
if (forced !== undefined && forced !== 'en' && forced !== 'ja') throw new Error('--lang needs en or ja');
const outDir = path.resolve(cli[0] ?? path.join(root, forced ? `tests/app/out-${forced}` : 'tests/app/out'));
if (!fs.existsSync(exe)) throw new Error('no inspect build: run "npm run build:inspect" first');
fs.mkdirSync(outDir, { recursive: true });

const PORT = 47841;
const CDP = 9339;
const rt = fs.mkdtempSync(path.join(os.tmpdir(), 'office-check-'));
// The browser part of the window keeps its own files in the temporary folder too: apart from an Office the user
// is running, and new every time (so the language asked for is the one it starts in).
const env = { ...process.env, ONECARAT_OFFICE_RUNTIME_DIR: rt, ONECARAT_OFFICE_INSPECT_PORT: String(CDP), WEBVIEW2_USER_DATA_FOLDER: path.join(rt, 'webview') };
if (forced) env.ONECARAT_OFFICE_INSPECT_LANG = forced;
else delete env.ONECARAT_OFFICE_INSPECT_LANG;
const forward = path.join(root, 'plugin/onecarat-agent-office/scripts/forward.mjs');
const ps1 = path.join(import.meta.dirname, 'win.ps1');

let failed = 0;
const results = [];
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  results.push({ name, ok: !!ok, detail: String(detail) });
  console.log(ok ? 'ok  ' : 'FAIL', name, detail);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms = 8000, step = 150) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await f();
    if (v) return v;
    if (Date.now() > end) return v;
    await sleep(step);
  }
};
const win = (...args) => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps1, ...args.map(String)], { encoding: 'utf8' });
const windows = (pid) => {
  const j = JSON.parse(win('list', pid));
  const all = Array.isArray(j.windows) ? j.windows : j.windows ? [j.windows] : [];
  // Every Tauri app also owns one internal, fully transparent helper window ("Tao Thread Event Target"); the
  // windows a person can see have the class "Tauri Window".
  return { ...j, windows: all.filter((x) => x.className === 'Tauri Window') };
};

/** One hook input through the real forwarder, exactly as Claude Code would run it. Resolves with how it ended. */
function hook(input, extraEnv = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const p = spawn(process.execPath, [forward], { env: { ...env, ...extraEnv }, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('exit', (code) => resolve({ code, out, ms: Date.now() - t0 }));
    p.stdin.end(typeof input === 'string' ? input : JSON.stringify(input));
  });
}
const S = (session_id, cwd) => (hook_event_name, more = {}) => hook({ session_id, cwd, hook_event_name, permission_mode: 'default', transcript_path: 'C:\\never\\forwarded.jsonl', ...more });

/** A raw request to the app (to try what the forwarder would never send). */
function raw(method, urlPath, { token, body = '', headers = {} } = {}) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: urlPath, method, timeout: 2000, headers: { 'content-length': Buffer.byteLength(body), ...(token ? { 'x-office-token': token } : {}), ...headers } }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', () => resolve(0));
    req.on('timeout', () => { req.destroy(); resolve(0); });
    req.end(body);
  });
}

// ---------- 0. the forwarder when the app is NOT running: silent, quick, exit 0 ----------
{
  const r = await hook({ session_id: 'nobody', hook_event_name: 'PreToolUse', tool_name: 'Bash' });
  check('forwarder is a silent no-op when the app is not running', r.code === 0 && r.out === '', `exit ${r.code}, ${r.ms} ms, output ${JSON.stringify(r.out)}`);
}

// ---------- 1. start ----------
const app = spawn(exe, ['--port', String(PORT)], { env, stdio: 'ignore' });
let appExit = null;
app.on('exit', (c) => (appExit = c));
const info = await until(async () => {
  const i = readRuntimeFile(path.join(rt, 'bridge.json'));
  return i && (await askApp(i.port, i.token)).ok ? i : undefined;
}, 15000);
if (!info) {
  console.error('the app did not start (exit code ' + appExit + ')');
  process.exit(1);
}
check('the app started and proved its token', info.pid === app.pid && info.port === PORT);

let browser;
/** The language the window chose (read from the page), and its words from the one table. */
let lang;
let T = dict.ja;
let L = bubbleShort.ja;
const finish = async (code) => {
  try { await browser?.close(); } catch { /* gone */ }
  if (appExit === null) { try { app.kill(); } catch { /* gone */ } }
  try { fs.rmSync(rt, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }); } catch { /* the browser part still holds a file: the system's temporary folder is cleaned later */ }
  fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify({ at: new Date().toISOString(), exe, lang, failed, results }, null, 2));
  console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed');
  process.exit(code ?? (failed ? 1 : 0));
};

try {
  browser = await until(() => chromium.connectOverCDP(`http://127.0.0.1:${CDP}`).catch(() => undefined), 15000, 500);
  if (!browser) {
    check('could look inside the windows (WebView2 debugging port)', false);
    await finish(1);
  }
  const pages = () => browser.contexts().flatMap((c) => c.pages()).filter((p) => !p.isClosed());
  const state = (p) => p.evaluate(() => ({
    folder: document.querySelector('.folder')?.textContent ?? '',
    hint: document.querySelector('.hint')?.textContent ?? '',
    figures: document.querySelectorAll('.fig').length,
    bubbles: [...document.querySelectorAll('.bubble text')].map((t) => t.textContent),
    waiting: !!document.querySelector('.wait-banner'),
    banner: document.querySelector('.wait-banner')?.textContent ?? '',
    bannerBox: (() => { const b = document.querySelector('.wait-banner')?.getBoundingClientRect(); return b ? { w: b.width, h: b.height } : null; })(),
    frame: !!document.querySelector('.wait-frame'),
    more: document.querySelector('.more text')?.textContent ?? '',
    tod: document.documentElement.dataset.tod,
    lang: document.documentElement.lang,
    // Every label with its box, in window pixels: [text, box of the words, box of the plate behind them].
    labels: [...document.querySelectorAll('.bubble, .nameplate')].map((g) => {
      const box = (e) => { const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
      return { kind: g.classList.contains('bubble') ? 'bubble' : 'nameplate', text: g.querySelector('text').textContent, words: box(g.querySelector('text')), plate: box(g.querySelector('rect')) };
    }),
    bannerWords: (() => { const e = document.querySelector('.wait-text'); if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, text: e.textContent }; })(),
    viewBox: document.querySelector('svg.stage-svg')?.getAttribute('viewBox') ?? '',
    svgBox: (() => { const b = document.querySelector('svg.stage-svg').getBoundingClientRect(); return { w: b.width, h: b.height }; })(),
    inner: { w: innerWidth, h: innerHeight },
    scroll: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight,
    controls: document.querySelectorAll('input, textarea, button, select, a, form, [contenteditable], [role="button"], [tabindex]').length,
    tauriKeys: Object.keys(window.__TAURI__ ?? {}),
  })).catch(() => undefined);
  const pageOf = (folder) => until(async () => { for (const p of pages()) if ((await state(p))?.folder === folder) return p; }, 8000);
  const shot = (p, name) => p.screenshot({ path: path.join(outDir, name) }).catch(() => undefined);

  // ---------- 2. the first window: top right, on top, waiting, does not take the keyboard ----------
  await until(() => pages().length === 1);
  let w = windows(app.pid);
  check('one window is open at start', w.windows.length === 1 && pages().length === 1, `${w.windows.length} window(s)`);
  const first = w.windows[0];
  check('it is always on top', first?.topmost === true);
  check('it can be resized and put away in the taskbar (minimize button), and has no maximize button', first?.resizable && first?.minimizeBox && !first?.maximizeBox, JSON.stringify({ resizable: first?.resizable, min: first?.minimizeBox, max: first?.maximizeBox }));
  // Windows 10/11 draw an invisible resize border of about 8 px around a window, so "at the edge" allows for it.
  const nearRight = Math.abs(first.x + first.w - (w.work.x + w.work.w)) <= 40;
  const nearTop = first.y - w.work.y >= 0 && first.y - w.work.y <= 40;
  check('it is at the top right of the primary screen', nearRight && nearTop, `window ${first.x},${first.y} ${first.w}x${first.h}; work area ${w.work.x},${w.work.y} ${w.work.w}x${w.work.h}`);
  check('it did not take the keyboard from the terminal', w.foregroundPid !== app.pid, `foreground pid ${w.foregroundPid}, app ${app.pid}`);
  let st = await state(pages()[0]);
  lang = st?.lang;
  check('the window speaks Japanese or English' + (forced ? ` (asked for ${forced})` : ', after the Windows display language'), (lang === 'ja' || lang === 'en') && (!forced || lang === forced), `lang ${lang}`);
  if (lang !== 'ja' && lang !== 'en') await finish(1);
  T = dict[lang];
  L = bubbleShort[lang];
  check('it shows the empty office and says it is waiting', st?.hint === T.waitingForSession && st.figures === 0, st?.hint);
  await shot(pages()[0], '01-waiting.png');

  // ---------- 3. session A: figures move with the events ----------
  const A = S('aaaa-1111', 'C:\\proj\\alpha');
  await A('SessionStart', { source: 'startup' });
  await A('UserPromptSubmit', { prompt: 'この文章は小窓には出ません。SECRET-PROMPT' });
  const pa = await pageOf('alpha');
  check('the waiting window became session A\'s window (folder name shown)', !!pa && pages().length === 1);
  st = await until(async () => { const s = await state(pa); return s?.bubbles.includes(L.thinking) ? s : undefined; });
  check('the manager is thinking after the user\'s request', st?.figures === 1 && st?.bubbles.includes(L.thinking), JSON.stringify(st?.bubbles));
  w = windows(app.pid);
  check('the title bar shows the folder name', w.windows[0]?.title === 'alpha', w.windows[0]?.title);
  await A('PreToolUse', { tool_name: 'Agent', tool_use_id: 'tu-agent-1', tool_input: { description: 'コードを調べる', subagent_type: 'Explore', prompt: 'SECRET-SUBAGENT-PROMPT' } });
  await A('SubagentStart', { agent_id: 'sub-1', agent_type: 'Explore' });
  await A('PreToolUse', { agent_id: 'sub-1', agent_type: 'Explore', tool_name: 'Read', tool_use_id: 'tu-r1', tool_input: { file_path: 'C:\\proj\\alpha\\src\\main.ts' } });
  st = await until(async () => { const s = await state(pa); return s?.figures === 2 && s.bubbles.includes(L.reading) ? s : undefined; }, 10000);
  check('a subagent figure appears and works at its desk', st?.figures === 2 && st?.bubbles.includes(L.reading), JSON.stringify(st?.bubbles));
  check('the manager shows that it is delegating', st?.bubbles.includes(L.delegating), JSON.stringify(st?.bubbles));
  await shot(pa, '02-working.png');
  const text = await pa.evaluate(() => document.documentElement.outerHTML);
  check('prompt text is nowhere in the window', !text.includes('SECRET'));

  // ---------- 4. waiting for approval ----------
  await A('PermissionRequest', { agent_id: 'sub-1', agent_type: 'Explore', tool_name: 'Bash', tool_input: { command: 'rm -rf node_modules' } });
  st = await until(async () => { const s = await state(pa); return s?.waiting ? s : undefined; });
  check('approval wait: banner and frame over the whole window', st?.waiting && st.frame && st.banner.includes(T.needsApproval), st?.banner);
  check('approval wait: the figure that waits says so', st?.bubbles.includes(L.waiting_permission), JSON.stringify(st?.bubbles));
  check('approval wait: the banner spans the window', st?.bannerBox && st.bannerBox.w >= st.inner.w - 2 && st.bannerBox.h >= 20, JSON.stringify(st?.bannerBox));
  w = windows(app.pid);
  check('approval wait: the title bar says so too', w.windows[0]?.title === `⚠ ${T.needsApproval} — alpha`, w.windows[0]?.title);
  await shot(pa, '03-approval.png');
  // as small as the window can get
  // The smallest size the app allows when dragging (220 x 140). The limit itself only acts on a drag with the
  // mouse, which this check does not do: it puts the window at exactly that size.
  {
    const x = w.windows[0];
    const scale = x.clientW / 420;
    win('move', x.hwnd, x.x + 150, x.y, Math.round(220 * scale) + (x.w - x.clientW), Math.round(140 * scale) + (x.h - x.clientH));
  }
  st = await until(async () => { const s = await state(pa); return s && s.inner.w < 300 ? s : undefined; });
  const fontPx = await pa.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.wait-text')).fontSize));
  check('approval wait: still plain at the smallest size', st?.waiting && st.bannerBox.w >= st.inner.w - 2 && fontPx >= 14, `window ${st?.inner.w}x${st?.inner.h}, banner text ${fontPx}px`);
  // Readable in this language at the smallest size: the banner's words are not cut off, and every label's words
  // are inside its plate and inside the window.
  const cutOff = st?.bannerWords ? st.bannerWords.l < 4 || st.bannerWords.r > st.inner.w - 4 : true;
  check('approval wait at the smallest size: the banner shows all of its words', st?.bannerWords?.text === T.needsApproval && !cutOff, JSON.stringify(st?.bannerWords));
  const inside = (a, b, slack = 0.5) => a.l >= b.l - slack && a.r <= b.r + slack && a.t >= b.t - slack && a.b <= b.b + slack;
  const view = { l: 0, t: 0, r: st?.inner.w, b: st?.inner.h };
  const badLabels = (st?.labels ?? []).filter((x) => !inside(x.words, x.plate) || !inside(x.plate, view));
  const smallBubbles = (st?.labels ?? []).filter((x) => x.kind === 'bubble').map((x) => x.text);
  check('the smallest window: every label fits its plate and the window', st?.labels.length >= 4 && badLabels.length === 0 && smallBubbles.includes(L.waiting_permission) && smallBubbles.includes(L.delegating), JSON.stringify(badLabels.length ? badLabels : st?.labels.map((x) => x.text)));
  check('the smallest window is still a usable picture', st?.inner.w >= 200 && st?.inner.h >= 120 && !st.scroll, `${st?.inner.w}x${st?.inner.h}`);
  await shot(pa, '04-approval-smallest.png');
  win('move', w.windows[0].hwnd, w.windows[0].x, w.windows[0].y, w.windows[0].w, w.windows[0].h);
  // the user answered in Claude Code: the tool ran
  await A('PostToolUse', { agent_id: 'sub-1', agent_type: 'Explore', tool_name: 'Bash', tool_use_id: 'tu-b1' });
  st = await until(async () => { const s = await state(pa); return s && !s.waiting ? s : undefined; });
  check('the approval display goes away once the tool has run', st && !st.waiting && !st.frame);
  w = windows(app.pid);
  check('and the title is the folder name again', w.windows[0]?.title === 'alpha', w.windows[0]?.title);

  // ---------- 4b. put away in the taskbar: the window keeps following its session ----------
  {
    const hwnd = w.windows[0].hwnd;
    const one = () => windows(app.pid).windows.find((x) => x.hwnd === hwnd);
    const before = one();
    win('minimize', hwnd);
    const away = await until(() => { const x = one(); return x?.minimized ? x : undefined; });
    check('the window can be put away in the taskbar, and the app keeps running', away?.minimized === true && appExit === null && windows(app.pid).windows.length === 1, JSON.stringify({ minimized: away?.minimized }));
    await sleep(3000);
    const t0 = Date.now();
    await A('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'echo hi' } });
    const told = await until(() => { const x = one(); return x?.title === `⚠ ${T.needsApproval} — alpha` ? x : undefined; }, 10000, 250);
    check('put away: its taskbar title tells of a wait for approval, without delay', !!told && told.minimized && Date.now() - t0 < 5000, `title "${one()?.title}" after ${Date.now() - t0} ms`);
    check('put away: it did not come back or take the keyboard by itself', one()?.minimized === true && windows(app.pid).foregroundPid !== app.pid);
    await A('PostToolUse', { tool_name: 'Bash', tool_use_id: 'tu-b2' });
    const quiet = await until(() => { const x = one(); return x?.title === 'alpha' ? x : undefined; }, 10000, 250);
    check('put away: the title is the folder name again once the tool has run', !!quiet && quiet.minimized, one()?.title);
    win('restore', hwnd);
    const back = await until(() => { const x = one(); return x && !x.minimized ? x : undefined; });
    st = await until(async () => { const s = await state(pa); return s && !s.waiting && s.figures === 2 ? s : undefined; });
    check('brought back: same place, same size, still on top, the picture is current', back && back.topmost && Math.abs(back.x - before.x) <= 2 && Math.abs(back.y - before.y) <= 2 && Math.abs(back.w - before.w) <= 2 && Math.abs(back.h - before.h) <= 2 && st?.figures === 2 && !st.waiting, back ? `${back.x},${back.y} ${back.w}x${back.h} (was ${before.x},${before.y} ${before.w}x${before.h})` : 'not back');
  }

  // ---------- 5. more sessions: one window each, not mixed ----------
  const B = S('bbbb-2222', 'C:\\proj\\beta');
  await B('UserPromptSubmit', { prompt: 'hello' });
  const pb = await pageOf('beta');
  check('a second session gets its own window', !!pb && pages().length === 2);
  await B('PermissionRequest', { tool_name: 'Write', tool_input: { file_path: 'C:\\proj\\beta\\x.txt' } });
  st = await until(async () => { const s = await state(pb); return s?.waiting ? s : undefined; });
  const sa = await state(pa);
  check('session B waits for approval, session A does not', st?.waiting === true && sa?.waiting === false);
  check('session A still has its own two figures, session B only its manager', sa?.figures === 2 && st?.figures === 1, `A ${sa?.figures}, B ${st?.figures}`);
  await B('PostToolUse', { tool_name: 'Write', tool_use_id: 'tu-w1' });
  const C = S('cccc-3333', 'C:\\proj\\gamma');
  const D = S('dddd-4444', 'C:\\proj\\delta');
  await C('UserPromptSubmit', { prompt: 'c' });
  await D('UserPromptSubmit', { prompt: 'd' });
  const pc = await pageOf('gamma');
  const pd = await pageOf('delta');
  check('four sessions: four windows', !!pc && !!pd && pages().length === 4);
  w = await until(() => { const x = windows(app.pid); return x.windows.length === 4 ? x : undefined; });
  const overlap = (a, b) => a.x < b.x + b.w - 16 && b.x < a.x + a.w - 16 && a.y < b.y + b.h - 16 && b.y < a.y + a.h - 16;
  let overlapping = 0;
  for (let i = 0; i < w.windows.length; i++) for (let j = i + 1; j < w.windows.length; j++) if (overlap(w.windows[i], w.windows[j])) overlapping++;
  check('the four windows do not overlap', w.windows.length === 4 && overlapping === 0, w.windows.map((x) => `${x.title}@${x.x},${x.y} ${x.w}x${x.h}`).join(' | '));
  check('all four are on top and inside the screen', w.windows.every((x) => x.topmost && x.x >= w.work.x - 16 && x.y >= w.work.y && x.x + x.w <= w.work.x + w.work.w + 16 && x.y + x.h <= w.work.y + w.work.h + 16));
  check('each title bar names its own folder', ['alpha', 'beta', 'gamma', 'delta'].every((n) => w.windows.some((x) => x.title === n)), w.windows.map((x) => x.title).join(', '));
  // (Session A's window was brought back from the taskbar above, which gives it the keyboard like any window
  // brought back; what must not happen is that a window that just opened takes it.)
  const newOnes = w.windows.filter((x) => ['beta', 'gamma', 'delta'].includes(x.title)).map((x) => x.hwnd);
  check('new windows did not take the keyboard', newOnes.length === 3 && !newOnes.includes(w.foregroundHwnd), `foreground window ${w.windows.find((x) => x.hwnd === w.foregroundHwnd)?.title ?? 'of another app'}`);
  // a burst for one session must not show up anywhere else
  for (let i = 0; i < 6; i++) await C('PreToolUse', { tool_name: 'Edit', tool_use_id: `tu-c${i}`, tool_input: { file_path: 'C:\\proj\\gamma\\a.ts' } });
  st = await until(async () => { const s = await state(pc); return s?.bubbles.includes(L.editing) ? s : undefined; });
  const others = await Promise.all([pa, pb, pd].map(state));
  check('session C edits; no other window shows it', st?.bubbles.includes(L.editing) && others.every((o) => !o.bubbles.includes(L.editing)), JSON.stringify(others.map((o) => o.bubbles)));

  // ---------- 6. unknown events and broken data ----------
  const before = await state(pa);
  const bad = [
    await raw('POST', '/hook', { token: info.token, body: 'this is not json' }),
    await raw('POST', '/hook', { token: info.token, body: '[1,2,3]' }),
    await raw('POST', '/hook', { token: info.token, body: '{"session_id":' }),
    await raw('POST', '/hook', { token: info.token, body: Buffer.from([0xff, 0xfe, 0x00, 0x80]).toString('latin1') }),
    await raw('POST', '/hook', { token: info.token, body: JSON.stringify({ session_id: 'aaaa-1111', hook_event_name: 'EventFromTheFuture', brand_new: { deep: [1, 2, 3] } }) }),
    await raw('POST', '/hook', { token: info.token, body: JSON.stringify({ session_id: 'aaaa-1111', hook_event_name: 'PreToolUse', tool_name: 12, tool_input: 'oops', tool_use_id: {} }) }),
    await raw('POST', '/hook', { token: info.token, body: JSON.stringify({ session_id: 'aaaa-1111', hook_event_name: 'SubagentStart', agent_id: 99, agent_type: [] }) }),
    await raw('POST', '/hook', { token: info.token, body: JSON.stringify({ session_id: 'aaaa-1111', hook_event_name: 'Stop', background_tasks: 'x', last_assistant_message: 5, cwd: 77 }) }),
    await raw('POST', '/hook', { token: info.token, body: JSON.stringify({ session_id: 42, hook_event_name: 'PreToolUse' }) }),
  ];
  check('broken and unknown hook data is accepted without an error', bad.every((s) => s === 204), bad.join(','));
  const viaForwarder = [await hook('not json at all'), await hook(''), await hook('{"a":'), await hook({ hook_event_name: 'FutureThing', session_id: 'aaaa-1111' })];
  check('the forwarder stays silent and exits 0 on broken input', viaForwarder.every((r) => r.code === 0 && r.out === ''), viaForwarder.map((r) => `${r.code}/${r.ms}ms`).join(' '));
  const refused = [
    await raw('POST', '/hook', { body: '{}' }),
    await raw('POST', '/hook', { token: 'x'.repeat(48), body: '{}' }),
    await raw('POST', '/hook', { token: info.token, body: '{}', headers: { origin: 'http://evil.example' } }),
    await raw('POST', '/hook', { token: info.token, body: '{}', headers: { host: 'evil.example' } }),
    await raw('POST', '/api/shutdown', {}),
  ];
  check('posts without the token, from a browser or for another host are refused', refused.every((s) => s === 403), refused.join(','));
  const big = await raw('POST', '/hook', { token: info.token, body: 'x'.repeat(600 * 1024) });
  check('an oversized post is refused', big === 413 || big === 0, String(big));
  await sleep(600);
  const after = await state(pa);
  check('the app is still running and the windows are unchanged', appExit === null && (await askApp(info.port, info.token)).ok && pages().length === 4 && after?.figures === before?.figures, `figures ${before?.figures} -> ${after?.figures}`);
  // the Stop with wrong types was still a Stop: a later real event shows the picture is alive
  await A('UserPromptSubmit', { prompt: 'again' });
  st = await until(async () => { const s = await state(pa); return s?.bubbles.includes(L.thinking) ? s : undefined; });
  check('events after the broken ones are shown as usual', !!st, JSON.stringify(st?.bubbles));

  // ---------- 7. no way in: the window has nothing to operate, the app has no other endpoint ----------
  const all = await Promise.all(pages().map(state));
  check('no window has anything to type in, press or follow', all.every((s) => s.controls === 0), all.map((s) => s.controls).join(','));
  const paths = ['/', '/index.html', '/api/prompt', '/api/terminal', '/pty', '/events', '/api/send', '/api/approve'];
  const codes = [];
  for (const p of paths) codes.push(await raw('GET', p, { token: info.token }), await raw('POST', p, { token: info.token, body: '{}' }));
  check('the listener has no other endpoint (all 404)', codes.every((c) => c === 404), codes.join(','));
  const cmds = await pa.evaluate(async () => {
    const out = {};
    for (const c of ['send', 'write', 'approve', 'prompt', 'plugin:shell|execute', 'plugin:shell|open', 'plugin:fs|write_file', 'plugin:window|set_size']) {
      try { await window.__TAURI__.core.invoke(c, {}); out[c] = 'ALLOWED'; } catch (e) { out[c] = 'refused'; }
    }
    return out;
  });
  check('the window can call nothing but its three commands', Object.values(cmds).every((v) => v === 'refused'), JSON.stringify(cmds));

  // ---------- 8. more subagents than desks, then a larger window ----------
  for (let i = 2; i <= 6; i++) {
    await A('SubagentStart', { agent_id: `sub-${i}`, agent_type: 'general-purpose' });
    await A('PreToolUse', { agent_id: `sub-${i}`, agent_type: 'general-purpose', tool_name: 'Grep', tool_use_id: `tu-g${i}`, tool_input: { pattern: 'TODO' } });
  }
  st = await until(async () => { const s = await state(pa); return s?.more === '+4' ? s : undefined; }, 10000);
  check('six subagents in a small window: two desks and "+4"', st?.more === '+4' && st.figures === 3, `figures ${st?.figures}, badge ${st?.more}`);
  await shot(pa, '05-overflow.png');
  w = windows(app.pid);
  const wa = w.windows.find((x) => x.title === 'alpha');
  const smallBox = st.viewBox;
  win('move', wa.hwnd, w.work.x + 40, w.work.y + w.work.h - 420, 1300, 380);
  st = await until(async () => { const s = await state(pa); return s && s.inner.w > 700 && s.figures === 7 ? s : undefined; }, 20000);
  check('resized larger: the picture follows and everyone has a desk', st?.figures === 7 && st.more === '' && st.viewBox !== smallBox, `figures ${st?.figures}, viewBox ${smallBox} -> ${st?.viewBox}`);
  check('the picture fills the window without scrolling', st && Math.abs(st.svgBox.w - st.inner.w) < 2 && Math.abs(st.svgBox.h - st.inner.h) < 2 && !st.scroll, JSON.stringify(st?.svgBox));
  const moved = windows(app.pid).windows.find((x) => x.hwnd === wa.hwnd);
  check('moved: the window is where it was put', Math.abs(moved.x - (w.work.x + 40)) <= 2 && Math.abs(moved.w - 1300) <= 2, `${moved.x},${moved.y} ${moved.w}x${moved.h}`);
  await sleep(1500);
  await shot(pa, '06-large.png');

  // ---------- 9. time of day (the PC's clock, replaced inside this one window) ----------
  const at = (h, m = 0, s = 0) => new Date(2026, 10, 21, h, m, s);
  const seen = {};
  for (const [name, h] of [['morning', 7], ['day', 12], ['evening', 17], ['night', 22]]) {
    await pa.clock.setFixedTime(at(h));
    const got = await until(async () => ((await state(pa))?.tod === name ? name : undefined), 20000, 500);
    seen[name] = got;
    const colours = await pa.evaluate(() => ({ sky: getComputedStyle(document.documentElement).getPropertyValue('--sky-top').trim(), line: getComputedStyle(document.documentElement).getPropertyValue('--figure-line').trim(), moon: !!document.querySelector('.moon'), sun: !!document.querySelector('.sun') }));
    seen[name + ':c'] = colours;
    await sleep(1400); // colour transition
    await shot(pa, `07-${name}.png`);
  }
  check('the background follows the clock: morning, day, evening, night', ['morning', 'day', 'evening', 'night'].every((n) => seen[n] === n), JSON.stringify(Object.fromEntries(['morning', 'day', 'evening', 'night'].map((n) => [n, seen[n]]))));
  const skies = ['morning', 'day', 'evening', 'night'].map((n) => seen[n + ':c']?.sky);
  check('each time of day has its own sky; night has the moon, the others the sun', new Set(skies).size === 4 && seen['night:c']?.moon && !seen['night:c']?.sun && seen['day:c']?.sun, skies.join(' '));
  // crossing a border while the window is open: 18:59:50 -> 19:00:05
  await pa.clock.setFixedTime(at(18, 59, 50));
  const b1 = await until(async () => ((await state(pa))?.tod === 'evening' ? 'evening' : undefined), 20000, 500);
  await pa.clock.setFixedTime(at(19, 0, 5));
  const b2 = await until(async () => ((await state(pa))?.tod === 'night' ? 'night' : undefined), 20000, 500);
  check('crossing 19:00 while open switches evening -> night without a restart', b1 === 'evening' && b2 === 'night', `${b1} -> ${b2}`);

  // ---------- 10. a session ends: goodbye, then its window closes; /clear keeps the window ----------
  await B('SessionEnd', { reason: 'prompt_input_exit' });
  const closed = await until(() => pb.isClosed() || !pages().includes(pb), 15000);
  check('session B ended: its window closed by itself', !!closed && windows(app.pid).windows.length === 3);
  await C('SessionEnd', { reason: 'clear' });
  const C2 = S('cccc-9999', 'C:\\proj\\gamma');
  await C2('SessionStart', { source: 'clear' });
  await C2('UserPromptSubmit', { prompt: 'after clear' });
  await sleep(9500); // longer than the goodbye
  st = await state(pc);
  check('/clear in session C: the same window goes on with the new session', !pc.isClosed() && st?.folder === 'gamma' && st.bubbles.includes(L.thinking) && windows(app.pid).windows.length === 3, JSON.stringify(st?.bubbles));

  // ---------- 11. the user closes a window ----------
  const wd = windows(app.pid).windows.find((x) => x.title === 'delta');
  win('close', wd.hwnd);
  await until(() => windows(app.pid).windows.length === 2);
  await D('PreToolUse', { tool_name: 'Read', tool_use_id: 'tu-d1', tool_input: { file_path: 'C:\\proj\\delta\\a.ts' } });
  await sleep(1200);
  check('a window the user closed does not come back by itself', windows(app.pid).windows.length === 2);
  check('asking for the office again is accepted', (await raw('POST', '/api/show', { token: info.token })) === 200);
  await D('PreToolUse', { tool_name: 'Read', tool_use_id: 'tu-d2', tool_input: { file_path: 'C:\\proj\\delta\\a.ts' } });
  check('after asking again, that session gets a window again', !!(await pageOf('delta')) && windows(app.pid).windows.length === 3);

  // ---------- 12. closing every window ends the app ----------
  for (const x of windows(app.pid).windows) win('close', x.hwnd);
  await until(() => appExit !== null, 8000);
  check('closing the last window ends the app', appExit !== null, `exit code ${appExit}`);
  check('and its runtime file is gone', !fs.existsSync(path.join(rt, 'bridge.json')));
  const late = await hook({ session_id: 'aaaa-1111', hook_event_name: 'PreToolUse', tool_name: 'Bash' });
  check('hooks after that are silent no-ops again', late.code === 0 && late.out === '', `${late.ms} ms`);
} catch (e) {
  check('the check ran to its end', false, e?.stack ?? String(e));
}
await finish();
