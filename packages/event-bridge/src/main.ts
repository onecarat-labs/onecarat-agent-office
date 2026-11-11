#!/usr/bin/env node
// Onecarat Agent Office bridge: localhost-only event receiver + UI server (+ optional embedded terminal).
// It never calls a model, never reads Claude credentials, and keeps events and terminal output in memory only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBridge } from './server.ts';
import { newToken } from './security.ts';
import { readRuntimeFile, removeRuntimeFile, runtimeFilePath, writeRuntimeFile } from './runtime-file.ts';
import { Terminal, loadPty, whenTerminalEnds } from './terminal.ts';
import { askOffice } from './proof.ts';
import { openWithKey } from './open-browser.ts';

const VERSION = '0.2.7';
const DEFAULT_PORT = 47821;

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const here = path.dirname(fileURLToPath(import.meta.url));
// Bundled layout: dist/bridge.mjs + dist/ui/ + dist/vendor/. Dev layout: packages/event-bridge/src.
const bundled = fs.existsSync(path.join(here, 'ui', 'index.html'));

// Development-only flags (serve another folder as the UI, open another page with the key, allow another
// origin). They would hand the access key to arbitrary content, so the shipped bundle ignores them: they only
// work when the bridge runs from the source tree, and even then only for loopback URLs.
const LOOPBACK = /^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}\/?$/;
const devOpt = (name: string) => (bundled ? undefined : opt(name));
const devOrigin = devOpt('dev-origin');
const openBase = devOpt('open-base');
if (devOrigin && !LOOPBACK.test(devOrigin)) fail(`--dev-origin must be a loopback origin, got ${devOrigin}`);
if (openBase && !LOOPBACK.test(openBase)) fail(`--open-base must be a loopback URL, got ${openBase}`);

const port = Number(opt('port') ?? process.env.ONECARAT_OFFICE_PORT ?? DEFAULT_PORT);
if (!Number.isInteger(port) || port < 1024 || port > 65535) fail(`--port must be between 1024 and 65535, got ${opt('port')}`);
const uiDir = devOpt('ui-dir') ?? (bundled ? path.join(here, 'ui') : path.resolve(here, '../../office-ui/dist'));
const ptyCandidates = [path.join(here, 'vendor', 'node-pty'), path.resolve(here, '../../../plugin/onecarat-agent-office/dist/vendor/node-pty')];
// Folder the embedded `claude` starts in: --cwd, else the folder the launcher was run from.
const termCwd = path.resolve(opt('cwd') ?? process.cwd());
const devOrigins = devOrigin ? [devOrigin.replace(/\/$/, '')] : [];

// Another bridge running? Trust the runtime file only if something at that port proves it holds that file's
// token (a stale file whose pid was reused, or whose port was taken by something else, must not block the start).
const existing = readRuntimeFile();
if (existing && existing.pid !== process.pid && isAlive(existing.pid) && (await askOffice(existing.port, existing.token)).ok) {
  console.error(`Onecarat Agent Office is already running (pid ${existing.pid}) at http://127.0.0.1:${existing.port}/`);
  process.exit(3);
}

const token = newToken();
const load = flag('no-terminal') || process.env.ONECARAT_OFFICE_NO_TERMINAL === '1' ? { ok: false as const, reason: 'turned off (--no-terminal)' } : loadPty(ptyCandidates);
const terminal = new Terminal({ load, cwd: termCwd });
const bridge = createBridge({
  port, token, uiDir, version: VERSION, terminal, devOrigins,
  // Read-only view of Claude Code's own configuration files (secret values hidden, nothing kept).
  config: { home: os.homedir(), defaultCwd: termCwd, configDir: process.env.CLAUDE_CONFIG_DIR || undefined },
  onShutdownRequest: () => void shutdown('stop requested') });
// Claude Code in the built-in terminal has ended: Office stops too. The page keeps its last scene (the goodbye).
// Sessions in other terminals do not stop Office.
whenTerminalEnds(terminal, 3000, () => void shutdown('Claude Code in the built-in terminal ended', 'claude-ended'));

bridge.server.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EADDRINUSE') console.error(`Port ${port} is in use. Start with --port <n> (and use the same port for the hooks).`);
  else console.error(e.message);
  process.exit(2);
});

bridge.server.listen(port, '127.0.0.1', () => {
  writeRuntimeFile({ port, token, pid: process.pid, startedAt: Date.now(), version: VERSION });
  const url = `http://127.0.0.1:${port}/`;
  const t = terminal.state;
  // The token is never printed (output of the skill ends up in the Claude Code transcript).
  console.log(`Onecarat Agent Office ${VERSION}`);
  console.log(`  UI:       ${url}`);
  console.log(`  terminal: ${t.available ? `available (${t.claudePath} starts in ${termCwd})` : `unavailable — ${t.reason}; Office runs read-only`}`);
  console.log(`  runtime:  ${runtimeFilePath()}`);
  console.log('  Events and terminal output are kept in memory only. Press Ctrl+C to stop.');
  if (!bundled && flag('open')) openWithKey(`${openBase ?? url}#t=${token}`);
});

let stopping = false;
async function shutdown(reason: string, uiReason = 'stopped') {
  if (stopping) return;
  stopping = true;
  console.log(`Stopping (${reason})…`);
  removeRuntimeFile(process.pid);
  await bridge.close(uiReason);
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('exit', () => {
  terminal.stop();
  removeRuntimeFile(process.pid);
});

function fail(msg: string): never {
  console.error(msg);
  process.exit(2);
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
