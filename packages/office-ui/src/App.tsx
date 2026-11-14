import { useCallback, useEffect, useRef, useState } from 'react';
import type { SessionState } from '@onecarat/domain';
import { useLiveFeed } from './live/useLiveFeed.ts';
import { useTerminal } from './live/useTerminal.ts';
import { authHeaders } from './live/token.ts';
import { FAREWELL_MS, Stage, useStageKeyboard } from './office/Stage.tsx';
import { StageStatus } from './office/TaskBoard.tsx';
import { ConsolePanel, MaxToggle, OVERVIEW, SPLIT_MAX, SPLIT_MIN, Splitter, TerminalPanel } from './panels.tsx';
import { useDemoPlayer } from './demo/useDemoPlayer.ts';
import { useResearch } from './live/useResearch.ts';
import { ModeSwitch, ResearchLab, type ViewMode } from './research/ResearchLab.tsx';
import { IconHome, IconPause, IconPlay, IconRestart, IconSessions, IconSettings, LogoMark } from './icons.tsx';
import { FONT_SCALE_DEFAULT, FONT_SCALE_MAX, FONT_SCALE_MIN, TERM_SCALE_MAX, TERM_SCALE_MIN, SettingsView, type Motion, type Theme } from './config/SettingsView.tsx';
import { detectLang, dict, type Lang } from './i18n.ts';

type Pane = 'stage' | 'terminal' | 'console';

function load<T extends string>(key: string, fallback: T): T {
  try {
    return (localStorage.getItem(key) as T | null) ?? fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* storage unavailable: keep in memory only */
  }
}

/** A stored number, or the fallback when missing, unreadable or out of range. */
function loadNum(key: string, fallback: number, min: number, max: number): number {
  const raw = load<string>(key, '');
  const v = Number(raw);
  return raw !== '' && Number.isFinite(v) && v >= min && v <= max ? v : fallback;
}

// Default sizes of the three areas: the office takes 1.25 of 2.25 of the height, terminal and console share the width.
const STAGE_SPLIT_DEFAULT = 1.25 / 2.25;
const TERM_SPLIT_DEFAULT = 0.5;

function lastActivity(s: SessionState | undefined): number {
  if (!s) return 0;
  let t = s.startedAt;
  for (const a of Object.values(s.agents)) t = Math.max(t, a.updatedAt);
  return t;
}

function sessionLabel(s: SessionState): string {
  const dir = s.cwd ? s.cwd.split(/[\\/]/).filter(Boolean).at(-1) : undefined;
  return `${dir ?? 'session'} · ${s.id.slice(0, 8)}`;
}

function useSystemReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return;
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

export function App() {
  const [lang, setLang] = useState<Lang>(() => load<Lang>('office.lang', detectLang()));
  const [theme, setTheme] = useState<Theme>(() => load<Theme>('office.theme', 'system'));
  const [motionPref, setMotionPref] = useState<Motion>(() => load<Motion>('office.motion', 'system'));
  // Sizes the user set with the mouse (borders between the three areas) and the text size; kept in this browser.
  const [stageSplit, setStageSplit] = useState(() => loadNum('office.split.stage', STAGE_SPLIT_DEFAULT, SPLIT_MIN, SPLIT_MAX));
  const [termSplit, setTermSplit] = useState(() => loadNum('office.split.terminal', TERM_SPLIT_DEFAULT, SPLIT_MIN, SPLIT_MAX));
  const [fontScale, setFontScale] = useState(() => loadNum('office.fontScale', FONT_SCALE_DEFAULT, FONT_SCALE_MIN, FONT_SCALE_MAX));
  // The built-in terminal has its own text size. Until it is set, it starts from the general one (which also
  // sized the terminal up to 0.2.10), so nobody's terminal changes size on update.
  const [termScale, setTermScale] = useState(() => loadNum('office.termScale', fontScale, TERM_SCALE_MIN, TERM_SCALE_MAX));
  const layoutCustom = stageSplit !== STAGE_SPLIT_DEFAULT || termSplit !== TERM_SPLIT_DEFAULT;
  const resetLayout = useCallback(() => { setStageSplit(STAGE_SPLIT_DEFAULT); setTermSplit(TERM_SPLIT_DEFAULT); }, []);
  const [popover, setPopover] = useState<'none' | 'sessions'>('none');
  // Main area: the office, or the settings view (Office display + Claude Code configuration). The office stays
  // mounted (the terminal keeps its session).
  const [view, setView] = useState<'office' | 'settings'>('office');
  // One pane may fill the main area. Hidden panes stay mounted (the terminal keeps its session).
  const [maxPane, setMaxPane] = useState<Pane | undefined>(undefined);
  const toggleMax = (p: Pane) => setMaxPane((cur) => (cur === p ? undefined : p));
  const sysReduced = useSystemReducedMotion();
  const motion = motionPref === 'full' ? true : motionPref === 'reduce' ? false : !sysReduced;
  const t = dict[lang];

  // Data source: live (bridge) unless the user explicitly picks the demo, or no bridge is reachable.
  const [demoChosen, setDemoChosen] = useState(false);
  const live = useLiveFeed(true);
  const isDemo = demoChosen || live.status === 'unavailable';
  const demo = useDemoPlayer(isDemo);
  const { paused, setPaused, restart } = demo;
  const state = isDemo ? demo.state : live.state;
  // stopped: Office was stopped (by "stop", or because Claude Code in the built-in terminal ended). The last scene
  // stays on screen — the goodbye keeps playing — but nothing reconnects.
  const stopped = !isDemo && live.status === 'stopped';
  const liveOk = !isDemo && (live.status === 'connected' || live.status === 'reconnecting' || stopped);
  const term = useTerminal(liveOk && !stopped);
  // Research Lab: another view of the same Claude Code session (the manager and its researchers); its state is in
  // the bridge. Switching the view only changes what is shown: nothing is started, stopped or reset by it.
  const [mode, setMode] = useState<ViewMode>('office');
  const research = useResearch(liveOk && !stopped);
  const researchSid = research.info?.current?.sessionId;
  const researchSession = researchSid ? state.sessions[researchSid] : undefined;

  // ---- the two automatic view changes of a research started from the page (never more than these) ----
  //   1. after "Start research" pasted the command: to the Office view, where Enter is pressed;
  //   2. after the researchers have appeared there: back to the Research Lab.
  // If a permission request is open at that moment (no hook has closed it; hiding it on the page does not count),
  // 2 is not made: a button is shown instead. The page never
  // moves from the Research Lab to the Office view by itself. Once the user changes the view by hand, nothing
  // is switched automatically for that research any more.
  const auto = useRef<{ id?: string; step: 'armed' | 'return' | 'off' }>({ step: 'off' });
  const [heldFor, setHeldFor] = useState<string | undefined>(undefined);
  const showMode = useCallback((m: ViewMode) => {
    // A pane filling the whole area would hide what the other view is for.
    setMaxPane((cur) => (m === 'research' && cur !== 'stage' ? undefined : cur));
    setMode(m);
  }, []);
  const userMode = useCallback((m: ViewMode) => {
    auto.current = { step: 'off' };
    setHeldFor(undefined);
    showMode(m);
  }, [showMode]);
  const onStartPressed = useCallback(() => { auto.current = { step: 'armed' }; setHeldFor(undefined); }, []);
  const rc = research.info?.current;
  const rcRef = useRef(rc);
  rcRef.current = rc;
  const termWaitsRef = useRef(0);
  // Every request no hook has closed counts, also one the user hid on the page: hiding is not evidence.
  termWaitsRef.current = research.info?.terminal.unresolved ?? research.info?.terminal.waits?.length ?? 0;
  const rcId = rc?.id;
  const rcStatus = rc?.status;
  const rcPasted = !!rc?.pasted;
  const rcPeople = rc?.researchers.length ?? 0;
  useEffect(() => {
    const a = auto.current;
    if (!rcId || a.step === 'off') return;
    if (a.step === 'armed') {
      if (rcRef.current?.origin !== 'button' || rcStatus !== 'awaiting-enter') return;
      // Not pasted: the command is shown in the Research Lab for copying, so the view stays there.
      if (!rcPasted) { auto.current = { step: 'off' }; return; }
      auto.current = { id: rcId, step: 'return' };
      showMode('office');
      return;
    }
    if (a.id !== rcId || (rcStatus !== 'awaiting-enter' && rcStatus !== 'researching')) { auto.current = { step: 'off' }; return; }
    if (rcStatus !== 'researching' || rcPeople === 0) return;
    // The researchers walk in and sit down first (the timer starts again when another one appears).
    const tm = setTimeout(() => {
      if (auto.current.step !== 'return' || auto.current.id !== rcId) return;
      auto.current = { step: 'off' };
      if ((rcRef.current?.unresolved ?? rcRef.current?.waiting.length ?? 0) > 0 || termWaitsRef.current > 0) setHeldFor(rcId);
      else showMode('research');
    }, motion ? 4500 : 1200);
    return () => clearTimeout(tm);
  }, [rcId, rcStatus, rcPasted, rcPeople, motion, showMode]);
  const returnHeld = !!heldFor && heldFor === rcId;

  const [pinnedSession, setPinnedSession] = useState<string | undefined>(undefined);
  // Goodbye after "Stop Claude Code": keeps the stage on the session that was shown while the figures bow and wave.
  const [farewell, setFarewell] = useState<{ at: number; sessionId?: string } | undefined>(undefined);
  useEffect(() => {
    if (!farewell) return;
    const tm = setTimeout(() => setFarewell(undefined), FAREWELL_MS);
    return () => clearTimeout(tm);
  }, [farewell]);
  const sessionsByActivity = [...state.sessionOrder].sort((a, b) => lastActivity(state.sessions[b]) - lastActivity(state.sessions[a]));
  // Auto-follow prefers the session running in the built-in terminal (ask and watch on one screen).
  const embedded = liveOk && term.state?.sessionId && state.sessions[term.state.sessionId] ? term.state.sessionId : undefined;
  const held = farewell?.sessionId && state.sessions[farewell.sessionId] ? farewell.sessionId : undefined;
  const sessionId = held ?? (pinnedSession && state.sessions[pinnedSession] ? pinnedSession : embedded ?? sessionsByActivity[0]);
  const cwds = [...new Set([term.state?.cwd, ...sessionsByActivity.map((id) => state.sessions[id]?.cwd)].filter((c): c is string => !!c))];
  const session = sessionId ? state.sessions[sessionId] : undefined;

  // Goodbye triggers: the Stop button, the built-in claude ending normally (/exit), and a SessionEnd of the shown
  // session from any terminal (except /clear, which ends and restarts the conversation). One goodbye per session
  // within a short window, so a stop followed by its SessionEnd does not bow twice.
  const lastGoodbye = useRef(new Map<string, number>());
  const sayGoodbye = useCallback((sid: string | undefined) => {
    const now = Date.now();
    const key = sid ?? '';
    if (now - (lastGoodbye.current.get(key) ?? 0) < FAREWELL_MS + 5000) return;
    lastGoodbye.current.set(key, now);
    setFarewell({ at: now, sessionId: sid });
  }, []);
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  const termRunning = !!term.state?.running;
  const termExit = term.state?.exitCode;
  // "Continue" / "pick a past session" that ended before a conversation opened (nothing to continue, picker
  // closed) is not a goodbye: no session ran in the terminal.
  const termHadSession = !term.state?.mode || term.state.mode === 'new' || !!term.state.sessionId;
  const termHadSessionRef = useRef(termHadSession);
  termHadSessionRef.current = termHadSession;
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !termRunning && termExit === 0 && termHadSessionRef.current) sayGoodbye(sessionIdRef.current);
    wasRunning.current = termRunning;
  }, [termRunning, termExit, sayGoodbye]);
  // The shown session is over: SessionEnd seen (not /clear), or it ran in the built-in terminal that has stopped
  // (a stop from the button may end claude before its SessionEnd hook is delivered).
  const sessionOver = !isDemo && !!session && ((session.endedAt !== undefined && session.endReason !== 'clear') || (liveOk && !!term.state && !term.state.running && term.state.sessionId === session.id));
  const endedAt = isDemo ? undefined : session?.endedAt;
  const endReason = session?.endReason;
  useEffect(() => {
    if (endedAt === undefined || endReason === 'clear') return;
    if (Date.now() - endedAt > 5000) return; // history replayed on (re)connect, not a fresh exit
    sayGoodbye(sessionIdRef.current);
  }, [endedAt, endReason, sayGoodbye]);

  // Nobody selected = the console shows the whole session. A click on a figure selects it; a second click on
  // the same figure goes back to the overview.
  const [selectedId, setSelectedId] = useState<string>(OVERVIEW);
  const onSelect = useCallback((id: string) => setSelectedId(id), []);
  const onFigure = useCallback((id: string) => setSelectedId((cur) => (cur === id ? OVERVIEW : id)), []);
  useEffect(() => {
    if (selectedId !== OVERVIEW && session && !session.agents[selectedId]) setSelectedId(OVERVIEW);
  }, [session, selectedId]);
  const onStageKey = useStageKeyboard(session, selectedId, onSelect);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') delete root.dataset.theme;
    else root.dataset.theme = theme;
    save('office.theme', theme);
  }, [theme]);
  useEffect(() => save('office.motion', motionPref), [motionPref]);
  useEffect(() => save('office.split.stage', String(stageSplit)), [stageSplit]);
  useEffect(() => save('office.split.terminal', String(termSplit)), [termSplit]);
  useEffect(() => {
    document.documentElement.style.setProperty('--fs', String(fontScale));
    save('office.fontScale', String(fontScale));
  }, [fontScale]);
  useEffect(() => save('office.termScale', String(termScale)), [termScale]);
  useEffect(() => {
    save('office.lang', lang);
    document.documentElement.lang = lang;
  }, [lang]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPopover('none');
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const motionClass = motionPref === 'reduce' ? 'reduce-motion' : motionPref === 'system' ? 'motion-auto' : '';

  return (
    <div className={`app ${motionClass}`}>
      <header className="topbar">
        <div className="brand"><LogoMark /><span>Onecarat Agent Office <span className="full">CC</span></span></div>
        <div className="sep" />
        <div className="tagline">{t.tagline}</div>
        <div className="spacer" />
        {isDemo ? (
          <>
            <span className="chip demo" title={t.demoRibbon}><span className="dot" />{t.demoChip}</span>
            <button className="iconbtn" onClick={() => setPaused(!paused)} aria-label={paused ? t.resume : t.pause} title={paused ? t.resume : t.pause}>
              {paused ? <IconPlay size={18} /> : <IconPause size={18} />}
            </button>
            <button className="iconbtn" onClick={restart} aria-label={t.replay} title={t.replay}><IconRestart size={18} /></button>
          </>
        ) : (
          <>
            {session ? <span className="chip" title={session.id}>{sessionLabel(session)}</span> : null}
            <span className={`chip ${live.status === 'connected' ? 'live' : 'demo'}`}>
              <span className="dot" />
              {live.status === 'connected' ? t.liveChip : live.status === 'reconnecting' ? t.reconnecting : live.status === 'locked' ? t.lockedChip : stopped ? t.stoppedChip : t.offline}
            </span>
          </>
        )}
      </header>

      <nav className="rail" aria-label="Main">
        <button className={`iconbtn${view === 'office' ? ' active' : ''}`} aria-current={view === 'office' ? 'page' : undefined} aria-label={t.office} title={t.office} onClick={() => { setPopover('none'); setView('office'); }}><IconHome size={22} /></button>
        <button className="iconbtn" aria-expanded={popover === 'sessions'} aria-label={t.sessions} title={t.sessions} onClick={() => setPopover(popover === 'sessions' ? 'none' : 'sessions')}><IconSessions size={22} /></button>
        <button className={`iconbtn${view === 'settings' ? ' active' : ''}`} aria-current={view === 'settings' ? 'page' : undefined} aria-label={t.settings} title={t.settings} onClick={() => { setPopover('none'); setView('settings'); }}><IconSettings size={22} /></button>
      </nav>

      {popover === 'sessions' ? (
        <div className="popover" role="dialog" aria-label={t.sessions} style={{ top: 64 + 48 }}>
          <h3>{t.sessions}</h3>
          {live.status !== 'unavailable' ? (
            <label>
              <span>{isDemo ? t.demoSource : t.liveSource}</span>
              <select value={isDemo ? 'demo' : 'live'} onChange={(e) => { setDemoChosen(e.target.value === 'demo'); setPinnedSession(undefined); }}>
                <option value="live">{t.liveSource}</option>
                <option value="demo">{t.demoSource}</option>
              </select>
            </label>
          ) : null}
          <button className="sess-item" aria-current={!pinnedSession} onClick={() => setPinnedSession(undefined)}>{t.autoFollow}</button>
          {sessionsByActivity.map((id) => {
            const s = state.sessions[id]!;
            return (
              <button key={id} className="sess-item" aria-current={pinnedSession === id} onClick={() => setPinnedSession(id)} title={id}>
                {s.source === 'demo' ? `${t.demoChip} — ` : ''}{sessionLabel(s)}{s.endedAt ? ` (${t.ended})` : ''}
              </button>
            );
          })}
          {state.sessionOrder.length === 0 ? <p>{t.noSession}</p> : null}
          <p>{t.sessionsNote}</p>
          {!isDemo && !stopped ? (
            <button className="sess-item" onClick={() => void fetch('/api/clear', { method: 'POST', headers: authHeaders() })}>{t.clearHistory}</button>
          ) : null}
        </div>
      ) : null}

      {view === 'settings' ? <SettingsView lang={lang} setLang={setLang} theme={theme} setTheme={setTheme} motion={motionPref} setMotion={setMotionPref} fontScale={fontScale} setFontScale={setFontScale} termScale={termScale} setTermScale={setTermScale} layout={{ stage: stageSplit, terminal: termSplit, custom: layoutCustom }} resetLayout={resetLayout} cwds={cwds} live={liveOk && !stopped} /> : null}
      <main className={`main view-${mode}${maxPane ? ` max-${maxPane}` : ''}${view === 'settings' ? ' hidden' : ''}`} style={{ '--stage-fr': `${stageSplit * 100}fr`, '--bottom-fr': `${(1 - stageSplit) * 100}fr`, '--term-fr': `${termSplit * 100}fr`, '--console-fr': `${(1 - termSplit) * 100}fr` } as React.CSSProperties}>
        <div className={`stage mode-${mode}`} onKeyDown={mode === 'office' ? onStageKey : undefined}>
          <ModeSwitch mode={mode} setMode={userMode} lang={lang} research={research} held={returnHeld} />
          <ResearchLab research={research} session={researchSession} termSession={term.state?.sessionId ? state.sessions[term.state.sessionId] : undefined} lang={lang} motion={motion} live={liveOk && !stopped} goOffice={() => userMode('office')} onStartPressed={onStartPressed} />
          {mode === 'office' ? <MaxToggle on={maxPane === 'stage'} onToggle={() => toggleMax('stage')} lang={lang} className="stage-max" /> : null}
          <StageStatus session={session} lang={lang} selectedId={selectedId} onPick={onSelect} onHide={isDemo || stopped ? undefined : research.hideWait} />
          <div className="stage-scroll"><Stage session={session} selectedId={selectedId} onSelect={onFigure} motion={motion} lang={lang} demo={isDemo} farewellAt={farewell?.at} ended={sessionOver} /></div>
          {isDemo ? <div className="demo-ribbon">{t.demoRibbon}</div> : null}
          {!isDemo && live.status === 'locked' ? <div className="live-waiting">{t.locked}</div> : null}
          {!isDemo && live.status !== 'locked' && !stopped && !session ? <div className="live-waiting">{t.liveWaiting}</div> : null}
          {stopped ? (
            <div className="office-stopped" role="status">
              {live.stopReason === 'claude-ended' ? t.stoppedClaudeEnded : t.stoppedByStop} {t.stoppedRestart}
            </div>
          ) : null}
        </div>
        <Splitter orientation="horizontal" value={stageSplit} onChange={setStageSplit} onReset={() => setStageSplit(STAGE_SPLIT_DEFAULT)} label={t.splitRows} />
        <div className="bottom">
          {/* One terminal, shown in the Office view only (it stays mounted in the Research Lab view, so its session goes on): Enter and every permission answer are the user's, here. */}
          <TerminalPanel fontScale={termScale} setFontScale={setTermScale} session={session} lang={lang} term={liveOk ? term : undefined} cwds={cwds} termMode={term.state?.sessionId ? state.sessions[term.state.sessionId]?.permissionMode : undefined} max={maxPane === 'terminal'} onMax={() => toggleMax('terminal')} onStop={() => { if (termHadSession) sayGoodbye(sessionId); }} officeStopped={stopped} />
          <Splitter orientation="vertical" value={termSplit} onChange={setTermSplit} onReset={() => setTermSplit(TERM_SPLIT_DEFAULT)} label={t.splitCols} />
          <ConsolePanel session={session} selectedId={selectedId} onSelect={onSelect} lang={lang} max={maxPane === 'console'} onMax={() => toggleMax('console')} />
        </div>
      </main>
    </div>
  );
}
