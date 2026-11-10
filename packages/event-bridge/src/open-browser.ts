// Opening the Office page with its per-launch access key.
//
// Two things can go wrong when a program "just opens a URL":
//  1. Windows: a bare `rundll32.exe` is looked up in the current folder before PATH (libuv follows cmd.exe here).
//     Started inside a cloned repository, a planted rundll32.exe would run with the user's rights and receive the
//     keyed URL as its argument. So the system binary is always started by absolute path.
//  2. macOS / Linux: the arguments of a process can be read by every local user (`ps`). A URL with `#t=<key>` on
//     the command line of `open` / `xdg-open` / the browser would show the key to other accounts. So there the key
//     travels in a short-lived private file instead: the browser is asked to open that file, and the file sends
//     the tab on to Office. Only the file's path appears on a command line. (On Windows a standard user cannot
//     read another user's command lines, and the protocol handler is given the URL directly.)
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { runtimeDir } from './runtime-file.ts';
import { systemRoot } from './claude-path.ts';

const HANDOFF_PREFIX = 'onecarat-agent-office-open-';
const HANDOFF_LIFETIME_MS = 20_000;

/** Program + arguments that open `target` (a URL or a file URL) in the default browser. */
export function browserCommand(target: string, platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): { file: string; args: string[] } {
  // explorer.exe drops the URL fragment (#t=…) (measured); the URL protocol handler keeps it.
  if (platform === 'win32') return { file: path.win32.join(systemRoot(env), 'System32', 'rundll32.exe'), args: ['url.dll,FileProtocolHandler', target] };
  if (platform === 'darwin') return { file: '/usr/bin/open', args: [target] };
  return { file: 'xdg-open', args: [target] };
}

/** The page that carries the key to the Office tab. `replace` keeps it out of the tab's back history. */
export function handoffHtml(url: string): string {
  const js = JSON.stringify(url).replace(/</g, '\\u003c');
  return `<!doctype html><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>Onecarat Agent Office</title><script>location.replace(${js})</script>\n`;
}

/**
 * Where the hand-off file goes. macOS: Office's own 0700 folder. Linux: the home folder itself, because
 * sandboxed browsers (snap, flatpak) cannot read hidden folders; the file is 0600 and removed after a moment.
 */
export function handoffDir(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): string {
  return platform === 'darwin' ? runtimeDir(env, platform) : os.homedir();
}

export function writeHandoff(url: string, dir: string, startCleaner = true): string {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  // Leftovers of an earlier launch whose cleaner did not run.
  for (const n of fs.readdirSync(dir)) {
    if (!n.startsWith(HANDOFF_PREFIX) || !n.endsWith('.html')) continue;
    try {
      const f = path.join(dir, n);
      if (Date.now() - fs.statSync(f).mtimeMs > HANDOFF_LIFETIME_MS) fs.unlinkSync(f);
    } catch {
      /* not ours to remove */
    }
  }
  const file = path.join(dir, `${HANDOFF_PREFIX}${crypto.randomBytes(8).toString('hex')}.html`);
  fs.writeFileSync(file, handoffHtml(url), { mode: 0o600, flag: 'wx' });
  if (startCleaner) {
    // The launcher exits right away, so a detached process removes the file. Its arguments hold the path only.
    const cleaner = `setTimeout(()=>{try{require('node:fs').unlinkSync(process.argv[1])}catch{}},${HANDOFF_LIFETIME_MS})`;
    spawn(process.execPath, ['-e', cleaner, file], { detached: true, stdio: 'ignore' }).unref();
  }
  return file;
}

/** Open `url` (which carries the access key in its fragment) in the browser. Returns false if that failed. */
export function openWithKey(url: string, platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    const target = platform === 'win32' ? url : pathToFileURL(writeHandoff(url, handoffDir(platform, env))).href;
    const { file, args } = browserCommand(target, platform, env);
    const child = spawn(file, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => {
      /* no browser launcher on this system */
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}
