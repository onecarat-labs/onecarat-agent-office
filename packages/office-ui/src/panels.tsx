import { useEffect, useRef, useState } from 'react';
import { TerminalView } from './TerminalView.tsx';
import { SizeControl, TERM_SCALE_DEFAULT, TERM_SCALE_MAX, TERM_SCALE_MIN, stepScale } from './config/SettingsView.tsx';
import type { StartMode, TerminalLink } from './live/useTerminal.ts';
import { MANAGER_ID, summarize, type AgentState, type SessionState } from '@onecarat/domain';
import { IconChat, IconClose, IconConsole, IconFolder, IconMaximize, IconMore, IconTextSize, IconRestore, IconSend, IconSmile, IconTerminal, IconUser } from './icons.tsx';
import { dict, displayName, modeText, outcomeText, statusText, bubbleText, type Lang } from './i18n.ts';
import { expressionOf } from '@onecarat/domain';

const hhmm = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const hhmmss = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** Maximize / restore toggle shown in each pane's header. */
export function MaxToggle({ on, onToggle, lang, className = '' }: { on: boolean; onToggle: () => void; lang: Lang; className?: string }) {
  const t = dict[lang];
  const label = on ? t.restore : t.maximize;
  return (
    <button className={`iconbtn maxbtn ${className}`} aria-pressed={on} aria-label={label} title={label} onClick={onToggle}>
      {on ? <IconRestore size={18} /> : <IconMaximize size={18} />}
    </button>
  );
}

/** Smallest / largest share of the container the first pane of a splitter may take. */
export const SPLIT_MIN = 0.15;
export const SPLIT_MAX = 0.85;
const clampSplit = (v: number) => Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, v));

/**
 * Draggable border between two panes of a grid container. It is its own grid track; `value` is the share of the
 * remaining space the pane before it takes. horizontal = a horizontal bar (changes heights), vertical = widths.
 * Mouse / touch drag, arrow keys, Home / End; double-click or Enter resets.
 */
export function Splitter({ orientation, value, onChange, onReset, label }: { orientation: 'horizontal' | 'vertical'; value: number; onChange: (v: number) => void; onReset: () => void; label: string }) {
  const [dragging, setDragging] = useState(false);
  const horizontal = orientation === 'horizontal';
  const fromPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const box = el.parentElement;
    if (!box) return;
    const r = box.getBoundingClientRect();
    const cs = getComputedStyle(box);
    const own = el.getBoundingClientRect();
    const start = horizontal ? r.top + parseFloat(cs.paddingTop) : r.left + parseFloat(cs.paddingLeft);
    const end = horizontal ? r.bottom - parseFloat(cs.paddingBottom) : r.right - parseFloat(cs.paddingRight);
    const thick = horizontal ? own.height : own.width;
    const room = end - start - thick;
    if (room <= 0) return;
    onChange(clampSplit(((horizontal ? e.clientY : e.clientX) - start - thick / 2) / room));
  };
  const onKey = (e: React.KeyboardEvent) => {
    const back = horizontal ? 'ArrowUp' : 'ArrowLeft';
    const fwd = horizontal ? 'ArrowDown' : 'ArrowRight';
    if (e.key === back) onChange(clampSplit(value - 0.02));
    else if (e.key === fwd) onChange(clampSplit(value + 0.02));
    else if (e.key === 'Home') onChange(SPLIT_MIN);
    else if (e.key === 'End') onChange(SPLIT_MAX);
    else if (e.key === 'Enter') onReset();
    else return;
    e.preventDefault();
  };
  return (
    <div
      className={`splitter ${horizontal ? 'h' : 'v'}${dragging ? ' dragging' : ''}`}
      role="separator"
      tabIndex={0}
      aria-orientation={orientation}
      aria-label={label}
      title={label}
      aria-valuemin={Math.round(SPLIT_MIN * 100)}
      aria-valuemax={Math.round(SPLIT_MAX * 100)}
      aria-valuenow={Math.round(value * 100)}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault(); // no text selection while dragging
        e.currentTarget.setPointerCapture(e.pointerId);
        e.currentTarget.focus();
        setDragging(true);
      }}
      onPointerMove={(e) => { if (dragging) fromPointer(e); }}
      onPointerUp={() => setDragging(false)}
      onPointerCancel={() => setDragging(false)}
      onLostPointerCapture={() => setDragging(false)}
      onDoubleClick={onReset}
      onKeyDown={onKey}
    />
  );
}

type MaxProps = { max: boolean; onMax: () => void };

/** Double-click on the empty part of a pane's header: maximize / restore (not on its buttons, tabs or selector). */
const headDoubleClick = (onMax: () => void) => (e: React.MouseEvent<HTMLElement>) => {
  if ((e.target as HTMLElement).closest('button, select, input, a, [role=tablist]')) return;
  onMax();
};

export function TerminalPanel({ session, lang, term, cwds, termMode, max, onMax, onStop, officeStopped, fontScale, setFontScale }: { session?: SessionState; lang: Lang; term?: TerminalLink; cwds: string[]; termMode?: string; onStop?: () => void; officeStopped?: boolean; fontScale?: number; setFontScale?: (v: number) => void } & MaxProps) {
  const t = dict[lang];
  const termOk = !!term && term.state?.available !== false;
  const [tab, setTab] = useState<'terminal' | 'history'>('terminal');
  const showTerm = termOk && tab === 'terminal';
  // Without the built-in terminal (demo, or not available here) the pane only shows the conversation.
  const title = termOk ? t.terminal : t.conversation;
  return (
    <section className="panel" aria-labelledby="chat-h">
      <div className="panel-head" onDoubleClick={headDoubleClick(onMax)}>
        {termOk ? <IconTerminal size={22} /> : <IconChat size={22} />}
        <span id="chat-h">{title}</span>
        {termOk ? (
          <div className="tabs" role="tablist" aria-label={title}>
            <button role="tab" aria-selected={tab === 'terminal'} title={t.termIntro} onClick={() => setTab('terminal')}>{t.termTab}</button>
            <button role="tab" aria-selected={tab === 'history'} title={t.historyNote} onClick={() => setTab('history')}>{t.historyTab}</button>
          </div>
        ) : null}
        <MaxToggle on={max} onToggle={onMax} lang={lang} />
      </div>
      {showTerm ? <TerminalPane term={term!} lang={lang} cwds={cwds} mode={termMode} onStop={onStop} officeStopped={officeStopped} fontScale={fontScale} setFontScale={setFontScale} /> : <HistoryPane session={session} lang={lang} term={term} />}
    </section>
  );
}

/** The last two folders of a path (the full path is in the tooltip). */
function shortPath(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 2) return p;
  return `…${p.includes('\\') ? '\\' : '/'}${parts.slice(-2).join(p.includes('\\') ? '\\' : '/')}`;
}

/**
 * A "more actions" button with a short list of items below it; each item opens its own dialog. As wide as its
 * content, never scrolls. Closes on Escape, on a click outside and when an item is chosen; ↑/↓ move between items.
 */
function Menu({ label, items, btnRef }: { label: string; items: { id: string; icon: React.ReactNode; text: string; onPick: () => void }[]; btnRef: React.RefObject<HTMLButtonElement | null> }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    box.current?.querySelector<HTMLButtonElement>('[role=menuitem]')?.focus();
    const onDown = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); btnRef.current?.focus(); return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const els = [...(box.current?.querySelectorAll<HTMLButtonElement>('[role=menuitem]') ?? [])];
      const i = els.indexOf(document.activeElement as HTMLButtonElement);
      els[(i + (e.key === 'ArrowDown' ? 1 : -1) + els.length) % els.length]?.focus();
      e.preventDefault();
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, btnRef]);
  return (
    <div className="menu" ref={box}>
      <button ref={btnRef} className="iconbtn menu-btn" aria-haspopup="menu" aria-expanded={open} aria-label={label} title={label} onClick={() => setOpen(!open)}><IconMore size={20} /></button>
      {open ? (
        <div className="menu-body" role="menu" aria-label={label}>
          {items.map((it) => (
            <button key={it.id} role="menuitem" className="menu-item" onClick={() => { setOpen(false); it.onPick(); }}>{it.icon}<span>{it.text}</span></button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Modal dialog (the browser's own <dialog>: Escape closes it, focus stays inside, the page behind is inert).
 * Centered in the window and scrolls inside when the window is low, so nothing is cut off by a pane.
 */
function Dialog({ title, closeLabel, onClose, className = '', children }: { title: string; closeLabel: string; onClose: () => void; className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`dlg ${className}`}
      aria-label={title}
      onClose={onClose}
      // A press on the dimmed area around the dialog closes it (a drag that merely ends there does not).
      onMouseDown={(e) => { if (e.target === ref.current) ref.current?.close(); }}
    >
      <div className="dlg-head">
        <h3>{title}</h3>
        <button className="iconbtn" aria-label={closeLabel} title={closeLabel} onClick={() => ref.current?.close()}><IconClose size={18} /></button>
      </div>
      <div className="dlg-body">{children}</div>
    </dialog>
  );
}

function TerminalPane({ term, lang, cwds, mode, onStop, officeStopped, fontScale = TERM_SCALE_DEFAULT, setFontScale }: { term: TerminalLink; lang: Lang; cwds: string[]; mode?: string; onStop?: () => void; officeStopped?: boolean; fontScale?: number; setFontScale?: (v: number) => void }) {
  const t = dict[lang];
  const st = term.state;
  const [folder, setFolder] = useState('');
  const cur = st?.cwd ?? '';
  const others = cwds.filter((c) => c && c !== cur);
  // How a start from the folder dialog begins (the button in the bar starts a new session in the current folder).
  const [folderMode, setFolderMode] = useState<StartMode>('new');
  const [dialog, setDialog] = useState<'none' | 'folder' | 'size'>('none');
  const menuBtn = useRef<HTMLButtonElement>(null);
  const closeDialog = () => { setDialog('none'); menuBtn.current?.focus(); };
  // Text size of this terminal only (also in Settings > Office > Display).
  const zoom = (dir: -1 | 1) => setFontScale?.(stepScale(fontScale, dir, TERM_SCALE_MIN, TERM_SCALE_MAX));
  /** false: the user kept the running Claude Code (nothing was stopped or started). */
  const startIn = (dir?: string, mode: StartMode = 'new'): boolean => {
    if (st?.running && !window.confirm(t.termConfirmRestart)) return false;
    if (st?.running) term.send({ t: 'stop' });
    term.send({ t: 'start', cwd: dir, mode });
    return true;
  };
  const canStart = term.link === 'open';
  // From the dialog: it closes only when something was started (declining the confirmation keeps it open).
  const startFromDialog = (dir: string | undefined) => { if (startIn(dir, folderMode)) setDialog('none'); };
  const modeHint = folderMode === 'continue' ? t.termContinueHint : folderMode === 'resume' ? t.termResumeHint : undefined;
  return (
    <>
      {/* Always in view: where it runs, the permission mode, and start / stop. The rest is behind the menu. */}
      <div className="term-bar">
        <span className="term-cwd" title={`${t.termFolder}: ${cur}`}>{cur ? shortPath(cur) : '—'}</span>
        {st?.running && mode ? (
          <span className={`pill ${mode === 'default' || mode === 'plan' ? 'muted' : 'warn'}`} title={`${t.modeLabel}\n${t.modeNote}`}>
            {modeText[lang][mode] ?? mode}
          </span>
        ) : null}
        {st?.running ? (
          <button className="btn" onClick={() => { onStop?.(); term.send({ t: 'stop' }); }}>{t.termStop}</button>
        ) : (
          <button className="btn primary" disabled={!canStart} onClick={() => startIn()}>{t.termStart}</button>
        )}
        <Menu
          label={t.termMore}
          btnRef={menuBtn}
          items={[
            { id: 'folder', icon: <IconFolder size={18} />, text: t.termChangeFolder, onPick: () => setDialog('folder') },
            ...(setFontScale ? [{ id: 'size', icon: <IconTextSize size={18} />, text: t.termTextSize, onPick: () => setDialog('size') }] : []),
          ]}
        />
      </div>
      {st?.reason && !st.running ? <div className="term-note warn">{st.reason}</div> : null}
      {st && !st.running && st.exitCode !== undefined ? <div className="term-note">{t.termExited.replace('{code}', String(st.exitCode))}</div> : null}
      {officeStopped ? <div className="term-note">{t.termOfficeStopped}</div> : term.link !== 'open' ? <div className="term-note">{t.termConnecting}</div> : null}
      <TerminalView term={term} label={t.terminal} fontScale={fontScale} onZoom={setFontScale ? zoom : undefined} />

      {dialog === 'folder' ? (
        <Dialog title={t.termChangeFolder} closeLabel={t.close} onClose={closeDialog} className="dlg-folder">
          <div className="dlg-field">
            <div className="k">{t.termFolderNow}</div>
            <code className="dlg-path">{cur || '—'}</code>
          </div>
          <label className="dlg-field">
            <span className="k">{t.termModeLabel}</span>
            <select value={folderMode} onChange={(e) => setFolderMode(e.target.value as StartMode)}>
              <option value="new">{t.termModeNew}</option>
              <option value="continue">{t.termContinue}</option>
              <option value="resume">{t.termResume}</option>
            </select>
            {modeHint ? <span className="hint">{modeHint}</span> : null}
          </label>
          {cur || others.length ? (
          <div className="dlg-field">
            <div className="k">{t.termFolderChoose}</div>
            <div className="dlg-folders">
              {cur ? <button className="sess-item" disabled={!canStart} title={cur} onClick={() => startFromDialog(undefined)}><span className="path">{cur}</span><span className="tag">{t.termFolderCurrent}</span></button> : null}
              {others.map((c) => (
                <button key={c} className="sess-item" disabled={!canStart} title={c} onClick={() => startFromDialog(c)}><span className="path">{c}</span></button>
              ))}
            </div>
          </div>
          ) : null}
          <form className="dlg-field" onSubmit={(e) => { e.preventDefault(); if (folder.trim()) startFromDialog(folder.trim()); }}>
            <label className="k" htmlFor="term-folder-input">{t.termFolderType}</label>
            <div className="dlg-row">
              <input id="term-folder-input" value={folder} onChange={(e) => setFolder(e.target.value)} placeholder={'C:\\path\\to\\project'} />
              <button className="btn primary" type="submit" disabled={!canStart || !folder.trim()}>{t.termRestart}</button>
            </div>
          </form>
          {st?.running ? <p className="hint">{t.termFolderRunning}</p> : null}
        </Dialog>
      ) : null}
      {dialog === 'size' && setFontScale ? (
        <Dialog title={t.termTextSize} closeLabel={t.close} onClose={closeDialog} className="dlg-size">
          <SizeControl label={t.termTextSize} about={t.termSizeAbout} value={fontScale} onChange={setFontScale} min={TERM_SCALE_MIN} max={TERM_SCALE_MAX} def={TERM_SCALE_DEFAULT} lang={lang} />
        </Dialog>
      ) : null}
    </>
  );
}

function HistoryPane({ session, lang, term }: { session?: SessionState; lang: Lang; term?: TerminalLink }) {
  const t = dict[lang];
  const listRef = useRef<HTMLDivElement>(null);
  const msgs = session?.chat ?? [];
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs.length]);
  const unavailable = term?.state?.available === false ? term.state.reason ?? '' : undefined;
  return (
    <>
      <div className="chat-list" ref={listRef} aria-live="polite">
        {session && !session.sawStart && session.source === 'live' ? <div className="chat-empty">{t.joinedMidway}</div> : null}
        {msgs.length === 0 && (session?.sawStart || session?.source !== 'live') ? <div className="chat-empty">{t.chatEmpty}</div> : null}
        {msgs.map((m) => (
          <div key={m.id} className={`msg ${m.from}`}>
            <div className={`avatar ${m.from}`}>{m.from === 'user' ? <IconUser size={20} /> : <IconSmile size={22} />}</div>
            <div>
              <div className="meta"><b>{m.from === 'user' ? t.user : t.manager}</b>{hhmm(m.at)}</div>
              <div className="text">{m.text}</div>
            </div>
          </div>
        ))}
      </div>
      {term ? null : (
        <div className="chat-input">
          <input disabled placeholder={t.chatPlaceholder} aria-label={t.chatPlaceholder} title={t.chatNote} />
          <button disabled aria-label={t.send} title={t.send}><IconSend size={18} /></button>
        </div>
      )}
      {/* Only what the user has to know stays in view; the read-only notes are tooltips (tab, input). */}
      {unavailable !== undefined ? <div className="chat-note">{t.termUnavailable.replace('{reason}', unavailable)}</div> : null}
    </>
  );
}

function pillClass(a: AgentState): string {
  switch (a.status) {
    case 'waiting_permission':
    case 'blocked':
      return 'warn';
    case 'failed':
      return 'danger';
    case 'completed':
      return a.outcome === 'success_estimated' ? 'ok' : 'muted';
    case 'idle':
    case 'unknown':
    case 'created':
      return 'muted';
    default:
      return 'accent';
  }
}

/** Console selection meaning "nobody": the pane shows the whole session. */
export const OVERVIEW = '';

export function ConsolePanel({ session, selectedId, onSelect, lang, max, onMax }: { session?: SessionState; selectedId: string; onSelect: (id: string) => void; lang: Lang } & MaxProps) {
  const t = dict[lang];
  const ids = [MANAGER_ID, ...(session?.order ?? [])];
  const all = ids.map((id) => session?.agents[id]).filter((x): x is AgentState => !!x);
  const a = selectedId === OVERVIEW ? undefined : session?.agents[selectedId];
  const logRef = useRef<HTMLDivElement>(null);
  // One agent: its events. Overview: the latest events of everyone, each with the agent's name.
  const lines = a
    ? a.evidence.slice(-80).map((l) => ({ ...l, who: undefined as string | undefined }))
    : all.flatMap((x) => x.evidence.slice(-80).map((l) => ({ ...l, who: displayName(x, lang) as string | undefined }))).sort((p, q) => p.at - q.at).slice(-80);
  const lastKey = lines.at(-1)?.eventId;
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length, lastKey, selectedId]);
  const lastUser = session?.chat.filter((m) => m.from === 'user').at(-1)?.text;
  const task = a?.role === 'manager' ? lastUser : a?.task;
  const expr = a ? expressionOf(a) : undefined;
  const summary = session ? summarize(session) : { active: 0, completed: 0, failed: 0 };
  return (
    <section className="panel" aria-labelledby="console-h">
      <div className="panel-head" onDoubleClick={headDoubleClick(onMax)}>
        <IconConsole size={22} /><span id="console-h" title={t.selectAgentHint}>{t.console}</span>
        <div className="agent-select">
          <label className="sr-only" htmlFor="agent-pick">{t.agent}</label>
          <select id="agent-pick" value={a?.id ?? OVERVIEW} title={t.selectAgentHint} onChange={(e) => onSelect(e.target.value)}>
            <option value={OVERVIEW}>{t.overview}</option>
            {all.map((x) => <option key={x.id} value={x.id}>{displayName(x, lang) + ' — ' + statusText[lang][x.status]}</option>)}
          </select>
        </div>
        <MaxToggle on={max} onToggle={onMax} lang={lang} />
      </div>
      <div className="console-body">
        {a ? (
          <div className="facts">
            <div>
              <div className="k">{t.currentTask}</div>
              <div className="v">{task ?? '—'}</div>
            </div>
            {a.role === 'subagent' ? (
              <div>
                <div className="k">agent_type</div>
                <code className="v">{a.agentType || '(unknown)'}</code>
              </div>
            ) : null}
            <div>
              <div className="k">{t.status}</div>
              <span className={`pill ${pillClass(a)}`}>{statusText[lang][a.status]}</span>
              {a.outcome ? (
                <div style={{ marginTop: 6 }}>
                  <span className="v">{outcomeText[lang][a.outcome]}</span>
                  <div className="estimate">{t.outcomeNote}</div>
                </div>
              ) : null}
            </div>
            {expr?.bubble && a.status !== 'completed' && a.status !== 'failed' ? (
              <div>
                <div className="k">{t.activity}</div>
                <div className="v">{bubbleText[lang][expr.bubble.key]}{a.activityDetail ? ` · ${a.activityDetail}` : ''}</div>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="facts">
            <div>
              <div className="k">{t.overviewNow}</div>
              <div className="v">{summary.active} {t.active} / {summary.completed} {t.completed}{summary.failed ? ` / ${summary.failed} ${t.failed}` : ''}</div>
            </div>
            {all.length ? (
              <div>
                <div className="k">{t.overviewAgents}</div>
                <div className="agent-list">
                  {all.map((x) => (
                    <button key={x.id} className="agent-row" title={x.role === 'subagent' ? x.task : undefined} onClick={() => onSelect(x.id)}>
                      <span className="name">{displayName(x, lang)}</span>
                      <span className={`pill ${pillClass(x)}`}>{statusText[lang][x.status]}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}
        <div className="log" ref={logRef} role="log" aria-label={t.console}>
          {lines.length === 0 ? <div className="row t">{t.noEvents}</div> : null}
          {lines.map((l, i) => (
            <div key={l.eventId + (l.who ?? '') + i} className={`row ${i === lines.length - 1 ? 'last' : l.tone}`}>
              <span className="t">{hhmmss(l.at)}</span>
              {l.who ? <span className="who">{l.who}</span> : null}
              {l.text}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
