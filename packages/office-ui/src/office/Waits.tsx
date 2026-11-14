// Permission waits, as rows: who waits and since when, each with "hide this wait".
//
// Why the button exists: when the user refuses a prompt, Claude Code sends no hook. Office then cannot know that
// the prompt is gone, and the wait would stay on the page until some later event. The time is a fact (when the
// request arrived); nothing is hidden or changed by itself as time passes. Hiding is the user's act: it changes
// the Office page only, sends nothing to Claude Code, and records neither "allowed" nor "refused".
import { useEffect, useState } from 'react';
import { MANAGER_ID, type SessionState } from '@onecarat/domain';
import { dict, displayName, sinceText, type Lang } from '../i18n.ts';

export interface WaitItem {
  sessionId: string;
  /** Absent = the manager. */
  agentId?: string;
  who: string;
  /** When the (oldest open) request arrived. */
  at: number;
  /** What was asked for (tool and its short detail), when known. */
  what?: string;
}

export type HideWait = (sessionId: string, agentId: string | undefined) => void;

/** The current time, refreshed now and then (elapsed times on the page). */
export function useNow(everyMs = 10_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(iv);
  }, [everyMs]);
  return now;
}

/** Everyone of a session who is shown as waiting for permission, the manager first. */
export function waitsOf(session: SessionState | undefined, lang: Lang): WaitItem[] {
  if (!session) return [];
  return [MANAGER_ID, ...session.order]
    .map((id) => session.agents[id])
    .filter((a) => a?.status === 'waiting_permission')
    .map((a) => ({ sessionId: session.id, agentId: a!.role === 'manager' ? undefined : a!.id, who: displayName(a!, lang), at: a!.waits?.[0]?.at ?? a!.updatedAt, what: a!.waits?.[0]?.toolName }));
}

export function WaitRows({ items, lang, onHide, className }: { items: WaitItem[]; lang: Lang; onHide?: HideWait; className?: string }) {
  const t = dict[lang];
  const now = useNow();
  if (!items.length) return null;
  return (
    <ul className={`wait-rows${className ? ` ${className}` : ''}`}>
      {items.map((w) => (
        <li key={`${w.sessionId}/${w.agentId ?? ''}/${w.at}`}>
          <span className="wait-text" title={w.what}>{t.waitRow.replace('{who}', w.who).replace('{since}', sinceText(lang, w.at, now))}{w.what ? <span className="wait-what"> · {w.what}</span> : null}</span>
          {onHide ? <button className="btn wait-hide" title={t.waitHideNote} onClick={() => onHide(w.sessionId, w.agentId)}>{t.waitHide}</button> : null}
        </li>
      ))}
    </ul>
  );
}
