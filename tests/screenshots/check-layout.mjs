// Check of the adjustable layout: dragging the borders between the three areas, the text size, that both are
// remembered across a reload, and that both go back to the default. Runs its own in-process bridge on another
// port (no terminal), so a running Office is not touched.
// Usage: node tests/screenshots/check-layout.mjs <outDir> [uiDir]   (uiDir defaults to the built plugin's UI)
import { chromium } from 'playwright-core';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createBridge } from '../../packages/event-bridge/src/index.ts';

const [outDir = 'tests/screenshots/out', uiArg = 'plugin/onecarat-agent-office/dist/ui'] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const PORT = 47842;
const token = 'd'.repeat(48);
const bridge = createBridge({ port: PORT, token, uiDir: path.resolve(uiArg), version: 'shot', config: { home: os.homedir(), defaultCwd: process.cwd() } });
await new Promise((r) => bridge.server.listen(PORT, '127.0.0.1', r));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ja-JP', colorScheme: 'light' });
const page = await ctx.newPage();
const url = `http://127.0.0.1:${PORT}/#t=${token}`;

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(ok ? 'ok  ' : 'FAIL', name, detail);
};
const near = (a, b, tol = 3) => Math.abs(a - b) <= tol;
const sizes = () => page.evaluate(() => {
  const r = (sel) => document.querySelector(sel).getBoundingClientRect();
  const panels = document.querySelectorAll('.bottom > .panel');
  return {
    stage: r('.stage').height,
    bottom: r('.bottom').height,
    term: panels[0].getBoundingClientRect().width,
    console: panels[1].getBoundingClientRect().width,
    font: parseFloat(getComputedStyle(document.querySelector('.panel-head')).fontSize),
    // the built-in terminal (xterm) when this machine has it; undefined otherwise
    termFont: document.querySelector('.term .xterm-rows') ? parseFloat(getComputedStyle(document.querySelector('.term .xterm-rows')).fontSize) : undefined,
    overflow: document.documentElement.scrollWidth > window.innerWidth || document.documentElement.scrollHeight > window.innerHeight,
  };
});
const drag = async (sel, dx, dy) => {
  const b = await page.locator(sel).boundingBox();
  const x = b.x + b.width / 2;
  const y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
  await page.mouse.move(x + dx, y + dy, { steps: 4 });
  await page.mouse.up();
};
const openDisplay = async (row) => {
  await page.click('nav.rail button:last-child');
  await page.locator('.cfg-menu-item').first().click();
  await page.locator('.cfg-item', { hasText: row }).first().click();
};
const backToOffice = () => page.click('nav.rail button:first-child');

await page.goto(url);
await page.waitForSelector('.splitter.h');
const d0 = await sizes();
check('default: office is 1.25 : 1 of the height', near(d0.stage / d0.bottom, 1.25, 0.02), `${d0.stage} / ${d0.bottom}`);
check('default: terminal and console share the width', near(d0.term, d0.console), `${d0.term} / ${d0.console}`);
check('default: text size 15px in pane heads', d0.font === 15, String(d0.font));

// Drag the borders.
await drag('.splitter.h', 0, -120);
await drag('.splitter.v', 200, 0);
const d1 = await sizes();
check('drag up: office 120px lower', near(d1.stage, d0.stage - 120), `${d0.stage} -> ${d1.stage}`);
check('drag up: lower areas 120px higher', near(d1.bottom, d0.bottom + 120), `${d0.bottom} -> ${d1.bottom}`);
check('drag right: terminal 200px wider', near(d1.term, d0.term + 200), `${d0.term} -> ${d1.term}`);
check('drag right: console 200px narrower', near(d1.console, d0.console - 200), `${d0.console} -> ${d1.console}`);
check('no page overflow after dragging', !d1.overflow);
await page.screenshot({ path: path.join(outDir, 'layout-dragged.png') });

// Text size: two steps up.
await openDisplay('文字の大きさ');
await page.click('.set-size button:last-of-type');
await page.click('.set-size button:last-of-type');
check('text size shows 120%', (await page.locator('.set-size output').textContent()) === '120%');
await page.screenshot({ path: path.join(outDir, 'layout-settings-textsize.png') });
await backToOffice();
const d2 = await sizes();
check('text size 120%: pane heads 18px', near(d2.font, 18, 0.01), String(d2.font));
if (d0.termFont !== undefined) check('text size 120%: terminal 13px -> 16px', d0.termFont === 13 && d2.termFont === 16, `${d0.termFont} -> ${d2.termFont}`);
else console.log('skip built-in terminal not available here');
check('no page overflow at 120%', !d2.overflow);
await page.screenshot({ path: path.join(outDir, 'layout-dragged-120.png') });

// Remembered across a reload (= the next start of Office: same origin, same browser storage).
await page.reload();
await page.waitForSelector('.splitter.h');
const d3 = await sizes();
check('reload: office height kept', near(d3.stage, d2.stage, 1), `${d2.stage} -> ${d3.stage}`);
check('reload: terminal width kept', near(d3.term, d2.term, 1), `${d2.term} -> ${d3.term}`);
check('reload: text size kept', near(d3.font, 18, 0.01), String(d3.font));

// Keyboard on a border, then double-click resets that border only.
await page.focus('.splitter.v');
await page.keyboard.press('ArrowLeft');
const d4 = await sizes();
check('arrow key moves the border', d4.term < d3.term, `${d3.term} -> ${d4.term}`);
await page.dblclick('.splitter.v');
const d5 = await sizes();
check('double-click: widths back to default', near(d5.term, d5.console), `${d5.term} / ${d5.console}`);
check('double-click: heights untouched', near(d5.stage, d3.stage, 1));

// Maximize hides the borders; restore brings the sizes back.
await page.click('.stage-max');
check('maximized: borders hidden', (await page.locator('.splitter:visible').count()) === 0);
await page.click('.stage-max');
check('restored: office height back', near((await sizes()).stage, d5.stage, 1));

// Reset both from the settings.
await openDisplay('エリアの大きさ');
await page.screenshot({ path: path.join(outDir, 'layout-settings-areas.png') });
await page.locator('.cfg-scroll .btn').click();
await page.locator('.cfg-item', { hasText: '文字の大きさ' }).first().click();
await page.locator('.cfg-scroll > .btn').click();
await backToOffice();
const d6 = await sizes();
check('reset: office height default', near(d6.stage, d0.stage, 1), `${d6.stage} vs ${d0.stage}`);
check('reset: terminal width default', near(d6.term, d0.term, 1), `${d6.term} vs ${d0.term}`);
check('reset: text size default', d6.font === 15, String(d6.font));
await page.reload();
await page.waitForSelector('.splitter.h');
const d7 = await sizes();
check('reset is remembered too', near(d7.stage, d0.stage, 1) && near(d7.term, d0.term, 1) && d7.font === 15);

// Narrow screens stack the areas: no borders to drag, no sideways overflow even at the largest text.
await page.evaluate(() => localStorage.setItem('office.fontScale', '1.6'));
await page.setViewportSize({ width: 820, height: 1100 });
await page.reload();
await page.waitForSelector('.stage');
check('820px: borders hidden', (await page.locator('.splitter:visible').count()) === 0);
check('820px at 160%: no sideways overflow', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
await page.setViewportSize({ width: 1440, height: 900 });
await page.reload();
await page.waitForSelector('.splitter.h');
await page.screenshot({ path: path.join(outDir, 'layout-160.png') });
check('1440px at 160%: no sideways overflow', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));

await browser.close();
await bridge.close();
console.log(failed ? `${failed} check(s) FAILED` : 'all checks passed');
process.exit(failed ? 1 : 0);
