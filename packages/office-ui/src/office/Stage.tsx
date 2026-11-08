import { useEffect, useMemo, useRef, useState } from 'react';
import { MANAGER_ID, expressionOf, summarize, type AgentState, type SessionState, type Expression } from '@onecarat/domain';
import { Figure, type FigurePose } from './Figure.tsx';
import { bubbleText, dict, displayName, statusText, type Lang } from '../i18n.ts';

const W = 1600;
const H = 480;
const DESK_FIG_Y = 402; // feet of a figure standing behind a desk (legs hidden by the desk front)
const AISLE_Y = 462; // feet of a walking figure, in front of the desks
const MGR_X = 320;
const REPORT_X = 462;
const SPAWN_X = 470;
const WALK_SPEED = 0.32; // units per ms

type Phase = 'arrive' | 'toDesk' | 'atDesk' | 'toManager' | 'atManager' | 'highfive' | 'back' | 'done';
interface Choreo { phase: Phase; since: number; dur: number; from: number }

export interface StageProps {
  session?: SessionState;
  selectedId: string;
  onSelect: (id: string) => void;
  motion: boolean;
  lang: Lang;
  demo: boolean;
}

function slotXs(n: number): { xs: number[]; deskW: number } {
  const left = 650;
  const right = 1540;
  const span = right - left;
  const spacing = n > 0 ? Math.min(300, span / n) : 300;
  const start = left + (span - spacing * n) / 2 + spacing / 2;
  return { xs: Array.from({ length: n }, (_, i) => start + i * spacing), deskW: Math.min(230, spacing - 30) };
}

export function Stage({ session, selectedId, onSelect, motion, lang, demo }: StageProps) {
  const t = dict[lang];
  const order = session?.order ?? [];
  const agents = session?.agents ?? {};
  const { xs, deskW } = slotXs(order.length);
  const slotOf = (id: string) => xs[order.indexOf(id)] ?? 1200;

  // ---- choreography: walking to desks, reporting, high-five (visual only) ----
  const [choreo, setChoreo] = useState<Record<string, Choreo>>({});
  const [, setTick] = useState(0);
  const agentsRef = useRef(agents);
  agentsRef.current = agents;
  const sessionId = session?.id;
  useEffect(() => setChoreo({}), [sessionId]);

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
          if (!c) {
            set(id, 'arrive', motion ? 700 : 0);
            continue;
          }
          const elapsed = now - c.since;
          if (elapsed < c.dur) continue;
          switch (c.phase) {
            case 'arrive': set(id, 'toDesk', walkDur(desk - SPAWN_X), SPAWN_X); break;
            case 'toDesk': set(id, 'atDesk'); break;
            case 'atDesk': if (finished) set(id, 'toManager', walkDur(desk - REPORT_X), desk); break;
            case 'toManager': set(id, 'atManager', motion ? 1200 : 600); break;
            case 'atManager': {
              const success = a.outcome === 'success_estimated';
              if (a.acknowledged && success) set(id, 'highfive', motion ? 2200 : 1500);
              else if (a.acknowledged || elapsed > 8000) set(id, 'back', walkDur(desk - REPORT_X) + (motion ? 1200 : 0), REPORT_X);
              break;
            }
            case 'highfive': set(id, 'back', walkDur(desk - REPORT_X), REPORT_X); break;
            case 'back': set(id, 'done'); break;
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

  const highfiving = order.some((id) => choreo[id]?.phase === 'highfive');
  const summary = session ? summarize(session) : { active: 0, completed: 0, failed: 0 };

  // Position of each subagent figure for its phase.
  const placed = order.map((id, idx) => {
    const a = agents[id]!;
    const c = choreo[id];
    const desk = xs[idx]!;
    const reporters = order.filter((o) => ['toManager', 'atManager', 'highfive'].includes(choreo[o]?.phase ?? ''));
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
      default: break;
    }
    return { id, a, x, y, front, walking, facing, dur, phase: c?.phase };
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
    return (
      <g
        key={p.id}
        className="mover"
        style={{ transform: `translate(${p.x}px, ${p.y}px)`, transitionDuration: `${p.dur}ms` }}
      >
        <FigureButton
          agent={p.a}
          selected={selectedId === p.id}
          onSelect={onSelect}
          lang={lang}
          pose={pose}
          face={face}
          sweat={e.sweat && !p.walking}
          walking={p.walking}
          motion={motion}
          facing={p.facing}
          bubble={bubble}
          busy={e.busy && !p.walking}
          sparkle={p.phase === 'highfive'}
        />
      </g>
    );
  };

  const manager = agents[MANAGER_ID];
  const mgrExpr: Expression | undefined = manager ? expressionOf(manager) : undefined;

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

      {/* logo (provisional) */}
      <g transform="translate(40,34)">
        <path d="M2 40 14 6h9L11 40Z M19 40 31 6h9L28 40Z" fill="var(--accent)" />
        <text x={52} y={36} className="stage-logo">Onecarat</text>
      </g>

      {/* plant */}
      <g transform="translate(110,300)">
        <path className="plant-leaf" d="M30 30 C 5 0, 0 -40, 18 -70 C 30 -40, 34 -10, 30 30Z" />
        <path className="plant-leaf" d="M30 30 C 50 -10, 70 -30, 78 -55 C 60 -40, 40 -15, 30 30Z" />
        <path className="plant-leaf" d="M30 30 C 15 10, -10 0, -18 -20 C 5 -15, 22 5, 30 30Z" />
        <path className="plant-pot" d="M8 30 h44 l-6 52 h-32Z" />
      </g>

      <AgentBoard session={session} lang={lang} />
      <StatusPill summary={summary} lang={lang} />

      {/* manager area */}
      <ellipse className="rug" cx={MGR_X + 20} cy={438} rx={230} ry={40} />
      <DeskBack x={MGR_X} w={250} manager />
      {manager && mgrExpr ? (
        <g transform={`translate(${MGR_X}, ${DESK_FIG_Y})`}>
          <FigureButton
            agent={manager}
            selected={selectedId === MANAGER_ID}
            onSelect={onSelect}
            lang={lang}
            pose={highfiving ? 'highfive' : mgrExpr.pose}
            face={highfiving ? 'happy' : mgrExpr.face}
            sweat={mgrExpr.sweat}
            walking={false}
            motion={motion}
            facing={1}
            bubble={highfiving ? undefined : mgrExpr.bubble}
            busy={mgrExpr.busy}
            manager
            sparkle={false}
          />
        </g>
      ) : null}
      <DeskFront x={MGR_X} w={250} label={t.manager} manager />

      {/* subagent desks with seated figures */}
      {order.map((id, i) => (
        <g key={`desk-${id}`}>
          {i > 0 ? <path className="partition" d={`M${xs[i]! - (xs[1]! - xs[0]!) / 2 - 6} 410 l0 -110 l14 -14 l0 110Z`} /> : null}
          <DeskBack x={xs[i]!} w={deskW} />
          {placed.filter((p) => p.id === id && !p.front).map(fig)}
          <DeskFront x={xs[i]!} w={deskW} label={agents[id] ? displayName(agents[id]!, lang) : 'Agent'} />
        </g>
      ))}

      {/* walking / reporting figures in front of desks */}
      {placed.filter((p) => p.front).map(fig)}

      {highfiving ? (
        <g className="sparkle" transform={`translate(${(MGR_X + REPORT_X) / 2 + 2}, ${AISLE_Y - 200})`}>
          <path d="M0 -26 v-16 M-18 -16 l-10 -10 M18 -16 l10 -10" className="facestroke" style={{ stroke: 'var(--warn)' }} />
        </g>
      ) : null}

      {order.length === 0 ? (
        <text x={1080} y={360} textAnchor="middle" className="board-empty">{t.agentsNone}</text>
      ) : null}
    </svg>
  );
}

function DeskBack({ x, w, manager }: { x: number; w: number; manager?: boolean }) {
  return <path className={manager ? 'desk-mgr-top' : 'desk-top'} d={`M${x - w / 2 + 14} 330 h${w - 28} l14 16 h${-w} Z`} />;
}

function DeskFront({ x, w, label, manager }: { x: number; w: number; label: string; manager?: boolean }) {
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
      <rect className="hit" x={-50} y={-190} width={110} height={196} />
      <rect className="focus-ring" x={-46} y={-188} width={100} height={194} rx={12} />
      <Figure pose={props.pose} face={props.face} sweat={props.sweat} walking={props.walking} motion={props.motion} facing={props.facing} manager={props.manager} />
      {bubble ? <Bubble text={bubbleText[lang][bubble.key]} tone={bubble.tone} busy={busy} /> : null}
    </g>
  );
}

function Bubble({ text, tone, busy }: { text: string; tone: string; busy: boolean }) {
  const w = Math.max(96, Math.round(text.length * (/[^\x00-\x7f]/.test(text) ? 17.5 : 9.6)) + 36);
  const h = busy ? 52 : 38;
  const x = -w / 2 + 6;
  const y = -206 - h;
  return (
    <g className={`bubble tone-${tone}`} aria-hidden="true">
      <rect x={x} y={y} width={w} height={h} rx={12} />
      <path className="tail" d={`M-4 ${y + h - 1} l10 13 l8 -13`} strokeWidth={2} />
      <rect x={x + 2} y={y + h - 4} width={w - 4} height={3} style={{ fill: 'var(--panel)', stroke: 'none' }} />
      <text x={x + w / 2} y={y + 25} textAnchor="middle">{text}</text>
      {busy ? (
        <g>
          <clipPath id={`clip-${text.length}-${w}`}><rect x={x + 16} y={y + 34} width={w - 32} height={5} rx={2.5} /></clipPath>
          <rect className="busybar-track" x={x + 16} y={y + 34} width={w - 32} height={5} rx={2.5} />
          <g clipPath={`url(#clip-${text.length}-${w})`}>
            <rect className="busybar-fill indeterminate" x={x + 16} y={y + 34} width={(w - 32) * 0.4} height={5} rx={2.5} />
          </g>
        </g>
      ) : null}
    </g>
  );
}

function AgentBoard({ session, lang }: { session?: SessionState; lang: Lang }) {
  const t = dict[lang];
  const rows = (session?.order ?? []).map((id) => session!.agents[id]!).slice(0, 4);
  const more = (session?.order.length ?? 0) - rows.length;
  const h = 58 + Math.max(1, rows.length) * 28 + (more > 0 ? 20 : 0);
  return (
    <g transform="translate(430, 12)">
      <rect className="svg-panel" width={270} height={h} rx={10} />
      <text x={20} y={34} className="board-title">{t.board}</text>
      {rows.length === 0 ? <text x={20} y={68} className="board-empty">{t.boardEmpty}</text> : null}
      {rows.map((a, i) => (
        <g key={a.id} transform={`translate(20, ${54 + i * 28})`}>
          <StatusGlyph a={a} />
          <text x={22} y={17} className="board-row">{a.task ? truncate(a.task, 23) : displayName(a, lang)}</text>
        </g>
      ))}
      {more > 0 ? <text x={20} y={h - 12} className="board-empty">+{more}</text> : null}
    </g>
  );
}

function StatusGlyph({ a }: { a: AgentState }) {
  if (a.status === 'completed' && a.outcome === 'success_estimated') return <path d="M2 12 l5 5 l9 -11" className="facestroke" style={{ stroke: 'var(--ok)' }} />;
  if (a.status === 'completed') return <circle cx={8} cy={11} r={6} style={{ fill: 'none', stroke: 'var(--muted)', strokeWidth: 2.5 }} />;
  if (a.status === 'failed') return <path d="M3 5 l11 11 M14 5 l-11 11" className="facestroke" style={{ stroke: 'var(--danger)' }} />;
  if (a.status === 'waiting_permission') return (<g><circle cx={8} cy={11} r={7} style={{ fill: 'none', stroke: 'var(--warn)', strokeWidth: 2.5 }} /><path d="M8 7 v4 l3 2" className="facestroke" style={{ stroke: 'var(--warn)', strokeWidth: 2 }} /></g>);
  return <circle cx={8} cy={11} r={7} className="spinner" style={{ fill: 'none', stroke: 'var(--accent)', strokeWidth: 2.5, strokeDasharray: '3 3.2' }} />;
}

function StatusPill({ summary, lang }: { summary: { active: number; completed: number; failed: number }; lang: Lang }) {
  const t = dict[lang];
  const text = `${summary.active} ${t.active} / ${summary.completed} ${t.completed}${summary.failed ? ` / ${summary.failed} ${t.failed}` : ''}`;
  const w = Math.round(text.length * (lang === 'ja' ? 13 : 9.2)) + 70;
  return (
    <g transform={`translate(${W - 24 - w}, 22)`}>
      <rect className="svg-panel" width={w} height={46} rx={10} />
      <circle cx={26} cy={23} r={11} className="svg-ok" />
      <path d="M20.5 23 l4 4 l7 -8" style={{ stroke: 'var(--panel)', strokeWidth: 2.6, fill: 'none', strokeLinecap: 'round' }} />
      <text x={46} y={29} className="status-text">{text}</text>
    </g>
  );
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

export function useStageKeyboard(session: SessionState | undefined, selectedId: string, onSelect: (id: string) => void) {
  return useMemo(() => {
    const ids = [MANAGER_ID, ...(session?.order ?? [])];
    return (e: React.KeyboardEvent) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const i = Math.max(0, ids.indexOf(selectedId));
      const n = e.key === 'ArrowRight' ? (i + 1) % ids.length : (i - 1 + ids.length) % ids.length;
      onSelect(ids[n]!);
      e.preventDefault();
    };
  }, [session?.order, selectedId, onSelect]);
}
