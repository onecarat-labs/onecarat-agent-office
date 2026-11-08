// Visual check: captures the Demo mode UI at fixed demo times with the locally installed Edge.
// Usage: node tests/screenshots/capture.mjs <outDir> [baseUrl]
// Uses playwright-core with channel "msedge" (no browser download). Demo time is advanced with the fake clock.
import { chromium } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';

const outDir = path.resolve(process.argv[2] ?? 'tests/screenshots/out');
const base = process.argv[3] ?? 'http://127.0.0.1:5318/';
fs.mkdirSync(outDir, { recursive: true });

const shots = [
  { name: 'light-en-19s', t: 19000, w: 1672, h: 941, locale: 'en-US', scheme: 'light' },
  { name: 'light-en-30s', t: 30500, w: 1672, h: 941, locale: 'en-US', scheme: 'light' },
  { name: 'dark-ja-23s', t: 23000, w: 1672, h: 941, locale: 'ja-JP', scheme: 'dark' },
  { name: 'light-ja-reduced-26s', t: 26800, w: 1672, h: 941, locale: 'ja-JP', scheme: 'light', reduced: true },
  { name: 'phone-ja-13s', t: 13000, w: 390, h: 844, locale: 'ja-JP', scheme: 'light', fullPage: true },
  { name: 'tablet-en-dark-10s', t: 10000, w: 820, h: 1180, locale: 'en-US', scheme: 'dark', fullPage: true },
];

const browser = await chromium.launch({ channel: 'msedge', headless: true });
for (const s of shots) {
  const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, locale: s.locale, colorScheme: s.scheme, reducedMotion: s.reduced ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage();
  await page.clock.install();
  await page.goto(base);
  // advance demo time in steps so React effects/timers run between ticks
  for (let done = 0; done < s.t; done += 500) await page.clock.runFor(500);
  await page.clock.runFor(1500);
  const noHScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  await page.screenshot({ path: path.join(outDir, `${s.name}.png`), fullPage: !!s.fullPage });
  console.log(s.name, 'saved; no horizontal scroll:', noHScroll);
  await ctx.close();
}
await browser.close();
