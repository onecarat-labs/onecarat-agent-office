import type { Face, Pose } from '@onecarat/domain';

export type FigurePose = Pose | 'highfive';

export interface FigureProps {
  pose: FigurePose;
  face: Face;
  sweat: boolean;
  walking: boolean;
  /** Only when motion is allowed: SMIL loops are not rendered at all under reduced motion. */
  motion: boolean;
  facing: 1 | -1;
  manager?: boolean;
}

const SHOULDER = { x: 0, y: -112 };
const HIP = { x: 0, y: -50 };

function pts(...p: [number, number][]) {
  return p.map(([x, y]) => `${x},${y}`).join(' ');
}

/** Stick figure, feet at (0,0), facing right. ~180 units tall. */
export function Figure({ pose, face, sweat, walking, motion, facing, manager }: FigureProps) {
  const typing = pose === 'type' && motion;
  const sw = (dur: string, values: string) => (motion ? <animateTransform attributeName="transform" type="rotate" dur={dur} values={values} repeatCount="indefinite" /> : null);
  return (
    <g transform={facing === -1 ? 'scale(-1,1)' : undefined}>
      <g>
        {walking && motion ? <animateTransform attributeName="transform" type="translate" dur="0.26s" values="0 0;0 -3;0 0" repeatCount="indefinite" /> : null}
        {/* legs */}
        <g>
          {walking ? sw('0.52s', `20 ${HIP.x} ${HIP.y};-20 ${HIP.x} ${HIP.y};20 ${HIP.x} ${HIP.y}`) : null}
          <polyline className="line" points={pts([HIP.x, HIP.y], [-14, -24], [-16, 0])} />
        </g>
        <g>
          {walking ? sw('0.52s', `-20 ${HIP.x} ${HIP.y};20 ${HIP.x} ${HIP.y};-20 ${HIP.x} ${HIP.y}`) : null}
          <polyline className="line" points={pts([HIP.x, HIP.y], [14, -24], [18, 0])} />
        </g>
        {/* body */}
        <line className="line" x1={0} y1={-122} x2={HIP.x} y2={HIP.y} />
        {manager ? <path className="tie" d="M0 -118 l-5 8 l5 26 l5 -26 Z" /> : null}
        <Arms pose={walking ? 'walk' : pose} typing={typing} motion={motion} />
        <Head face={face} />
        {sweat ? (
          <g>
            {motion ? <animateTransform attributeName="transform" type="translate" dur="1.6s" values="0 0;0 10;0 0" repeatCount="indefinite" /> : null}
            <path className="sweat" d="M36 -178 q-7 10 0 14 q7 -4 0 -14Z" />
            <path className="sweat" d="M45 -164 q-5 7 0 10 q5 -3 0 -10Z" opacity={0.7} />
          </g>
        ) : null}
      </g>
    </g>
  );
}

function Arms({ pose, typing, motion }: { pose: FigurePose | 'walk'; typing: boolean; motion: boolean }) {
  const S = SHOULDER;
  const rot = (values: string, dur: string) =>
    typing && motion ? <animateTransform attributeName="transform" type="rotate" dur={dur} values={values} repeatCount="indefinite" /> : null;
  switch (pose) {
    case 'type':
      return (
        <>
          <g>{rot(`0 ${S.x} ${S.y};-6 ${S.x} ${S.y};0 ${S.x} ${S.y}`, '0.34s')}<polyline className="line" points={pts([S.x, S.y], [20, -86], [46, -84])} /></g>
          <g>{rot(`-4 ${S.x} ${S.y};3 ${S.x} ${S.y};-4 ${S.x} ${S.y}`, '0.34s')}<polyline className="line" points={pts([S.x, S.y], [14, -90], [40, -92])} /></g>
        </>
      );
    case 'think':
      return (
        <>
          <polyline className="line" points={pts([S.x, S.y], [-18, -84], [-22, -62])} />
          <polyline className="line" points={pts([S.x, S.y], [24, -96], [14, -128])} />
        </>
      );
    case 'report':
      return (
        <>
          <polyline className="line" points={pts([S.x, S.y], [-18, -84], [-22, -62])} />
          <polyline className="line" points={pts([S.x, S.y], [24, -92], [40, -104])} />
          <rect x={34} y={-132} width={26} height={32} rx={3} className="svg-panel" />
          <path d="M40 -116 l5 5 l9 -11" className="facestroke" />
        </>
      );
    case 'cheer':
      return (
        <>
          <polyline className="line" points={pts([S.x, S.y], [-24, -128], [-34, -156])} />
          <polyline className="line" points={pts([S.x, S.y], [24, -128], [34, -156])} />
        </>
      );
    case 'highfive':
      return (
        <>
          <polyline className="line" points={pts([S.x, S.y], [-18, -84], [-22, -62])} />
          <polyline className="line" points={pts([S.x, S.y], [26, -146], [44, -182])} />
          <circle cx={46} cy={-186} r={6} className="head" />
        </>
      );
    case 'wait':
      return (
        <>
          <polyline className="line" points={pts([S.x, S.y], [-14, -80], [-10, -56])} />
          <polyline className="line" points={pts([S.x, S.y], [14, -80], [10, -56])} />
        </>
      );
    case 'walk':
      return (
        <>
          <g>{motion ? <animateTransform attributeName="transform" type="rotate" dur="0.52s" values={`-22 ${S.x} ${S.y};22 ${S.x} ${S.y};-22 ${S.x} ${S.y}`} repeatCount="indefinite" /> : null}<polyline className="line" points={pts([S.x, S.y], [-4, -84], [-2, -60])} /></g>
          <g>{motion ? <animateTransform attributeName="transform" type="rotate" dur="0.52s" values={`22 ${S.x} ${S.y};-22 ${S.x} ${S.y};22 ${S.x} ${S.y}`} repeatCount="indefinite" /> : null}<polyline className="line" points={pts([S.x, S.y], [4, -84], [2, -60])} /></g>
        </>
      );
    case 'stand':
    default:
      return (
        <>
          <polyline className="line" points={pts([S.x, S.y], [-20, -84], [-24, -60])} />
          <polyline className="line" points={pts([S.x, S.y], [20, -84], [24, -60])} />
        </>
      );
  }
}

function Head({ face }: { face: Face }) {
  const cx = 2;
  const cy = -152;
  return (
    <g>
      <circle className="head" cx={cx} cy={cy} r={29} />
      {face === 'happy' ? (
        <>
          <path className="facestroke" d={`M${cx - 14} ${cy - 4} q5 -7 10 0`} />
          <path className="facestroke" d={`M${cx + 5} ${cy - 4} q5 -7 10 0`} />
          <path className="facefill" d={`M${cx - 10} ${cy + 6} h22 q-2 13 -11 13 q-9 0 -11 -13Z`} />
          <path className="tongue" d={`M${cx - 4} ${cy + 15} q5 -5 10 0 q-5 4 -10 0Z`} />
        </>
      ) : (
        <>
          <circle className="facefill" cx={cx - 9} cy={cy - 4} r={3.4} />
          <circle className="facefill" cx={cx + 10} cy={cy - 4} r={3.4} />
          {face === 'focused' ? (
            <>
              <path className="facestroke" d={`M${cx - 15} ${cy - 15} l10 4`} />
              <path className="facestroke" d={`M${cx + 16} ${cy - 15} l-10 4`} />
              <path className="facestroke" d={`M${cx - 7} ${cy + 11} h14`} />
            </>
          ) : face === 'worried' ? (
            <>
              <path className="facestroke" d={`M${cx - 15} ${cy - 11} l10 -5`} />
              <path className="facestroke" d={`M${cx + 16} ${cy - 11} l-10 -5`} />
              <path className="facestroke" d={`M${cx - 8} ${cy + 12} q4 -4 8 0 q4 4 8 0`} />
            </>
          ) : face === 'troubled' ? (
            <>
              <path className="facestroke" d={`M${cx - 15} ${cy - 10} l10 -6`} />
              <path className="facestroke" d={`M${cx + 16} ${cy - 10} l-10 -6`} />
              <path className="facestroke" d={`M${cx - 9} ${cy + 15} q9 -9 18 0`} />
            </>
          ) : face === 'neutral' ? (
            <path className="facestroke" d={`M${cx - 6} ${cy + 11} h12`} />
          ) : (
            <path className="facestroke" d={`M${cx - 10} ${cy + 7} q10 10 20 0`} />
          )}
        </>
      )}
    </g>
  );
}
