#!/usr/bin/env node
// Onecarat Agent Office bridge: localhost-only event receiver + UI server (+ optional embedded terminal).
// It never calls a model, never reads Claude credentials, and keeps events and terminal output in memory only.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createBridge } from './server.ts';
import { newToken } from './security.ts';
import { readRuntimeFile, removeRuntimeFile, runtimeFilePath, writeRuntimeFile } from './runtime-file.ts';
import { Terminal, loadPty } from './terminal.ts';

const VERSION = '0.2.0';
const DEFAULT_PORT = 47821;

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(opt('port') ?? process.env.ONECARAT_OFFICE_PORT ?? DEFAULT_PORT);
// Bundled layout: dist/bridge.mjs + dist/ui/ + dist/vendor/. Dev layout: packages/event-bridge/src.
const uiDir = opt('ui-dir') ?? (fs.existsSync(path.join(here, 'ui', 'index.html')) ? path.join(here, 'ui') : path.resolve(here, '../../office-ui/dist'));
const ptyCandidates = [path.join(here, 'vendor', 'node-pty'), path.resolve(here, '../../../plugin/onecarat-agent-office/dist/vendor/node-pty')];
// Folder the embedded `claude` starts in: --cwd, else the folder the launcher was run from.
const termCwd = path.resolve(opt('cwd') ?? process.cwd());
const devOrigins = opt('dev-origin') ? [opt('dev-origin')!] : [];

const existing = readRuntimeFile();
if (existing && isAlive(existing.pid) && existing.pid !== process.pid) {
  console.error(`Onecarat Agent Office is already running (pid ${existing.pid}) at http://127.0.0.1:${existing.port}/`);
  process.exit(3);
}

const token = newToken();
const load = flag('no-terminal') || process.env.ONECARAT_OFFICE_NO_TERMINAL === '1' ? { ok: false as const, reason: 'turned off (--no-terminal)' } : loadPty(ptyCandidates);
const terminal = new Terminal({ load, cwd: termCwd });
const bridge = createBridge({ port, token, uiDir, version: VERSION, terminal, devOrigins, onShutdownRequest: () => void shutdown('stop requested') });

bridge.server.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EADDRINUSE') console.error(`Port ${port} is in use. Start with --port <n> (and use the same port for the hooks).`);
  else console.error(e.message);
  process.exit(2);
});

bridge.server.listen(port, '127.0.0.1', () => {
  writeRuntimeFile({ port, token, pid: process.pid, startedAt: Date.now(), version: VERSION });
  const url = `http://127.0.0.1:${port}/`;
  // The token is never printed (output of the skill ends up in the Claude Code transcript).
  console.log(`Onecarat Agent Office ${VERSION}`);
  console.log(`  UI:       ${url}`);
  console.log(`  terminal: ${load.ok ? `available (claude starts in ${termCwd})` : `unavailable — ${load.reason}; Office runs read-only`}`);
  console.log(`  runtime:  ${runtimeFilePath()}`);
  console.log('  Events and terminal output are kept in memory only. Press Ctrl+C to stop.');
  if (flag('open')) openBrowser(`${opt('open-base') ?? url}#t=${token}`);
});

let stopping = false;
async function shutdown(reason: string) {
  if (stopping) return;
  stopping = true;
  console.log(`Stopping (${reason})…`);
  removeRuntimeFile(process.pid);
  await bridge.close();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('exit', () => {
  terminal.stop();
  removeRuntimeFile(process.pid);
});

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// Windows: explorer.exe drops the URL fragment (#t=…) (measured); the URL protocol handler keeps it.
function openBrowser(url: string) {
  const [cmd, ...a] = process.platform === 'win32' ? ['rundll32.exe', 'url.dll,FileProtocolHandler', url] : process.platform === 'darwin' ? ['open', url] : ['xdg-open', url];
  spawn(cmd!, a, { detached: true, stdio: 'ignore' }).unref();
}
