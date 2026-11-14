import { useCallback, useEffect, useRef, useState } from 'react';
import { authHeaders } from './token.ts';

/** Mirrors packages/event-bridge/src/research.ts and research-result.ts (the UI does not import Node code). */
export interface ResearchSource { title: string; url: string }
export interface ResearchCard {
  id: string;
  file: string;
  title: string;
  summary: string;
  details: string;
  findings: string[];
  sources: ResearchSource[];
  caveats: string[];
  status: 'completed' | 'partial' | 'failed';
  engine: string;
  at: number;
  /** Who wrote it (the agent id on the Write hook). Absent = not seen by this Office. */
  agentId?: string;
  /** The manager's check of this result, when there is one. */
  review?: { verdict: 'confirmed' | 'needs-check'; note: string };
}
export type ResearchStatus = 'awaiting-enter' | 'researching' | 'completed' | 'unconfirmed' | 'dismissed';
export type ResearcherStatus = 'working' | 'reported' | 'completed' | 'failed' | 'stopped';
export interface Researcher { agentId: string; n: number; status: ResearcherStatus; startedAt: number; updatedAt: number; cards: number }
export interface ResearchWaiting { agentId?: string; toolName: string; detail: string; at: number }
export interface ResearchRun {
  id: string;
  theme: string;
  requestedCount: number;
  requestedResearchers?: number;
  engine: string;
  dir: string;
  status: ResearchStatus;
  origin: 'button' | 'observed';
  /** The command line: pasted into the Office terminal, or shown for copying. */
  command?: string;
  pasted?: boolean;
  /** Why it was not pasted (no-terminal / not-started / waiting-permission / wait-unknown). */
  notPasted?: string;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  sessionId?: string;
  cards: ResearchCard[];
  errors: { file: string; reason: string }[];
  researchers: Researcher[];
  summary?: { saved?: number; missing?: number; reason: string; at: number };
  waiting: ResearchWaiting[];
  /** Requests of this research no hook has closed yet, including those hidden on the page. */
  unresolved?: number;
  restored?: boolean;
}
export interface ResearchInfo {
  cwd: string;
  root: string;
  inGit: boolean;
  counts: number[];
  defaultCount: number;
  researcherCounts: number[];
  defaultResearchers: number;
  command: string;
  researcherType: string;
  /** The Office terminal as hooks see it. permissionMode: the manager's, as last reported. */
  terminal: { available: boolean; running: boolean; sessionId?: string; started: boolean; waiting: boolean; waits?: ResearchWaiting[]; /** All requests no hook has closed, including those hidden on the page. */ unresolved?: number; permissionMode?: string };
  current?: ResearchRun;
  past: ResearchRun[];
}

/** A value from the bridge is data: anything that is not the expected shape is dropped, never rendered. */
function asInfo(v: unknown): ResearchInfo | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Partial<ResearchInfo>;
  if (typeof o.cwd !== 'string' || !Array.isArray(o.past) || !o.terminal) return undefined;
  return o as ResearchInfo;
}

/**
 * Research Lab state. It lives in the bridge, so it survives switching views and reloading the page; this hook
 * only asks for it (every second while a research runs, slowly otherwise).
 */
export function useResearch(enabled: boolean) {
  const [info, setInfo] = useState<ResearchInfo | undefined>(undefined);
  /** Why the last start was refused (a reason code from the bridge). */
  const [refused, setRefused] = useState<string | undefined>(undefined);
  const activeRef = useRef(false);
  const st = info?.current?.status;
  activeRef.current = st === 'awaiting-enter' || st === 'researching';

  const load = useCallback(async (refresh = false) => {
    try {
      const r = await fetch(`/api/research${refresh ? '?refresh=1' : ''}`, { headers: authHeaders(), cache: 'no-store' });
      if (!r.ok) return;
      const v = asInfo(await r.json());
      if (v) setInfo(v);
    } catch {
      /* bridge not reachable: keep what is shown */
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const loop = async () => {
      await load();
      if (!stop) timer = setTimeout(() => void loop(), activeRef.current ? 1000 : 4000);
    };
    void loop();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [enabled, load]);

  const post = useCallback(async (path: string, body?: unknown): Promise<void> => {
    try {
      const r = await fetch(path, { method: 'POST', headers: { ...authHeaders(), 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
      const j = (await r.json()) as unknown;
      if (r.ok) {
        setRefused(undefined);
        const v = asInfo(j);
        if (v) setInfo(v);
      } else setRefused(String((j as { error?: unknown } | null)?.error ?? 'failed'));
    } catch {
      setRefused('failed');
    }
  }, []);

  const start = useCallback((theme: string, count: number, researchers: number) => post('/api/research/start', { theme, count, researchers }), [post]);
  /** Drops a research that has not started. Nothing is written to the terminal. */
  const dismiss = useCallback(() => post('/api/research/dismiss'), [post]);
  const refresh = useCallback(() => load(true), [load]);
  /**
   * Hides one agent's permission wait on the page (a refused prompt sends no hook, so it would stay). Nothing is
   * sent to Claude Code and no prompt is answered. Display only: it does not make a paste or the automatic
   * return possible (only a hook closes a request).
   */
  const hideWait = useCallback((sessionId: string, agentId: string | undefined) => void post('/api/waits/dismiss', { sessionId, agentId }), [post]);
  return { info, refused, start, dismiss, refresh, hideWait };
}

export type ResearchLink = ReturnType<typeof useResearch>;
