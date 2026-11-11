// Visual check of the settings view (Office display + Claude Code configuration), using the real files of this
// machine (read-only). Runs its own in-process bridge on another port, so a running Office is not touched.
// Usage: node tests/screenshots/capture-config.mjs <outDir> [uiDir]   (uiDir defaults to the built plugin's UI)
import { chromium } from 'playwright-core';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createBridge } from '../../packages/event-bridge/src/index.ts';

const [outDir = 'tests/screenshots/out', uiArg = 'plugin/onecarat-agent-office/dist/ui'] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const PORT = 47841;
const token = 'c'.repeat(48);
const uiDir = path.resolve(uiArg);
const bridge = createBridge({ port: PORT, token, uiDir, version: 'shot', config: { home: os.homedir(), defaultCwd: process.cwd() } });
await new Promise((r) => bridge.server.listen(PORT, '127.0.0.1', r));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const desktop = (colorScheme) => ({ viewport: { width: 1440, height: 900 }, locale: 'ja-JP', colorScheme });
// [file name, browser context, menu entry (index in the left pane), row to open in the middle pane]
for (const [name, opts, menu, row] of [
  ['settings-ja-light-display', desktop('light'), 0, 'アニメーション'],
  ['settings-ja-light-settings', desktop('light'), 1, '.claude/settings.json'],
  ['settings-ja-dark-mcp', desktop('dark'), 3, '.claude.json'],
  ['settings-ja-light-missing', desktop('light'), 3, '.mcp.json'],
  ['settings-ja-memory', desktop('light'), 2, '.claude/projects/<project>/memory/'],
  ['settings-en-tablet', { viewport: { width: 820, height: 1100 }, locale: 'en-US', colorScheme: 'light' }, 4, undefined],
  ['settings-en-phone', { viewport: { width: 390, height: 844 }, locale: 'en-US', colorScheme: 'light' }, 1, undefined],
]) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/#t=${token}`);
  await page.click('nav.rail button:last-child');
  await page.waitForSelector('.cfg-menu-item .count');
  await page.locator('.cfg-menu-item').nth(menu).click();
  if (row) await page.locator('.cfg-item', { hasText: row }).first().click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(outDir, `${name}.png`) });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  console.log(name, overflow ? 'HORIZONTAL OVERFLOW' : 'ok');
  await ctx.close();
}
await browser.close();
await bridge.close();
