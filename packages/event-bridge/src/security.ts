import crypto from 'node:crypto';
import type { IncomingMessage } from 'node:http';

export function newToken(): string {
  return crypto.randomBytes(24).toString('hex');
}

export function tokenMatches(given: unknown, expected: string): boolean {
  if (typeof given !== 'string' || given.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

/** DNS-rebinding guard: only accept requests addressed to the loopback name we serve on. */
export function hostAllowed(req: IncomingMessage, port: number): boolean {
  const host = (req.headers.host ?? '').toLowerCase();
  return host === `127.0.0.1:${port}` || host === `localhost:${port}` || host === `[::1]:${port}`;
}

/**
 * Hook posts come from the local forwarder (a Node process), never from a browser.
 * Any request carrying browser markers (Origin / Sec-Fetch-*) is refused on the hook endpoint (CSRF guard).
 */
export function looksLikeBrowser(req: IncomingMessage): boolean {
  return req.headers.origin !== undefined || req.headers['sec-fetch-site'] !== undefined || req.headers['sec-fetch-mode'] !== undefined;
}

/** UI endpoints: allow same-origin browser requests (or non-browser tools), refuse cross-site ones. */
export function crossSite(req: IncomingMessage, port: number, devOrigins: string[] = []): boolean {
  if (req.headers.origin && devOrigins.includes(req.headers.origin)) return false;
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return true;
  const origin = req.headers.origin;
  if (origin && origin !== `http://127.0.0.1:${port}`) return true;
  return false;
}

export const SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cross-origin-resource-policy': 'same-origin',
  'x-frame-options': 'DENY',
};

export const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";

/**
 * WebSocket auth. Browsers cannot set headers on a WebSocket, so the page offers two subprotocols,
 * "office.v1" and "office-token.<token>". The server only ever answers "office.v1" (the token is not echoed).
 */
export const WS_PROTOCOL = 'office.v1';
export function protocolToken(header: string | string[] | undefined): string | undefined {
  const list = (Array.isArray(header) ? header.join(',') : header ?? '').split(',').map((s) => s.trim());
  if (!list.includes(WS_PROTOCOL)) return undefined;
  return list.find((p) => p.startsWith('office-token.'))?.slice('office-token.'.length);
}
