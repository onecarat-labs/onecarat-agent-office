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
if (d0.termFont !== undefined) check('text size 120%: terminal keeps its own size (13px)', d0.termFont === 13 && d2.termFont === 13,`${d0.termFont} -> ${d2.termFont}`);
else console.log('skip built-in terminal not available here');
check('no page overflow at 120%', !d2.overflow);
await page.screenshot({ path: path.join(outDir, 'layout-dragged-120.png') });

// Terminal text size: its own setting, three steps up; the rest of Office stays at 120%.
const stored = (key) => page.evaluate((k) => localStorage.getItem(k), key);
await openDisplay('ターミナルの文字の大きさ');
for (let i = 0; i < 3; i++) await page.click('.set-size button:last-of-type');
check('terminal text size shows 130%', (await page.locator('.set-size output').textContent()) === '130%');
check('terminal text size is stored on its own', (await stored('office.termScale')) === '1.3' && (await stored('office.fontScale')) === '1.2');
await page.screenshot({ path: path.join(outDir, 'layout-settings-termsize.png') });
await backToOffice();
const dT = await sizes();
check('terminal text size 130%: pane heads still 18px', near(dT.font, 18, 0.01), String(dT.font));
if (d0.termFont !== undefined) {
  check('terminal text size 130%: terminal 13px -> 17px', dT.termFont === 17, String(dT.termFont));
  // The same setting in the terminal's "more actions" menu (no A-/A+ in the bar itself).
  // The terminal's "more actions" menu: two items only, no scrolling, narrower than the terminal.
  check('no text size buttons in the terminal bar', (await page.locator('.term-bar .set-size').count()) === 0);
  await page.click('.term-bar .menu-btn');
  const menu = await page.evaluate(() => {
    const m = document.querySelector('.menu-body');
    return { items: [...m.querySelectorAll('[role=menuitem]')].map((e) => e.textContent), scrolls: m.scrollHeight > m.clientHeight || m.scrollWidth > m.clientWidth, w: m.getBoundingClientRect().width, termW: document.querySelector('.term').getBoundingClientRect().width, focus: document.activeElement?.textContent };
  });
  check('menu: two items', menu.items.join('|') === '作業フォルダを変更|ターミナルの文字の大きさ', menu.items.join('|'));
  check('menu: no scrollbar, narrower than half the terminal', !menu.scrolls && menu.w < menu.termW / 2, `${menu.w} / ${menu.termW}`);
  check('menu: first item focused', menu.focus === '作業フォルダを変更');
  await page.screenshot({ path: path.join(outDir, 'layout-terminal-menu.png') });
  await page.keyboard.press('Escape');
  check('Escape closes the menu, focus back on its button', (await page.locator('.menu-body').count()) === 0 && (await page.evaluate(() => document.activeElement?.classList.contains('menu-btn'))));

  // Text size dialog.
  await page.click('.term-bar .menu-btn');
  await page.getByRole('menuitem', { name: 'ターミナルの文字の大きさ' }).click();
  check('size dialog: open, menu closed, shows 130%', (await page.locator('dialog.dlg-size[open]').count()) === 1 && (await page.locator('.menu-body').count()) === 0 && (await page.locator('.dlg-size output').textContent()) === '130%');
  const inView = () => page.evaluate(() => {
    const r = document.querySelector('dialog[open]').getBoundingClientRect();
    return r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth;
  });
  check('size dialog: fully inside the window', await inView());
  await page.click('.dlg-size button[aria-label="小さく"]');
  check('size dialog A-: 120% = 16px', (await sizes()).termFont === 16 && (await stored('office.termScale')) === '1.2');
  await page.screenshot({ path: path.join(outDir, 'layout-terminal-size-dialog.png') });
  await page.locator('.dlg-size .dlg-body > .btn').click();
  check('size dialog reset: 100% = 13px', (await sizes()).termFont === 13 && (await stored('office.termScale')) === '1');
  await page.click('.dlg-size button[aria-label="大きく"]');
  await page.click('.dlg-size button[aria-label="大きく"]');
  await page.keyboard.press('Escape');
  await page.waitForSelector('dialog', { state: 'detached', timeout: 2000 }).catch(() => {});
  check('Escape closes the dialog, focus back on the menu button',(await page.locator('dialog[open]').count()) === 0 && (await page.evaluate(() => document.activeElement?.classList.contains('menu-btn'))), await page.evaluate(() => `${document.querySelectorAll('dialog').length} ${document.activeElement?.outerHTML.slice(0, 120)}`));

  // Folder dialog: opens on its own, nothing starts or stops until a folder is chosen.
  await page.click('.term-bar .menu-btn');
  await page.getByRole('menuitem', { name: '作業フォルダを変更' }).click();
  const fd = await page.evaluate(() => {
    const d = document.querySelector('dialog.dlg-folder[open]');
    return d && { modes: [...d.querySelectorAll('select option')].map((o) => o.textContent), submitDisabled: d.querySelector('form button').disabled, folders: d.querySelectorAll('.dlg-folders .sess-item').length };
  });
  check('folder dialog: three ways to start', fd?.modes.join('|') === '新しいセッション|前回の続きから|過去のセッションから選ぶ', fd?.modes.join('|'));
  check('folder dialog: empty folder cannot be submitted', fd?.submitDisabled === true);
  check('folder dialog: fully inside the window', await inView());
  await page.screenshot({ path: path.join(outDir, 'layout-terminal-folder-dialog.png') });
  await page.setViewportSize({ width: 390, height: 520 });
  check('folder dialog: fits a 390x520 window', await inView());
  await page.screenshot({ path: path.join(outDir, 'layout-terminal-folder-dialog-390.png') });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('.dlg-folder .dlg-head .iconbtn').click();
  check('close button closes the folder dialog', (await page.locator('dialog[open]').count()) === 0);
  check('still at 120% after the dialogs', (await stored('office.termScale')) === '1.2');
  // Ctrl + wheel over the terminal: one step, and the page itself is not zoomed or scrolled.
  const tb = await page.locator('.term').boundingBox();
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -120);
  await page.keyboard.up('Control');
  await page.waitForTimeout(250);
  check('Ctrl+wheel up over the terminal: 130% again', (await stored('office.termScale')) === '1.3' && (await sizes()).termFont === 17);
  await page.mouse.wheel(0, -120);
  await page.waitForTimeout(250);
  check('plain wheel does not change the size', (await stored('office.termScale')) === '1.3');
  check('pane heads unchanged by Ctrl+wheel', near((await sizes()).font, 18, 0.01));
}

// Remembered across a reload (= the next start of Office: same origin, same browser storage).
await page.reload();
await page.waitForSelector('.splitter.h');
const d3 = await sizes();
check('reload: office height kept', near(d3.stage, d2.stage, 1), `${d2.stage} -> ${d3.stage}`);
check('reload: terminal width kept', near(d3.term, d2.term, 1), `${d2.term} -> ${d3.term}`);
check('reload: text size kept', near(d3.font, 18, 0.01), String(d3.font));
check('reload: terminal text size kept', (await stored('office.termScale')) === '1.3' && (d3.termFont === undefined || d3.termFont === 17), String(d3.termFont));

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

// Double-click on the empty part of a pane's header maximizes it; again restores. Not on its controls.
const paneState = () => page.evaluate(() => document.querySelector('.main').className.match(/max-\w+/)?.[0] ?? 'none');
for (const [i, name] of [[0, 'terminal'], [1, 'console']]) {
  const head = page.locator('.bottom > .panel').nth(i).locator('.panel-head');
  const title = await head.locator('span[id]').boundingBox();
  const at = { position: { x: title.x + title.width + 30 - (await head.boundingBox()).x, y: 12 } };
  await head.dblclick(at);
  check(`double-click on the ${name} header: maximized`, (await paneState()) === `max-${name}`, await paneState());
  await head.dblclick(at);
  check(`double-click again: ${name} restored`, (await paneState()) === 'none' && near((await sizes()).stage, d5.stage, 1));
}
await page.locator('#agent-pick').dblclick();
await page.keyboard.press('Escape');
check('double-click on the agent selector does not maximize', (await paneState()) === 'none');

// Reset both from the settings.
await openDisplay('エリアの大きさ');
await page.screenshot({ path: path.join(outDir, 'layout-settings-areas.png') });
await page.locator('.cfg-scroll .btn').click();
await page.locator('.cfg-item', { hasText: '文字の大きさ' }).first().click();
await page.locator('.cfg-scroll > .btn').click();
await page.locator('.cfg-item', { hasText: 'ターミナルの文字の大きさ' }).first().click();
await page.locator('.cfg-scroll > .btn').click();
check('reset: terminal text size default', (await stored('office.termScale')) === '1');
await backToOffice();
const d6 = await sizes();
check('reset: office height default', near(d6.stage, d0.stage, 1), `${d6.stage} vs ${d0.stage}`);
check('reset: terminal width default', near(d6.term, d0.term, 1), `${d6.term} vs ${d0.term}`);
check('reset: text size default', d6.font === 15, String(d6.font));
await page.reload();
await page.waitForSelector('.splitter.h');
const d7 = await sizes();
check('reset is remembered too', near(d7.stage, d0.stage, 1) && near(d7.term, d0.term, 1) && d7.font === 15);

// Updating from 0.2.10: no terminal size stored yet, so the terminal starts from the general text size.
await page.evaluate(() => { localStorage.removeItem('office.termScale'); localStorage.setItem('office.fontScale', '1.4'); });
await page.reload();
await page.waitForSelector('.splitter.h');
check('update from 0.2.10: terminal starts from the general text size', (await stored('office.termScale')) === '1.4');

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
