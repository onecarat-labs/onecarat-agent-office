// Read-only scan of Claude Code's own configuration files (the documented locations only).
// Nothing here writes, and nothing is kept: every request reads the files again.
// Protection, in order:
//   - credentials are never opened (~/.claude/.credentials.json is not in the catalog);
//   - ~/.claude.json is mostly Claude Code's own state (and the OAuth account): only the MCP servers and the
//     current project's permission/MCP fields are taken from it, the rest never leaves this function;
//   - values under secret-looking keys, and every value under `env` / `headers`, are replaced before sending;
//   - other strings go through the same best-effort masking as the office view.
import fs from 'node:fs';
import path from 'node:path';
import { maskSecrets } from '@onecarat/adapter-claude-code';

export type ConfigLayer = 'managed' | 'user' | 'project';
export type ConfigKind = 'settings' | 'mcp' | 'claude-json' | 'keybindings' | 'markdown' | 'dir' | 'skills' | 'memory' | 'ancestors';

export interface ConfigItem {
  name: string;
  /** Relative to the entry's folder. */
  file: string;
  description?: string;
}

export interface ConfigEntry {
  id: string;
  layer: ConfigLayer;
  kind: ConfigKind;
  path: string;
  exists: boolean;
  error?: string;
  size?: number;
  mtime?: number;
  /** settings / mcp / keybindings / claude-json: the parsed file, with secret values hidden. */
  json?: unknown;
  /** markdown / memory (MEMORY.md): the text, masked and clipped. */
  text?: string;
  truncated?: boolean;
  /** dir / skills / memory / ancestors: what the folder holds. */
  items?: ConfigItem[];
}

export interface ConfigScan {
  cwd: string;
  userDir: string;
  scannedAt: number;
  entries: ConfigEntry[];
}

export interface ScanOptions {
  cwd: string;
  home: string;
  platform?: NodeJS.Platform;
  /** CLAUDE_CONFIG_DIR, when set, replaces ~/.claude (and holds .claude.json). */
  configDir?: string;
  /** Overrides the managed-policy folder (tests). */
  managedDir?: string;
}

export const HIDDEN = '••• (hidden)';
const SECRET_KEY = /(key|token|secret|passw(or)?d|pwd|pass\b|auth(?!or\b)|credential|cookie|session)/i;
// Whole subtrees whose values are hidden: environment and HTTP headers, and MCP/hook `args` (secrets are passed there as
// `--token xxx` or a bare value too often for the string mask to be trusted).
const HIDE_ALL_UNDER = new Set(['env', 'headers', 'args']);
const MAX_TEXT = 64 * 1024;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_CLAUDE_JSON_BYTES = 64 * 1024 * 1024;
const MAX_ITEMS = 300;

export function managedDirFor(platform: NodeJS.Platform): string {
  if (platform === 'win32') return 'C:\\Program Files\\ClaudeCode';
  if (platform === 'darwin') return '/Library/Application Support/ClaudeCode';
  return '/etc/claude-code';
}

/** Claude Code's per-project folder name under ~/.claude/projects (every non-alphanumeric becomes '-'). */
export function projectSlug(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, '-');
}

/**
 * Hide secret values. Keys are kept (they tell what is configured); only values are replaced.
 * A secret-looking key hides its whole subtree (string, array or object); `env` / `headers` / `args` likewise.
 * Other strings go through the best-effort mask; a URL additionally loses its query string (`?token=…`).
 */
export function sanitize(v: unknown, hideAll = false, depth = 0): unknown {
  if (depth > 32) return '…';
  if (typeof v === 'string') return hideAll ? HIDDEN : maskSecrets(v.replace(/^([a-z][a-z0-9+.-]*:\/\/[^\s?#]*)\?[^\s#]*/i, '$1?***'));
  if (Array.isArray(v)) return v.map((x) => sanitize(x, hideAll, depth + 1));
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      const all = hideAll || HIDE_ALL_UNDER.has(k) || SECRET_KEY.test(k);
      out[k] = all && (typeof x === 'string' || typeof x === 'number') ? HIDDEN : sanitize(x, all, depth + 1);
    }
    return out;
  }
  return v;
}

function stat(p: string): fs.Stats | undefined {
  try {
    return fs.statSync(p);
  } catch {
    return undefined;
  }
}

function base(id: string, layer: ConfigLayer, kind: ConfigKind, p: string): ConfigEntry {
  const st = stat(p);
  return { id, layer, kind, path: p, exists: !!st, size: st?.isFile() ? st.size : undefined, mtime: st ? st.mtimeMs : undefined };
}

function readJson(e: ConfigEntry, limit = MAX_JSON_BYTES): unknown {
  // Regular files only: reading a pipe or device placed under one of these names would never return.
  if (!stat(e.path)?.isFile()) {
    e.error = 'unreadable';
    return undefined;
  }
  if ((e.size ?? 0) > limit) {
    e.error = 'too-large';
    return undefined;
  }
  try {
    return JSON.parse(fs.readFileSync(e.path, 'utf8').replace(/^\uFEFF/, ''));
  } catch (err) {
    e.error = err instanceof SyntaxError ? 'invalid-json' : 'unreadable';
    return undefined;
  }
}

function readText(e: ConfigEntry, file = e.path): void {
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(MAX_TEXT + 1);
      const n = fs.readSync(fd, buf, 0, buf.length, 0);
      e.truncated = n > MAX_TEXT;
      e.text = maskSecrets(buf.subarray(0, Math.min(n, MAX_TEXT)).toString('utf8'));
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    e.error = 'unreadable';
  }
}

/** name / description from a Markdown file's YAML front matter (simple `key: value` lines only). */
export function frontMatter(file: string): { name?: string; description?: string } {
  let head: string;
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(8192);
      head = buf.subarray(0, fs.readSync(fd, buf, 0, buf.length, 0)).toString('utf8').replace(/^\uFEFF/, '');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return {};
  }
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(head);
  if (!m) return {};
  const out: { name?: string; description?: string } = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = /^(name|description):\s*(.*)$/.exec(line);
    if (kv) out[kv[1] as 'name' | 'description'] = maskSecrets(kv[2]!.replace(/^["']|["']$/g, '').trim()).slice(0, 300);
  }
  return out;
}

function listMarkdown(dir: string, rel = '', depth = 0, out: ConfigItem[] = []): ConfigItem[] {
  if (depth > 3 || out.length >= MAX_ITEMS) return out;
  let names: fs.Dirent[];
  try {
    names = fs.readdirSync(path.join(dir, rel), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const d of names.sort((a, b) => a.name.localeCompare(b.name))) {
    const r = rel ? `${rel}/${d.name}` : d.name;
    if (d.isDirectory()) listMarkdown(dir, r, depth + 1, out);
    else if (d.isFile() && d.name.toLowerCase().endsWith('.md')) {
      const fm = frontMatter(path.join(dir, r));
      out.push({ name: fm.name ?? d.name.replace(/\.md$/i, ''), file: r, description: fm.description });
    }
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

function listSkills(dir: string): ConfigItem[] {
  const out: ConfigItem[] = [];
  let names: fs.Dirent[];
  try {
    names = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const d of names.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!d.isDirectory()) continue;
    const file = path.join(dir, d.name, 'SKILL.md');
    if (!stat(file)?.isFile()) continue;
    const fm = frontMatter(file);
    out.push({ name: fm.name ?? d.name, file: `${d.name}/SKILL.md`, description: fm.description });
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

const PROJECT_FIELDS = ['allowedTools', 'mcpServers', 'enabledMcpjsonServers', 'disabledMcpjsonServers', 'hasTrustDialogAccepted'] as const;
const norm = (p: string) => path.resolve(p).replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();

/** The two parts of ~/.claude.json that are configuration. Everything else in it is never returned. */
export function pickClaudeJson(raw: unknown, cwd: string): unknown {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const projects = o.projects && typeof o.projects === 'object' ? (o.projects as Record<string, Record<string, unknown>>) : {};
  const key = Object.keys(projects).find((k) => norm(k) === norm(cwd));
  const proj = key ? projects[key] : undefined;
  const picked: Record<string, unknown> = {};
  if (proj) for (const f of PROJECT_FIELDS) if (f in proj) picked[f] = proj[f];
  return sanitize({
    mcpServers: o.mcpServers ?? {},
    project: proj ? { path: key, ...picked } : null,
    projectsKnown: Object.keys(projects).length,
  });
}

export function scanConfig(opts: ScanOptions): ConfigScan {
  const platform = opts.platform ?? process.platform;
  const cwd = path.resolve(opts.cwd);
  const userDir = opts.configDir ? path.resolve(opts.configDir) : path.join(opts.home, '.claude');
  const claudeJson = opts.configDir ? path.join(userDir, '.claude.json') : path.join(opts.home, '.claude.json');
  const managed = opts.managedDir ?? managedDirFor(platform);
  const proj = path.join(cwd, '.claude');
  const entries: ConfigEntry[] = [];

  const settings = (id: string, layer: ConfigLayer, p: string, kind: ConfigKind = 'settings') => {
    const e = base(id, layer, kind, p);
    if (e.exists) {
      const raw = readJson(e);
      if (raw !== undefined) e.json = sanitize(raw);
    }
    entries.push(e);
  };
  const markdown = (id: string, layer: ConfigLayer, ...candidates: string[]) => {
    const p = candidates.find((c) => stat(c)?.isFile()) ?? candidates[0]!;
    const e = base(id, layer, 'markdown', p);
    if (e.exists) readText(e);
    entries.push(e);
  };
  const dir = (id: string, layer: ConfigLayer, p: string, kind: 'dir' | 'skills' = 'dir') => {
    const e = base(id, layer, kind, p);
    if (e.exists) e.items = kind === 'skills' ? listSkills(p) : listMarkdown(p);
    entries.push(e);
  };

  // ---- managed (organization policy; highest precedence) ----
  settings('managed-settings', 'managed', path.join(managed, 'managed-settings.json'));
  settings('managed-mcp', 'managed', path.join(managed, 'managed-mcp.json'), 'mcp');
  markdown('managed-claude-md', 'managed', path.join(managed, 'CLAUDE.md'));

  // ---- user ----
  settings('user-settings', 'user', path.join(userDir, 'settings.json'));
  {
    const e = base('user-claude-json', 'user', 'claude-json', claudeJson);
    if (e.exists) {
      const raw = readJson(e, MAX_CLAUDE_JSON_BYTES);
      if (raw !== undefined) e.json = pickClaudeJson(raw, cwd);
    }
    entries.push(e);
  }
  markdown('user-claude-md', 'user', path.join(userDir, 'CLAUDE.md'));
  dir('user-rules', 'user', path.join(userDir, 'rules'));
  dir('user-agents', 'user', path.join(userDir, 'agents'));
  dir('user-commands', 'user', path.join(userDir, 'commands'));
  dir('user-skills', 'user', path.join(userDir, 'skills'), 'skills');
  dir('user-output-styles', 'user', path.join(userDir, 'output-styles'));
  settings('user-keybindings', 'user', path.join(userDir, 'keybindings.json'), 'keybindings');
  {
    const p = path.join(userDir, 'projects', projectSlug(cwd), 'memory');
    const e = base('user-memory', 'user', 'memory', p);
    if (e.exists) {
      e.items = listMarkdown(p).filter((i) => i.file !== 'MEMORY.md');
      const index = path.join(p, 'MEMORY.md');
      if (stat(index)?.isFile()) readText(e, index);
    }
    entries.push(e);
  }

  // ---- project (the folder Claude Code starts in) ----
  settings('project-settings', 'project', path.join(proj, 'settings.json'));
  settings('project-settings-local', 'project', path.join(proj, 'settings.local.json'));
  markdown('project-claude-md', 'project', path.join(cwd, 'CLAUDE.md'), path.join(proj, 'CLAUDE.md'));
  markdown('project-claude-local-md', 'project', path.join(cwd, 'CLAUDE.local.md'));
  {
    // CLAUDE.md files in parent folders are read too.
    const found: ConfigItem[] = [];
    for (let d = path.dirname(cwd); ; d = path.dirname(d)) {
      for (const n of ['CLAUDE.md', 'CLAUDE.local.md']) if (stat(path.join(d, n))?.isFile()) found.push({ name: n, file: path.join(d, n) });
      if (path.dirname(d) === d) break;
    }
    const e: ConfigEntry = { id: 'project-ancestors', layer: 'project', kind: 'ancestors', path: path.dirname(cwd), exists: found.length > 0, items: found };
    entries.push(e);
  }
  dir('project-rules', 'project', path.join(proj, 'rules'));
  settings('project-mcp', 'project', path.join(cwd, '.mcp.json'), 'mcp');
  dir('project-agents', 'project', path.join(proj, 'agents'));
  dir('project-commands', 'project', path.join(proj, 'commands'));
  dir('project-skills', 'project', path.join(proj, 'skills'), 'skills');
  dir('project-output-styles', 'project', path.join(proj, 'output-styles'));

  return { cwd, userDir, scannedAt: Date.now(), entries };
}
