// The office's status chip (top right of the stage) and the task list it opens. The list used to be drawn inside
// the office picture all the time; it is now shown on request so the picture stays clear.
import { useEffect, useRef, useState } from 'react';
import { MANAGER_ID, summarize, type AgentState, type SessionState } from '@onecarat/domain';
import { IconChevronDown } from '../icons.tsx';
import { dict, displayName, statusText, type Lang } from '../i18n.ts';
import { WaitRows, waitsOf, type HideWait } from './Waits.tsx';

/** Status mark of one agent: shape and color together (never color alone). */
export function StatusGlyph({ a }: { a: AgentState }) {
  let mark: React.ReactNode;
  if (a.status === 'completed' && a.outcome === 'success_estimated') mark = <path d="M3 10.5 l4.5 4.5 l8 -10" style={{ stroke: 'var(--ok)' }} />;
  else if (a.status === 'completed') mark = <circle cx={9.5} cy={10} r={6} style={{ stroke: 'var(--muted)' }} />;
  else if (a.status === 'failed') mark = <path d="M4 4.5 l11 11 M15 4.5 l-11 11" style={{ stroke: 'var(--danger)' }} />;
  else if (a.status === 'waiting_permission' || a.status === 'blocked') mark = <g style={{ stroke: 'var(--warn)' }}><circle cx={9.5} cy={10} r={7} /><path d="M9.5 6 v4 l3 2" strokeWidth={2} /></g>;
  else if (a.status === 'idle' || a.status === 'unknown') mark = <circle cx={9.5} cy={10} r={2.5} style={{ stroke: 'var(--muted)' }} />;
  else mark = <circle cx={9.5} cy={10} r={7} className="spinner" style={{ stroke: 'var(--accent)', strokeDasharray: '3 3.2' }} />;
  return (
    <svg className="glyph" width={19} height={20} viewBox="0 0 19 20" fill="none" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {mark}
    </svg>
  );
}

export function StageStatus({ session, lang, selectedId, onPick, onHide }: { session?: SessionState; lang: Lang; selectedId: string; onPick: (id: string) => void; onHide?: HideWait }) {
  const t = dict[lang];
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const summary = session ? summarize(session) : { active: 0, completed: 0, failed: 0 };
  const rows = (session?.order ?? []).map((id) => session!.agents[id]).filter((a): a is AgentState => !!a);
  // Someone is waiting for the user's answer in Claude Code: never folded away with the list.
  const waiting = [session?.agents[MANAGER_ID], ...rows].filter((a) => a?.status === 'waiting_permission').length;
  return (
    <div className="stage-status" ref={box}>
      <button className={`status-chip${waiting ? ' warn' : ''}`} aria-expanded={open} aria-haspopup="true" aria-label={t.boardOpen} title={t.boardOpen} onClick={() => setOpen(!open)}>
        <span>{summary.active} {t.active} / {summary.completed} {t.completed}{summary.failed ? <b className="bad"> / {summary.failed} {t.failed}</b> : null}</span>
        {waiting ? <b className="wait">{t.waitingCount.replace('{n}', String(waiting))}</b> : null}
        <IconChevronDown size={16} />
      </button>
      {/* Who waits and since when; a wait whose prompt is long gone (refused: no hook) can be hidden by the user. */}
      <WaitRows items={waitsOf(session, lang)} lang={lang} onHide={onHide} />
      {open ? (
        <div className="task-pop" role="dialog" aria-label={t.board}>
          <h3>{t.board}</h3>
          {rows.length === 0 ? <p>{t.boardEmpty}</p> : null}
          <div className="task-list">
            {rows.map((a) => (
              <button key={a.id} className="task-row" aria-current={selectedId === a.id} title={a.task} onClick={() => { onPick(a.id); setOpen(false); }}>
                <StatusGlyph a={a} />
                <span className="what">{a.task || displayName(a, lang)}</span>
                <span className="who">{displayName(a, lang)} · {statusText[lang][a.status]}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
