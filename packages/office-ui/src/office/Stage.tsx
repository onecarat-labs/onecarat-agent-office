import { useEffect, useMemo, useRef, useState } from 'react';
import { MANAGER_ID, expressionOf, type AgentState, type SessionState, type Expression } from '@onecarat/domain';
import { Figure, type FigurePose } from './Figure.tsx';
import { bubbleShort, bubbleText, dict, displayName, statusText, type Lang } from '../i18n.ts';

const W = 1600;
const H = 480;
const DESK_FIG_Y = 402; // feet of a figure standing behind a desk (legs hidden by the desk front)
const AISLE_Y = 462; // feet of a walking figure, in front of the desks
const MGR_X = 320;
const REPORT_X = 462;
const SPAWN_X = 470;
const WALK_SPEED = 0.32; // units per ms

/** A finished subagent stays at its desk this long, then stands up, bows to the manager and leaves. */
const LINGER_MS = 10_000;
/** A subagent that was already finished this long before we first saw it (page reload, session switch) is not shown. */
const STALE_MS = 15_000;

/** Goodbye when the user stops Claude Code: everyone stands up, bows toward the viewer, then waves (visual only). */
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
  selectedId: string;
  onSelect: (id: string) => void;
  motion: boolean;
  lang: Lang;
  demo: boolean;
  /** When the user pressed "Stop Claude Code" (ms epoch); starts the goodbye. */
  farewellAt?: number;
  /** The shown session is over (SessionEnd, or the built-in claude stopped): after the goodbye the manager keeps waving. */
  ended?: boolean;
}

function slotXs(n: number): { xs: number[]; deskW: number } {
  const left = 650;
  const right = 1540;
  const span = right - left;
  const spacing = n > 0 ? Math.min(300, span / n) : 300;
  const start = left + (span - spacing * n) / 2 + spacing / 2;
  return { xs: Array.from({ length: n }, (_, i) => start + i * spacing), deskW: Math.min(230, spacing - 30) };
}

export function Stage({ session, selectedId, onSelect, motion, lang, demo, farewellAt, ended }: StageProps) {
  const t = dict[lang];
  const order = session?.order ?? [];
  const agents = session?.agents ?? {};

  // ---- choreography: walking to desks, reporting, high-five, leaving (visual only) ----
  const [choreo, setChoreo] = useState<Record<string, Choreo>>({});
  // Subagents still in the office. Those who went home free their desk (the session state keeps them).
  const onStage = order.filter((id) => choreo[id]?.phase !== 'gone');
  const { xs, deskW } = slotXs(onStage.length);
  const slotOf = (id: string) => xs[onStage.indexOf(id)] ?? 1200;
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
          const desk = slotOf(id);
          const finished = a.status === 'completed' || a.status === 'failed';
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
              else if (sentHome) set(id, 'standUp', motion ? 400 : 0);
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
  }, [order.join('|'), motion, xs.join('|')]);

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
    if (p.phase === 'arrive') { pose = 'stand'; bubble = undefined; face = 'smile'; }
    if (p.phase === 'highfive') { pose = 'highfive'; face = 'happy'; }
    if (p.phase === 'atManager') { pose = p.a.status === 'failed' ? 'stand' : 'report'; }
    if ((p.phase === 'done' || p.phase === 'atDesk') && (p.a.status === 'completed' || p.a.status === 'failed')) { pose = 'stand'; }
    if (p.phase === 'toDesk' && !p.walking) pose = 'stand';
    const leaving = p.phase === 'standUp' || p.phase === 'leave' || p.phase === 'bow' || p.phase === 'fade';
    if (leaving) { bubble = undefined; face = 'smile'; pose = 'stand'; }
    if (p.phase === 'bow' || p.phase === 'fade') pose = 'bow';
    if (p.farewell && fw) { bubble = undefined; pose = farewellPose(fw); face = fw === 'wave' ? 'happy' : 'smile'; }
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
        <FigureButton
          agent={p.a}
          selected={selectedId === p.id}
          onSelect={onSelect}
          lang={lang}
          pose={pose}
          face={face}
          sweat={e.sweat && !p.walking && !p.farewell}
          walking={p.walking}
          motion={motion}
          facing={p.facing}
          bubble={bubble}
          busy={e.busy && !p.walking && !p.farewell}
          sparkle={p.phase === 'highfive' && !p.farewell}
        />
      </g>
    );
  };

  const manager = agents[MANAGER_ID];
  const mgrExpr: Expression | undefined = manager ? expressionOf(manager) : undefined;
  // The manager stands behind the desk; during the goodbye it stands up tall (a short rise animation) and, once the
  // session is over, stays up waving until a session starts again.
  const waving = !fw && !!ended;
  const goodbye = !!fw || waving;
  const managerFig = () =>
    manager && mgrExpr ? (
      <g transform={`translate(${MGR_X}, ${goodbye ? DESK_FIG_Y - FW_RISE : DESK_FIG_Y})`}>
        <g className={fw === 'up' && motion ? 'farewell-rise' : undefined}>
          <FigureButton
            agent={manager}
            selected={selectedId === MANAGER_ID}
            onSelect={onSelect}
            lang={lang}
            pose={fw ? farewellPose(fw) : waving ? 'wave' : highfiving ? 'highfive' : bowing ? 'wave' : mgrExpr.pose}
            face={fw ? (fw === 'wave' ? 'happy' : 'smile') : waving ? 'happy' : highfiving ? 'happy' : bowing ? 'smile' : mgrExpr.face}
            sweat={mgrExpr.sweat && !bowing && !goodbye}
            walking={false}
            motion={motion}
            facing={1}
            bubble={highfiving || bowing || goodbye ? undefined : mgrExpr.bubble}
            busy={mgrExpr.busy && !goodbye}
            manager
            sparkle={false}
          />
        </g>
      </g>
    ) : null;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="group" aria-label={t.office}>
      {/* backdrop: sky + faint skyline + window mullions */}
      <rect className="sky" x={0} y={0} width={W} height={H} />
      <g className="skyline">
        <rect x={900} y={70} width={60} height={160} /><rect x={970} y={110} width={40} height={120} /><rect x={1180} y={40} width={70} height={190} />
        <rect x={1260} y={95} width={44} height={135} /><rect x={1420} y={60} width={56} height={170} /><rect x={1486} y={120} width={50} height={110} />
      </g>
      {[300, 840, 1180].map((x) => (<rect key={x} x={x} y={0} width={10} height={300} className="skyline" />))}
      <rect className="floor" x={0} y={300} width={W} height={H - 300} />

      {/* logo sign */}
      <text x={38} y={70} className="stage-logo">Onecarat <tspan className="stage-logo-labs">Labs</tspan></text>

      {/* plant */}
      <g transform="translate(110,300)">
        <path className="plant-leaf" d="M30 30 C 5 0, 0 -40, 18 -70 C 30 -40, 34 -10, 30 30Z" />
        <path className="plant-leaf" d="M30 30 C 50 -10, 70 -30, 78 -55 C 60 -40, 40 -15, 30 30Z" />
        <path className="plant-leaf" d="M30 30 C 15 10, -10 0, -18 -20 C 5 -15, 22 5, 30 30Z" />
        <path className="plant-pot" d="M8 30 h44 l-6 52 h-32Z" />
      </g>

      {/* manager area */}
      <ellipse className="rug" cx={MGR_X + 20} cy={438} rx={230} ry={40} />
      <DeskBack x={MGR_X} w={250} manager />
      {managerFig()}
      <DeskFront x={MGR_X} w={250} label={t.manager} manager />

      {/* subagent desks with seated figures */}
      {onStage.map((id, i) => (
        <g key={`desk-${id}`}>
          {i > 0 ? <path className="partition" d={`M${xs[i]! - (xs[1]! - xs[0]!) / 2 - 6} 410 l0 -110 l14 -14 l0 110Z`} /> : null}
          <DeskBack x={xs[i]!} w={deskW} />
          {placed.filter((p) => p.id === id && !p.front).map(fig)}
          <DeskFront x={xs[i]!} w={deskW} label={agents[id] ? displayName(agents[id]!, lang) : 'Agent'} />
        </g>
      ))}

      {/* walking / reporting figures in front of desks */}
      {placed.filter((p) => p.front).map(fig)}

      {highfiving && !fw ? (
        <g className="sparkle" transform={`translate(${(MGR_X + REPORT_X) / 2 + 2}, ${AISLE_Y - 200})`}>
          <path d="M0 -26 v-16 M-18 -16 l-10 -10 M18 -16 l10 -10" className="facestroke" style={{ stroke: 'var(--warn)' }} />
        </g>
      ) : null}

      {onStage.length === 0 ? (
        <text x={1080} y={360} textAnchor="middle" className="board-empty">{t.agentsNone}</text>
      ) : null}
    </svg>
  );
}

export function DeskBack({ x, w, manager }: { x: number; w: number; manager?: boolean }) {
  return <path className={manager ? 'desk-mgr-top' : 'desk-top'} d={`M${x - w / 2 + 14} 330 h${w - 28} l14 16 h${-w} Z`} />;
}

export function DeskFront({ x, w, label, manager }: { x: number; w: number; label: string; manager?: boolean }) {
  const lw = Math.max(90, [...label].reduce((n, c) => n + (/[^\x00-\x7f]/.test(c) ? 19 : 10.5), 0) + 34);
  return (
    <g>
      {/* laptop seen from behind */}
      <path className="laptop" d={`M${x + 18} 342 l10 -42 h46 l-6 42Z`} opacity={0.85} />
      <rect className={manager ? 'desk-mgr-front' : 'desk-front'} x={x - w / 2} y={346} width={w} height={70} rx={4} />
      <g className="nameplate" transform={`translate(${x - lw / 2}, 392)`}>
        <rect width={lw} height={34} rx={8} />
        <text x={lw / 2} y={23.5} textAnchor="middle">{label}</text>
      </g>
    </g>
  );
}

function FigureButton(props: {
  agent: AgentState;
  selected: boolean;
  onSelect: (id: string) => void;
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
  sparkle: boolean;
}) {
  const { agent, selected, onSelect, lang, bubble, busy } = props;
  const label = `${displayName(agent, lang)}: ${statusText[lang][agent.status]}${bubble ? ` — ${bubbleText[lang][bubble.key]}` : ''}`;
  return (
    <g
      className={`fig${selected ? ' selected' : ''}`}
      tabIndex={0}
      role="button"
      aria-pressed={selected}
      aria-label={label}
      onClick={() => onSelect(agent.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(agent.id);
        }
      }}
    >
      {/* hover: the full wording, what it is working on and its task (the label above the head is short) */}
      <title>{[label + (bubble && agent.activityDetail ? ` · ${agent.activityDetail}` : ''), agent.role === 'subagent' ? agent.task : undefined].filter(Boolean).join('\n')}</title>
      <rect className="hit" x={-50} y={-190} width={110} height={196} />
      <rect className="focus-ring" x={-46} y={-188} width={100} height={194} rx={12} />
      <Figure pose={props.pose} face={props.face} sweat={props.sweat} walking={props.walking} motion={props.motion} facing={props.facing} manager={props.manager} />
      {bubble ? <Bubble text={bubbleShort[lang][bubble.key]} tone={bubble.tone} busy={busy} attention={ATTENTION.has(bubble.key)} /> : null}
    </g>
  );
}

/** Bubbles that ask for the user's attention keep a strong outline; the rest are a quiet label. */
const ATTENTION: ReadonlySet<string> = new Set(['waiting_permission', 'blocked', 'failed', 'retrying']);

/**
 * Small status label above a figure. No progress bar: Claude Code reports no progress, so nothing here may look
 * like one. "busy" is a pulsing dot only.
 */
export function Bubble({ text, tone, busy, attention }: { text: string; tone: string; busy: boolean; attention: boolean }) {
  const tw = [...text].reduce((n, c) => n + (/[^\x00-\x7f]/.test(c) ? 15.5 : 8.4), 0);
  const dot = busy ? 15 : 0;
  const w = Math.max(54, Math.round(tw) + 24 + dot);
  const h = 30;
  const x = -w / 2 + 2;
  const y = -194 - h;
  return (
    <g className={`bubble tone-${tone}${attention ? ' attention' : ''}`} aria-hidden="true">
      <rect x={x} y={y} width={w} height={h} rx={h / 2} />
      {busy ? <circle className="pulse" cx={x + 16} cy={y + h / 2} r={4} /> : null}
      <text x={x + dot + (w - dot) / 2} y={y + 20.5} textAnchor="middle">{text}</text>
    </g>
  );
}

export function useStageKeyboard(session: SessionState | undefined, selectedId: string, onSelect: (id: string) => void) {
  return useMemo(() => {
    const ids = [MANAGER_ID, ...(session?.order ?? [])];
    return (e: React.KeyboardEvent) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      // Nobody selected (overview): the first key press picks the manager.
      const i = ids.indexOf(selectedId);
      const n = i < 0 ? 0 : e.key === 'ArrowRight' ? (i + 1) % ids.length : (i - 1 + ids.length) % ids.length;
      onSelect(ids[n]!);
      e.preventDefault();
    };
  }, [session?.order, selectedId, onSelect]);
}
