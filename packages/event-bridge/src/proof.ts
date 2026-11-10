// "Is the thing on that port really the Office that wrote the runtime file?"
//
// A runtime file can outlive its bridge (crash, forced kill, power loss). Whatever listens on that port later
// (another user's process on a shared computer, an unrelated dev server) must not be taken for Office: the hook
// forwarder would post prompts to it and the launcher would call it "running". Answering with the app name proves
// nothing, so the caller sends a random nonce and Office answers with HMAC(token, nonce). Only the process that
// holds the per-launch token can do that, and the token itself is not revealed by the answer.
// KEEP IN SYNC with plugin/onecarat-agent-office/scripts/forward-lib.mjs (healthProof, NONCE_RE).
import crypto from 'node:crypto';
import http from 'node:http';

export const NONCE_RE = /^[0-9a-f]{32,64}$/;

export function healthProof(token: string, nonce: string): string {
  return crypto.createHmac('sha256', token).update(`office-health:${nonce}`).digest('hex');
}

export function proofMatches(given: unknown, token: string, nonce: string): boolean {
  const want = healthProof(token, nonce);
  return typeof given === 'string' && given.length === want.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(want));
}

export interface OfficeAnswer {
  /** True only when the answer carried a valid proof for this token. */
  ok: boolean;
  body?: Record<string, unknown>;
}

/** GET /api/health with a fresh nonce; `ok` only if the answer proves it holds `token`. */
export function askOffice(port: number, token: string, timeoutMs = 800): Promise<OfficeAnswer> {
  return new Promise((resolve) => {
    const nonce = crypto.randomBytes(16).toString('hex');
    const req = http.get({ host: '127.0.0.1', port, path: '/api/health', timeout: timeoutMs, headers: { 'x-office-token': token, 'x-office-nonce': nonce } }, (res) => {
      const c: Buffer[] = [];
      let size = 0;
      res.on('data', (d: Buffer) => {
        size += d.length;
        if (size > 64 * 1024) req.destroy();
        else c.push(d);
      });
      res.on('error', () => resolve({ ok: false }));
      res.on('end', () => {
        try {
          const j = JSON.parse(Buffer.concat(c).toString()) as Record<string, unknown> | null;
          const ok = !!j && typeof j === 'object' && j.app === 'onecarat-agent-office' && proofMatches(j.proof, token, nonce);
          resolve(ok ? { ok, body: j! } : { ok: false });
        } catch {
          resolve({ ok: false });
        }
      });
    });
    req.on('error', () => resolve({ ok: false }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false });
    });
  });
}
