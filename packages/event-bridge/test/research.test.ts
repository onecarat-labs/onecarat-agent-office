import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import type { OfficeEvent } from '@onecarat/domain';
import {
  EventStore, RESEARCHER_AGENT_TYPE, ResearchController, Terminal, cleanTheme, createBridge, loadResult, loadReview, oneLine, researchCommand, researchFileIn, researchFileKind,
  revealTarget, scanRun, validateResult, type PtyModule, type PtyProcess, type ResearchRun, type ResearchTerminal,
} from '../src/index.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let n = 0;
const ev = (sessionId: string, body: Record<string, unknown>): OfficeEvent => ({ id: `${++n}.0`, at: Date.now(), sessionId, source: 'live', ...body }) as OfficeEvent;
const ID_RE = /^r-\d{8}-\d{6}-[0-9a-f]{4}$/;

/** A terminal that records what Office wrote to it; its session is driven by the test through hook-like events. */
function fakeTerminal(cwd: string) {
  const wrote: string[] = [];
  const s = { available: true, running: true, cwd, sessionId: 'S1' as string | undefined };
  const terminal: ResearchTerminal = { state: () => ({ ...s }), paste: (t) => { wrote.push(t); return true; } };
  return { terminal, wrote, s };
}

function setup(opts: { started?: boolean } = {}) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'office-research-'));
  const store = new EventStore();
  const f = fakeTerminal(cwd);
  const c = new ResearchController({ terminal: f.terminal, store, cwd });
  const done = () => { c.dispose(); fs.rmSync(cwd, { recursive: true, force: true }); };
  /** Every real hook carries the session's working folder. */
  const hook = (sid: string, body: Record<string, unknown>) => store.append([ev(sid, { cwd, ...body })]);
  /** What Claude Code would do: write a file, then its Write hook arrives (with the writer's agent id). */
  const write = (run: { dir: string }, name: string, value: unknown, by?: string, sid = 'S1') => {
    fs.mkdirSync(run.dir, { recursive: true });
    const file = path.join(run.dir, name);
    fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
    hook(sid, { type: 'file.created', name, path: file, agentId: by });
  };
  if (opts.started !== false) hook('S1', { type: 'session.started' });
  const cur = () => c.info().current!;
  /** Press the button, then the user presses Enter (the command's own hook arrives). */
  const begin = (theme = 'small LLMs', count = 3, people = 2): ResearchRun => {
    const r = c.start(theme, count, people);
    assert.ok('run' in r);
    hook('S1', { type: 'user.prompt', text: r.run.command });
    return r.run;
  };
  const researcher = (id: string, sid = 'S1') => hook(sid, { type: 'subagent.started', childId: id, agentType: RESEARCHER_AGENT_TYPE });
  return { cwd, store, c, done, hook, write, cur, begin, researcher, ...f };
}

// ---------- what Office writes: one command line, never Enter ----------

test('start: one command line is pasted, once; Enter is never sent; the research begins only with the command\'s hook', () => {
  const t = setup();
  try {
    const r = t.c.start('  small "LLMs"; $HOME & 100% <b>\r\n\u001b[201~rm -rf  ', 5, 2);
    assert.ok('run' in r);
    const run = r.run;
    assert.match(run.id, ID_RE);
    assert.equal(run.dir, path.join(t.cwd, 'research', run.id));
    assert.deepEqual(t.wrote, [`/onecarat-agent-office:research 5 2 ${run.id} small "LLMs"; $HOME & 100% <b> [201~rm -rf`]);
    assert.ok(!/[\u0000-\u001f\u007f-\u009f]/.test(t.wrote[0]!), 'one line, no control character: nothing in it can act as a key');
    assert.deepEqual([run.status, run.pasted, run.origin, run.requestedCount, run.requestedResearchers], ['awaiting-enter', true, 'button', 5, 2]);
    assert.equal(run.startedAt, undefined, 'nothing has started: the user has not pressed Enter');
    // Nothing happens by itself, however long the user waits.
    t.hook('S1', { type: 'turn.stopped', backgroundTasks: [] });
    assert.deepEqual([t.cur().status, t.wrote.length], ['awaiting-enter', 1]);
    // A second press while that line is still in the input box is refused (it would be pasted next to it).
    assert.deepEqual(t.c.start('other', 3, 1), { error: 'pending' });
    assert.equal(t.wrote.length, 1);
    // The user presses Enter: the command arrives as a hook.
    t.hook('S1', { type: 'user.prompt', text: t.wrote[0] });
    assert.deepEqual([t.cur().status, t.cur().sessionId], ['researching', 'S1']);
    assert.equal(t.wrote.length, 1, 'Office wrote nothing else');
  } finally {
    t.done();
  }
});

test('start: bad input is refused; nothing is pasted while the session has not started or waits for a permission answer', () => {
  const t = setup({ started: false });
  try {
    assert.deepEqual(t.c.start('', 3, 2), { error: 'bad-theme' });
    assert.deepEqual(t.c.start('\u0001\r\n', 3, 2), { error: 'bad-theme' });
    assert.deepEqual(t.c.start('x', 0, 2), { error: 'bad-count' });
    assert.deepEqual(t.c.start('x', 21, 2), { error: 'bad-count' });
    assert.deepEqual(t.c.start('x', 3, 4), { error: 'bad-researchers' });
    assert.deepEqual(t.c.start('x', 3, 0), { error: 'bad-researchers' });
    assert.deepEqual(t.wrote, []);
    // No hook from that terminal's session yet: Claude Code may still be showing a start-up question.
    let r = t.c.start('x', 3, 2);
    assert.ok('run' in r);
    assert.deepEqual([r.run.pasted, r.run.notPasted, r.run.status], [false, 'not-started', 'awaiting-enter']);
    assert.ok(r.run.command!.includes(r.run.id), 'the command is still given, for the user to copy');
    assert.deepEqual(t.wrote, []);
    // Started, but someone is waiting for the user's answer: a paste could act as key presses in that prompt.
    t.hook('S1', { type: 'session.started' });
    t.hook('S1', { type: 'tool.started', toolUseId: 'w1', toolName: 'Write', activity: 'editing', detail: 'a.md' });
    t.hook('S1', { type: 'permission.requested', toolName: 'Write', detail: 'a.md' });
    assert.equal(t.c.info().terminal.waiting, true);
    r = t.c.start('x', 3, 2);
    assert.ok('run' in r);
    assert.deepEqual([r.run.pasted, r.run.notPasted], [false, 'waiting-permission']);
    assert.deepEqual(t.wrote, []);
    // Answered: now it is pasted (a new press; a never-pasted one does not block it).
    t.hook('S1', { type: 'tool.finished', toolUseId: 'w1', toolName: 'Write' });
    r = t.c.start('x', 3, 2);
    assert.ok('run' in r && r.run.pasted);
    assert.equal(t.wrote.length, 1);
    // The terminal is not running: only shown.
    t.c.dismiss();
    t.s.running = false;
    r = t.c.start('x', 3, 2);
    assert.ok('run' in r);
    assert.deepEqual([r.run.pasted, r.run.notPasted], [false, 'no-terminal']);
    assert.equal(t.wrote.length, 1);
  } finally {
    t.done();
  }
});

test('a pasted command that was not sent: dismissing writes nothing; another prompt from that box drops it', () => {
  const t = setup();
  try {
    let r = t.c.start('theme', 3, 2);
    assert.ok('run' in r);
    t.c.dismiss();
    assert.equal(t.c.info().current, undefined);
    assert.equal(t.wrote.length, 1, 'Office takes nothing back out of the terminal and sends no key');
    r = t.c.start('theme two', 3, 2);
    assert.ok('run' in r);
    // The user cleared the box and sent something else: that research never started. No second paste.
    t.hook('S1', { type: 'user.prompt', text: 'something else' });
    assert.equal(t.c.info().current, undefined);
    assert.equal(t.wrote.length, 2);
    assert.equal(fs.existsSync(path.join(t.cwd, 'research')), false, 'Office created no folder and no file');
  } finally {
    t.done();
  }
});

// ---------- the research itself: hooks and files ----------

test('researchers, cards with their writer, reviews, and the two ways a researcher is known to have finished', () => {
  const t = setup();
  try {
    const run = t.begin('small LLMs', 3, 2);
    t.write(run, 'request.json', { researchId: run.id, theme: 'from the file', requestedCount: 9, researchers: 3 });
    assert.deepEqual([t.cur().theme, t.cur().requestedCount, t.cur().requestedResearchers], ['small LLMs', 3, 2], 'a research started from the page keeps what the user entered');
    assert.equal(typeof t.cur().startedAt, 'number');
    // Only the shipped researcher definition counts as a researcher.
    t.hook('S1', { type: 'subagent.started', childId: 'x1', agentType: 'general-purpose' });
    t.hook('S1', { type: 'subagent.started', childId: 'x2', agentType: 'web-fetch' });
    t.researcher('a1');
    t.researcher('a2');
    t.researcher('zz', 'OTHER'); // another session's researcher is not this research's
    assert.deepEqual(t.cur().researchers.map((r) => [r.agentId, r.n, r.status]), [['a1', 1, 'working'], ['a2', 2, 'working']]);
    t.hook('S1', { type: 'turn.stopped', backgroundTasks: [{ id: 'a1', status: 'running', agentType: RESEARCHER_AGENT_TYPE }, { id: 'a2', status: 'running', agentType: RESEARCHER_AGENT_TYPE }] });
    assert.equal(t.cur().status, 'researching', 'the manager is free; the researchers work on');

    t.write(run, 'r1-001.json', { researchId: run.id, id: 'r1-001', title: 'First', sources: [{ title: 'p', url: 'https://example.com/a' }] }, 'a1');
    t.write(run, 'r2-001.json', { researchId: run.id, id: 'r2-001', title: 'Other', agentId: 'a1', review: { verdict: 'confirmed' } }, 'a2');
    t.write(run, 'r1-002.json', '{ broken', 'a1');
    t.write(run, 'r1-003.json', { researchId: 'r-00000000-000000-0000', title: 'Other research' }, 'a1');
    assert.deepEqual(t.cur().cards.map((c) => [c.file, c.title, c.agentId, c.review]), [['r1-001.json', 'First', 'a1', undefined], ['r2-001.json', 'Other', 'a2', undefined]], 'the writer comes from the hook, never from the file');
    assert.deepEqual(t.cur().errors, [{ file: 'r1-002.json', reason: 'invalid-json' }, { file: 'r1-003.json', reason: 'wrong-research-id' }]);
    assert.deepEqual(t.cur().researchers.map((r) => r.cards), [1, 1]);

    // (1) A stop alone is not an end.
    t.hook('S1', { type: 'subagent.stopped', childId: 'a1', agentType: RESEARCHER_AGENT_TYPE });
    assert.equal(t.cur().researchers[0]!.status, 'working');
    // (2) A report (agent-message) is "reported"; it becomes "completed" when the manager's turn ends without it running.
    t.hook('S1', { type: 'injected.prompt', kind: 'agent-message', fromAgentId: 'a1', preview: '' });
    assert.equal(t.cur().researchers[0]!.status, 'reported');
    t.write(run, 'review-r1-001.json', { researchId: run.id, resultId: 'r1-001', verdict: 'confirmed', note: 'ok' });
    t.write(run, 'review-r2-001.json', { researchId: run.id, resultId: 'r2-001', verdict: 'maybe', note: 'x' });
    assert.deepEqual(t.cur().cards.map((c) => c.review), [{ verdict: 'confirmed', note: 'ok' }, undefined]);
    assert.deepEqual(t.cur().errors.at(-1), { file: 'review-r2-001.json', reason: 'bad-verdict' });
    t.hook('S1', { type: 'turn.stopped' }); // an old forwarder: no task list, so no conclusion is drawn
    assert.deepEqual(t.cur().researchers.map((r) => r.status), ['reported', 'working']);
    t.hook('S1', { type: 'turn.stopped', backgroundTasks: [{ id: 'a1', status: 'running' }, { id: 'a2', status: 'running' }] });
    assert.equal(t.cur().researchers[0]!.status, 'reported', 'still listed as running');
    t.hook('S1', { type: 'turn.stopped', backgroundTasks: [{ id: 'a2', status: 'running', agentType: RESEARCHER_AGENT_TYPE }] });
    assert.deepEqual([t.cur().researchers.map((r) => r.status), t.cur().status], [['completed', 'working'], 'researching']);
    // (3) Claude Code's completion notice.
    t.hook('S1', { type: 'injected.prompt', kind: 'task-notification', fromAgentId: 'a2', taskStatus: 'completed', preview: '' });
    assert.deepEqual(t.cur().researchers.map((r) => r.status), ['completed', 'completed']);
    // A finished researcher that works again (the user resumed it) is working again.
    t.hook('S1', { type: 'tool.finished', toolUseId: 'late', toolName: 'WebFetch', agentId: 'a2' });
    assert.equal(t.cur().researchers[1]!.status, 'completed', 'a late end-of-tool hook is not new work');
    t.hook('S1', { type: 'tool.started', toolUseId: 'n1', toolName: 'WebFetch', activity: 'researching', detail: 'example.com', agentId: 'a2' });
    assert.equal(t.cur().researchers[1]!.status, 'working');
    t.hook('S1', { type: 'injected.prompt', kind: 'task-notification', fromAgentId: 'a2', taskStatus: 'failed', preview: '' });
    assert.equal(t.cur().researchers[1]!.status, 'failed');

    // The research is completed by summary.json, and only by it.
    t.write(run, 'review-r2-001.json', { researchId: run.id, resultId: 'r2-001', verdict: 'needs-check', note: 'one source' });
    assert.equal(t.cur().status, 'researching');
    t.write(run, 'summary.json', { researchId: run.id, saved: 2, missing: 1, reason: 'one angle had no source' });
    const end = t.cur();
    assert.deepEqual([end.status, end.summary?.saved, end.summary?.missing, end.cards.length, end.requestedCount], ['completed', 2, 1, 2, 3], 'a shortfall stays a shortfall');
    assert.equal(end.endedAt, end.summary!.at);
    assert.deepEqual(end.cards[1]!.review, { verdict: 'needs-check', note: 'one source' });
    assert.deepEqual(end.errors.map((e) => e.file), ['r1-002.json', 'r1-003.json']);
    assert.equal(t.wrote.length, 1, 'one paste for the whole research: Office sent nothing to steer it');
  } finally {
    t.done();
  }
});

test('no summary.json: the research is never shown as completed; new evidence of work brings it back', () => {
  const t = setup();
  try {
    const run = t.begin('theme', 3, 1);
    t.write(run, 'request.json', { researchId: run.id, theme: 'theme', requestedCount: 3, researchers: 1 });
    t.researcher('a1');
    t.write(run, 'r1-001.json', { title: 'One' }, 'a1');
    t.hook('S1', { type: 'injected.prompt', kind: 'task-notification', fromAgentId: 'a1', taskStatus: 'completed', preview: '' });
    assert.equal(t.cur().status, 'researching');
    t.hook('S1', { type: 'turn.stopped', backgroundTasks: [] });
    assert.deepEqual([t.cur().status, t.cur().cards.length], ['unconfirmed', 1]);
    // The user asks the manager to go on: a new researcher starts.
    t.researcher('a3');
    assert.deepEqual([t.cur().status, t.cur().endedAt, t.cur().researchers.map((r) => r.n)], ['researching', undefined, [1, 2]]);
    t.hook('S1', { type: 'turn.stopped', backgroundTasks: [{ id: 'a3', status: 'running', agentType: RESEARCHER_AGENT_TYPE }] });
    assert.equal(t.cur().status, 'researching');
    // summary.json written without the Write tool (no hook): found when the manager's turn ends.
    fs.writeFileSync(path.join(run.dir, 'summary.json'), JSON.stringify({ researchId: run.id, saved: 1, missing: 2, reason: '' }));
    t.hook('S1', { type: 'injected.prompt', kind: 'task-notification', fromAgentId: 'a3', taskStatus: 'completed', preview: '' });
    t.hook('S1', { type: 'turn.stopped', backgroundTasks: [] });
    assert.equal(t.cur().status, 'completed');
    // The session ends in the middle of another research: not confirmed, not completed.
    const two = t.begin('second', 3, 1);
    t.write(two, 'request.json', { researchId: two.id, theme: 'second', requestedCount: 3 });
    t.researcher('b1');
    t.hook('S1', { type: 'session.ended' });
    assert.equal(t.cur().status, 'unconfirmed');
  } finally {
    t.done();
  }
});

test('a research the user typed themselves, in any session, is shown the same way; only <cwd of that session>/research/<id>/<file> is read', () => {
  const t = setup();
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'office-other-'));
  try {
    const id = 'r-20261114-002500-f854';
    const dir = path.join(t.cwd, 'research', id);
    const req = { researchId: id, theme: 'typed by hand', requestedCount: 3, researchers: 2 };
    const put = (file: string, hookBody: Record<string, unknown>, sid = 'EXT') => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(req));
      t.store.append([ev(sid, { type: 'file.created', name: 'request.json', path: file, ...hookBody })]);
    };
    // The path must be exactly <the writing session's cwd>/research/<valid id>/<file>. None of these is read:
    put(path.join(dir, 'request.json'), {}); // the hook names no working folder
    put(path.join(dir, 'request.json'), { cwd: other }); // written outside that session's own folder
    put(path.join(dir, 'request.json'), { cwd: path.join(t.cwd, 'research') }); // cwd/research/<id> does not match
    put(path.join(dir, 'request.json'), { cwd: '\\\\host\\share\\w' }); // a UNC working folder is never touched
    put(path.join(dir, 'request.json'), { cwd: 'relative\\folder' });
    put(path.join(t.cwd, 'research', 'not-an-id', 'request.json'), { cwd: t.cwd });
    put(path.join(dir, 'sub', 'request.json'), { cwd: t.cwd });
    put(path.join(t.cwd, 'elsewhere', id, 'request.json'), { cwd: t.cwd });
    assert.equal(t.c.info().current, undefined);
    // A result of a research Office does not follow opens nothing.
    t.write({ dir }, 'r1-001.json', { title: 'Early' }, 'e1', 'EXT');
    assert.equal(t.c.info().current, undefined);
    // request.json does: from a session outside the Office terminal, without any button.
    t.write({ dir }, 'request.json', req, undefined, 'EXT');
    const cur = t.cur();
    assert.deepEqual([cur.id, cur.origin, cur.status, cur.theme, cur.requestedCount, cur.requestedResearchers, cur.sessionId, cur.command], [id, 'observed', 'researching', 'typed by hand', 3, 2, 'EXT', undefined]);
    t.researcher('e1', 'EXT');
    t.researcher('s1'); // the Office terminal's own session has nothing to do with it
    t.write({ dir }, 'r1-002.json', { title: 'Two' }, 'e1', 'EXT');
    assert.deepEqual([t.cur().researchers.map((r) => r.agentId), t.cur().cards.map((c) => c.file)], [['e1'], ['r1-002.json']]);
    t.hook('EXT', { type: 'injected.prompt', kind: 'task-notification', fromAgentId: 'e1', taskStatus: 'completed', preview: '' });
    t.write({ dir }, 'summary.json', { researchId: id, saved: 2, missing: 1, reason: '' }, undefined, 'EXT');
    t.hook('EXT', { type: 'turn.stopped', backgroundTasks: [] });
    assert.deepEqual([t.cur().status, t.cur().cards.map((c) => c.file)], ['completed', ['r1-001.json', 'r1-002.json']], 'completed; the folder is read again when the manager stops, so the early card is there too');
    assert.deepEqual(t.wrote, [], 'Office wrote nothing at all');

    // A session working in ANOTHER folder: its research is read from its own folder (the cwd its hooks report).
    const far = 'r-20261114-003626-2de3';
    const farDir = path.join(other, 'research', far);
    fs.mkdirSync(farDir, { recursive: true });
    const farWrite = (name: string, v: unknown, by?: string) => {
      fs.writeFileSync(path.join(farDir, name), JSON.stringify(v));
      t.store.append([ev('FAR', { type: 'file.created', name, path: path.join(farDir, name), agentId: by, cwd: other })]);
    };
    farWrite('request.json', { researchId: far, theme: 'in another folder', requestedCount: 1, researchers: 1 });
    t.store.append([ev('FAR', { type: 'subagent.started', childId: 'f1', agentType: RESEARCHER_AGENT_TYPE, cwd: other })]);
    farWrite('r1-001.json', { researchId: far, title: 'Far' }, 'f1');
    // The same id from a third place does not get mixed into it.
    put(path.join(t.cwd, 'research', far, 'r1-009.json'), { cwd: t.cwd });
    assert.deepEqual([t.cur().id, t.cur().dir, t.cur().theme, t.cur().cards.map((c) => [c.title, c.agentId])], [far, farDir, 'in another folder', [['Far', 'f1']]]);
    // A later research takes the board; the others are listed, with what the hooks told.
    const next = t.begin('next');
    let info = t.c.info(true);
    assert.equal(info.current!.id, next.id);
    assert.deepEqual(info.past.map((p) => [p.id, p.status, p.researchers.length]), [[far, 'researching', 1], [id, 'completed', 1]]);
    // After a restart: only the Office working folder and the terminal's current folder are read back.
    fs.rmSync(path.join(t.cwd, 'research', far), { recursive: true, force: true }); // the stray file of the test above
    t.c.dispose();
    const again = new ResearchController({ terminal: t.terminal, store: new EventStore(), cwd: t.cwd });
    assert.deepEqual(again.info().past.map((p) => p.id), [id], 'the other folder\'s research is not restored');
    t.s.cwd = other; // the user chose that folder in the built-in terminal
    info = again.info();
    assert.deepEqual([info.past.map((p) => p.id).sort(), info.root], [[far, id].sort(), path.join(other, 'research')], 'now both folders are read');
    again.dispose();
  } finally {
    fs.rmSync(other, { recursive: true, force: true });
    t.done();
  }
});
test('who is waiting for a permission answer: the manager or a researcher, until that tool call ends', () => {
  const t = setup();
  try {
    const run = t.begin('theme', 3, 2);
    t.hook('S1', { type: 'tool.started', toolUseId: 'm1', toolName: 'Write', activity: 'editing', detail: 'request.json', permissionMode: 'default' });
    t.hook('S1', { type: 'permission.requested', toolName: 'Write', detail: 'request.json' });
    assert.deepEqual(t.cur().waiting.map(({ at, ...w }) => [w, typeof at]), [[{ agentId: undefined, toolName: 'Write', detail: 'request.json' }, 'number']], 'with the time the request arrived');
    assert.deepEqual([t.c.info().terminal.permissionMode, t.c.info().terminal.waiting], ['default', true]);
    t.write(run, 'request.json', { researchId: run.id });
    t.hook('S1', { type: 'tool.finished', toolUseId: 'm1', toolName: 'Write' });
    assert.deepEqual(t.cur().waiting, []);
    t.researcher('a1');
    t.researcher('a2');
    // Three searches asked at once by one researcher, one page by the other, and an unrelated agent's request.
    for (const [id, q] of [['s1', 'q1'], ['s2', 'q2'], ['s3', 'q3']] as const) t.hook('S1', { type: 'tool.started', toolUseId: id, toolName: 'WebSearch', activity: 'researching', detail: q, agentId: 'a1', permissionMode: 'acceptEdits' });
    for (const q of ['q1', 'q2', 'q3']) t.hook('S1', { type: 'permission.requested', toolName: 'WebSearch', detail: q, agentId: 'a1' });
    t.hook('S1', { type: 'tool.started', toolUseId: 'f1', toolName: 'WebFetch', activity: 'researching', detail: 'example.com', agentId: 'a2' });
    t.hook('S1', { type: 'permission.requested', toolName: 'WebFetch', detail: 'example.com', agentId: 'a2' });
    t.hook('S1', { type: 'permission.requested', toolName: 'Bash', detail: 'ls', agentId: 'stranger' });
    assert.deepEqual(t.cur().waiting.map((w) => [w.agentId, w.toolName, w.detail]), [['a1', 'WebSearch', 'q1'], ['a1', 'WebSearch', 'q2'], ['a1', 'WebSearch', 'q3'], ['a2', 'WebFetch', 'example.com']]);
    assert.equal(t.c.info().terminal.permissionMode, 'default', 'the mode shown is the manager\'s, not a subagent\'s');
    t.hook('S1', { type: 'tool.finished', toolUseId: 's2', toolName: 'WebSearch', agentId: 'a1' });
    t.hook('S1', { type: 'tool.failed', toolUseId: 'f1', toolName: 'WebFetch', agentId: 'a2', error: 'denied', interrupted: false });
    assert.deepEqual(t.cur().waiting.map((w) => w.detail), ['q1', 'q3']);
    // The manager's turn ending says nothing about a researcher's open question.
    t.hook('S1', { type: 'turn.stopped', backgroundTasks: [{ id: 'a1', status: 'running' }, { id: 'a2', status: 'running' }] });
    assert.deepEqual(t.cur().waiting.map((w) => w.detail), ['q1', 'q3']);
    // A refused request sends no hook of its own. It is over when that agent goes on with another call some
    // time later (requests asked together arrive within a second, so a call right after is not taken as an answer)...
    const later = (ms: number, sid: string, body: Record<string, unknown>) => t.store.append([{ ...ev(sid, { cwd: t.cwd, ...body }), at: Date.now() + ms } as OfficeEvent]);
    later(500, 'S1', { type: 'tool.started', toolUseId: 's4', toolName: 'WebSearch', activity: 'researching', detail: 'q4', agentId: 'a1' });
    assert.deepEqual(t.cur().waiting.map((w) => w.detail), ['q1', 'q3'], 'asked in the same burst: still waiting');
    later(60_000, 'S1', { type: 'tool.started', toolUseId: 's5', toolName: 'WebFetch', activity: 'researching', detail: 'example.org', agentId: 'a1' });
    assert.deepEqual(t.cur().waiting, [], 'the researcher went on: the refused requests are behind it');
    // ...and, for the manager, when the user sends the next message (a refusal with Esc ends the turn without a hook).
    t.hook('S1', { type: 'tool.started', toolUseId: 'm2', toolName: 'Write', activity: 'editing', detail: 'summary.json' });
    t.hook('S1', { type: 'permission.requested', toolName: 'Write', detail: 'summary.json' });
    t.hook('S1', { type: 'tool.started', toolUseId: 's6', toolName: 'WebSearch', activity: 'researching', detail: 'q6', agentId: 'a1' });
    t.hook('S1', { type: 'permission.requested', toolName: 'WebSearch', detail: 'q6', agentId: 'a1' });
    assert.deepEqual(t.cur().waiting.map((w) => [w.agentId, w.detail]), [[undefined, 'summary.json'], ['a1', 'q6']]);
    t.hook('S1', { type: 'user.prompt', text: 'never mind' });
    assert.deepEqual(t.cur().waiting.map((w) => [w.agentId, w.detail]), [['a1', 'q6']], 'the manager\'s is gone; the researcher\'s own question is still open');
    assert.equal(t.c.info().terminal.waiting, true);    // The researcher is known to have ended: nothing of it can still be waiting.
    t.hook('S1', { type: 'injected.prompt', kind: 'task-notification', fromAgentId: 'a1', taskStatus: 'completed', preview: '' });
    assert.deepEqual(t.cur().waiting, []);
  } finally {
    t.done();
  }
});

test('files written all at once, out of order, or without any hook: no card is lost and the board stays in file order', () => {
  const t = setup();
  try {
    const run = t.begin('theme', 12, 1);
    t.write(run, 'request.json', { researchId: run.id });
    t.researcher('a1');
    const names = Array.from({ length: 12 }, (_, i) => `r1-${String(i + 1).padStart(3, '0')}.json`);
    for (const name of names) fs.writeFileSync(path.join(run.dir, name), JSON.stringify({ researchId: run.id, title: name }));
    const hooks = [...names].reverse().map((name) => ev('S1', { type: 'file.created', name, path: path.join(run.dir, name), agentId: 'a1', cwd: t.cwd }));
    t.store.append([...hooks.slice(5), ...hooks.slice(0, 5), hooks[3]!]); // shuffled, one of them twice
    assert.deepEqual(t.cur().cards.map((c) => c.file), names, 'all twelve, each once, in file order');
    // Written without the Write tool: found when the manager's turn ends; the known writers are kept.
    for (const name of ['r2-10.json', 'r2-2.json']) fs.writeFileSync(path.join(run.dir, name), JSON.stringify({ title: name }));
    t.hook('S1', { type: 'turn.stopped', backgroundTasks: [{ id: 'a1', status: 'running' }] });
    assert.deepEqual(t.cur().cards.map((c) => [c.file, c.agentId]).slice(-3), [['r1-012.json', 'a1'], ['r2-2.json', undefined], ['r2-10.json', undefined]]);
    assert.equal(t.cur().researchers[0]!.cards, 12);
  } finally {
    t.done();
  }
});

// ---------- the terminal and the command line ----------

test('the terminal gets the pasted line and nothing else: no Enter, no control character', () => {
  assert.equal(cleanTheme('a\r\nb\u001b[201~c\u0003\u2028d'), 'a b [201~c d');
  assert.equal(cleanTheme(5), '');
  assert.equal(cleanTheme('x'.repeat(900)).length, 500);
  assert.equal(oneLine(' a \t b\u0085\u009b '), 'a b');
  const cmd = researchCommand({ id: 'r-20261114-000000-0000', theme: cleanTheme('x "y"\nz'), count: 5, researchers: 2 });
  assert.equal(cmd, '/onecarat-agent-office:research 5 2 r-20261114-000000-0000 x "y" z');

  const written: string[] = [];
  const pty: PtyModule = { spawn: () => ({ pid: 1, onData: () => {}, onExit: () => {}, write: (d) => void written.push(d), resize: () => {}, kill: () => {} }) as PtyProcess };
  const term = new Terminal({ load: { ok: true, pty, from: 'fake' }, cwd: os.tmpdir(), command: () => ({ file: 'claude', args: [] }) });
  assert.equal(term.pasteLine('x'), false, 'not running: nothing is written');
  assert.equal(term.start(), undefined);
  assert.equal(term.pasteLine('\r\n\u0003'), false, 'nothing left after cleaning: nothing is written');
  assert.equal(term.pasteLine('hello\u001b[201~\rrm -rf\n'), true);
  assert.deepEqual(written, ['\u001b[200~hello [201~ rm -rf\u001b[201~'], 'the paste alone: the end marker inside the text is defused and no Enter follows');
  assert.ok(!('pressEnter' in term) && !('pastePrompt' in term), 'the terminal has no way to press Enter for Office');
  term.stop();
});

// ---------- the API ----------

test('API: token and same-site only; there is no second terminal; start pastes into the Office terminal without Enter', async () => {
  const P = 47961; // not shared with any other test file (they run in parallel)
  const TOKEN = 'c'.repeat(48);
  const spawned: string[] = [];
  const written: string[] = [];
  const pty: PtyModule = { spawn: (_f, _a, o) => { spawned.push(o.cwd); return { pid: 1, onData: () => {}, onExit: () => {}, write: (d) => void written.push(d), resize: () => {}, kill: () => {} } as PtyProcess; } };
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'office-research-api-'));
  const terminal = new Terminal({ load: { ok: true, pty, from: 'fake' }, cwd, command: () => ({ file: 'claude', args: [] }) });
  const b = createBridge({ port: P, token: TOKEN, version: 'test', terminal });
  await new Promise<void>((r) => b.server.listen(P, '127.0.0.1', () => r()));
  const call = (method: string, p: string, headers: Record<string, string> = {}, body?: string) =>
    new Promise<{ status: number; body: string }>((resolve, reject) => {
      const r = http.request({ host: '127.0.0.1', port: P, method, path: p, headers }, (res) => {
        const c: Buffer[] = [];
        res.on('data', (d) => c.push(d));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(c).toString() }));
      });
      r.on('error', reject);
      r.end(body);
    });
  const open = (p: string) =>
    new Promise<WebSocket | string>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${P}${p}`, ['office.v1', `office-token.${TOKEN}`], { origin: `http://127.0.0.1:${P}` });
      ws.on('open', () => resolve(ws));
      ws.on('unexpected-response', (_q, res) => resolve(`refused:${res.statusCode}`));
      ws.on('error', () => resolve('refused:error'));
    });
  const auth = { 'x-office-token': TOKEN, 'content-type': 'application/json' };
  const startBody = '{"theme":"real theme","count":3,"researchers":2}';
  try {
    // Cross-site requests are refused on every Research Lab endpoint, even with the token; so is a missing token.
    for (const [method, p, body] of [['GET', '/api/research', undefined], ['GET', '/api/research?refresh=1', undefined], ['POST', '/api/research/start', startBody], ['POST', '/api/research/dismiss', '{}'], ['POST', '/api/waits/dismiss', '{"sessionId":"x"}']] as const) {
      for (const marks of [{ origin: 'https://evil.example' }, { origin: `http://localhost:${P}` }, { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-site' }] as Record<string, string>[]) {
        assert.equal((await call(method, p, { ...auth, ...marks }, body)).status, 403, `${method} ${p} ${JSON.stringify(marks)}`);
      }
      assert.equal((await call(method, p, { ...auth, host: 'evil.example' }, body)).status, 421, `${method} ${p} wrong Host`);
      assert.equal((await call(method, p, { 'content-type': 'application/json' }, body)).status, 401, `${method} ${p} no token`);
    }
    assert.deepEqual([terminal.state.running, spawned, written], [false, [], []], 'none of the refused requests started or wrote anything');
    assert.equal(await open('/pty/research'), 'refused:404', 'the Research Lab has no terminal of its own any more');
    assert.equal((await call('POST', '/api/research/cancel', auth, '{}')).status, 404);

    const info = JSON.parse((await call('GET', '/api/research', auth)).body);
    assert.deepEqual([info.cwd, info.root, info.terminal.running, info.command, info.researcherType], [cwd, path.join(cwd, 'research'), false, '/onecarat-agent-office:research', 'onecarat-agent-office:researcher']);
    assert.equal((await call('POST', '/api/research/start', auth, 'nope')).status, 400);
    const bad = await call('POST', '/api/research/start', auth, '{"theme":"","count":3}');
    assert.deepEqual([bad.status, JSON.parse(bad.body)], [409, { error: 'bad-theme' }]);

    // The Office terminal is not running: a research never starts Claude Code. The command is only given back.
    let res = JSON.parse((await call('POST', '/api/research/start', auth, startBody)).body);
    assert.deepEqual([res.current.pasted, res.current.notPasted, terminal.state.running, spawned], [false, 'no-terminal', false, []]);
    assert.match(res.current.command, /^\/onecarat-agent-office:research 3 2 r-\d{8}-\d{6}-[0-9a-f]{4} real theme$/);
    assert.equal(JSON.parse((await call('POST', '/api/research/dismiss', auth, '{}')).body).current, undefined);

    // The user starts Claude Code in the Office terminal; before its first hook nothing is pasted.
    const office = (await open('/pty')) as WebSocket;
    office.send(JSON.stringify({ t: 'start' }));
    await sleep(80);
    assert.equal(terminal.state.running, true);
    res = JSON.parse((await call('POST', '/api/research/start', auth, startBody)).body);
    assert.deepEqual([res.current.notPasted, written], ['not-started', []]);
    b.store.append([ev(terminal.state.sessionId!, { type: 'session.started' })]);
    res = JSON.parse((await call('POST', '/api/research/start', auth, startBody)).body);
    assert.equal(res.current.pasted, true);
    assert.deepEqual(written, [`\u001b[200~${res.current.command}\u001b[201~`], 'the command as a paste, and no Enter');
    // The user's own keys (Enter among them) go through the same socket as always.
    office.send(JSON.stringify({ t: 'in', d: '\r' }));
    await sleep(50);
    assert.equal(written.at(-1), '\r');

    // A refused prompt sends no hook: its wait stays and holds back the next paste, with the time it began.
    // "Hide this wait" removes it from what is shown. It writes nothing to the terminal and answers nothing.
    const S = terminal.state.sessionId!;
    await call('POST', '/api/research/dismiss', auth, '{}');
    b.store.append([ev(S, { type: 'tool.started', toolUseId: 't1', toolName: 'Write', activity: 'editing', detail: 'a.txt' }), ev(S, { type: 'permission.requested', toolName: 'Write', detail: 'a.txt' })]);
    res = JSON.parse((await call('POST', '/api/research/start', auth, startBody)).body);
    assert.deepEqual([res.current.pasted, res.current.notPasted, res.terminal.waits.length, typeof res.terminal.waits[0].at], [false, 'waiting-permission', 1, 'number']);
    const before = [...written];
    assert.equal((await call('POST', '/api/waits/dismiss', auth, '{}')).status, 400);
    assert.equal((await call('POST', '/api/waits/dismiss', auth, '{"sessionId":"no-such-session"}')).status, 404);
    const hid = await call('POST', '/api/waits/dismiss', auth, JSON.stringify({ sessionId: S }));
    assert.deepEqual([hid.status, JSON.parse(hid.body).terminal.waits, JSON.parse(hid.body).terminal.unresolved], [200, [], 1], 'gone from what is shown; still open as far as hooks tell');
    assert.deepEqual(written, before, 'hiding a wait writes nothing to the terminal');
    const last = b.store.snapshot().at(-1)!;
    assert.deepEqual([last.type, last.sessionId, last.agentId], ['wait.dismissed', S, undefined], 'recorded as the user\'s act, not as an answer');
    // Hiding is not evidence that the prompt is gone: the paste is still held back, and the page is told why.
    res = JSON.parse((await call('POST', '/api/research/start', auth, startBody)).body);
    assert.deepEqual([res.current.pasted, res.current.notPasted], [false, 'wait-unknown']);
    assert.deepEqual(written, before, 'nothing was pasted on the strength of the user hiding a wait');
    // Only a hook closes the request (here: the user's next prompt). Then the paste is made again.
    b.store.append([ev(S, { type: 'user.prompt', text: 'something else' })]);
    res = JSON.parse((await call('POST', '/api/research/start', auth, startBody)).body);
    assert.deepEqual([res.current.pasted, res.terminal.unresolved], [true, 0], 'after hook evidence, the next start pastes');
    office.close();
  } finally {
    await b.close();
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

// ---------- open folder ----------

test('C: only a regular file is selected; anything else shows the parent folder, never the recorded path', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-reveal-'));
  try {
    const win = { SystemRoot: 'C:\\Windows' };
    const file = path.join(dir, 'spec.md');
    fs.writeFileSync(file, 'x');
    assert.deepEqual(revealTarget(file, 'darwin'), { file: '/usr/bin/open', args: ['-R', file] });
    const opener = path.join(dir, 'xdg-open');
    fs.writeFileSync(opener, '#!/bin/sh\n', { mode: 0o755 });
    assert.deepEqual(revealTarget(file, 'linux', { PATH: dir }), { file: opener, args: [dir] });
    assert.equal(revealTarget(file, 'linux', { PATH: '' }), undefined, 'no xdg-open on PATH: nothing is started');
    if (process.platform === 'win32') assert.deepEqual(revealTarget(file, 'win32', win)!.args, [`/select,"${file}"`]);
    // Replaced by a folder (on macOS it could be an .app bundle): the folder itself is not opened.
    const app = path.join(dir, 'Thing.app');
    fs.mkdirSync(app);
    assert.deepEqual(revealTarget(app, 'darwin'), { file: '/usr/bin/open', args: [dir] });
    if (process.platform === 'win32') assert.deepEqual(revealTarget(app, 'win32', win)!.args, [`"${dir}"`]);
    // Gone: the parent folder.
    assert.deepEqual(revealTarget(path.join(dir, 'gone.md'), 'darwin'), { file: '/usr/bin/open', args: [dir] });
    // No parent folder either: nothing.
    assert.equal(revealTarget(path.join(dir, 'no', 'such', 'file.md'), 'darwin'), undefined);
    // A link is not a regular file, whatever it points to.
    let linked = false;
    try {
      fs.symlinkSync(file, path.join(dir, 'link.md'));
      linked = true;
    } catch {
      /* no right to create links on this machine */
    }
    if (linked) assert.deepEqual(revealTarget(path.join(dir, 'link.md'), 'darwin'), { file: '/usr/bin/open', args: [dir] });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- result files ----------

test('earlier researches are restored from disk (both file layouts); completed only with summary.json; only plain .json files directly inside are read', () => {
  const t = setup();
  try {
    const root = path.join(t.cwd, 'research');
    // The first version's layout: result-NNN.json, no summary.
    const old = 'r-20261101-101010-ab12';
    fs.mkdirSync(path.join(root, old, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(root, old, 'request.json'), JSON.stringify({ researchId: old, theme: 'old theme', requestedCount: 4 }));
    fs.writeFileSync(path.join(root, old, 'result-001.json'), JSON.stringify({ researchId: old, title: 'Old', sources: ['javascript:alert(1)', { url: 'https://example.com' }] }));
    fs.writeFileSync(path.join(root, old, 'notes.txt'), 'not a result');
    fs.writeFileSync(path.join(root, old, 'sub', 'result-009.json'), JSON.stringify({ title: 'In a sub-folder' }));
    fs.writeFileSync(path.join(root, old, 'big.json'), JSON.stringify({ title: 'x', details: 'y'.repeat(300 * 1024) }));
    fs.mkdirSync(path.join(root, 'not-a-research'));
    // The two-view layout: r<k>-NNN.json, reviews, summary.
    const id = 'r-20261114-002500-f854';
    fs.mkdirSync(path.join(root, id));
    fs.writeFileSync(path.join(root, id, 'request.json'), JSON.stringify({ researchId: id, theme: 'new theme', requestedCount: 3, researchers: 2 }));
    fs.writeFileSync(path.join(root, id, 'r1-001.json'), JSON.stringify({ researchId: id, id: 'r1-001', title: 'A' }));
    fs.writeFileSync(path.join(root, id, 'r2-001.json'), JSON.stringify({ researchId: id, id: 'r2-001', title: 'B' }));
    fs.writeFileSync(path.join(root, id, 'review-r1-001.json'), JSON.stringify({ researchId: id, resultId: 'r1-001', verdict: 'confirmed', note: 'fine' }));
    fs.writeFileSync(path.join(root, id, 'review-r2-001.json'), JSON.stringify({ researchId: id, verdict: 'needs-check', note: 'thin' }));
    fs.writeFileSync(path.join(root, id, 'summary.json'), JSON.stringify({ researchId: id, saved: 2, missing: 1, reason: 'r' }));
    const past = t.c.info(true).past;
    assert.deepEqual(past.map((p) => [p.id, p.theme, p.requestedCount, p.requestedResearchers, p.status, p.restored]), [[id, 'new theme', 3, 2, 'completed', true], [old, 'old theme', 4, undefined, 'unconfirmed', true]]);
    assert.deepEqual(past[0]!.cards.map((c) => [c.title, c.review?.verdict, c.agentId]), [['A', 'confirmed', undefined], ['B', 'needs-check', undefined]], 'reviews and the summary are not cards; who wrote a card is not guessed from its name');
    assert.equal(past[0]!.endedAt, past[0]!.summary!.at);
    assert.deepEqual(past[1]!.cards.map((c) => c.title), ['Old']);
    // The file's text is kept as text: whether a source is a link is decided by the page (http/https only).
    assert.deepEqual(past[1]!.cards[0]!.sources.map((s) => s.url), ['javascript:alert(1)', 'https://example.com']);
    assert.deepEqual(past[1]!.errors, [{ file: 'big.json', reason: 'too-large' }]);
    const outside = path.join(t.cwd, 'outside.json');
    fs.writeFileSync(outside, JSON.stringify({ title: 'Outside' }));
    let linked = false;
    try {
      fs.symlinkSync(outside, path.join(root, old, 'result-002.json'));
      linked = true;
    } catch {
      /* no right to create links on this machine */
    }
    if (linked) assert.deepEqual(loadResult(path.join(root, old), 'result-002.json', old, 'e'), { error: { file: 'result-002.json', reason: 'not-a-regular-file' } });
    assert.deepEqual(scanRun(root, '../' + old, 'e'), { cards: [], errors: [], reviews: [] });
    assert.equal(fs.readdirSync(path.join(root, id)).length, 6, 'reading changed nothing');
  } finally {
    t.done();
  }
});

test('file kinds and schemas: wrong types are dropped, texts are clipped, a review needs one of the two verdicts', () => {
  assert.deepEqual(['request.json', 'summary.json', 'review-r1-001.json', 'r1-001.json', 'result-001.json', 'review.json', 'notes.txt', '../x.json'].map(researchFileKind), ['request', 'summary', 'review', 'result', 'result', 'result', undefined, undefined]);
  const root = path.join(os.tmpdir(), 'w', 'research');
  assert.deepEqual(researchFileIn(root, path.join(root, 'r-20261114-002500-f854', 'r1-001.json')), { id: 'r-20261114-002500-f854', name: 'r1-001.json' });
  for (const p of [path.join(root, 'r1-001.json'), path.join(root, 'r-20261114-002500-f854', 'sub', 'a.json'), path.join(root, 'R-20261114-002500-F854', 'a.json'), path.join(root, '..', 'other', 'r-20261114-002500-f854', 'a.json'), path.join(root, 'r-20261114-002500-f854', 'a.txt')]) assert.equal(researchFileIn(root, p), undefined, p);

  assert.equal(validateResult([1], 'r', 'a.json', 'e', 0), 'not-an-object');
  assert.equal(validateResult({ title: 5 }, 'r', 'a.json', 'e', 0), 'no-title');
  const c = validateResult({ title: ' T\u0007 ', summary: 7, findings: ['a', 3, ''], sources: 'nope', caveats: [null, 'c'], id: '../x', status: 'weird', html: '<script>', agentId: 'forged', review: { verdict: 'confirmed' } }, 'r', 'result-9.json', 'e', 1);
  assert.deepEqual(c, { id: 'result-9', file: 'result-9.json', title: 'T', summary: '', details: '', findings: ['a'], sources: [], caveats: ['c'], status: 'completed', engine: 'e', at: 1 });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-review-'));
  try {
    const put = (name: string, v: unknown) => fs.writeFileSync(path.join(dir, name), JSON.stringify(v));
    put('review-r1-001.json', { researchId: 'R', resultId: '../x', verdict: 'needs-check', note: ' n\u0007 ', extra: '<script>' });
    const ok = loadReview(dir, 'review-r1-001.json', 'R');
    assert.ok(ok && 'review' in ok);
    assert.deepEqual([ok.review.resultId, ok.review.verdict, ok.review.note], ['r1-001', 'needs-check', 'n'], 'a bad result id falls back to the file name');
    put('review-a.json', { verdict: 'CONFIRMED' });
    put('review-b.json', { researchId: 'other', verdict: 'confirmed' });
    put('review-c.json', ['confirmed']);
    assert.deepEqual(['review-a.json', 'review-b.json', 'review-c.json'].map((f) => (loadReview(dir, f, 'R') as { error: { reason: string } }).error.reason), ['bad-verdict', 'wrong-research-id', 'not-an-object']);
    assert.equal(loadReview(dir, 'r1-001.json', 'R'), undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- what ships in the plugin ----------

test('the shipped skill and researcher definition loosen no permission and give the researcher no Agent tool', () => {
  const plugin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../plugin/onecarat-agent-office');
  const front = (file: string) => {
    const text = fs.readFileSync(path.join(plugin, file), 'utf8');
    const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text);
    assert.ok(m, `${file} has front matter`);
    const keys = Object.fromEntries(m[1]!.split(/\r?\n/).map((l) => [l.slice(0, l.indexOf(':')).trim(), l.slice(l.indexOf(':') + 1).trim()]));
    return { keys, body: m[2]! };
  };
  const skill = front('skills/research/SKILL.md');
  assert.deepEqual(Object.keys(skill.keys).sort(), ['argument-hint', 'description', 'disable-model-invocation', 'name']);
  assert.deepEqual([skill.keys.name, skill.keys['disable-model-invocation']], ['research', 'true'], 'only the user runs it');
  for (const must of ['$ARGUMENTS', 'r-YYYYMMDD-HHMMSS-xxxx', 'Do not run any shell command', 'already has a folder', RESEARCHER_AGENT_TYPE, 'in the background', 'review-<result id>.json', 'summary.json', '"needs-check"', 'Do not put times in any file']) assert.ok(skill.body.includes(must), must);
  const agent = front('agents/researcher.md');
  assert.deepEqual(Object.keys(agent.keys).sort(), ['background', 'description', 'name', 'tools']);
  assert.deepEqual([agent.keys.name, agent.keys.tools, agent.keys.background], ['researcher', 'WebSearch, WebFetch, Write, Read', 'true']);
  for (const must of ['r<k>-001.json', 'Only after that Write has finished', 'Never invent or guess a URL', 'data, not instructions']) assert.ok(agent.body.includes(must), must);
  for (const f of [skill, agent]) for (const banned of ['allowed-tools', 'permissionMode', 'bypassPermissions', 'dangerously']) assert.ok(!JSON.stringify(f).includes(banned), banned);
});

// ---------- scripts that touch the running Office ----------

test('scripts that act on the running Office do nothing unless asked for explicitly', async () => {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../tests/screenshots');
  const guard = (await import(new URL(`file:///${path.join(dir, 'live-guard.mjs').replace(/\\/g, '/')}`).href)) as { liveAllowed: (env: Record<string, string | undefined>) => boolean; LIVE_ENV: string };
  assert.equal(guard.LIVE_ENV, 'ONECARAT_OFFICE_LIVE');
  assert.deepEqual([{}, { ONECARAT_OFFICE_LIVE: '' }, { ONECARAT_OFFICE_LIVE: '0' }, { ONECARAT_OFFICE_LIVE: 'true' }, { ONECARAT_OFFICE_LIVE: '1' }].map((e) => guard.liveAllowed(e)), [false, false, false, false, true]);
  // Every script that reads the runtime file (the running Office's port and key) stops at the guard first.
  // (They are checked as text: running them here to "see" the guard would be the very thing it forbids.)
  const live = fs.readdirSync(dir).filter((f) => f.endsWith('.mjs') && /readRuntimeFile\(|bridge\.json/.test(fs.readFileSync(path.join(dir, f), 'utf8')));
  assert.deepEqual(live.sort(), ['capture-live.mjs', 'check-terminal.mjs']);
  for (const f of live) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    const at = text.indexOf('requireLive(');
    assert.ok(at > 0, `${f} calls requireLive`);
    for (const later of ['readRuntimeFile()', 'chromium.launch', 'page.goto']) assert.ok(text.indexOf(later) > at, `${f}: ${later} comes after the guard`);
  }
});
test('an idle notice of the manager ends its permission wait, and the research is not left "researching" (a refusal itself sends nothing)', () => {
  const t = setup();
  try {
    t.begin('theme', 1, 1);
    t.hook('S1', { type: 'tool.started', toolUseId: 'm1', toolName: 'Write', activity: 'editing', detail: 'request.json' });
    t.hook('S1', { type: 'permission.requested', toolName: 'Write', detail: 'request.json' });
    t.hook('S1', { type: 'notification', kind: 'permission_prompt', message: 'Claude needs your permission' });
    assert.deepEqual([t.cur().status, t.cur().waiting.length, t.c.info().terminal.waiting], ['researching', 1, true]);
    // The user answers "No". Nothing arrives until Claude Code reports that it waits for input.
    t.hook('S1', { type: 'notification', kind: 'idle_prompt', message: 'Claude is waiting for your input' });
    assert.deepEqual([t.cur().status, t.cur().waiting, t.c.info().terminal.waiting, t.cur().cards.length], ['unconfirmed', [], false, 0], 'no file, nobody at work: the end is not confirmed (never "completed")');
    // While researchers are at work, the same notice changes nothing about them or the research.
    const run = t.begin('second', 1, 1);
    t.write(run, 'request.json', { researchId: run.id });
    t.researcher('a1');
    t.hook('S1', { type: 'tool.started', toolUseId: 'f1', toolName: 'WebFetch', activity: 'researching', detail: 'example.com', agentId: 'a1' });
    t.hook('S1', { type: 'permission.requested', toolName: 'WebFetch', detail: 'example.com', agentId: 'a1' });
    t.hook('S1', { type: 'notification', kind: 'idle_prompt', message: 'Claude is waiting for your input' });
    assert.deepEqual([t.cur().status, t.cur().researchers[0]!.status, t.cur().waiting.map((w) => w.agentId)], ['researching', 'working', ['a1']]);
  } finally {
    t.done();
  }
});