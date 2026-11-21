// How the launcher finds the running app and makes sure it really is the app.
// KEEP IN SYNC with src-tauri/src/main.rs (runtime_file) and plugin/onecarat-agent-office/scripts/forward-lib.mjs.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

export const APP_NAME = 'onecarat-agent-office';

export interface RuntimeInfo {
  port: number;
  token: string;
  pid: number;
  startedAt?: number;
  version?: string;
}

export function runtimeFilePath(env: NodeJS.ProcessEnv = process.env): string {
  const dir = env.ONECARAT_OFFICE_RUNTIME_DIR || path.join(env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), APP_NAME);
  return path.join(dir, 'bridge.json');
}

export function readRuntimeFile(file = runtimeFilePath()): RuntimeInfo | undefined {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8')) as RuntimeInfo;
    // A port the app could not have written (it listens on 1024-65535) makes the file unusable: Node throws on it.
    const portOk = v && Number.isInteger(v.port) && v.port >= 1024 && v.port <= 65535;
    return portOk && typeof v.token === 'string' && typeof v.pid === 'number' ? v : undefined;
  } catch {
    return undefined;
  }
}

/** Remove the file only if it still belongs to that process (another launch may have replaced it). */
export function removeRuntimeFile(pid: number, file = runtimeFilePath()): void {
  const cur = readRuntimeFile(file);
  if (cur && cur.pid !== pid) return;
  try {
    fs.unlinkSync(file);
  } catch {
    /* already gone */
  }
}

export function healthProof(token: string, nonce: string): string {
  return crypto.createHmac('sha256', token).update(`office-health:${nonce}`).digest('hex');
}

export interface Health {
  ok: boolean;
  /** Not ok because no answer came in time (the listener may only be busy). Unset when it answered wrongly or refused. */
  silent?: boolean;
  version?: string;
  windows?: number;
}

/**
 * Ask the listener on that port to prove that it holds the runtime file's token. `ok` only then: after a crash
 * the port (or the pid) may belong to something else, and that must never be treated as the app.
 */
export function askApp(port: number, token: string, timeoutMs = 800): Promise<Health> {
  return new Promise((resolve) => {
    const nonce = crypto.randomBytes(16).toString('hex');
    const req = http.get({ host: '127.0.0.1', port, path: '/api/health', timeout: timeoutMs, headers: { 'x-office-nonce': nonce } }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (d: Buffer) => {
        size += d.length;
        if (size > 16 * 1024) {
          req.destroy();
          resolve({ ok: false });
          return;
        }
        chunks.push(d);
      });
      res.on('error', () => resolve({ ok: false }));
      res.on('end', () => {
        try {
          const j = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { app?: string; proof?: unknown; version?: unknown; windows?: unknown };
          const want = healthProof(token, nonce);
          const proven = j.app === APP_NAME && typeof j.proof === 'string' && j.proof.length === want.length && crypto.timingSafeEqual(Buffer.from(j.proof), Buffer.from(want));
          resolve(proven ? { ok: true, version: typeof j.version === 'string' ? j.version : undefined, windows: typeof j.windows === 'number' ? j.windows : undefined } : { ok: false });
        } catch {
          resolve({ ok: false });
        }
      });
    });
    req.on('error', () => resolve({ ok: false }));
    req.on('timeout', () => {
      resolve({ ok: false, silent: true });
      req.destroy();
    });
  });
}

/** POST to the app with the token (show / shutdown). Resolves true when it answered 200. */
export function tellApp(info: RuntimeInfo, apiPath: '/api/show' | '/api/shutdown', timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: info.port, path: apiPath, method: 'POST', timeout: timeoutMs, headers: { 'x-office-token': info.token, 'content-length': 0 } }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode === 200));
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}
