// Where the running bridge advertises its port and per-launch token to the hook forwarder.
// KEEP IN SYNC with plugin/onecarat-agent-office/scripts/forward-lib.mjs (runtimeFilePath).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface RuntimeInfo {
  port: number;
  token: string;
  pid: number;
  startedAt: number;
  version: string;
}

export function runtimeDir(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  if (env.ONECARAT_OFFICE_RUNTIME_DIR) return env.ONECARAT_OFFICE_RUNTIME_DIR;
  const home = os.homedir();
  if (platform === 'win32') return path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'onecarat-agent-office');
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'onecarat-agent-office');
  return path.join(env.XDG_STATE_HOME || path.join(home, '.local', 'state'), 'onecarat-agent-office');
}

export function runtimeFilePath(env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform): string {
  return path.join(runtimeDir(env, platform), 'bridge.json');
}

export function writeRuntimeFile(info: RuntimeInfo, file = runtimeFilePath()): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(info), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export function readRuntimeFile(file = runtimeFilePath()): RuntimeInfo | undefined {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8')) as RuntimeInfo;
    return typeof v.port === 'number' && typeof v.token === 'string' ? v : undefined;
  } catch {
    return undefined;
  }
}

/** Remove the file only if it still belongs to this process (another bridge may have replaced it). */
export function removeRuntimeFile(pid: number, file = runtimeFilePath()): void {
  const cur = readRuntimeFile(file);
  if (cur && cur.pid !== pid) return;
  try {
    fs.unlinkSync(file);
  } catch {
    /* already gone */
  }
}
