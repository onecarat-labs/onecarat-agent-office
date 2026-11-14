import http from 'node:http';
import crypto from 'node:crypto';
import type { OfficeEvent } from '@onecarat/domain';
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
import { isStartMode } from './claude-path.ts';
import { revealInFolder } from './reveal.ts';
import { ResearchController, officeTerminal } from './research.ts';

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
  /**
   * Research Lab. It needs no terminal of its own: a research runs in the user's Claude Code session (the Office
   * terminal, or any other), and is followed through hooks and files. `cwd` is the working folder when there is
   * no terminal. Without a terminal and without this, /api/research is not offered.
   */
  research?: { cwd?: string; now?: () => number };
  /** Shows a file in the file manager (tests replace it). Returns false when it could not. */
  reveal?: (path: string) => boolean;
}

export interface Bridge {
  server: http.Server;
  store: EventStore;
  broadcaster: Broadcaster;
  stats: { received: number; rejected: number };
  research?: ResearchController;
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
  let userSeq = 0;
  const uiRoot = opts.uiDir ? path.resolve(opts.uiDir) : undefined;
  // Files Claude Code wrote: the full path stays here. Events (and so the page) get a display name and an id.
  const files = new Map<string, string>();
  const MAX_FILES = 5000;
  const hidePath = (e: OfficeEvent): OfficeEvent => {
    if (e.type !== 'file.created' || !e.path) return e;
    const fileId = crypto.createHmac('sha256', opts.token).update(e.path).digest('hex').slice(0, 24);
    files.delete(fileId);
    files.set(fileId, e.path);
    if (files.size > MAX_FILES) files.delete(files.keys().next().value!);
    const { path: _full, ...rest } = e;
    return { ...rest, fileId };
  };
  const research = opts.terminal || opts.research ? new ResearchController({ ...opts.research, cwd: opts.research?.cwd ?? opts.terminal?.state.cwd, terminal: opts.terminal ? officeTerminal(opts.terminal) : undefined, store, filePath: (id) => files.get(id) }) : undefined;
  const readJson = async (req: http.IncomingMessage): Promise<Record<string, unknown> | undefined> => {
    try {
      const v = JSON.parse((await readBody(req, 16 * 1024)).toString('utf8')) as unknown;
      return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
    } catch {
      return undefined;
    }
  };

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
        const events = eventsFromHookBody(body, header(req, 'x-office-hook-time')).map(hidePath);
        // Hooks of the claude in the built-in terminal carry that run's marker: its SessionStart names the session.
        const run = header(req, 'x-office-terminal');
        if (run) for (const e of events) if (e.type === 'session.started') opts.terminal?.adoptSession(run, e.sessionId);
        reorder.push(events);
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
      files.clear();
      broadcaster.reset();
      opts.terminal?.clearScrollback();
      return send(res, 200, '{}');
    }
    if (url.pathname === '/api/waits/dismiss' && req.method === 'POST') {
      // "Hide this wait": a refused permission prompt sends no hook, so its wait can stay on the page for ever.
      // This removes it from the DISPLAY of one agent. Nothing is written to a terminal, no prompt is answered,
      // and the agent is not marked as allowed or refused.
      const body = await readJson(req);
      const sessionId = body?.sessionId;
      const agentId = body?.agentId;
      const idOk = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 200;
      if (!idOk(sessionId) || (agentId !== undefined && !idOk(agentId))) return send(res, 400, '{"error":"bad request"}');
      if (!store.snapshot().some((e) => e.sessionId === sessionId)) return send(res, 404, '{}');
      reorder.flush();
      store.append([{ id: `${Date.now()}.${++userSeq}`, at: Date.now(), sessionId, source: 'live', agentId, type: 'wait.dismissed' }]);
      return send(res, 200, research ? JSON.stringify(research.info()) : '{}');
    }
    // ---- Research Lab ----
    if (url.pathname === '/api/research' && req.method === 'GET') {
      if (!research) return send(res, 404, '{}');
      return send(res, 200, JSON.stringify(research.info(url.searchParams.get('refresh') === '1')));
    }
    if (url.pathname === '/api/research/start' && req.method === 'POST') {
      // The user pressed "Start research". This is the only request that makes Office write into a terminal:
      // one command line into the input box. Enter is the user's.
      if (!research) return send(res, 404, '{}');
      const body = await readJson(req);
      if (!body) return send(res, 400, '{"error":"bad request"}');
      const r = research.start(body.theme, body.count, body.researchers ?? 2);
      return 'error' in r ? send(res, 409, JSON.stringify(r)) : send(res, 200, JSON.stringify(research.info()));
    }
    if (url.pathname === '/api/research/dismiss' && req.method === 'POST') {
      // Drops a research that has not started. Nothing is written to the terminal and nothing is stopped.
      if (!research) return send(res, 404, '{}');
      research.dismiss();
      return send(res, 200, JSON.stringify(research.info()));
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
    if (url.pathname === '/api/reveal' && req.method === 'POST') {
      // "Open folder" for a file Claude Code wrote. Only a path this bridge itself recorded as written is accepted,
      // so the page cannot make the file manager open anything else. The page names it by id; it never has the path.
      const id = (await readJson(req))?.id;
      if (id === undefined) return send(res, 400, '{"error":"bad request"}');
      const file = typeof id === 'string' ? files.get(id) : undefined;
      if (!file) return send(res, 404, '{"error":"unknown file"}');
      return (opts.reveal ?? revealInFolder)(file) ? send(res, 200, '{}') : send(res, 410, '{"error":"gone"}');
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
    const target = pathname === '/pty' ? opts.terminal : undefined;
    if (!target) return refuse(socket, 404, 'Not Found');
    // All three checks run before the WebSocket exists: Host (DNS rebinding), exact Origin, token.
    if (!hostAllowed(req, opts.port)) return refuse(socket, 421, 'Misdirected Request');
    if (!allowedOrigins.has(String(req.headers.origin ?? ''))) return refuse(socket, 403, 'Forbidden');
    if (!tokenMatches(protocolToken(req.headers['sec-websocket-protocol']), opts.token)) return refuse(socket, 403, 'Forbidden');
    wss.handleUpgrade(req, socket, head, (ws) => attachTerminal(ws, target));
  });

  return {
    server,
    store,
    broadcaster,
    stats,
    research,
    close: (reason?: string) =>
      new Promise<void>((resolve) => {
        reorder.flush();
        broadcaster.close(reason);
        research?.dispose();
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

type ClientMessage = { t: 'in'; d: string } | { t: 'resize'; cols: number; rows: number } | { t: 'start'; cwd?: string; mode?: unknown } | { t: 'stop' };

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
        // mode is one of three fixed words (new / continue / resume); anything else is refused, never passed on.
        const err = m.mode === undefined || isStartMode(m.mode) ? term.start(typeof m.cwd === 'string' && m.cwd ? m.cwd : undefined, m.mode) : 'unknown start mode';
        if (err) out({ t: 'state', state: { ...term.state, reason: err } });
      } else if (m.t === 'stop') term.stop();
    } catch {
      /* malformed message: ignored */
    }
  });
  ws.on('error', () => ws.terminate());
  ws.on('close', off);
}
