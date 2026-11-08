// Receiving responsibility: authenticate the forwarder's POST, parse, normalize. Nothing raw is kept.
import type { IncomingMessage } from 'node:http';
import type { OfficeEvent } from '@onecarat/domain';
import { normalizeHook, type HookInput } from '@onecarat/adapter-claude-code';

export const MAX_BODY = 512 * 1024;
const MAX_CLOCK_SKEW_MS = 60_000;

export class BodyTooLarge extends Error {}

export function readBody(req: IncomingMessage, limit = MAX_BODY): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new BodyTooLarge());
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

let seq = 0;

/** Turn one hook post into normalized events. `hookTime` is when the hook process started (forwarder header). */
export function eventsFromHookBody(body: Buffer, hookTimeHeader: string | undefined, now = Date.now()): OfficeEvent[] {
  let input: unknown;
  try {
    input = JSON.parse(body.toString('utf8'));
  } catch {
    return [];
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return [];
  const ht = Number(hookTimeHeader);
  const at = Number.isFinite(ht) && Math.abs(ht - now) < MAX_CLOCK_SKEW_MS ? ht : now;
  return normalizeHook(input as HookInput, { source: 'live', at, seq: ++seq });
}
