import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { EventStore, ReorderBuffer } from './store.ts';
import { Broadcaster } from './broadcaster.ts';
import { BodyTooLarge, eventsFromHookBody, readBody } from './receiver.ts';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { CSP, SECURITY_HEADERS, crossSite, hostAllowed, looksLikeBrowser, protocolToken, tokenMatches, WS_PROTOCOL } from './security.ts';
import type { Terminal, TerminalMessage } from './terminal.ts';
import { scanConfig } from './config-scan.ts';
import { NONCE_RE, healthProof } from './proof.ts';
import { isLocalDir } from './local-dir.ts';

export interface BridgeOptions {
  port: number;
  token: string;
  /** Built office-ui (dist). Optional: without it only the API is served. */
  uiDir?: string;
  version: string;
  reorderWindowMs?: number;
  onShutdownRequest?: () => void;
  /** Embedded terminal (B1). Without it, /pty is not offered and Office is read-only. */
  terminal?: Terminal;
  /** Extra exact origins allowed for the UI besides http://127.0.0.1:<port> (the Vite dev server only). */
  devOrigins?: string[];
  /** Claude Code configuration view (read-only). Without it, /api/config answers 404. */
  config?: { home: string; defaultCwd: string; configDir?: string; managedDir?: string };
}

export interface Bridge {
  server: http.Server;
  store: EventStore;
  broadcaster: Broadcaster;
  stats: { received: number; rejected: number };
  /** reason is passed to the UIs ("stopped", "claude-ended"). */
  close: (reason?: string) => Promise<void>;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
};

export function createBridge(opts: BridgeOptions): Bridge {
  const store = new EventStore();
  const broadcaster = new Broadcaster(store);
  const reorder = new ReorderBuffer(opts.reorderWindowMs ?? 300, (b) => store.append(b));
  const stats = { received: 0, rejected: 0 };
  const uiRoot = opts.uiDir ? path.resolve(opts.uiDir) : undefined;

  const send = (res: http.ServerResponse, code: number, body: string, type = 'application/json; charset=utf-8', extra: Record<string, string> = {}) => {
    res.writeHead(code, { ...SECURITY_HEADERS, 'content-type': type, 'cache-control': 'no-store', ...extra });
    res.end(body);
  };

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      // A bad request must never take the bridge down (a malformed %-escape used to).
      stats.rejected++;
      if (!res.headersSent) send(res, e instanceof URIError ? 400 : 500, '{}');
      else res.destroy();
    });
  });

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (!hostAllowed(req, opts.port)) {
      stats.rejected++;
      return send(res, 421, '{"error":"host not allowed"}');
    }

    // ---- hook intake (from the local forwarder only) ----
    if (url.pathname === '/hook') {
      if (req.method !== 'POST') return send(res, 405, '{}');
      if (looksLikeBrowser(req) || !tokenMatches(req.headers['x-office-token'], opts.token)) {
        stats.rejected++;
        req.resume();
        return send(res, 403, '{}');
      }
      if (!(req.headers['content-type'] ?? '').startsWith('application/json')) {
        stats.rejected++;
        req.resume();
        return send(res, 415, '{}');
      }
      try {
        const body = await readBody(req);
        // Answer first: the hook must never wait on Office's own processing.
        send(res, 200, '{}');
        stats.received++;
        reorder.push(eventsFromHookBody(body, header(req, 'x-office-hook-time')));
      } catch (e) {
        stats.rejected++;
        if (!res.headersSent) send(res, e instanceof BodyTooLarge ? 413 : 400, '{}');
      }
      return;
    }

    // ---- UI endpoints (same-origin browser) ----
    if (crossSite(req, opts.port, opts.devOrigins)) {
      stats.rejected++;
      return send(res, 403, '{"error":"cross-site"}');
    }
    const authed = tokenMatches(req.headers['x-office-token'], opts.token);
    if (url.pathname === '/api/health' && req.method === 'GET') {
      // Without the token: only "is this Office?" (the page asks before it has a token). No data.
      // A caller that sends a nonce gets HMAC(token, nonce) back: proof that this is the Office that wrote the
      // runtime file, not something else that took the port after a crash (see proof.ts). The token is not revealed.
      const nonce = header(req, 'x-office-nonce');
      const base = { ok: true, app: 'onecarat-agent-office', version: opts.version, authed, ...(nonce && NONCE_RE.test(nonce) ? { proof: healthProof(opts.token, nonce) } : {}) };
      if (!authed) return send(res, 200, JSON.stringify(base));
      const terminal = opts.terminal?.state ?? { available: false, reason: 'disabled', running: false };
      return send(res, 200, JSON.stringify({ ...base, events: store.size, clients: broadcaster.count, received: stats.received, terminal }));
    }
    // Everything below shows or changes data. One token is the only way in (the same one the hooks use).
    if (url.pathname.startsWith('/api/') || url.pathname === '/events') {
      if (!authed) {
        stats.rejected++;
        return send(res, 401, '{"error":"token required"}');
      }
    }
    if (url.pathname === '/events' && req.method === 'GET') {
      broadcaster.attach(res, SECURITY_HEADERS);
      return;
    }
    if (url.pathname === '/api/clear' && req.method === 'POST') {
      store.clear();
      broadcaster.reset();
      opts.terminal?.clearScrollback();
      return send(res, 200, '{}');
    }
    if (url.pathname === '/api/config' && req.method === 'GET') {
      // Read-only, read again on every request, nothing kept. Secret values are hidden in config-scan.ts.
      if (!opts.config) return send(res, 404, '{}');
      const asked = url.searchParams.get('cwd');
      let cwd = opts.config.defaultCwd;
      if (asked) {
        // Absolute and local only: a UNC path would make this computer contact another machine.
        if (!isLocalDir(asked)) return send(res, 400, '{"error":"bad cwd"}');
        cwd = asked;
      }
      return send(res, 200, JSON.stringify(scanConfig({ cwd, home: opts.config.home, configDir: opts.config.configDir, managedDir: opts.config.managedDir })));
    }
    if (url.pathname === '/api/shutdown' && req.method === 'POST') {
      // Used by the launcher's "stop" (it reads the token from the runtime file).
      send(res, 200, '{}');
      opts.onShutdownRequest?.();
      return;
    }

    // ---- static UI ----
    if ((req.method === 'GET' || req.method === 'HEAD') && uiRoot) {
      let rel: string;
      try {
        rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
      } catch {
        return send(res, 400, 'bad path', 'text/plain');
      }
      if (rel.includes('\0')) return send(res, 400, 'bad path', 'text/plain');
      const file = path.resolve(uiRoot, '.' + rel);
      if (!file.startsWith(uiRoot + path.sep) && file !== uiRoot) return send(res, 404, 'not found', 'text/plain');
      fs.readFile(file, (err, data) => {
        if (err) return send(res, 404, 'not found', 'text/plain');
        const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
        const extra: Record<string, string> = type.startsWith('text/html') ? { 'content-security-policy': CSP } : {};
        if (rel.startsWith('/assets/')) extra['cache-control'] = 'public, max-age=31536000, immutable';
        res.writeHead(200, { ...SECURITY_HEADERS, 'content-type': type, 'cache-control': 'no-store', ...extra });
        res.end(req.method === 'HEAD' ? undefined : data);
      });
      return;
    }
    send(res, 404, '{}');
  }

  // ---- embedded terminal: WebSocket /pty ----
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024, handleProtocols: () => WS_PROTOCOL });
  const allowedOrigins = new Set([`http://127.0.0.1:${opts.port}`, ...(opts.devOrigins ?? [])]);
  const refuse = (socket: Duplex, code: number, text: string) => {
    stats.rejected++;
    socket.end(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  };
  server.on('upgrade', (req, socket, head) => {
    let pathname: string;
    try {
      pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    } catch {
      return refuse(socket, 400, 'Bad Request');
    }
    if (pathname !== '/pty' || !opts.terminal) return refuse(socket, 404, 'Not Found');
    // All three checks run before the WebSocket exists: Host (DNS rebinding), exact Origin, token.
    if (!hostAllowed(req, opts.port)) return refuse(socket, 421, 'Misdirected Request');
    if (!allowedOrigins.has(String(req.headers.origin ?? ''))) return refuse(socket, 403, 'Forbidden');
    if (!tokenMatches(protocolToken(req.headers['sec-websocket-protocol']), opts.token)) return refuse(socket, 403, 'Forbidden');
    wss.handleUpgrade(req, socket, head, (ws) => attachTerminal(ws, opts.terminal!));
  });

  return {
    server,
    store,
    broadcaster,
    stats,
    close: (reason?: string) =>
      new Promise<void>((resolve) => {
        reorder.flush();
        broadcaster.close(reason);
        opts.terminal?.stop();
        for (const c of wss.clients) c.terminate();
        server.close(() => resolve());
        server.closeAllConnections?.();
      }),
  };
}

function header(req: http.IncomingMessage, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

type ClientMessage = { t: 'in'; d: string } | { t: 'resize'; cols: number; rows: number } | { t: 'start'; cwd?: string } | { t: 'stop' };

function attachTerminal(ws: WebSocket, term: Terminal) {
  const out = (m: TerminalMessage) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m));
  };
  out({ t: 'state', state: term.state });
  const back = term.scrollback();
  if (back) out({ t: 'out', d: back });
  const off = term.subscribe(out);
  ws.on('message', (raw) => {
    // Nothing a client sends may take the bridge down: an exception here would be an uncaught one.
    try {
      const m = JSON.parse(String(raw)) as ClientMessage | null;
      if (!m || typeof m !== 'object') return;
      if (m.t === 'in' && typeof m.d === 'string') term.write(m.d);
      else if (m.t === 'resize') term.resize(m.cols, m.rows);
      else if (m.t === 'start') {
        const err = term.start(typeof m.cwd === 'string' && m.cwd ? m.cwd : undefined);
        if (err) out({ t: 'state', state: { ...term.state, reason: err } });
      } else if (m.t === 'stop') term.stop();
    } catch {
      /* malformed message: ignored */
    }
  });
  ws.on('error', () => ws.terminate());
  ws.on('close', off);
}
