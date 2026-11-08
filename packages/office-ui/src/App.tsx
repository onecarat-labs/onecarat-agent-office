import { useCallback, useEffect, useState } from 'react';
import { MANAGER_ID, type SessionState } from '@onecarat/domain';
import { useLiveFeed } from './live/useLiveFeed.ts';
import { useTerminal } from './live/useTerminal.ts';
import { authHeaders } from './live/token.ts';
import { Stage, useStageKeyboard } from './office/Stage.tsx';
import { ChatPanel, ConsolePanel } from './panels.tsx';
import { useDemoPlayer } from './demo/useDemoPlayer.ts';
import { IconHome, IconPause, IconPlay, IconRestart, IconSessions, IconSettings, LogoMark } from './icons.tsx';
import { detectLang, dict, type Lang } from './i18n.ts';

type Theme = 'system' | 'light' | 'dark';
type Motion = 'system' | 'reduce' | 'full';

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
  const [popover, setPopover] = useState<'none' | 'settings' | 'sessions'>('none');
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
  const liveOk = !isDemo && (live.status === 'connected' || live.status === 'reconnecting');
  const term = useTerminal(liveOk);

  const [pinnedSession, setPinnedSession] = useState<string | undefined>(undefined);
  const sessionsByActivity = [...state.sessionOrder].sort((a, b) => lastActivity(state.sessions[b]) - lastActivity(state.sessions[a]));
  // Auto-follow prefers the session running in the built-in terminal (ask and watch on one screen).
  const embedded = liveOk && term.state?.sessionId && state.sessions[term.state.sessionId] ? term.state.sessionId : undefined;
  const sessionId = pinnedSession && state.sessions[pinnedSession] ? pinnedSession : embedded ?? sessionsByActivity[0];
  const cwds = [...new Set([term.state?.cwd, ...sessionsByActivity.map((id) => state.sessions[id]?.cwd)].filter((c): c is string => !!c))];
  const session = sessionId ? state.sessions[sessionId] : undefined;

  const [selectedId, setSelectedId] = useState<string>(MANAGER_ID);
  const onSelect = useCallback((id: string) => setSelectedId(id), []);
  useEffect(() => {
    if (session && !session.agents[selectedId]) setSelectedId(MANAGER_ID);
  }, [session, selectedId]);
  const onStageKey = useStageKeyboard(session, selectedId, onSelect);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') delete root.dataset.theme;
    else root.dataset.theme = theme;
    save('office.theme', theme);
  }, [theme]);
  useEffect(() => save('office.motion', motionPref), [motionPref]);
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
              {live.status === 'connected' ? t.liveChip : live.status === 'reconnecting' ? t.reconnecting : live.status === 'locked' ? t.lockedChip : t.offline}
            </span>
          </>
        )}
      </header>

      <nav className="rail" aria-label="Main">
        <button className="iconbtn active" aria-current="page" aria-label={t.office} title={t.office} onClick={() => setPopover('none')}><IconHome size={22} /></button>
        <button className="iconbtn" aria-expanded={popover === 'sessions'} aria-label={t.sessions} title={t.sessions} onClick={() => setPopover(popover === 'sessions' ? 'none' : 'sessions')}><IconSessions size={22} /></button>
        <button className="iconbtn" aria-expanded={popover === 'settings'} aria-label={t.settings} title={t.settings} onClick={() => setPopover(popover === 'settings' ? 'none' : 'settings')}><IconSettings size={22} /></button>
      </nav>

      {popover === 'settings' ? (
        <div className="popover" role="dialog" aria-label={t.settings} style={{ top: 64 + 48 * 2 }}>
          <h3>{t.settings}</h3>
          <label>{t.theme}
            <select value={theme} onChange={(e) => setTheme(e.target.value as Theme)}>
              <option value="system">{t.system}</option><option value="light">{t.light}</option><option value="dark">{t.dark}</option>
            </select>
          </label>
          <label>{t.motion}
            <select value={motionPref} onChange={(e) => setMotionPref(e.target.value as Motion)}>
              <option value="system">{t.system}</option><option value="reduce">{t.reduce}</option><option value="full">{t.full}</option>
            </select>
          </label>
          <label>{t.language}
            <select value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
              <option value="ja">日本語</option><option value="en">English</option>
            </select>
          </label>
          <p>{t.highFiveNote}</p>
        </div>
      ) : null}
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
          {!isDemo ? (
            <button className="sess-item" onClick={() => void fetch('/api/clear', { method: 'POST', headers: authHeaders() })}>{t.clearHistory}</button>
          ) : null}
        </div>
      ) : null}

      <main className="main">
        <div className="stage" onKeyDown={onStageKey}>
          <div className="stage-scroll"><Stage session={session} selectedId={selectedId} onSelect={onSelect} motion={motion} lang={lang} demo={isDemo} /></div>
          {isDemo ? <div className="demo-ribbon">{t.demoRibbon}</div> : null}
          {!isDemo && live.status === 'locked' ? <div className="live-waiting">{t.locked}</div> : null}
          {!isDemo && live.status !== 'locked' && !session ? <div className="live-waiting">{t.liveWaiting}</div> : null}
        </div>
        <div className="bottom">
          <ChatPanel session={session} lang={lang} term={liveOk ? term : undefined} cwds={cwds} termMode={term.state?.sessionId ? state.sessions[term.state.sessionId]?.permissionMode : undefined} />
          <ConsolePanel session={session} selectedId={selectedId} onSelect={onSelect} lang={lang} />
        </div>
      </main>
    </div>
  );
}
