import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { currentEpoch, tellApp, useSession } from './feed.ts';
import { detectLang, dict } from './i18n.ts';
import { FAREWELL_MS, Stage } from './office/Stage.tsx';
import { folderName, stageLayout, timeOfDay, type TimeOfDay } from './scene.ts';

/** The PC's local time of day. Checked again and again, so the background changes while the window stays open. */
function useTimeOfDay(): TimeOfDay {
  const [tod, setTod] = useState<TimeOfDay>(() => timeOfDay(new Date().getHours()));
  useEffect(() => {
    const iv = setInterval(() => setTod(timeOfDay(new Date().getHours())), 15_000);
    return () => clearInterval(iv);
  }, []);
  return tod;
}

function useWindowSize(): { width: number; height: number } {
  const [size, setSize] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  useEffect(() => {
    const on = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return size;
}

function useMotion(): boolean {
  const [motion, setMotion] = useState(() => !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return;
    const on = () => setMotion(!mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return motion;
}

/**
 * After the goodbye the window closes by itself. When a new session starts in the same folder before that
 * (/clear, a quick restart), the app gives this window to it instead and the goodbye is dropped.
 */
const CLOSE_AFTER_MS = FAREWELL_MS + 1500;

export function App() {
  const lang = detectLang();
  const t = dict[lang];
  const session = useSession();
  const tod = useTimeOfDay();
  const motion = useMotion();
  const size = useWindowSize();
  const { w, capacity } = stageLayout(size.width, size.height);

  // Night uses the dark colours, so the figures stay readable in front of the night sky.
  useLayoutEffect(() => {
    document.documentElement.dataset.tod = tod;
    document.documentElement.lang = lang;
  }, [tod, lang]);

  const waiting = !!session && !session.endedAt && Object.values(session.agents).some((a) => a.status === 'waiting_permission');
  const folder = folderName(session?.cwd);

  // The window's title bar says the same, in the same words (it is what the taskbar shows).
  useEffect(() => {
    tellApp('set_status', { waiting, folder, label: t.needsApproval });
  }, [waiting, folder, t]);

  // The session ended: say goodbye, then close this window. A new start of the same session cancels it.
  const endedAt = session?.endedAt;
  const closing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (endedAt === undefined) return;
    closing.current = setTimeout(() => tellApp('close_me', { epoch: currentEpoch() }), CLOSE_AFTER_MS);
    return () => clearTimeout(closing.current);
  }, [endedAt]);

  return (
    <div className={`win${waiting ? ' is-waiting' : ''}${motion ? '' : ' reduce-motion'}`}>
      <Stage session={session} w={w} capacity={capacity} tod={tod} motion={motion} lang={lang} farewellAt={endedAt} ended={endedAt !== undefined} />
      {!session ? <div className="hint">{t.waitingForSession}</div> : null}
      {folder ? <div className="folder" title={folder}>{folder}</div> : null}
      {waiting ? (
        <>
          <div className="wait-frame" aria-hidden="true" />
          <div className="wait-banner" role="status">
            <span className="wait-mark" aria-hidden="true">!</span>
            <span className="wait-text">{t.needsApproval}</span>
            <span className="wait-where">{t.answerInTerminal}</span>
          </div>
        </>
      ) : null}
    </div>
  );
}
