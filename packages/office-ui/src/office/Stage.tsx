import { useEffect, useRef, useState } from 'react';
import { MANAGER_ID, expressionOf, type AgentState, type SessionState, type Expression } from '@onecarat/domain';
import { Figure, type FigurePose } from './Figure.tsx';
import { bubbleShort, dict, displayName, type Lang } from '../i18n.ts';
import { STAGE_H, deskSlots, type TimeOfDay } from '../scene.ts';

const H = STAGE_H;
const DESK_FIG_Y = 402; // feet of a figure standing behind a desk (legs hidden by the desk front)
const AISLE_Y = 462; // feet of a walking figure, in front of the desks
const MGR_X = 150;
const MGR_DESK_W = 200;
const REPORT_X = 292;
const SPAWN_X = 300;
const WALK_SPEED = 0.32; // units per ms

/** A finished subagent stays at its desk this long, then stands up, bows to the manager and leaves. */
const LINGER_MS = 10_000;
/** A subagent that was already finished this long before it could be shown is not shown. */
const STALE_MS = 15_000;

/** Goodbye when the session ends: everyone stands up, bows toward the viewer, then waves (visual only). */
const FW_UP_MS = 500;
const FW_BOW_MS = 1600;
const FW_WAVE_MS = 3000;
/** How much taller a figure at a desk stands during the goodbye (its legs stay hidden by the desk front). */
const FW_RISE = 40;
export const FAREWELL_MS = FW_UP_MS + FW_BOW_MS + FW_WAVE_MS;
type FarewellStep = 'up' | 'bow' | 'wave';
function farewellStep(at: number | undefined, now: number): FarewellStep | undefined {
  if (at === undefined) return undefined;
  const e = now - at;
  if (e < 0) return undefined;
  if (e < FW_UP_MS) return 'up';
  if (e < FW_UP_MS + FW_BOW_MS) return 'bow';
  if (e < FAREWELL_MS) return 'wave';
  return undefined;
}
const farewellPose = (s: FarewellStep): FigurePose => (s === 'bow' ? 'bowFront' : s === 'wave' ? 'wave' : 'stand');

type Phase =
  | 'arrive' | 'toDesk' | 'atDesk' | 'toManager' | 'atManager' | 'highfive' | 'back' | 'done'
  // leaving (visual only): step out from the desk, walk to the door by the manager, bow, fade out
  | 'standUp' | 'leave' | 'bow' | 'fade' | 'gone';
interface Choreo { phase: Phase; since: number; dur: number; from: number }

export interface StageProps {
  session?: SessionState;
  /** Width of the drawing in units, and how many subagent desks fit (scene.ts: stageLayout). */
  w: number;
  capacity: number;
  tod: TimeOfDay;
  motion: boolean;
  lang: Lang;
  /** When the session ended (ms epoch); starts the goodbye. */
  farewellAt?: number;
  /** The session is over: after the goodbye the manager keeps waving. */
  ended?: boolean;
}

const isFinished = (a: AgentState) => a.status === 'completed' || a.status === 'failed' || a.status === 'unknown';

export function Stage({ session, w: W, capacity, tod, motion, lang, farewellAt, ended }: StageProps) {
  const t = dict[lang];
  const order = session?.order ?? [];
  const agents = session?.agents ?? {};

  // ---- choreography: walking to desks, reporting, high-five, leaving (visual only) ----
  const [choreo, setChoreo] = useState<Record<string, Choreo>>({});
  // Subagents still in the office. Those who went home free their desk (the session state keeps them).
  const present = order.filter((id) => choreo[id]?.phase !== 'gone' && agents[id]);
  // Only as many as there are desks are drawn; the others wait their turn and are shown as a number.
  const onStage = present.slice(0, capacity);
  const hidden = present.length - onStage.length;
  const { xs, deskW } = deskSlots(W, onStage.length);
  const slotOf = (id: string) => xs[onStage.indexOf(id)] ?? W - 200;
  const [, setTick] = useState(0);
  const agentsRef = useRef(agents);
  agentsRef.current = agents;
  const sessionId = session?.id;
  useEffect(() => setChoreo({}), [sessionId]);
  // When the session is over, subagents that never reported back (Claude Code stopped mid-task, so no SubagentStop
  // will come) go home too, after the goodbye. Visual only: their recorded status stays as it is.
  const endedRef = useRef(ended);
  endedRef.current = ended;
  const farewellAtRef = useRef(farewellAt);
  farewellAtRef.current = farewellAt;

  useEffect(() => {
    const walkDur = (dx: number) => (motion ? Math.max(500, Math.abs(dx) / WALK_SPEED) : 0);
    const iv = setInterval(() => {
      const now = Date.now();
      setChoreo((prev) => {
        let changed = false;
        const next: Record<string, Choreo> = { ...prev };
        const set = (id: string, phase: Phase, dur = 0, from = 0) => {
          next[id] = { phase, since: now, dur, from };
          changed = true;
        };
        for (const id of order) {
          const a = agentsRef.current[id];
          if (!a) continue;
          const c = next[id];
          const finished = a.status === 'completed' || a.status === 'failed';
          if (!onStage.includes(id)) {
            // No desk yet. One that finished (or whose session ended) without ever being shown has gone home.
            if (!c && (isFinished(a) || endedRef.current)) set(id, 'gone');
            continue;
          }
          const desk = slotOf(id);
          const sentHome = !finished && !!endedRef.current && farewellStep(farewellAtRef.current, now) === undefined;
          if (!c) {
            if ((finished || endedRef.current) && now - a.updatedAt > STALE_MS) set(id, 'gone');
            else set(id, 'arrive', motion ? 700 : 0);
            continue;
          }
          const elapsed = now - c.since;
          if (elapsed < c.dur) continue;
          switch (c.phase) {
            case 'arrive': set(id, 'toDesk', walkDur(desk - SPAWN_X), SPAWN_X); break;
            case 'toDesk': set(id, 'atDesk'); break;
            case 'atDesk':
              if (finished) set(id, 'toManager', walkDur(desk - REPORT_X), desk);
              else if (sentHome || a.status === 'unknown') set(id, 'standUp', motion ? 400 : 0);
              break;
            case 'toManager': set(id, 'atManager', motion ? 1200 : 600); break;
            case 'atManager': {
              const success = a.outcome === 'success_estimated';
              if (a.acknowledged && success) set(id, 'highfive', motion ? 2200 : 1500);
              else if (a.acknowledged || elapsed > 8000) set(id, 'back', walkDur(desk - REPORT_X) + (motion ? 1200 : 0), REPORT_X);
              break;
            }
            case 'highfive': set(id, 'back', walkDur(desk - REPORT_X), REPORT_X); break;
            case 'back': set(id, 'done'); break;
            case 'done': if (finished && elapsed >= LINGER_MS) set(id, 'standUp', motion ? 400 : 0); break;
            case 'standUp': set(id, 'leave', walkDur(desk - REPORT_X), desk); break;
            case 'leave': set(id, 'bow', motion ? 1600 : 1200); break;
            case 'bow': set(id, 'fade', motion ? 600 : 0); break;
            case 'fade': set(id, 'gone'); break;
            default: break;
          }
        }
        return changed ? next : prev;
      });
      setTick((n) => (n + 1) % 1000);
    }, 120);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.join('|'), onStage.join('|'), motion, xs.join('|')]);

  const highfiving = onStage.some((id) => choreo[id]?.phase === 'highfive');
  const bowing = onStage.some((id) => choreo[id]?.phase === 'bow');
  const fw = farewellStep(farewellAt, Date.now());

  // Position of each subagent figure for its phase.
  const placed = onStage.map((id, idx) => {
    const a = agents[id]!;
    const c = choreo[id];
    const desk = xs[idx]!;
    const reporters = onStage.filter((o) => ['toManager', 'atManager', 'highfive', 'leave', 'bow', 'fade'].includes(choreo[o]?.phase ?? ''));
    const qx = REPORT_X + Math.max(0, reporters.indexOf(id)) * 70;
    let x = desk;
    let y = DESK_FIG_Y;
    let front = false;
    let walking = false;
    let facing: 1 | -1 = 1;
    let dur = 0;
    switch (c?.phase) {
      case undefined:
      case 'arrive': x = SPAWN_X; y = AISLE_Y; front = true; break;
      case 'toDesk': x = desk; y = AISLE_Y; front = true; walking = c.dur > 0; dur = c.dur; break;
      case 'toManager': x = qx; y = AISLE_Y; front = true; walking = c.dur > 0; facing = -1; dur = c.dur; break;
      case 'atManager':
      case 'highfive': x = qx; y = AISLE_Y; front = true; facing = -1; break;
      case 'back': x = desk; y = AISLE_Y; front = true; walking = c.dur > 0; dur = c.dur; break;
      case 'standUp': x = desk; y = AISLE_Y; front = true; dur = c.dur; break;
      case 'leave': x = qx; y = AISLE_Y; front = true; walking = c.dur > 0; facing = -1; dur = c.dur; break;
      case 'bow':
      case 'fade': x = qx; y = AISLE_Y; front = true; facing = -1; break;
      default: break;
    }
    // Goodbye: everyone still in the office (not already fading out) faces the viewer; those at a desk stand up tall
    // behind it (the move is the mover's CSS transition), those in the aisle stop where they are headed.
    const farewell = fw !== undefined && c?.phase !== 'fade';
    if (farewell) { if (!front) y = DESK_FIG_Y - FW_RISE; walking = false; facing = 1; dur = motion ? 400 : 0; }
    return { id, a, x, y, front, walking, facing, dur, phase: c?.phase, farewell };
  });

  const fig = (p: (typeof placed)[number]) => {
    const e = expressionOf(p.a);
    let pose: FigurePose = e.pose;
    let face = e.face;
    let bubble = e.bubble;
    if (p.walking) { pose = 'stand'; bubble = undefined; }
    if (p.phase === 'arrive' || p.phase === undefined) { pose = 'stand'; bubble = undefined; face = 'smile'; }
    if (p.phase === 'highfive') { pose = 'highfive'; face = 'happy'; }
    if (p.phase === 'atManager') { pose = p.a.status === 'failed' ? 'stand' : 'report'; }
    if ((p.phase === 'done' || p.phase === 'atDesk') && (p.a.status === 'completed' || p.a.status === 'failed')) { pose = 'stand'; }
    if (p.phase === 'toDesk' && !p.walking) pose = 'stand';
    const leaving = p.phase === 'standUp' || p.phase === 'leave' || p.phase === 'bow' || p.phase === 'fade';
    if (leaving) { bubble = undefined; face = 'smile'; pose = 'stand'; }
    if (p.phase === 'bow' || p.phase === 'fade') pose = 'bow';
    if (p.farewell && fw) { bubble = undefined; pose = farewellPose(fw); face = fw === 'wave' ? 'happy' : 'smile'; }
    // A wait for the user's approval is never hidden by a walk or a pose.
    const waiting = p.a.status === 'waiting_permission' && !p.farewell;
    if (waiting) { bubble = e.bubble; if (!p.walking) pose = e.pose; }
    const fading = p.phase === 'fade';
    return (
      <g
        key={p.id}
        className="mover"
        style={{
          transform: `translate(${p.x}px, ${p.y}px)`,
          ...(fading ? { opacity: 0, transition: `opacity ${motion ? 600 : 0}ms ease-out` } : { transitionDuration: `${p.dur}ms` }),
        }}
      >
        <StageFigure
          lang={lang}
          pose={pose}
          face={face}
          sweat={e.sweat && !p.walking && !p.farewell}
          walking={p.walking}
          motion={motion}
          facing={p.facing}
          bubble={bubble}
          busy={e.busy && !p.walking && !p.farewell}
        />
      </g>
    );
  };

  const manager = agents[MANAGER_ID];
  const mgrExpr: Expression | undefined = manager ? expressionOf(manager) : undefined;
  const mgrWaiting = manager?.status === 'waiting_permission';
  // The manager stands behind the desk; during the goodbye it stands up tall (a short rise animation) and, once the
  // session is over, stays up waving until the window closes.
  const waving = !fw && !!ended;
  const goodbye = !!fw || waving;
  const managerFig = () =>
    manager && mgrExpr ? (
      <g transform={`translate(${MGR_X}, ${goodbye ? DESK_FIG_Y - FW_RISE : DESK_FIG_Y})`}>
        <g className={fw === 'up' && motion ? 'farewell-rise' : undefined}>
          <StageFigure
            lang={lang}
            pose={fw ? farewellPose(fw) : waving ? 'wave' : mgrWaiting ? mgrExpr.pose : highfiving ? 'highfive' : bowing ? 'wave' : mgrExpr.pose}
            face={fw ? (fw === 'wave' ? 'happy' : 'smile') : waving ? 'happy' : mgrWaiting ? mgrExpr.face : highfiving ? 'happy' : bowing ? 'smile' : mgrExpr.face}
            sweat={mgrExpr.sweat && !bowing && !goodbye}
            walking={false}
            motion={motion}
            facing={1}
            bubble={goodbye ? undefined : mgrWaiting ? mgrExpr.bubble : highfiving || bowing ? undefined : mgrExpr.bubble}
            busy={mgrExpr.busy && !goodbye}
            manager
          />
        </g>
      </g>
    ) : null;

  return (
    <svg className={`stage-svg tod-${tod}`} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={t.office}>
      <Backdrop w={W} tod={tod} />

      {/* manager area */}
      <ellipse className="rug" cx={MGR_X + 14} cy={438} rx={170} ry={36} />
      <DeskBack x={MGR_X} w={MGR_DESK_W} manager />
      {managerFig()}
      <DeskFront x={MGR_X} w={MGR_DESK_W} label={t.manager} manager />

      {/* subagent desks with seated figures */}
      {onStage.map((id, i) => (
        <g key={`desk-${id}`}>
          <DeskBack x={xs[i]!} w={deskW} />
          {placed.filter((p) => p.id === id && !p.front).map(fig)}
          <DeskFront x={xs[i]!} w={deskW} label={displayName(agents[id]!, lang)} />
        </g>
      ))}

      {/* walking / reporting figures in front of desks */}
      {placed.filter((p) => p.front).map(fig)}

      {highfiving && !fw ? (
        <g className="sparkle" transform={`translate(${(MGR_X + REPORT_X) / 2 + 2}, ${AISLE_Y - 200})`}>
          <path d="M0 -26 v-16 M-18 -16 l-10 -10 M18 -16 l10 -10" className="facestroke" style={{ stroke: 'var(--warn)' }} />
        </g>
      ) : null}

      {/* subagents that have no desk in a window this small: a number, never left out silently */}
      {hidden > 0 ? (
        <g className="more" transform={`translate(${W - 20}, 20)`} aria-label={t.more(hidden)}>
          <title>{t.more(hidden)}</title>
          <rect x={-(String(hidden).length * 24 + 62)} y={0} width={String(hidden).length * 24 + 62} height={56} rx={28} />
          <text x={-(String(hidden).length * 24 + 62) / 2} y={41} textAnchor="middle">+{hidden}</text>
        </g>
      ) : null}
    </svg>
  );
}

/** What is seen through the office windows: it follows the PC's clock (scene.ts: timeOfDay). Colours are in styles.css. */
function Backdrop({ w, tod }: { w: number; tod: TimeOfDay }) {
  // Buildings as fractions of the width, so they spread with the window: [x, top, width].
  const towers: [number, number, number][] = [[0.42, 150, 54], [0.5, 110, 40], [0.62, 70, 64], [0.72, 135, 46], [0.84, 95, 58], [0.93, 160, 50]];
  const sun = tod === 'morning' ? { x: 0.3 * w, y: 232, r: 40 } : tod === 'evening' ? { x: 0.78 * w, y: 236, r: 44 } : { x: 0.6 * w, y: 62, r: 34 };
  const mullions = Math.max(1, Math.round(w / 420));
  return (
    <g className="backdrop">
      <defs>
        <linearGradient id="sky-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="sky-top" />
          <stop offset="1" className="sky-low" />
        </linearGradient>
        <clipPath id="sky-clip"><rect x={0} y={0} width={w} height={300} /></clipPath>
      </defs>
      <rect className="wall" x={0} y={0} width={w} height={H} />
      <rect x={0} y={0} width={w} height={300} fill="url(#sky-grad)" />
      <g clipPath="url(#sky-clip)">
        {tod === 'night' ? (
          <g>
            {[[0.08, 40], [0.18, 96], [0.27, 30], [0.36, 72], [0.47, 44], [0.58, 22], [0.81, 52], [0.9, 28], [0.97, 84]].map(([fx, y]) => (
              <circle key={`${fx}`} className="star" cx={fx! * w} cy={y} r={2.6} />
            ))}
            <circle className="moon" cx={0.7 * w} cy={74} r={30} />
            <circle className="moon-cut" cx={0.7 * w + 13} cy={66} r={26} />
          </g>
        ) : (
          <g>
            <circle className="sun-glow" cx={sun.x} cy={sun.y} r={sun.r * 1.9} />
            <circle className="sun" cx={sun.x} cy={sun.y} r={sun.r} />
          </g>
        )}
        {towers.map(([fx, top, tw]) => (
          <g key={fx}>
            <rect className="tower" x={fx * w} y={top} width={tw} height={300 - top} />
            {/* a few windows: lit after dark */}
            {[0, 1, 2, 3].map((r) =>
              [0, 1].map((c) => ((r + c + Math.round(fx * 100)) % 3 === 0 ? null : (
                <rect key={`${r}-${c}`} className="tower-win" x={fx * w + 9 + c * (tw / 2 - 4)} y={top + 14 + r * 30} width={tw / 2 - 14} height={14} />
              ))),
            )}
          </g>
        ))}
      </g>
      {Array.from({ length: mullions }, (_, i) => (
        <rect key={i} className="mullion" x={Math.round(((i + 1) * w) / (mullions + 1)) - 4} y={0} width={8} height={300} />
      ))}
      <rect className="sill" x={0} y={296} width={w} height={8} />
      <rect className="floor" x={0} y={304} width={w} height={H - 304} />
      <text x={22} y={42} className="stage-logo">Onecarat <tspan className="stage-logo-labs">Labs</tspan></text>
    </g>
  );
}

function DeskBack({ x, w, manager }: { x: number; w: number; manager?: boolean }) {
  return <path className={manager ? 'desk-mgr-top' : 'desk-top'} d={`M${x - w / 2 + 14} 330 h${w - 28} l14 16 h${-w} Z`} />;
}

function DeskFront({ x, w, label, manager }: { x: number; w: number; label: string; manager?: boolean }) {
  const lw = Math.min(w - 8, Math.max(80, [...label].reduce((n, c) => n + (/[^\x00-\x7f]/.test(c) ? 20 : 11.5), 0) + 30));
  return (
    <g>
      {/* laptop seen from behind */}
      <path className="laptop" d={`M${x + 18} 342 l10 -42 h46 l-6 42Z`} opacity={0.85} />
      <rect className={manager ? 'desk-mgr-front' : 'desk-front'} x={x - w / 2} y={346} width={w} height={70} rx={4} />
      <g className="nameplate" transform={`translate(${x - lw / 2}, 390)`}>
        <rect width={lw} height={36} rx={8} />
        <text x={lw / 2} y={25} textAnchor="middle">{label}</text>
      </g>
    </g>
  );
}

/** A figure with its status label. Nothing here reacts to the mouse or the keyboard: the window is for watching. */
function StageFigure(props: {
  lang: Lang;
  pose: FigurePose;
  face: Expression['face'];
  sweat: boolean;
  walking: boolean;
  motion: boolean;
  facing: 1 | -1;
  bubble: Expression['bubble'];
  busy: boolean;
  manager?: boolean;
}) {
  const { lang, bubble, busy } = props;
  return (
    <g className="fig">
      <Figure pose={props.pose} face={props.face} sweat={props.sweat} walking={props.walking} motion={props.motion} facing={props.facing} manager={props.manager} />
      {bubble ? <Bubble text={bubbleShort[lang][bubble.key]} tone={bubble.tone} busy={busy} attention={ATTENTION.has(bubble.key)} waiting={bubble.key === 'waiting_permission'} /> : null}
    </g>
  );
}

/** Bubbles that ask for the user's attention keep a strong outline; the rest are a quiet label. */
const ATTENTION: ReadonlySet<string> = new Set(['waiting_permission', 'blocked', 'failed', 'retrying']);

/**
 * Status label above a figure. No progress bar: Claude Code reports no progress, so nothing here may look
 * like one. "busy" is a pulsing dot only. A wait for approval is filled with the warning colour.
 */
function Bubble({ text, tone, busy, attention, waiting }: { text: string; tone: string; busy: boolean; attention: boolean; waiting: boolean }) {
  const tw = [...text].reduce((n, c) => n + (/[^\x00-\x7f]/.test(c) ? 23 : 12.6), 0);
  const dot = busy ? 20 : 0;
  const w = Math.max(70, Math.round(tw) + 30 + dot);
  const h = 40;
  const x = -w / 2 + 2;
  const y = -192 - h;
  return (
    <g className={`bubble tone-${tone}${attention ? ' attention' : ''}${waiting ? ' waiting' : ''}`} aria-hidden="true">
      <rect x={x} y={y} width={w} height={h} rx={h / 2} />
      {busy ? <circle className="pulse" cx={x + 20} cy={y + h / 2} r={5.5} /> : null}
      <text x={x + dot + (w - dot) / 2} y={y + 28} textAnchor="middle">{text}</text>
    </g>
  );
}
