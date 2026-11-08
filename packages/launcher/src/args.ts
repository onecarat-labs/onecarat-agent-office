// The launcher's options, as an allow-list. Nothing else is ever passed on to the bridge.
//
// The plugin skill pre-approves `office.mjs <subcommand> …`, so whatever the launcher accepts can be run by
// the model without a permission prompt. The bridge has development-only flags (serve another folder as the
// UI, open another page with the access key…) that would hand the key to arbitrary content; they are not
// reachable from here, and the bridge itself ignores them when it runs from the shipped bundle.
import fs from 'node:fs';
import path from 'node:path';

export const COMMANDS = ['check', 'start', 'stop', 'status', 'open'] as const;
export type Command = (typeof COMMANDS)[number];

export interface LauncherArgs {
  cmd: Command;
  port?: number;
  cwd?: string;
  noTerminal: boolean;
  noOpen: boolean;
}

export function parseLauncherArgs(argv: string[], exists: (dir: string) => boolean = (d) => isDir(d)): LauncherArgs | { error: string } {
  const [first = 'status', ...rest] = argv;
  if (!(COMMANDS as readonly string[]).includes(first)) return { error: `unknown command: ${first}` };
  const out: LauncherArgs = { cmd: first as Command, noTerminal: false, noOpen: false };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === '--no-open') out.noOpen = true;
    else if (a === '--no-terminal') out.noTerminal = true;
    else if (a === '--port') {
      const v = rest[++i];
      if (!v || !/^\d{4,5}$/.test(v) || Number(v) < 1024 || Number(v) > 65535) return { error: '--port needs a number between 1024 and 65535' };
      out.port = Number(v);
    } else if (a === '--cwd') {
      const v = rest[++i];
      if (!v) return { error: '--cwd needs a folder' };
      const dir = path.resolve(v);
      if (!exists(dir)) return { error: `--cwd: not a folder: ${dir}` };
      out.cwd = dir;
    } else return { error: `unknown option: ${a}` };
  }
  return out;
}

/** Arguments for the bridge process, built from the parsed values only (never copied from argv). */
export function bridgeArgs(a: LauncherArgs, defaultCwd: string): string[] {
  const args = ['--cwd', a.cwd ?? defaultCwd];
  if (a.port) args.push('--port', String(a.port));
  if (a.noTerminal) args.push('--no-terminal');
  return args;
}

function isDir(d: string): boolean {
  try {
    return fs.statSync(d).isDirectory();
  } catch {
    return false;
  }
}
