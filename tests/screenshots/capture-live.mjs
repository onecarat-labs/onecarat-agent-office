// Visual check: screenshots of the LIVE UI (served by the bridge) at real-time intervals.
// Usage: node tests/screenshots/capture-live.mjs <outDir> <prefix> <count> <intervalMs> [lang]
import { chromium } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';
import { readRuntimeFile } from '../../packages/event-bridge/src/runtime-file.ts';

const [outDir = 'tests/screenshots/out', prefix = 'live', count = '6', interval = '4000', lang = 'ja-JP'] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1672, height: 941 }, locale: lang, colorScheme: 'light' });
const page = await ctx.newPage();
// Same as the launcher: the access key travels in the URL fragment only.
const rt = readRuntimeFile();
await page.goto(`http://127.0.0.1:${rt?.port ?? 47821}/#t=${rt?.token ?? ''}`);
for (let i = 0; i < Number(count); i++) {
  await page.waitForTimeout(Number(interval));
  const file = path.join(outDir, `${prefix}-${String(i).padStart(2, '0')}.png`);
  await page.screenshot({ path: file });
  const info = await page.evaluate(() => ({
    chip: [...document.querySelectorAll('.chip')].map((c) => c.textContent).join(' | '),
    plates: [...document.querySelectorAll('.nameplate text')].map((t) => t.textContent).join(', '),
  }));
  console.log(file, JSON.stringify(info));
}
await browser.close();
