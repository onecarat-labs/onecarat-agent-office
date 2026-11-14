// "Open folder" for a file Claude Code wrote: shows it in the system file manager.
//
// The page never names a program or arguments. It names a path, and the bridge accepts it only if that exact
// path is in its own event store as a file Claude Code wrote (see server.ts), is absolute and local, and exists.
// The file itself is never opened or run: the file manager is asked to show its folder.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { systemRoot } from './claude-path.ts';
import { isLocalAbsolute } from './local-dir.ts';

export interface RevealSpec {
  file: string;
  args: string[];
  verbatim?: boolean;
}

/** What to run for a recorded path, after looking at what is there now (see revealInFolder). */
export function revealTarget(p: string, platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): RevealSpec | undefined {
  // lstat: a link is not a regular file here, whatever it points to.
  const st = fs.lstatSync(p, { throwIfNoEntry: false });
  if (st?.isFile()) return revealCommand(p, true, platform, env);
  const parent = path.dirname(p);
  if (parent === p || !fs.statSync(parent, { throwIfNoEntry: false })?.isDirectory()) return undefined;
  return revealCommand(parent, false, platform, env);
}

/** Program + arguments that show `target` in the file manager, or undefined when it cannot be shown. */
export function revealCommand(target: string, isFile: boolean, platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): RevealSpec | undefined {
  if (platform === 'win32') {
    // explorer.exe by absolute path (a bare name would be looked up in the working folder first).
    const p = path.win32.normalize(target);
    if (p.includes('"')) return undefined;
    const explorer = path.win32.join(systemRoot(env), 'explorer.exe');
    // /select wants the quotes around the path only, so the argument is passed as written.
    return { file: explorer, args: [isFile ? `/select,"${p}"` : `"${p}"`], verbatim: true };
  }
  if (platform === 'darwin') return { file: '/usr/bin/open', args: isFile ? ['-R', target] : [target] };
  // Linux: xdg-open by absolute path, found through the absolute PATH entries only (never the working folder).
  const opener = findOnPath('xdg-open', env.PATH);
  return opener ? { file: opener, args: [isFile ? path.dirname(target) : target] } : undefined;
}

/**
 * Absolute path of a program found through PATH. Relative entries and "." are skipped, so a program of that name
 * placed in the working folder (a cloned repository) is never the one that runs.
 */
export function findOnPath(name: string, pathValue: string | undefined, delimiter: string = path.delimiter): string | undefined {
  for (const raw of (pathValue ?? '').split(delimiter)) {
    const dir = raw.replace(/^"|"$/g, '');
    if (!dir || dir === '.' || !path.isAbsolute(dir)) continue;
    const f = path.join(dir, name);
    try {
      if (!fs.statSync(f).isFile()) continue;
      fs.accessSync(f, fs.constants.X_OK);
      return f;
    } catch {
      /* not here */
    }
  }
  return undefined;
}

/**
 * Show the file in its folder. Only a regular file is ever selected. If the recorded path is anything else by now
 * (gone, replaced by a folder, a link, a special file), that path itself is NOT opened: only its parent folder is
 * shown. False when there is no parent folder either, or nothing could be started.
 */
export function revealInFolder(p: string, platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!isLocalAbsolute(p, platform)) return false;
  const spec = revealTarget(p, platform, env);
  if (!spec) return false;
  try {
    const child = spawn(spec.file, spec.args, { detached: true, stdio: 'ignore', windowsVerbatimArguments: spec.verbatim });
    child.on('error', () => {
      /* no file manager on this system */
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}
