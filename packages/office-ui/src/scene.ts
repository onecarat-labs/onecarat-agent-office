// Pure rules of the small window's picture: how wide the office is drawn, how many desks fit, and which
// time of day the background shows. No DOM here, so node:test can pin them.

/** The office is always this tall in drawing units; its width follows the window's shape. */
export const STAGE_H = 480;
const MIN_W = 600;
const MAX_W = 2600;
/** Left edge of the subagent desks (the manager's area is to the left of it). */
export const DESKS_LEFT = 350;
const DESKS_RIGHT_MARGIN = 14;
/** A desk needs this much room: a figure with its status label must not run into its neighbour. */
const MIN_SPACING = 172;
const MAX_SPACING = 260;

export interface StageLayout {
  /** Width of the drawing in units (the viewBox is `0 0 w STAGE_H`). */
  w: number;
  /** How many subagent desks fit. Always at least 1. */
  capacity: number;
}

/** The drawing for a window of this size (CSS pixels). A degenerate size gives the smallest office. */
export function stageLayout(width: number, height: number): StageLayout {
  const aspect = width > 0 && height > 0 ? width / height : MIN_W / STAGE_H;
  const w = Math.round(Math.min(MAX_W, Math.max(MIN_W, STAGE_H * aspect)));
  const span = w - DESKS_RIGHT_MARGIN - DESKS_LEFT;
  return { w, capacity: Math.max(1, Math.floor(span / MIN_SPACING)) };
}

/** Desk centres for n subagents (n <= capacity) in an office of width w. */
export function deskSlots(w: number, n: number): { xs: number[]; deskW: number } {
  const span = w - DESKS_RIGHT_MARGIN - DESKS_LEFT;
  const spacing = n > 0 ? Math.min(MAX_SPACING, span / n) : MAX_SPACING;
  const start = DESKS_LEFT + (span - spacing * n) / 2 + spacing / 2;
  return { xs: Array.from({ length: n }, (_, i) => Math.round(start + i * spacing)), deskW: Math.round(Math.min(200, spacing - 26)) };
}

export type TimeOfDay = 'morning' | 'day' | 'evening' | 'night';

/**
 * The background for an hour of the PC's local clock (0-23):
 * morning 5:00-9:59, day 10:00-15:59, evening 16:00-18:59, night 19:00-4:59.
 * Anything that is not an hour counts as day.
 */
export function timeOfDay(hour: number): TimeOfDay {
  if (!Number.isFinite(hour)) return 'day';
  const h = ((Math.floor(hour) % 24) + 24) % 24;
  if (h >= 5 && h < 10) return 'morning';
  if (h >= 10 && h < 16) return 'day';
  if (h >= 16 && h < 19) return 'evening';
  return 'night';
}

/** The last part of a folder path ("C:\\proj\\my-app" -> "my-app"). Not a string, or empty: ''. */
export function folderName(cwd: unknown): string {
  if (typeof cwd !== 'string') return '';
  const parts = cwd.split(/[\\/]/).filter(Boolean);
  const last = parts[parts.length - 1] ?? '';
  return [...last].length > 40 ? [...last].slice(0, 39).join('') + '…' : last;
}
