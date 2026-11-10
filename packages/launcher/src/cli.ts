#!/usr/bin/env node
// Onecarat Agent Office launcher: check | start | stop | status | open
// Plain Node, no dependencies at run time. It never calls a model and never touches Claude credentials.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readRuntimeFile, removeRuntimeFile, type RuntimeInfo } from '@onecarat/event-bridge/runtime-file';
import { childEnv } from '@onecarat/event-bridge/child-env';
import { resolveClaude } from '@onecarat/event-bridge/claude-path';
import { askOffice } from '@onecarat/event-bridge/proof';
import { openWithKey } from '@onecarat/event-bridge/open-browser';
import { bridgeArgs, parseLauncherArgs } from './args.ts';

const MIN_NODE_MAJOR = 18;
const here = path.dirname(fileURLToPath(import.meta.url));
// Bundled layout (plugin/.../dist/office.mjs next to bridge.mjs) or the dev source tree.
const bundledBridge = path.join(here, 'bridge.mjs');
const devBridge = path.resolve(here, '../../event-bridge/src/main.ts');
const bridgeEntry = fs.existsSync(bundledBridge) ? bundledBridge : devBridge;

const parsed = parseLauncherArgs(process.argv.slice(2));
if ('error' in parsed) {
  console.error(parsed.error);
  console.error('Usage: office <check|start|stop|status|open> [--port N] [--cwd DIR] [--no-terminal] [--no-open]');
  process.exit(2);
}
const opts = parsed;

interface Health {
  ok: boolean;
  events?: number;
  clients?: number;
  terminal?: { available: boolean; reason?: string; running: boolean; cwd: string; claudePath?: string };
}

/**
 * Asks the port from the runtime file. `ok` only when the answer proves it holds that file's token (proof.ts):
 * the app name alone could be answered by anything that took the port after a crash.
 */
async function health(port: number, token: string, timeoutMs = 800): Promise<Health> {
  const a = await askOffice(port, token, timeoutMs);
  if (!a.ok || !a.body) return { ok: false };
  const j = a.body as { events?: number; clients?: number; terminal?: Health['terminal'] };
  return { ok: true, events: j.events, clients: j.clients, terminal: j.terminal };
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** The runtime file points at a live Office (health answered). A stale file is removed. */
async function running(): Promise<RuntimeInfo | undefined> {
  const info = readRuntimeFile();
  if (!info) return undefined;
  if ((await health(info.port, info.token)).ok) return info;
  // Nothing there proves it holds this file's token: a crashed or force-killed bridge left the file behind (even
  // if its pid was reused, or something else now listens on that port).
  removeRuntimeFile(info.pid);
  return undefined;
}

/**
 * The page gets the per-launch token in the URL fragment: browsers never send the fragment to the server,
 * and the page removes it from the address bar at once. It is handed to the browser only, never printed.
 */
function openOffice(info: { port: number; token: string }) {
  if (!openWithKey(`http://127.0.0.1:${info.port}/#t=${info.token}`)) console.error('Could not open the browser.');
}

function terminalLine(h: Health): string {
  if (!h.terminal) return '';
  if (!h.terminal.available) return `  Terminal: unavailable (${h.terminal.reason}). Office is read-only; use Claude Code in your own terminal.`;
  return `  Terminal: claude ${h.terminal.running ? 'running' : 'starts'} in ${h.terminal.cwd}${h.terminal.claudePath ? ` (${h.terminal.claudePath})` : ''}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function start() {
  const cur = await running();
  if (cur) {
    console.log(`Already running: http://127.0.0.1:${cur.port}/`);
    if (!opts.noOpen) openOffice(cur);
    return;
  }
  // Only the allow-listed options reach the bridge. The embedded claude starts where Office was started from
  // (the session that asked for it) unless --cwd is given.
  const args = [bridgeEntry, ...bridgeArgs(opts, process.cwd())];
  // Drop the calling Claude Code session's own markers and private channels; keep the user's configuration.
  const child = spawn(process.execPath, args, { detached: true, stdio: 'ignore', windowsHide: true, env: childEnv() });
  child.unref();
  for (let i = 0; i < 40; i++) {
    await sleep(150);
    const info = readRuntimeFile();
    const h = info && info.pid === child.pid ? await health(info.port, info.token) : undefined;
    if (info && h?.ok) {
      console.log(`Started Onecarat Agent Office: http://127.0.0.1:${info.port}/`);
      const line = terminalLine(h);
      if (line) console.log(line);
      if (!opts.noOpen) openOffice(info);
      return;
    }
    if (child.exitCode !== null) break;
  }
  console.error('Could not start the bridge. Try running it in the foreground to see why:');
  console.error(`  node "${bridgeEntry}"`);
  process.exitCode = 1;
}

async function stop() {
  const info = readRuntimeFile();
  if (!info) {
    console.log('Not running.');
    return;
  }
  // Only a process that answered as Office is ever signalled: a stale file whose pid was reused by something
  // else must not get killed.
  if (!(await health(info.port, info.token)).ok) {
    removeRuntimeFile(info.pid);
    console.log('Not running (a stale runtime file was removed).');
    return;
  }
  await new Promise<void>((resolve) => {
    const req = http.request(
      { host: '127.0.0.1', port: info.port, path: '/api/shutdown', method: 'POST', timeout: 1500, headers: { 'x-office-token': info.token } },
      (res) => {
        res.resume();
        res.on('end', () => resolve());
      },
    );
    req.on('error', () => resolve());
    req.on('timeout', () => {
      req.destroy();
      resolve();
    });
    req.end();
  });
  for (let i = 0; i < 20 && pidAlive(info.pid); i++) await sleep(150);
  if (pidAlive(info.pid)) {
    try {
      process.kill(info.pid);
    } catch {
      /* already gone */
    }
  }
  removeRuntimeFile(info.pid);
  console.log('Stopped. In-memory events were discarded.');
}

async function status() {
  const info = await running();
  if (!info) {
    console.log('Not running.');
    return;
  }
  const h = await health(info.port, info.token);
  console.log(`Running: http://127.0.0.1:${info.port}/  (pid ${info.pid}, events in memory: ${h.events ?? '?'}, open tabs: ${h.clients ?? '?'})`);
  const line = terminalLine(h);
  if (line) console.log(line);
}

function check() {
  const major = Number(process.versions.node.split('.')[0]);
  const ok = major >= MIN_NODE_MAJOR;
  console.log(`Node.js ${process.versions.node} (${process.platform}/${process.arch}) — ${ok ? 'OK' : `too old, need ${MIN_NODE_MAJOR}+`}`);
  console.log(`Bridge: ${bridgeEntry}`);
  // The built-in terminal needs an upstream node-pty prebuild for this OS/CPU and a `claude` on PATH.
  const plat = `${process.platform}-${process.arch}`;
  const vendor = [path.join(here, 'vendor/node-pty'), path.resolve(here, '../../../plugin/onecarat-agent-office/dist/vendor/node-pty')].find((d) => fs.existsSync(d));
  const term = vendor && fs.existsSync(path.join(vendor, 'prebuilds', plat));
  const claude = resolveClaude();
  console.log(`Built-in terminal: ${term ? `available (${plat})` : `not available for ${plat} — Office runs read-only`}`);
  console.log(`claude: ${claude ?? 'not found on PATH — the built-in terminal cannot start it'}`);
  if (!ok) process.exitCode = 1;
}

switch (opts.cmd) {
  case 'check': check(); break;
  case 'start': await start(); break;
  case 'stop': await stop(); break;
  case 'status': await status(); break;
  case 'open': {
    const info = await running();
    if (info) openOffice(info);
    else console.log('Not running. Use "start".');
    break;
  }
}
