// Embedded terminal (method B1): the official interactive `claude`, run in a pseudo-terminal and shown in the
// Office chat panel with xterm.js. The user types requests and answers permission prompts there themselves.
// Office never parses this output, never infers state from it (state comes from hooks only), never writes to it
// on its own, and keeps the scrollback in memory only.
//
// node-pty is optional. If it cannot be loaded (no prebuild for this OS/CPU, files missing…), the terminal reports
// `available: false` with a reason and the rest of Office keeps working read-only.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { childEnv } from './child-env.ts';

export interface PtyProcess {
  pid: number;
  onData(cb: (d: string) => void): unknown;
  onExit(cb: (e: { exitCode: number; signal?: number }) => void): unknown;
  write(d: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
}
export interface PtyModule {
  spawn(file: string, args: string[], opts: { name: string; cols: number; rows: number; cwd: string; env: Record<string, string> }): PtyProcess;
}
export type PtyLoad = { ok: true; pty: PtyModule; from: string } | { ok: false; reason: string };

/** Try each candidate node-pty directory; require a native build for this platform before accepting it. */
export function loadPty(candidates: string[]): PtyLoad {
  const req = createRequire(import.meta.url);
  const plat = `${process.platform}-${process.arch}`;
  const reasons: string[] = [];
  for (const dir of candidates) {
    if (!fs.existsSync(path.join(dir, 'package.json'))) continue;
    const hasNative = fs.existsSync(path.join(dir, 'prebuilds', plat)) || fs.existsSync(path.join(dir, 'build', 'Release'));
    if (!hasNative) {
      reasons.push(`no node-pty binary for ${plat}`);
      continue;
    }
    try {
      const m = req(dir) as PtyModule;
      if (typeof m.spawn === 'function') return { ok: true, pty: m, from: dir };
      reasons.push('node-pty has no spawn()');
    } catch (e) {
      reasons.push((e as Error).message.split('\n')[0]!);
    }
  }
  return { ok: false, reason: reasons[0] ?? 'node-pty is not bundled' };
}

export interface TerminalState {
  available: boolean;
  reason?: string;
  running: boolean;
  cwd: string;
  /** --session-id given to the embedded claude, so the UI can follow that session's hook events. */
  sessionId?: string;
  exitCode?: number;
}

export type TerminalMessage = { t: 'state'; state: TerminalState } | { t: 'out'; d: string } | { t: 'reset' };

export interface TerminalOptions {
  load: PtyLoad;
  cwd: string;
  /** What to run. Fixed by the bridge; never taken from the UI. Default: the user's `claude`. */
  command?: (sessionId: string) => { file: string; args: string[] };
  scrollbackBytes?: number;
  env?: NodeJS.ProcessEnv;
}

export function defaultClaudeCommand(sessionId: string): { file: string; args: string[] } {
  const args = ['--session-id', sessionId];
  // `claude` is found on PATH. On Windows go through cmd so claude.exe / claude.cmd both resolve.
  if (process.platform === 'win32') return { file: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', 'claude', ...args] };
  return { file: 'claude', args };
}

export class Terminal {
  private readonly opts: TerminalOptions;
  private proc: PtyProcess | undefined;
  private chunks: string[] = [];
  private bytes = 0;
  private listeners = new Set<(m: TerminalMessage) => void>();
  private st: TerminalState;
  private cols = 100;
  private rows = 30;

  constructor(opts: TerminalOptions) {
    this.opts = opts;
    this.st = { available: opts.load.ok, reason: opts.load.ok ? undefined : opts.load.reason, running: false, cwd: opts.cwd };
  }

  get state(): TerminalState {
    return { ...this.st };
  }

  /** Output kept for re-attaching tabs (memory only, bounded). */
  scrollback(): string {
    return this.chunks.join('');
  }

  subscribe(fn: (m: TerminalMessage) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(m: TerminalMessage) {
    for (const l of this.listeners) l(m);
  }

  private setState(patch: Partial<TerminalState>) {
    this.st = { ...this.st, ...patch };
    this.emit({ t: 'state', state: this.state });
  }

  /** Start `claude` (optionally in another folder). Returns an error string, or undefined on success. */
  start(cwd?: string): string | undefined {
    if (!this.opts.load.ok) return this.opts.load.reason;
    if (this.proc) return 'already running';
    const dir = cwd ?? this.st.cwd;
    try {
      if (!fs.statSync(dir).isDirectory()) return 'not a folder';
    } catch {
      return 'folder not found';
    }
    const sessionId = crypto.randomUUID();
    const { file, args } = (this.opts.command ?? defaultClaudeCommand)(sessionId);
    this.clearScrollback();
    let proc: PtyProcess;
    try {
      proc = this.opts.load.pty.spawn(file, args, {
        name: 'xterm-256color',
        cols: this.cols,
        rows: this.rows,
        cwd: dir,
        env: childEnv(this.opts.env ?? process.env, { COLORTERM: 'truecolor' }),
      });
    } catch (e) {
      return (e as Error).message.split('\n')[0];
    }
    this.proc = proc;
    proc.onData((d) => {
      if (this.proc !== proc) return;
      this.chunks.push(d);
      this.bytes += d.length;
      const max = this.opts.scrollbackBytes ?? 512 * 1024;
      while (this.bytes > max && this.chunks.length > 1) this.bytes -= this.chunks.shift()!.length;
      this.emit({ t: 'out', d });
    });
    proc.onExit(({ exitCode }) => {
      if (this.proc !== proc) return;
      this.proc = undefined;
      this.setState({ running: false, exitCode });
    });
    this.setState({ running: true, cwd: dir, sessionId, exitCode: undefined });
    return undefined;
  }

  /** Keystrokes typed by the user in the Office tab. Office itself never calls this with its own input. */
  write(d: string): void {
    this.proc?.write(d);
  }

  resize(cols: number, rows: number): void {
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 10 || rows < 4 || cols > 500 || rows > 200) return;
    this.cols = cols;
    this.rows = rows;
    try {
      this.proc?.resize(cols, rows);
    } catch {
      /* process just exited */
    }
  }

  stop(): void {
    const p = this.proc;
    if (!p) return;
    this.proc = undefined;
    try {
      p.kill();
    } catch {
      /* already gone */
    }
    this.setState({ running: false });
  }

  clearScrollback(): void {
    this.chunks = [];
    this.bytes = 0;
    this.emit({ t: 'reset' });
  }
}
