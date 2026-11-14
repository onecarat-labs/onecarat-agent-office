// Research Lab controller (two-view version): a research runs in the user's own Claude Code session, started by
// the plugin's research skill. The manager (the main conversation) starts a few researchers in the background;
// each finding comes back as a file and becomes a card.
//
//   "Start research"  ->  one command line pasted into the Office terminal  ->  the USER presses Enter
//                                                                                   |
//   board  <-  hooks + files in research/<id>/  <-  manager + researchers (Claude Code, its normal permissions)
//
// What Office does and does not do here:
//   - Only after the user pressed "Start research": ONE command line is pasted into the Office terminal's input
//     box. Office never presses Enter, never answers a prompt, never types anything else, never retries.
//   - Nothing is pasted while hooks do not show that terminal's session as started, or show it waiting for a
//     permission answer (pasted characters could act as key presses there). The command is then only shown, for
//     the user to copy. The terminal's output is never read to decide any of this.
//   - A research the user started by typing the command themselves (any terminal, IDE, Desktop app) is shown the
//     same way: everything here is driven by hooks and by the files, not by who pasted.
//   - Results are written by Claude Code. Office only reads them (research-result.ts), and only in
//     <working folder of the session that runs the research>/research/<research id>/. That folder is the cwd
//     its hooks report: it must be a local absolute path (never a UNC path), and a written file is read only
//     when its path is exactly <that cwd>/research/<valid id>/<a file directly inside>.
//   - After a restart, earlier researches are read back only from the Office working folder and from the folder
//     currently chosen in the built-in terminal. Researches of other folders are not restored.
//   - No completion or progress without evidence: a researcher is "completed" only on Claude Code's own
//     completion notice; a research is "completed" only when its summary.json was written.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { OfficeEvent } from '@onecarat/domain';
import type { EventStore } from './store.ts';
import { oneLine, type Terminal } from './terminal.ts';
import { isLocalAbsolute } from './local-dir.ts';
import {
  MAX_PAST_RUNS, RESEARCHER_AGENT_TYPE, RESEARCH_DIR, compareResultNames, insideGit, isRealDir, listRunIds, loadRequest, loadResult, loadReview, loadSummary,
  researchFileIn, researchFileKind, scanRun, type ResearchCard, type ResearchFileError, type ResearchReview, type ResearchSummary,
} from './research-result.ts';

/**
 * awaiting-enter: the command is in the input box (or shown for copying); nothing has started.
 * researching:    the command was sent (its hook arrived) or request.json was written.
 * completed:      summary.json was written.
 * unconfirmed:    the manager's turn ended with no researcher running and no summary.json: the end is not confirmed.
 * dismissed:      the user dropped a research that never started.
 */
export type ResearchStatus = 'awaiting-enter' | 'researching' | 'completed' | 'unconfirmed' | 'dismissed';
/** Why a start was refused. The page has the wording. */
export type ResearchReason = 'bad-theme' | 'bad-count' | 'bad-researchers' | 'pending';
/** Why the command was not pasted (it is then shown for the user to copy). */
/** wait-unknown: a wait the user hid is still open as far as hooks tell (Office cannot know how it ended). */
export type NotPasted = 'no-terminal' | 'not-started' | 'waiting-permission' | 'wait-unknown';
/**
 * working:   started (SubagentStart), or seen working again after an end.
 * reported:  its report reached the manager (agent-message). Not an end yet.
 * completed: Claude Code's completion notice, or reported and then absent from the running background tasks.
 * failed / stopped: a completion notice with another status.
 */
export type ResearcherStatus = 'working' | 'reported' | 'completed' | 'failed' | 'stopped';

export const RESEARCH_COUNTS = [3, 5, 10, 20];
export const RESEARCH_MAX_COUNT = 20;
export const RESEARCHER_COUNTS = [1, 2, 3];
export const RESEARCH_COMMAND = '/onecarat-agent-office:research';
export const THEME_MAX = 500;

export interface Researcher {
  agentId: string;
  /** Order of appearance in this research (1, 2, 3). A display number, not the k in the file names. */
  n: number;
  status: ResearcherStatus;
  startedAt: number;
  updatedAt: number;
  /** How many cards on the board were written by this researcher (by the Write hook's agent id). */
  cards: number;
}

/** Someone in the research's session is waiting for the user's permission answer (in Claude Code, never here). */
export interface ResearchWaiting {
  /** Absent = the manager. */
  agentId?: string;
  toolName: string;
  detail: string;
  /** When the request arrived. A refusal sends no hook, so an old entry may be a prompt that is long gone. */
  at: number;
}

export interface ResearchRun {
  id: string;
  theme: string;
  requestedCount: number;
  requestedResearchers?: number;
  engine: string;
  dir: string;
  status: ResearchStatus;
  /** button: started from the page. observed: its request.json appeared (the user typed the command). */
  origin: 'button' | 'observed';
  /** The command line (button only): what was pasted, or what the user can copy. */
  command?: string;
  pasted?: boolean;
  notPasted?: NotPasted;
  /** When the button was pressed, or when the research was first seen. */
  createdAt: number;
  /** Evidence of the start: the command's hook, or request.json's modification time. */
  startedAt?: number;
  /** summary.json's modification time, or when the end could not be confirmed. */
  endedAt?: number;
  sessionId?: string;
  cards: ResearchCard[];
  errors: ResearchFileError[];
  researchers: Researcher[];
  summary?: ResearchSummary;
  waiting: ResearchWaiting[];
  /** How many requests of this research no hook has closed yet, including those the user hid on the page. */
  unresolved?: number;
  /** Read back from disk (an earlier research), not followed live by this Office. */
  restored?: boolean;
}

export interface ResearchInfo {
  cwd: string;
  /** Where results are read from: <cwd>/research. (One function decides it, so it can become a setting.) */
  root: string;
  inGit: boolean;
  counts: number[];
  defaultCount: number;
  researcherCounts: number[];
  defaultResearchers: number;
  command: string;
  researcherType: string;
  /** The Office terminal, as hooks see its session. permissionMode: the manager's, as last reported. */
  terminal: { available: boolean; running: boolean; sessionId?: string; started: boolean; waiting: boolean; waits: ResearchWaiting[]; /** All requests no hook has closed, including those the user hid. */ unresolved: number; permissionMode?: string };
  current?: ResearchRun;
  past: ResearchRun[];
}

/** The part of the Office terminal the controller uses. */
export interface ResearchTerminal {
  state(): { available: boolean; running: boolean; cwd: string; sessionId?: string };
  /** Put one line into the input box. Never sends it. */
  paste(line: string): boolean;
}

export function officeTerminal(term: Terminal): ResearchTerminal {
  return { state: () => term.state, paste: (line) => term.pasteLine(line) };
}

export interface ResearchOptions {
  store: EventStore;
  /** Without a terminal nothing is ever pasted; researches are still shown, and the command can be copied. */
  terminal?: ResearchTerminal;
  /** The Office working folder (where Office was started). Also the working folder when there is no terminal. */
  cwd?: string;
  /** Full path of a written file, from the id the bridge gave it (the events themselves carry no path). */
  filePath?: (fileId: string) => string | undefined;
  now?: () => number;
}

export const researchRoot = (cwd: string) => path.join(cwd, RESEARCH_DIR);
const fold = (p: string) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));
const samePath = (a: string, b: string) => fold(a) === fold(b);

export function newResearchId(now: number, exists: (id: string) => boolean): string {
  const d = new Date(now);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  for (;;) {
    const id = `r-${stamp}-${crypto.randomBytes(2).toString('hex')}`;
    if (!exists(id)) return id;
  }
}

/** The theme is typed by the user and goes into a terminal: one line of plain text, nothing that acts as a key. */
export function cleanTheme(v: unknown): string {
  return typeof v === 'string' ? oneLine(v).slice(0, THEME_MAX).trim() : '';
}

/** The one line Office pastes: `/onecarat-agent-office:research <findings> <researchers> <research id> <theme>`. */
export function researchCommand(req: { id: string; theme: string; count: number; researchers: number }): string {
  return oneLine(`${RESEARCH_COMMAND} ${req.count} ${req.researchers} ${req.id} ${req.theme}`);
}

interface OpenTool {
  agentId?: string;
  toolName: string;
  detail: string;
  /** When the permission request arrived (pending ones only). */
  at?: number;
  /** The user hid it on the page. Still open: only a hook closes a request. */
  hidden?: boolean;
}

/**
 * A refused permission request sends no hook of its own. An agent that starts another tool call this long after
 * its request has left that prompt behind (requests asked together arrive within about a second of each other).
 */
const ANSWERED_AFTER_MS = 3000;

const waitOf = (t: OpenTool): ResearchWaiting => ({ agentId: t.agentId, toolName: t.toolName, detail: t.detail, at: t.at ?? 0 });

/** What hooks say about one session. Only what the decisions below need. */
interface SessionView {
  started: boolean;
  mode?: string;
  /** Tool calls that began and have not ended (by tool_use_id). */
  open: Map<string, OpenTool>;
  /** Of those, the ones a permission request was seen for. Keys without a tool_use_id are synthetic. */
  pending: Map<string, OpenTool>;
}

const MAX_SESSIONS = 50;
const MAX_OPEN = 300;
const MAX_LIVE_RUNS = 20;
const ENDED: ResearcherStatus[] = ['completed', 'failed', 'stopped'];

export class ResearchController {
  private readonly o: ResearchOptions & { now: () => number };
  private readonly off: () => void;
  /** Researches followed live since this Office started, oldest first. */
  private readonly runs = new Map<string, ResearchRun>();
  private readonly reviews = new Map<string, Map<string, ResearchReview>>();
  private currentId: string | undefined;
  private past: ResearchRun[] | undefined;
  private pastKey = '';
  private readonly sessions = new Map<string, SessionView>();
  private seq = 0;

  constructor(opts: ResearchOptions) {
    this.o = { now: Date.now, ...opts };
    this.off = opts.store.subscribe((batch) => {
      for (const ev of batch) this.onEvent(ev);
    });
  }

  dispose(): void {
    this.off();
  }

  private term(): { available: boolean; running: boolean; cwd: string; sessionId?: string } {
    return this.o.terminal?.state() ?? { available: false, running: false, cwd: this.o.cwd ?? process.cwd() };
  }

  private sess(id: string): SessionView {
    let s = this.sessions.get(id);
    if (!s) {
      s = { started: false, open: new Map(), pending: new Map() };
      this.sessions.set(id, s);
      if (this.sessions.size > MAX_SESSIONS) this.sessions.delete(this.sessions.keys().next().value!);
    }
    return s;
  }

  private runOfAgent(sessionId: string, agentId: string): { run: ResearchRun; r: Researcher } | undefined {
    for (const run of this.runs.values()) {
      if (run.sessionId !== sessionId) continue;
      const r = run.researchers.find((x) => x.agentId === agentId);
      if (r) return { run, r };
    }
    return undefined;
  }

  /** The research a new researcher of this session belongs to: the newest one that is under way there. */
  private runOfSession(sessionId: string): ResearchRun | undefined {
    const mine = [...this.runs.values()].filter((r) => r.sessionId === sessionId && r.status !== 'dismissed' && r.status !== 'awaiting-enter');
    return mine.reverse().find((r) => r.status === 'researching') ?? mine[0];
  }

  private onEvent(ev: OfficeEvent): void {
    const s = this.sess(ev.sessionId);
    if (ev.type === 'session.ended') {
      s.started = false;
      s.open.clear();
      s.pending.clear();
      for (const run of this.runs.values()) if (run.sessionId === ev.sessionId && run.status === 'researching') this.unconfirmed(run, ev.at);
      return;
    }
    if (ev.type === 'wait.dismissed') {
      // Not a hook: the user hid this agent's wait on the page (a refused prompt sends nothing, so the wait
      // would stay). ONLY WHAT IS SHOWN changes. The request stays open here until a hook closes it: hiding
      // is not evidence that the prompt is gone, so it never lets a paste or the automatic return through.
      for (const t of s.pending.values()) if (t.agentId === ev.agentId) t.hidden = true;
      return;
    }
    // Any hook of a session shows that its Claude Code is past its start-up questions.
    s.started = true;
    if (!ev.agentId && ev.permissionMode) s.mode = ev.permissionMode;
    // A researcher known as ended is at work again (the user resumed it, or its end was only a pause).
    if (ev.agentId && ev.type === 'tool.started') {
      const hit = this.runOfAgent(ev.sessionId, ev.agentId);
      if (hit && hit.r.status !== 'working') this.working(hit.run, hit.r, ev.at);
    }
    switch (ev.type) {
      case 'session.started':
        s.open.clear();
        s.pending.clear();
        break;
      case 'user.prompt':
        // A new turn of the user: whatever the manager was asking before is no longer on screen (answered or
        // refused; a refusal sends no hook of its own).
        for (const [k, t] of s.pending) if (!t.agentId) s.pending.delete(k);
        for (const [k, t] of s.open) if (!t.agentId) s.open.delete(k);
        this.onPrompt(ev.sessionId, ev.text, ev.at);
        break;
      case 'tool.started':
        // This agent goes on with another call: its older requests were answered (or refused) before that.
        for (const [k, t] of s.pending) if (t.agentId === ev.agentId && k !== ev.toolUseId && (t.at ?? 0) < ev.at - ANSWERED_AFTER_MS) s.pending.delete(k);
        if (ev.toolUseId) {
          s.open.set(ev.toolUseId, { agentId: ev.agentId, toolName: ev.toolName, detail: ev.detail });
          if (s.open.size > MAX_OPEN) s.open.delete(s.open.keys().next().value!);
        }
        break;
      case 'permission.requested': {
        // The request names no tool call. It belongs to this agent's newest open call of that tool that has no
        // request yet (the call's start hook comes first).
        const mine = [...s.open].reverse().filter(([id, t]) => t.agentId === ev.agentId && t.toolName === ev.toolName && !s.pending.has(id));
        const hit = mine.find(([, t]) => t.detail === ev.detail) ?? mine[0];
        s.pending.set(hit ? hit[0] : `?${++this.seq}`, { agentId: ev.agentId, toolName: ev.toolName, detail: ev.detail, at: ev.at });
        break;
      }
      case 'tool.finished':
      case 'tool.failed': {
        const id = ev.toolUseId;
        if (id) s.open.delete(id);
        if (id && s.pending.delete(id)) break;
        // A request that could not be tied to a call: the same agent's same tool ending answers it.
        for (const [k, t] of s.pending) {
          if (k.startsWith('?') && t.agentId === ev.agentId && t.toolName === ev.toolName) {
            s.pending.delete(k);
            break;
          }
        }
        break;
      }
      case 'file.created': {
        // A whole file was written (the hook fires when Write has finished, so it is never read half-written).
        const p = ev.path ?? (ev.fileId ? this.o.filePath?.(ev.fileId) : undefined);
        if (p) this.take(p, ev);
        break;
      }
      case 'subagent.started':
        if (ev.agentType === RESEARCHER_AGENT_TYPE) this.researcherStarted(ev.sessionId, ev.childId, ev.at);
        break;
      case 'injected.prompt':
        if (ev.fromAgentId) this.researcherHeard(ev.sessionId, ev.fromAgentId, ev.kind, ev.taskStatus, ev.at);
        break;
      case 'notification':
        // "Claude is waiting for your input": the manager sits at its input box, so no question of the manager's
        // is open any more. It says nothing about what runs in the background.
        // Not a refusal signal: measured on 2.1.323, a refused request of the manager ends the turn with no hook
        // at all (no Stop, no PermissionDenied, and no idle notice in three minutes), so that wait stays shown
        // until the user's next prompt or the end of the session.
        if (!ev.agentId && ev.kind === 'idle_prompt') {
          for (const [k, t] of s.pending) if (!t.agentId) s.pending.delete(k);
          for (const [k, t] of s.open) if (!t.agentId) s.open.delete(k);
          this.onTurnEnd(ev.sessionId, undefined, ev.at);
        }
        break;
      case 'turn.stopped':
        if (!ev.agentId) {
          // The manager's turn is over: nothing of the manager's can still be waiting for an answer.
          for (const [k, t] of s.pending) if (!t.agentId) s.pending.delete(k);
          for (const [k, t] of s.open) if (!t.agentId) s.open.delete(k);
          this.onTurnEnd(ev.sessionId, ev.backgroundTasks, ev.at);
        }
        break;
      default:
        break;
    }
  }

  /** A turn began. Is it the research command of a research that was waiting for Enter? */
  private onPrompt(sessionId: string, text: string, at: number): void {
    const isCommand = text.trimStart().startsWith(RESEARCH_COMMAND);
    for (const run of this.runs.values()) {
      if (run.status !== 'awaiting-enter') continue;
      if (isCommand && text.includes(run.id)) {
        // The user pressed Enter (in the Office terminal, or wherever they pasted the copied command).
        run.status = 'researching';
        run.sessionId = sessionId;
        run.startedAt = at;
      } else if (run.pasted && sessionId === run.sessionId) {
        // Something else was sent from that input box: the pasted command is gone. Office does not paste again.
        run.status = 'dismissed';
        run.endedAt = at;
      }
    }
  }

  private researcherStarted(sessionId: string, agentId: string, at: number): void {
    const known = this.runOfAgent(sessionId, agentId);
    if (known) return this.working(known.run, known.r, at);
    const run = this.runOfSession(sessionId);
    if (!run) return;
    run.researchers.push({ agentId, n: run.researchers.length + 1, status: 'working', startedAt: at, updatedAt: at, cards: 0 });
    if (run.status === 'unconfirmed') this.resume(run);
  }

  private working(run: ResearchRun, r: Researcher, at: number): void {
    r.status = 'working';
    r.updatedAt = at;
    if (run.status === 'unconfirmed') this.resume(run);
  }

  /** New evidence of work after "end not confirmed": the research is under way again. */
  private resume(run: ResearchRun): void {
    run.status = 'researching';
    run.endedAt = undefined;
  }

  /** The manager received something from an agent: a report (agent-message) or Claude Code's completion notice. */
  private researcherHeard(sessionId: string, agentId: string, kind: string, taskStatus: string | undefined, at: number): void {
    const hit = this.runOfAgent(sessionId, agentId);
    if (!hit) return;
    const r = hit.r;
    if (kind === 'task-notification' && taskStatus) {
      r.status = taskStatus === 'completed' ? 'completed' : taskStatus === 'failed' ? 'failed' : 'stopped';
      r.updatedAt = at;
      this.dropWaiting(sessionId, agentId);
    } else if ((kind === 'agent-message' || kind === 'task-notification') && r.status === 'working') {
      // A report alone is not an end: it becomes one when the manager's turn ends without this agent running.
      r.status = 'reported';
      r.updatedAt = at;
    }
  }

  private dropWaiting(sessionId: string, agentId: string): void {
    const s = this.sess(sessionId);
    for (const [k, t] of s.pending) if (t.agentId === agentId) s.pending.delete(k);
    for (const [k, t] of s.open) if (t.agentId === agentId) s.open.delete(k);
  }

  /** The manager's turn ended. `tasks`: what Claude Code says is still running in the background (may be absent). */
  private onTurnEnd(sessionId: string, tasks: { id: string; status: string; agentType?: string }[] | undefined, at: number): void {
    for (const run of this.runs.values()) {
      if (run.sessionId !== sessionId || run.restored) continue;
      const running = (id: string) => tasks?.some((t) => t.id === id && t.status === 'running') === true;
      if (tasks) {
        for (const r of run.researchers) {
          if (r.status === 'reported' && !running(r.agentId)) {
            r.status = 'completed';
            r.updatedAt = at;
            this.dropWaiting(sessionId, r.agentId);
          }
        }
      }
      if (run.status !== 'researching') continue;
      // Also what was written without the Write tool (no hook): look at the folder itself.
      this.rescan(run);
      if (run.summary) {
        this.complete(run);
        continue;
      }
      const someoneAtWork = tasks ? run.researchers.some((r) => running(r.agentId)) || tasks.some((t) => t.status === 'running' && t.agentType === RESEARCHER_AGENT_TYPE) : run.researchers.some((r) => !ENDED.includes(r.status));
      if (!someoneAtWork) this.unconfirmed(run, at);
    }
  }

  private complete(run: ResearchRun): void {
    run.status = 'completed';
    run.endedAt = run.summary?.at;
  }

  /** No summary.json and nobody at work: the end is not confirmed. Never shown as completed. */
  private unconfirmed(run: ResearchRun, at: number): void {
    run.status = 'unconfirmed';
    run.endedAt = at;
  }

  /**
   * A file was written: if it belongs to a research of the session that wrote it, read it. The session's working
   * folder is the cwd on that very hook; without one, or with a path that is not local and absolute (a UNC path
   * would make this computer contact another machine), nothing is read.
   */
  private take(file: string, ev: OfficeEvent): void {
    if (!isLocalAbsolute(ev.cwd) || !isLocalAbsolute(file)) return;
    const root = researchRoot(ev.cwd);
    const where = researchFileIn(root, file);
    if (!where) return;
    const kind = researchFileKind(where.name);
    const dir = path.join(root, where.id);
    if (!kind || !isRealDir(root) || !isRealDir(dir)) return;
    let run = this.runs.get(where.id);
    if (run && !samePath(run.dir, dir)) {
      // The same id in another folder. A research started from the page whose command the user ran in a session
      // of another folder moves there with its request.json; anything else is not this research.
      if (run.origin !== 'button' || kind !== 'request' || run.cards.length) return;
      run.dir = dir;
    }
    if (!run) {
      // Only request.json opens a research (whoever typed the command, in whatever session). Other files of a
      // research this Office does not follow just mean the list of earlier researches changed.
      this.past = undefined;
      if (kind !== 'request') return;
      run = this.add({ id: where.id, theme: '', requestedCount: 0, engine: 'claude-code', dir, status: 'researching', origin: 'observed', createdAt: ev.at, sessionId: ev.sessionId, cards: [], errors: [], researchers: [], waiting: [] });
    }
    if (run.status === 'dismissed') return;
    run.sessionId ??= ev.sessionId;
    if (kind === 'request') {
      const req = loadRequest(dir);
      if (run.origin === 'observed') {
        run.theme = req.theme ?? run.theme;
        run.requestedCount = req.requestedCount ?? run.requestedCount;
        run.requestedResearchers = req.researchers ?? run.requestedResearchers;
      }
      run.startedAt = req.at ?? run.startedAt ?? ev.at;
      if (run.status === 'awaiting-enter') run.status = 'researching';
    } else if (kind === 'result') {
      const r = loadResult(dir, where.name, run.id, run.engine);
      if (!r) return;
      run.errors = run.errors.filter((e) => e.file !== where.name);
      run.cards = run.cards.filter((c) => c.file !== where.name);
      // Who wrote it comes from the hook, never from the file or its name.
      if ('card' in r) run.cards.push({ ...r.card, agentId: ev.agentId });
      else run.errors.push(r.error);
      // Always in file order (r1-2 before r1-10), whatever order the hooks arrived in.
      run.cards.sort((a, b) => compareResultNames(a.file, b.file));
    } else if (kind === 'review') {
      const r = loadReview(dir, where.name, run.id);
      if (!r) return;
      run.errors = run.errors.filter((e) => e.file !== where.name);
      if ('review' in r) this.reviewsOf(run.id).set(r.review.file, r.review);
      else run.errors.push(r.error);
    } else {
      const r = loadSummary(dir, run.id);
      run.errors = run.errors.filter((e) => e.file !== where.name);
      if (r && 'summary' in r) {
        // The research is closed: take everything that is in its folder (also what arrived without a hook).
        this.rescan(run);
        run.summary = r.summary;
        this.complete(run);
      } else if (r) run.errors.push(r.error);
    }
    if (run.status === 'unconfirmed' && kind !== 'summary') this.resume(run);
  }

  private reviewsOf(id: string): Map<string, ResearchReview> {
    let m = this.reviews.get(id);
    if (!m) this.reviews.set(id, (m = new Map()));
    return m;
  }

  /** Everything in the run's folder. Who wrote a card is kept from the hooks (the folder cannot tell). */
  private rescan(run: ResearchRun): void {
    const got = scanRun(path.dirname(run.dir), run.id, run.engine);
    const by = new Map(run.cards.map((c) => [c.file, c.agentId]));
    run.cards = got.cards.map((c) => ({ ...c, agentId: by.get(c.file) }));
    run.errors = got.errors;
    const m = this.reviewsOf(run.id);
    m.clear();
    for (const r of got.reviews) m.set(r.file, r);
    run.summary = got.summary;
  }

  private add(run: ResearchRun): ResearchRun {
    this.runs.set(run.id, run);
    this.currentId = run.id;
    if (this.runs.size > MAX_LIVE_RUNS) {
      const old = this.runs.keys().next().value!;
      this.runs.delete(old);
      this.reviews.delete(old);
    }
    return run;
  }

  /**
   * The user pressed "Start research". The command line is pasted into the Office terminal's input box when that
   * is safe; otherwise it is only returned, for the page to show. Enter is never pressed here.
   */
  start(themeIn: unknown, countIn: unknown, researchersIn: unknown = 2): { run: ResearchRun } | { error: ResearchReason } {
    const theme = cleanTheme(themeIn);
    if (!theme) return { error: 'bad-theme' };
    const count = Number(countIn);
    if (!Number.isInteger(count) || count < 1 || count > RESEARCH_MAX_COUNT) return { error: 'bad-count' };
    const researchers = Number(researchersIn);
    if (!RESEARCHER_COUNTS.includes(researchers)) return { error: 'bad-researchers' };
    // A command that was pasted and not sent is still in the input box: a second paste would land next to it.
    if ([...this.runs.values()].some((r) => r.status === 'awaiting-enter' && r.pasted)) return { error: 'pending' };
    const st = this.term();
    const root = researchRoot(st.cwd);
    const now = this.o.now();
    const id = newResearchId(now, (x) => this.runs.has(x) || fs.existsSync(path.join(root, x)));
    const command = researchCommand({ id, theme, count, researchers });
    const sess = st.sessionId ? this.sessions.get(st.sessionId) : undefined;
    let notPasted: NotPasted | undefined;
    if (!this.o.terminal || !st.available || !st.running) notPasted = 'no-terminal';
    else if (!sess?.started) notPasted = 'not-started';
    // Only hooks close a request. One the user merely hid still holds the paste back: its prompt may be open.
    else if (sess.pending.size > 0) notPasted = [...sess.pending.values()].some((t) => !t.hidden) ? 'waiting-permission' : 'wait-unknown';
    // The one and only text Office writes for this research. No Enter.
    else if (!this.o.terminal.paste(command)) notPasted = 'no-terminal';
    for (const r of this.runs.values()) if (r.status === 'awaiting-enter') r.status = 'dismissed'; // only never-pasted ones are left
    const run = this.add({ id, theme, requestedCount: count, requestedResearchers: researchers, engine: 'claude-code', dir: path.join(root, id), status: 'awaiting-enter', origin: 'button', command, pasted: !notPasted, notPasted, createdAt: now, sessionId: notPasted ? undefined : st.sessionId, cards: [], errors: [], researchers: [], waiting: [] });
    // The research shown until now moves to the list of earlier ones: read them from disk again.
    this.past = undefined;
    return { run };
  }

  /**
   * Drop a research that has not started. Office takes nothing back out of the terminal: a pasted command stays
   * in the input box until the user clears it.
   */
  dismiss(): void {
    const run = this.currentId ? this.runs.get(this.currentId) : undefined;
    if (run?.status !== 'awaiting-enter') return;
    run.status = 'dismissed';
    run.endedAt = this.o.now();
  }

  private view(run: ResearchRun): ResearchRun {
    const reviews = [...(this.reviews.get(run.id)?.values() ?? [])];
    const cards = run.cards.map((c) => {
      const rv = reviews.find((r) => r.resultId === c.id) ?? reviews.find((r) => `${r.resultId}.json` === c.file);
      return rv ? { ...c, review: { verdict: rv.verdict, note: rv.note } } : { ...c };
    });
    const researchers = run.researchers.map((r) => ({ ...r, cards: cards.filter((c) => c.agentId === r.agentId).length }));
    const s = run.sessionId ? this.sessions.get(run.sessionId) : undefined;
    const mine = new Set(run.researchers.map((r) => r.agentId));
    const active = run.status === 'researching' || run.status === 'unconfirmed';
    const waiting = s && active ? [...s.pending.values()].filter((t) => !t.agentId || mine.has(t.agentId)) : [];
    return { ...run, cards, errors: [...run.errors], researchers, waiting: waiting.filter((t) => !t.hidden).map(waitOf), unresolved: waiting.length };
  }

  /** Where earlier researches are read back from: the Office working folder and the terminal's current folder. */
  private pastRoots(): string[] {
    const out: string[] = [];
    for (const cwd of [this.o.cwd, this.term().cwd]) {
      if (!isLocalAbsolute(cwd)) continue;
      const root = researchRoot(cwd);
      if (!out.some((x) => samePath(x, root))) out.push(root);
    }
    return out;
  }

  private loadPast(root: string): ResearchRun[] {
    return listRunIds(root).map((id): ResearchRun => {
      const dir = path.join(root, id);
      const req = loadRequest(dir);
      const got = scanRun(root, id, 'claude-code');
      const m = /^r-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-/.exec(id)!;
      const named = new Date(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!).getTime();
      const cards = got.cards.map((c) => {
        const rv = got.reviews.find((r) => r.resultId === c.id) ?? got.reviews.find((r) => `${r.resultId}.json` === c.file);
        return rv ? { ...c, review: { verdict: rv.verdict, note: rv.note } } : c;
      });
      // On disk the only evidence of an end is summary.json.
      return { id, theme: req.theme ?? '', requestedCount: req.requestedCount ?? cards.length, requestedResearchers: req.researchers, engine: 'claude-code', dir, status: got.summary ? 'completed' : 'unconfirmed', origin: 'observed', createdAt: req.at ?? named, startedAt: req.at ?? named, endedAt: got.summary?.at, cards, errors: got.errors, researchers: [], summary: got.summary, waiting: [], restored: true };
    });
  }

  info(refresh = false): ResearchInfo {
    const st = this.term();
    // Earlier researches are read from disk once per folder (and again on request, or when their files change).
    const roots = this.pastRoots();
    if (!this.past || this.pastKey !== roots.join('|') || refresh) {
      const seen = new Set<string>();
      this.past = roots.flatMap((r) => this.loadPast(r)).filter((p) => !seen.has(p.id) && !!seen.add(p.id)).sort((a, b) => (a.id < b.id ? 1 : -1)).slice(0, MAX_PAST_RUNS);
      this.pastKey = roots.join('|');
    }
    // Researches followed live in other folders are listed while this Office runs (they are not read back later).
    const elsewhere = [...this.runs.values()].filter((r) => r.startedAt !== undefined && r.status !== 'dismissed' && !this.past!.some((p) => p.id === r.id));
    const cur = this.currentId ? this.runs.get(this.currentId) : undefined;
    const sess = st.sessionId ? this.sessions.get(st.sessionId) : undefined;
    return {
      cwd: st.cwd,
      root: researchRoot(st.cwd),
      inGit: insideGit(st.cwd),
      counts: RESEARCH_COUNTS,
      defaultCount: 5,
      researcherCounts: RESEARCHER_COUNTS,
      defaultResearchers: 2,
      command: RESEARCH_COMMAND,
      researcherType: RESEARCHER_AGENT_TYPE,
      terminal: { available: st.available, running: st.running, sessionId: st.sessionId, started: st.running && sess?.started === true, waiting: (sess?.pending.size ?? 0) > 0, waits: [...(sess?.pending.values() ?? [])].filter((t) => !t.hidden).map(waitOf), unresolved: sess?.pending.size ?? 0, permissionMode: sess?.mode },
      current: cur && cur.status !== 'dismissed' ? this.view(cur) : undefined,
      // A research followed live keeps what only the hooks know (who wrote which card, who is still at work).
      past: [...elsewhere, ...this.past]
        .filter((p) => p.id !== cur?.id)
        .sort((a, b) => (a.id < b.id ? 1 : -1))
        .map((p) => {
          const live = this.runs.get(p.id);
          return live ? this.view(live) : p;
        }),
    };
  }
}
