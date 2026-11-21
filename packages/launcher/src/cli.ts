#!/usr/bin/env node
// Onecarat Agent Office launcher: check | start | stop | status
// Plain Node, no dependencies at run time. It starts and stops the small-window app; it never runs claude,
// never calls a model and never touches Claude credentials or settings.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launcherText } from '@onecarat/domain';
import { appArgs, parseLauncherArgs } from './args.ts';
import { detectLang } from './lang.ts';
import { askApp, readRuntimeFile, removeRuntimeFile, tellApp, type RuntimeInfo } from './runtime.ts';

const MIN_NODE_MAJOR = 18;
const DEFAULT_PORT = 47821;
const EXE = 'onecarat-agent-office.exe';
const here = path.dirname(fileURLToPath(import.meta.url));
// Shipped layout (plugin/.../dist/office.mjs next to the exe) or the development tree (cargo's output).
const exePath = [path.join(here, EXE), path.resolve(here, '../../../src-tauri/target/release', EXE)].find((p) => fs.existsSync(p));

/** Every message below comes from the one table of words; the language follows the Windows display language. */
const t = launcherText[detectLang()];

const parsed = parseLauncherArgs(process.argv.slice(2));
if ('error' in parsed) {
  console.error(parsed.error === 'badPort' ? t.badPort : t[parsed.error](parsed.arg));
  console.error(t.usage);
  process.exit(2);
}
const opts = parsed;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * The runtime file points at a live app (it proved the token). A stale file is removed.
 * 'silent': its process exists but gave no answer in time. That is not proof of a stale file (the app may only
 * be busy), and removing the file of a running app would cut it off from every hook until it is restarted
 * (audit 2026-11-21). So nothing is touched.
 */
async function running(): Promise<RuntimeInfo | 'silent' | undefined> {
  const info = readRuntimeFile();
  if (!info) return undefined;
  const h = await askApp(info.port, info.token);
  if (h.ok) return info;
  if (h.silent && pidAlive(info.pid)) return 'silent';
  // A crashed or force-killed app left the file behind (even if its pid or port is used by something else now).
  removeRuntimeFile(info.pid);
  return undefined;
}

function notAnswering() {
  console.error(t.notAnswering);
  process.exitCode = 1;
}

function supported(): boolean {
  if (process.platform === 'win32') return true;
  console.error(t.windowsOnly);
  process.exitCode = 1;
  return false;
}

/**
 * The app must not inherit the calling Claude Code session's own environment markers, nor the variables with
 * which the window component (WebView2) can be given other program files, another data folder or extra
 * arguments such as a debugging port.
 */
function appEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/^(CLAUDE|ANTHROPIC|WEBVIEW2_)/i.test(k)) continue;
    env[k] = v;
  }
  return env;
}

async function start() {
  if (!supported()) return;
  const cur = await running();
  if (cur === 'silent') return notAnswering();
  if (cur) {
    // Windows the user closed may come back for their sessions.
    await tellApp(cur, '/api/show');
    console.log(t.alreadyRunning);
    return;
  }
  if (!exePath) {
    console.error(t.exeNotFound(EXE));
    process.exitCode = 1;
    return;
  }
  const child = spawn(exePath, appArgs(opts), { detached: true, stdio: 'ignore', env: appEnv() });
  let exited: number | null = null;
  child.on('exit', (code) => (exited = code ?? -1));
  child.on('error', () => (exited = -1));
  child.unref();
  for (let i = 0; i < 80; i++) {
    await sleep(150);
    const info = readRuntimeFile();
    if (info && info.pid === child.pid && (await askApp(info.port, info.token)).ok) {
      console.log(t.started);
      console.log(t.startedHow);
      return;
    }
    if (exited !== null) break;
  }
  if (exited === 3) console.error(t.portInUse(opts.port ?? DEFAULT_PORT, (opts.port ?? DEFAULT_PORT) === 47822 ? 47823 : 47822));
  else console.error(t.couldNotStart);
  process.exitCode = 1;
}

async function stop() {
  const info = readRuntimeFile();
  if (!info) {
    console.log(t.notRunning);
    return;
  }
  // Only a process that proved to be the app is ever asked to stop or signalled: a stale file whose pid was
  // reused by something else must not get it killed.
  const h = await askApp(info.port, info.token);
  if (!h.ok) {
    if (h.silent && pidAlive(info.pid)) return notAnswering();
    removeRuntimeFile(info.pid);
    console.log(t.notRunningStale);
    return;
  }
  await tellApp(info, '/api/shutdown');
  for (let i = 0; i < 20 && pidAlive(info.pid); i++) await sleep(150);
  if (pidAlive(info.pid)) {
    try {
      process.kill(info.pid);
    } catch {
      /* already gone */
    }
  }
  removeRuntimeFile(info.pid);
  console.log(t.stopped);
}

async function status() {
  const info = await running();
  if (info === 'silent') return notAnswering();
  if (!info) {
    console.log(t.notRunning);
    return;
  }
  const h = await askApp(info.port, info.token);
  console.log(t.running(String(h.version ?? '?'), info.pid, info.port, String(h.windows ?? '?')));
}

function check() {
  const major = Number(process.versions.node.split('.')[0]);
  const nodeOk = major >= MIN_NODE_MAJOR;
  console.log(nodeOk ? t.checkNodeOk(process.versions.node) : t.checkNodeOld(process.versions.node, MIN_NODE_MAJOR));
  console.log(process.platform === 'win32' ? t.checkWindowsOk : t.checkWindowsNo(process.platform));
  console.log(exePath ? t.checkApp(exePath) : t.checkAppMissing(EXE));
  console.log(t.checkWebView);
  if (!nodeOk || process.platform !== 'win32' || !exePath) process.exitCode = 1;
}

switch (opts.cmd) {
  case 'check': check(); break;
  case 'start': await start(); break;
  case 'stop': await stop(); break;
  case 'status': await status(); break;
}
