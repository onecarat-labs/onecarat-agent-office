// Visual check of the Claude Code configuration view, using the real files of this machine (read-only).
// Runs its own in-process bridge on another port, so a running Office is not touched.
// Usage: node tests/screenshots/capture-config.mjs <outDir>
import { chromium } from 'playwright-core';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createBridge } from '../../packages/event-bridge/src/index.ts';

const [outDir = 'tests/screenshots/out'] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const PORT = 47841;
const token = 'c'.repeat(48);
const uiDir = path.resolve('plugin/onecarat-agent-office/dist/ui');
const bridge = createBridge({ port: PORT, token, uiDir, version: 'shot', config: { home: os.homedir(), defaultCwd: process.cwd() } });
await new Promise((r) => bridge.server.listen(PORT, '127.0.0.1', r));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
for (const [name, opts, clicks] of [
  ['config-ja-light-settings', { viewport: { width: 1440, height: 900 }, locale: 'ja-JP', colorScheme: 'light' }, ['.claude/settings.json']],
  ['config-ja-dark-claudejson', { viewport: { width: 1440, height: 900 }, locale: 'ja-JP', colorScheme: 'dark' }, ['.claude.json']],
  ['config-ja-light-missing', { viewport: { width: 1440, height: 900 }, locale: 'ja-JP', colorScheme: 'light' }, ['.mcp.json']],
  ['config-ja-memory', { viewport: { width: 1440, height: 900 }, locale: 'ja-JP', colorScheme: 'light' }, ['.claude/projects/<project>/memory/']],
  ['config-en-phone', { viewport: { width: 390, height: 844 }, locale: 'en-US', colorScheme: 'light' }, []],
]) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/#t=${token}`);
  await page.click('nav.rail button:last-child');
  await page.waitForSelector('.cfg-item.st-present');
  for (const c of clicks) await page.locator('.cfg-item', { hasText: c }).first().click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(outDir, `${name}.png`) });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  console.log(name, overflow ? 'HORIZONTAL OVERFLOW' : 'ok');
  await ctx.close();
}
await browser.close();
await bridge.close();
