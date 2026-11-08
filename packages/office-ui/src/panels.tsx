import { useEffect, useRef, useState } from 'react';
import { TerminalView } from './TerminalView.tsx';
import type { TerminalLink } from './live/useTerminal.ts';
import { MANAGER_ID, type AgentState, type SessionState } from '@onecarat/domain';
import { IconChat, IconConsole, IconSend, IconSmile, IconUser } from './icons.tsx';
import { dict, displayName, modeText, outcomeText, statusText, bubbleText, type Lang } from './i18n.ts';
import { expressionOf } from '@onecarat/domain';

const hhmm = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const hhmmss = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export function ChatPanel({ session, lang, term, cwds, termMode }: { session?: SessionState; lang: Lang; term?: TerminalLink; cwds: string[]; termMode?: string }) {
  const t = dict[lang];
  const termOk = !!term && term.state?.available !== false;
  const [tab, setTab] = useState<'terminal' | 'history'>('terminal');
  const showTerm = termOk && tab === 'terminal';
  return (
    <section className="panel" aria-labelledby="chat-h">
      <div className="panel-head">
        <IconChat size={22} />
        <span id="chat-h">{t.chat}</span>
        {termOk ? (
          <div className="tabs" role="tablist" aria-label={t.chat}>
            <button role="tab" aria-selected={tab === 'terminal'} onClick={() => setTab('terminal')}>{t.termTab}</button>
            <button role="tab" aria-selected={tab === 'history'} onClick={() => setTab('history')}>{t.historyTab}</button>
          </div>
        ) : null}
      </div>
      {showTerm ? <TerminalPane term={term!} lang={lang} cwds={cwds} mode={termMode} /> : <HistoryPane session={session} lang={lang} term={term} />}
    </section>
  );
}

function TerminalPane({ term, lang, cwds, mode }: { term: TerminalLink; lang: Lang; cwds: string[]; mode?: string }) {
  const t = dict[lang];
  const st = term.state;
  const [folder, setFolder] = useState('');
  const cur = st?.cwd ?? '';
  const others = cwds.filter((c) => c && c !== cur);
  const startIn = (dir?: string) => {
    if (st?.running && !window.confirm(t.termConfirmRestart)) return;
    if (st?.running) term.send({ t: 'stop' });
    term.send({ t: 'start', cwd: dir });
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
          <button className="btn" onClick={() => term.send({ t: 'stop' })}>{t.termStop}</button>
        ) : (
          <button className="btn primary" disabled={term.link !== 'open'} onClick={() => startIn()}>{t.termStart}</button>
        )}
        <details className="term-other">
          <summary>{t.termFolderPick}</summary>
          <div className="term-other-body">
            {others.map((c) => (
              <button key={c} className="sess-item" title={c} onClick={() => startIn(c)}>{c}</button>
            ))}
            <form onSubmit={(e) => { e.preventDefault(); if (folder.trim()) startIn(folder.trim()); }}>
              <input value={folder} onChange={(e) => setFolder(e.target.value)} placeholder={'C:\\path\\to\\project'} aria-label={t.termFolder} />
              <button className="btn" type="submit" disabled={!folder.trim()}>{t.termRestart}</button>
            </form>
          </div>
        </details>
      </div>
      {st?.reason && !st.running ? <div className="term-note warn">{st.reason}</div> : null}
      {st && !st.running && st.exitCode !== undefined ? <div className="term-note">{t.termExited.replace('{code}', String(st.exitCode))}</div> : null}
      {term.link !== 'open' ? <div className="term-note">{t.termConnecting}</div> : null}
      <TerminalView term={term} label={t.termTab} />
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

export function ConsolePanel({ session, selectedId, onSelect, lang }: { session?: SessionState; selectedId: string; onSelect: (id: string) => void; lang: Lang }) {
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
      <div className="panel-head"><IconConsole size={22} /><span id="console-h">{t.console}</span><span className="sub">{t.selectAgentHint}</span></div>
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
