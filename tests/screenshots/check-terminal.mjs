// Check: access key handling and the built-in terminal, in a real browser (Edge, headless).
// Starts the embedded `claude` with the button, waits for its UI and its SessionStart hook, then stops it.
// It never types into the terminal (no prompt is sent, no model call).
// Usage: node tests/screenshots/check-terminal.mjs <outDir>
import { chromium } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';
import { readRuntimeFile } from '../../packages/event-bridge/src/runtime-file.ts';

const [outDir = 'tests/screenshots/out'] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const rt = readRuntimeFile();
if (!rt) throw new Error('Office is not running');
const base = `http://127.0.0.1:${rt.port}/`;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1672, height: 941 }, locale: 'ja-JP', colorScheme: 'light' });
const shot = async (page, name) => {
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file });
  return file;
};
const result = {};

// 1) without the key: no data, a clear message
{
  const page = await ctx.newPage();
  await page.goto(base);
  await page.waitForTimeout(1500);
  result.noKey = {
    chips: await page.locator('.chip').allTextContents(),
    overlay: await page.locator('.live-waiting').textContent().catch(() => null),
    shot: await shot(page, 'locked'),
  };
  await page.close();
}

// 2) with the key in the fragment (like the launcher)
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
page.on('console', (m) => m.type() === 'error' && pageErrors.push(m.text()));
await page.goto(`${base}#t=${rt.token}`);
await page.waitForTimeout(1500);
result.urlAfterLoad = page.url();
result.keyRemovedFromUrl = !page.url().includes(rt.token);
result.chipsBefore = await page.locator('.chip').allTextContents();
result.tabs = await page.locator('.tabs [role=tab]').allTextContents();
result.cwd = await page.locator('.term-cwd').textContent();
await shot(page, 'terminal-idle');

// 3) start claude from the button and wait for its screen + hook session
await page.getByRole('button', { name: 'ここで Claude Code を開始' }).click();
const t0 = Date.now();
let screen = '';
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(500);
  screen = await page.locator('.term .xterm-rows').innerText().catch(() => '');
  if (/Claude Code/.test(screen) && (await page.locator('.chip').allTextContents()).some((c) => /onecarat-agent-office ·/.test(c))) break;
}
result.secondsToScreenAndSession = (Date.now() - t0) / 1000;
result.screenHasClaude = /Claude Code/.test(screen);
result.chipsRunning = await page.locator('.chip').allTextContents();
result.stopButton = await page.getByRole('button', { name: 'Claude Code を終了' }).count();
await shot(page, 'terminal-running');

// 4) reload: the key survives in this tab (sessionStorage), the scrollback is replayed from memory
await page.reload();
await page.waitForTimeout(2500);
result.afterReload = { chips: await page.locator('.chip').allTextContents(), screenHasClaude: /Claude Code/.test(await page.locator('.term .xterm-rows').innerText().catch(() => '')) };

// 5) stop
await page.getByRole('button', { name: 'Claude Code を終了' }).click();
await page.waitForTimeout(1500);
result.afterStop = { startButton: await page.getByRole('button', { name: 'ここで Claude Code を開始' }).count() };
await shot(page, 'terminal-stopped');
result.pageErrors = pageErrors;
await browser.close();
console.log(JSON.stringify({ ...result, urlAfterLoad: result.urlAfterLoad.replace(rt.token, '<TOKEN>') }, null, 2));
