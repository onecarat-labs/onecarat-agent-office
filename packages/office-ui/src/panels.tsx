import { useEffect, useRef, useState } from 'react';
import { TerminalView } from './TerminalView.tsx';
import type { StartMode, TerminalLink } from './live/useTerminal.ts';
import { MANAGER_ID, type AgentState, type SessionState } from '@onecarat/domain';
import { IconChat, IconConsole, IconMaximize, IconRestore, IconSend, IconSmile, IconTerminal, IconUser } from './icons.tsx';
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

type MaxProps = { max: boolean; onMax: () => void };

export function TerminalPanel({ session, lang, term, cwds, termMode, max, onMax, onStop, officeStopped }: { session?: SessionState; lang: Lang; term?: TerminalLink; cwds: string[]; termMode?: string; onStop?: () => void; officeStopped?: boolean } & MaxProps) {
  const t = dict[lang];
  const termOk = !!term && term.state?.available !== false;
  const [tab, setTab] = useState<'terminal' | 'history'>('terminal');
  const showTerm = termOk && tab === 'terminal';
  // Without the built-in terminal (demo, or not available here) the pane only shows the conversation.
  const title = termOk ? t.terminal : t.conversation;
  return (
    <section className="panel" aria-labelledby="chat-h">
      <div className="panel-head">
        {termOk ? <IconTerminal size={22} /> : <IconChat size={22} />}
        <span id="chat-h">{title}</span>
        {termOk ? (
          <div className="tabs" role="tablist" aria-label={title}>
            <button role="tab" aria-selected={tab === 'terminal'} onClick={() => setTab('terminal')}>{t.termTab}</button>
            <button role="tab" aria-selected={tab === 'history'} onClick={() => setTab('history')}>{t.historyTab}</button>
          </div>
        ) : null}
        <MaxToggle on={max} onToggle={onMax} lang={lang} />
      </div>
      {showTerm ? <TerminalPane term={term!} lang={lang} cwds={cwds} mode={termMode} onStop={onStop} officeStopped={officeStopped} /> : <HistoryPane session={session} lang={lang} term={term} />}
    </section>
  );
}

function TerminalPane({ term, lang, cwds, mode, onStop, officeStopped }: { term: TerminalLink; lang: Lang; cwds: string[]; mode?: string; onStop?: () => void; officeStopped?: boolean }) {
  const t = dict[lang];
  const st = term.state;
  const [folder, setFolder] = useState('');
  const cur = st?.cwd ?? '';
  const others = cwds.filter((c) => c && c !== cur);
  // How a start in another folder begins (the three buttons of the bar cover the current folder).
  const [folderMode, setFolderMode] = useState<StartMode>('new');
  const startIn = (dir?: string, mode: StartMode = 'new') => {
    if (st?.running && !window.confirm(t.termConfirmRestart)) return;
    if (st?.running) term.send({ t: 'stop' });
    term.send({ t: 'start', cwd: dir, mode });
  };
  return (
    <>
      <div className="term-bar">
        <span className="term-cwd" title={cur}><b>{t.termFolder}</b> {cur || '—'}</span>
        {st?.running && mode ? (
          <span className={`pill ${mode === 'default' || mode === 'plan' ? 'muted' : 'warn'}`} title={t.modeNote}>
            {t.modeLabel}: {modeText[lang][mode] ?? mode}
          </span>
        ) : null}
        {st?.running ? (
          <button className="btn" onClick={() => { onStop?.(); term.send({ t: 'stop' }); }}>{t.termStop}</button>
        ) : (
          <>
            <button className="btn primary" disabled={term.link !== 'open'} onClick={() => startIn()}>{t.termStart}</button>
            <button className="btn" disabled={term.link !== 'open'} title={t.termContinueHint} onClick={() => startIn(undefined, 'continue')}>{t.termContinue}</button>
            <button className="btn" disabled={term.link !== 'open'} title={t.termResumeHint} onClick={() => startIn(undefined, 'resume')}>{t.termResume}</button>
          </>
        )}
        <details className="term-other">
          <summary>{t.termFolderPick}</summary>
          <div className="term-other-body">
            {others.map((c) => (
              <button key={c} className="sess-item" title={c} onClick={() => startIn(c, folderMode)}>{c}</button>
            ))}
            <label className="term-mode">
              {t.termModeLabel}
              <select value={folderMode} onChange={(e) => setFolderMode(e.target.value as StartMode)}>
                <option value="new">{t.termModeNew}</option>
                <option value="continue">{t.termContinue}</option>
                <option value="resume">{t.termResume}</option>
              </select>
            </label>
            <form onSubmit={(e) => { e.preventDefault(); if (folder.trim()) startIn(folder.trim(), folderMode); }}>
              <input value={folder} onChange={(e) => setFolder(e.target.value)} placeholder={'C:\\path\\to\\project'} aria-label={t.termFolder} />
              <button className="btn" type="submit" disabled={!folder.trim()}>{t.termRestart}</button>
            </form>
          </div>
        </details>
      </div>
      {st?.reason && !st.running ? <div className="term-note warn">{st.reason}</div> : null}
      {st && !st.running && st.exitCode !== undefined ? <div className="term-note">{t.termExited.replace('{code}', String(st.exitCode))}</div> : null}
      {officeStopped ? <div className="term-note">{t.termOfficeStopped}</div> : term.link !== 'open' ? <div className="term-note">{t.termConnecting}</div> : null}
      <TerminalView term={term} label={t.terminal} />
      <div className="chat-note">{t.termIntro}</div>
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
          <input disabled placeholder={t.chatPlaceholder} aria-label={t.chatPlaceholder} />
          <button disabled aria-label={t.send} title={t.send}><IconSend size={18} /></button>
        </div>
      )}
      <div className="chat-note">{unavailable !== undefined ? t.termUnavailable.replace('{reason}', unavailable) : term ? t.historyNote : t.chatNote}</div>
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

export function ConsolePanel({ session, selectedId, onSelect, lang, max, onMax }: { session?: SessionState; selectedId: string; onSelect: (id: string) => void; lang: Lang } & MaxProps) {
  const t = dict[lang];
  const ids = [MANAGER_ID, ...(session?.order ?? [])];
  const a = session?.agents[selectedId] ?? session?.agents[MANAGER_ID];
  const logRef = useRef<HTMLDivElement>(null);
  const lines = a?.evidence.slice(-80) ?? [];
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length, selectedId]);
  const lastUser = session?.chat.filter((m) => m.from === 'user').at(-1)?.text;
  const task = a?.role === 'manager' ? lastUser : a?.task;
  const expr = a ? expressionOf(a) : undefined;
  return (
    <section className="panel" aria-labelledby="console-h">
      <div className="panel-head"><IconConsole size={22} /><span id="console-h">{t.console}</span><span className="sub">{t.selectAgentHint}</span><MaxToggle on={max} onToggle={onMax} lang={lang} /></div>
      <div className="agent-select">
        <label className="sr-only" htmlFor="agent-pick">{t.agent}</label>
        <select id="agent-pick" value={a?.id ?? MANAGER_ID} onChange={(e) => onSelect(e.target.value)}>
          {ids.map((id) => {
            const x = session?.agents[id];
            if (!x) return null;
            return <option key={id} value={id}>{displayName(x, lang) + ' — ' + statusText[lang][x.status]}</option>;
          })}
        </select>
      </div>
      <div className="console-body">
        <div className="facts">
          <div>
            <div className="k">{t.currentTask}</div>
            <div className="v">{task ?? '—'}</div>
          </div>
          {a && a.role === 'subagent' ? (
            <div>
              <div className="k">agent_type</div>
              <code className="v">{a.agentType || '(unknown)'}</code>
            </div>
          ) : null}
          {a ? (
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
          ) : null}
          {expr?.bubble && a && a.status !== 'completed' && a.status !== 'failed' ? (
            <div>
              <div className="k">{t.activity}</div>
              <div className="v">{bubbleText[lang][expr.bubble.key]}{a.activityDetail ? ` · ${a.activityDetail}` : ''}</div>
            </div>
          ) : null}
        </div>
        <div className="log" ref={logRef} role="log" aria-label={t.console}>
          {lines.length === 0 ? <div className="row t">{t.noEvents}</div> : null}
          {lines.map((l, i) => (
            <div key={l.eventId + i} className={`row ${i === lines.length - 1 ? 'last' : l.tone}`}>
              <span className="t">{hhmmss(l.at)}</span>
              {l.text}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
