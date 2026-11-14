// Research Lab: reading the result files Claude Code wrote.
//
// Office only READS here. It never writes, changes or deletes a research file: the files are written by Claude
// Code (through its normal permission prompts), in <working folder>/research/<research id>/.
// What is read is untrusted data (it was put together from web pages): every field is type-checked, clipped and
// copied into a fresh object; nothing is executed, and nothing outside that one folder is opened:
//   - only regular files directly in the run folder (no sub-folders; a link is not followed, at any level),
//   - only names ending in .json, bounded in size and in number.
import fs from 'node:fs';
import path from 'node:path';

export const RESEARCH_DIR = 'research';
/** r-YYYYMMDD-HHMMSS-xxxx (made by the bridge). */
export const RESEARCH_ID_RE = /^r-\d{8}-\d{6}-[0-9a-f]{4}$/;
export const MAX_RESULT_BYTES = 256 * 1024;
export const MAX_RESULT_FILES = 60;
export const MAX_PAST_RUNS = 20;
const REQUEST_FILE = 'request.json';
const SUMMARY_FILE = 'summary.json';
const REVIEW_FILE_RE = /^review-([A-Za-z0-9][A-Za-z0-9._-]{0,63})\.json$/;
/** The agent type of the researcher definition shipped in the plugin (agents/researcher.md). */
export const RESEARCHER_AGENT_TYPE = 'onecarat-agent-office:researcher';

export type ResearchFileKind = 'request' | 'summary' | 'review' | 'result';
/** What a file directly in a run folder is, by its name alone. */
export function researchFileKind(name: string): ResearchFileKind | undefined {
  if (!RESULT_FILE_RE.test(name)) return undefined;
  if (name === REQUEST_FILE) return 'request';
  if (name === SUMMARY_FILE) return 'summary';
  return REVIEW_FILE_RE.test(name) ? 'review' : 'result';
}
const RESULT_FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.json$/;

export interface ResearchSource {
  title: string;
  /** As written in the file. The page shows it as a link only when it is http(s). */
  url: string;
}

export interface ResearchCard {
  /** Result id: the file's `id` when it is a plain token, else the file name without .json. */
  id: string;
  file: string;
  title: string;
  summary: string;
  details: string;
  findings: string[];
  sources: ResearchSource[];
  caveats: string[];
  status: 'completed' | 'partial' | 'failed';
  /** Set by the bridge, never taken from the file. */
  engine: string;
  at: number;
  /** Who wrote it: the agent id on the Write hook (never taken from the file or its name). Absent = not seen. */
  agentId?: string;
  /** The manager's check of this result (review-<id>.json), when there is one. */
  review?: { verdict: ResearchReview['verdict']; note: string };
}

/** review-<result id>.json, written by the manager. */
export interface ResearchReview {
  resultId: string;
  file: string;
  verdict: 'confirmed' | 'needs-check';
  note: string;
  at: number;
}

/** summary.json, written by the manager when the research is over. `at` = when the file was written. */
export interface ResearchSummary {
  saved?: number;
  missing?: number;
  reason: string;
  at: number;
}

export interface ResearchFileError {
  file: string;
  reason: 'unreadable' | 'too-large' | 'invalid-json' | 'not-an-object' | 'wrong-research-id' | 'no-title' | 'not-a-regular-file' | 'bad-verdict';
}

export interface ResearchRequestInfo {
  theme?: string;
  requestedCount?: number;
  researchers?: number;
  /** When request.json was written (its modification time): the start of the research. */
  at?: number;
}

const str = (v: unknown, max: number): string => (typeof v === 'string' ? clean(v).slice(0, max) : '');
/** Text only: control characters (except line breaks and tabs) are dropped. Never interpreted as HTML by the page. */
function clean(s: string): string {
  return s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
}
const list = (v: unknown, maxItems: number, maxLen: number): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((x) => clean(x).slice(0, maxLen)).filter(Boolean).slice(0, maxItems) : [];

/** A real folder, not a link to one. */
export function isRealDir(p: string): boolean {
  try {
    const st = fs.lstatSync(p);
    return st.isDirectory() && !st.isSymbolicLink();
  } catch {
    return false;
  }
}

function readJsonFile(file: string): { value: unknown } | { reason: ResearchFileError['reason'] } {
  let st: fs.Stats;
  try {
    st = fs.lstatSync(file);
  } catch {
    return { reason: 'unreadable' };
  }
  if (!st.isFile() || st.isSymbolicLink()) return { reason: 'not-a-regular-file' };
  if (st.size > MAX_RESULT_BYTES) return { reason: 'too-large' };
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  } catch {
    return { reason: 'unreadable' };
  }
  try {
    return { value: JSON.parse(text) };
  } catch {
    return { reason: 'invalid-json' };
  }
}

/** Check one parsed result against the schema. Unknown fields are ignored; wrong types become empty. */
export function validateResult(value: unknown, researchId: string, file: string, engine: string, at: number): ResearchCard | ResearchFileError['reason'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'not-an-object';
  const o = value as Record<string, unknown>;
  // A file that names another research does not belong on this board.
  if (o.researchId !== undefined && o.researchId !== researchId) return 'wrong-research-id';
  const title = str(o.title, 200);
  if (!title) return 'no-title';
  const rawId = typeof o.id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(o.id) ? o.id : file.replace(/\.json$/i, '');
  const sources: ResearchSource[] = Array.isArray(o.sources)
    ? o.sources
        .map((s): ResearchSource | undefined => {
          if (typeof s === 'string') return { title: '', url: str(s, 2000) };
          if (!s || typeof s !== 'object') return undefined;
          const r = s as Record<string, unknown>;
          return { title: str(r.title, 300), url: str(r.url, 2000) };
        })
        .filter((s): s is ResearchSource => !!s && (!!s.url || !!s.title))
        .slice(0, 50)
    : [];
  const status = o.status === 'partial' || o.status === 'failed' ? o.status : 'completed';
  return { id: rawId, file, title, summary: str(o.summary, 1000), details: str(o.details, 20000), findings: list(o.findings, 30, 1000), sources, caveats: list(o.caveats, 20, 1000), status, engine, at };
}

/** Read one result file of a run. `name` must be a plain file name directly in the run folder. */
export function loadResult(runDir: string, name: string, researchId: string, engine: string): { card: ResearchCard } | { error: ResearchFileError } | undefined {
  if (researchFileKind(name) !== 'result') return undefined;
  const file = path.join(runDir, name);
  const r = readJsonFile(file);
  if ('reason' in r) return { error: { file: name, reason: r.reason } };
  let at = Date.now();
  try {
    at = fs.lstatSync(file).mtimeMs;
  } catch {
    /* keep now */
  }
  const card = validateResult(r.value, researchId, name, engine, at);
  return typeof card === 'string' ? { error: { file: name, reason: card } } : { card };
}

/** request.json: what was asked (written by Claude Code first, so a past research can be labelled after a restart). */
export function loadRequest(runDir: string): ResearchRequestInfo {
  const r = readJsonFile(path.join(runDir, REQUEST_FILE));
  if ('reason' in r || !r.value || typeof r.value !== 'object' || Array.isArray(r.value)) return {};
  const o = r.value as Record<string, unknown>;
  const n = Number(o.requestedCount);
  const p = Number(o.researchers);
  return { theme: str(o.theme, 500) || undefined, requestedCount: Number.isInteger(n) && n > 0 && n <= 100 ? n : undefined, researchers: Number.isInteger(p) && p > 0 && p <= 10 ? p : undefined, at: mtime(path.join(runDir, REQUEST_FILE)) };
}

function mtime(file: string): number | undefined {
  try {
    return fs.lstatSync(file).mtimeMs;
  } catch {
    return undefined;
  }
}

const count = (v: unknown): number | undefined => (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 1000 ? (v as number) : undefined);

/** Read one review file of a run. The verdict must be one of the two words; anything else is an error, not a guess. */
export function loadReview(runDir: string, name: string, researchId: string): { review: ResearchReview } | { error: ResearchFileError } | undefined {
  if (researchFileKind(name) !== 'review') return undefined;
  const file = path.join(runDir, name);
  const r = readJsonFile(file);
  if ('reason' in r) return { error: { file: name, reason: r.reason } };
  if (!r.value || typeof r.value !== 'object' || Array.isArray(r.value)) return { error: { file: name, reason: 'not-an-object' } };
  const o = r.value as Record<string, unknown>;
  if (o.researchId !== undefined && o.researchId !== researchId) return { error: { file: name, reason: 'wrong-research-id' } };
  if (o.verdict !== 'confirmed' && o.verdict !== 'needs-check') return { error: { file: name, reason: 'bad-verdict' } };
  const fromName = REVIEW_FILE_RE.exec(name)![1]!;
  const resultId = typeof o.resultId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(o.resultId) ? o.resultId : fromName;
  return { review: { resultId, file: name, verdict: o.verdict, note: str(o.note, 1000), at: mtime(file) ?? Date.now() } };
}

/** summary.json of a run: its existence is the evidence that the manager closed the research. */
export function loadSummary(runDir: string, researchId: string): { summary: ResearchSummary } | { error: ResearchFileError } | undefined {
  const file = path.join(runDir, SUMMARY_FILE);
  if (!fs.existsSync(file)) return undefined;
  const r = readJsonFile(file);
  if ('reason' in r) return { error: { file: SUMMARY_FILE, reason: r.reason } };
  if (!r.value || typeof r.value !== 'object' || Array.isArray(r.value)) return { error: { file: SUMMARY_FILE, reason: 'not-an-object' } };
  const o = r.value as Record<string, unknown>;
  if (o.researchId !== undefined && o.researchId !== researchId) return { error: { file: SUMMARY_FILE, reason: 'wrong-research-id' } };
  return { summary: { saved: count(o.saved), missing: count(o.missing), reason: str(o.reason, 1000), at: mtime(file) ?? Date.now() } };
}

/** Board order: by file name, numbers compared as numbers (result-2 before result-10). */
export function compareResultNames(a: string, b: string): number {
  return a.localeCompare(b, 'en', { numeric: true }) || (a < b ? -1 : a > b ? 1 : 0);
}

export interface RunFiles {
  cards: ResearchCard[];
  errors: ResearchFileError[];
  reviews: ResearchReview[];
  summary?: ResearchSummary;
}

/** All result files of a run, by file name. Nothing is read when the folders are not real folders. */
export function scanRun(root: string, researchId: string, engine: string): RunFiles {
  const out: RunFiles = { cards: [], errors: [], reviews: [] };
  const runDir = path.join(root, researchId);
  if (!RESEARCH_ID_RE.test(researchId) || !isRealDir(root) || !isRealDir(runDir)) return out;
  let names: string[];
  try {
    names = fs.readdirSync(runDir).sort(compareResultNames);
  } catch {
    return out;
  }
  let n = 0;
  let v = 0;
  for (const name of names) {
    const kind = researchFileKind(name);
    if (kind === 'result' && n < MAX_RESULT_FILES) {
      const r = loadResult(runDir, name, researchId, engine);
      if (!r) continue;
      n++;
      if ('card' in r) out.cards.push(r.card);
      else out.errors.push(r.error);
    } else if (kind === 'review' && v < MAX_RESULT_FILES) {
      const r = loadReview(runDir, name, researchId);
      if (!r) continue;
      v++;
      if ('review' in r) out.reviews.push(r.review);
      else out.errors.push(r.error);
    }
  }
  const s = loadSummary(runDir, researchId);
  if (s && 'summary' in s) out.summary = s.summary;
  else if (s) out.errors.push(s.error);
  return out;
}

/** Ids of earlier researches found in <cwd>/research, newest first. */
export function listRunIds(root: string): string[] {
  if (!isRealDir(root)) return [];
  try {
    return fs.readdirSync(root).filter((n) => RESEARCH_ID_RE.test(n) && isRealDir(path.join(root, n))).sort().reverse().slice(0, MAX_PAST_RUNS);
  } catch {
    return [];
  }
}

/**
 * Is `file` a .json directly inside a run folder of `root` (<root>/<research id>/<name>.json)? Returns the id and
 * the name; nothing else on disk is ever looked at.
 */
export function researchFileIn(root: string, file: string): { id: string; name: string } | undefined {
  const a = path.resolve(file);
  const fold = (p: string) => (process.platform === 'win32' ? p.toLowerCase() : p);
  const runDir = path.dirname(a);
  if (fold(path.dirname(runDir)) !== fold(path.resolve(root))) return undefined;
  const id = path.basename(runDir);
  const name = path.basename(a);
  return RESEARCH_ID_RE.test(id) && RESULT_FILE_RE.test(name) ? { id, name } : undefined;
}

/** Is `file` a .json directly inside `runDir`? (Used for the "a file was written" hook.) Returns its name. */
export function resultNameIn(runDir: string, file: string): string | undefined {
  const a = path.resolve(file);
  const fold = (p: string) => (process.platform === 'win32' ? p.toLowerCase() : p);
  if (fold(path.dirname(a)) !== fold(path.resolve(runDir))) return undefined;
  const name = path.basename(a);
  return RESULT_FILE_RE.test(name) ? name : undefined;
}

/** Is the folder inside a git working tree? (Only to tell the user that research/ may show up as a change.) */
export function insideGit(cwd: string): boolean {
  for (let d = path.resolve(cwd); ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, '.git'))) return true;
    if (path.dirname(d) === d) return false;
  }
}
