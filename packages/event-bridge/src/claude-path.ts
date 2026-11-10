// Where is the user's `claude`? Resolved ONCE from PATH, never from the terminal's working folder.
//
// Why this matters: on Windows, cmd.exe looks for a command in the current directory before PATH. If the
// embedded terminal ran `cmd /c claude` inside a cloned repository, a `claude.cmd` placed in that repository
// would run instead of Claude Code, with the user's rights and before Claude Code's own trust prompt.
// So the bridge spawns an absolute path, and relative or "." PATH entries are skipped on every platform.
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD';

/** The Windows folder, absolute. A missing or odd SystemRoot falls back to the standard location. */
export function systemRoot(env: NodeJS.ProcessEnv = process.env): string {
  const v = envGet(env, 'SYSTEMROOT') ?? envGet(env, 'WINDIR');
  return v && /^[A-Za-z]:[\\/]/.test(v) && !v.includes('"') ? v : 'C:\\Windows';
}

function envGet(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const k = Object.keys(env).find((x) => x.toUpperCase() === name);
  return k ? env[k] : undefined;
}

/** Absolute path of `claude` found through PATH, or undefined. */
export function resolveClaude(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string | undefined {
  const win = platform === 'win32';
  const entries = (envGet(env, 'PATH') ?? '').split(win ? ';' : ':');
  const names = win ? (envGet(env, 'PATHEXT') ?? DEFAULT_PATHEXT).split(';').filter(Boolean).map((e) => 'claude' + e.toLowerCase()) : ['claude'];
  for (const raw of entries) {
    const dir = raw.replace(/^"|"$/g, '');
    if (!dir || dir === '.' || !path.isAbsolute(dir)) continue; // never the working folder, never a relative entry
    for (const name of names) {
      const f = path.join(dir, name);
      try {
        if (!fs.statSync(f).isFile()) continue;
        if (!win) fs.accessSync(f, fs.constants.X_OK);
        if (f.includes('"')) continue;
        return f;
      } catch {
        /* not here */
      }
    }
  }
  return undefined;
}

export interface SpawnSpec {
  file: string;
  /** node-pty takes an argv array, or on Windows one verbatim command line. */
  args: string[] | string;
}

/**
 * How to start the resolved `claude` with the arguments Office fixes. A .cmd/.bat shim (npm installs) needs
 * cmd.exe; everything else is executed directly. The path is quoted as a whole; the session id is a UUID.
 */
export function claudeCommand(exe: string, sessionId: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): SpawnSpec {
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) throw new Error('bad session id');
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(exe)) {
    // cmd.exe by absolute path: a bare name would be looked up in the working folder first.
    const comspec = envGet(env, 'COMSPEC');
    const cmd = comspec && /^[A-Za-z]:[\\/]/.test(comspec) ? comspec : path.win32.join(systemRoot(env), 'System32', 'cmd.exe');
    return { file: cmd, args: `/d /s /c ""${exe}" --session-id ${sessionId}"` };
  }
  return { file: exe, args: ['--session-id', sessionId] };
}
