import type { AgentState } from './types.ts';

export type Face = 'neutral' | 'smile' | 'focused' | 'worried' | 'troubled' | 'happy';
export type Pose = 'stand' | 'type' | 'think' | 'wait' | 'report' | 'cheer';
export type BubbleKey =
  | 'delegating'
  | 'thinking'
  | 'reading'
  | 'editing'
  | 'executing'
  | 'testing'
  | 'researching'
  | 'reporting'
  | 'waiting_permission'
  | 'blocked'
  | 'retrying'
  | 'failed'
  | 'done'
  | 'done_unknown';

export interface Expression {
  face: Face;
  pose: Pose;
  sweat: boolean;
  bubble?: { key: BubbleKey; tone: 'accent' | 'warn' | 'ok' | 'danger' | 'muted' };
  /** Indeterminate activity indicator (never a percentage unless progress is measured/estimated). */
  busy: boolean;
}

/**
 * Derive how a figure looks from its state. Pure, so tests can pin the rules:
 * - failure -> troubled face, never a celebration
 * - waiting for permission -> stopped, amber bubble (Office never answers it)
 * - celebration only for an estimated success that the manager acknowledged
 */
export function expressionOf(a: AgentState): Expression {
  switch (a.status) {
    case 'waiting_permission':
      return { face: 'neutral', pose: 'wait', sweat: false, bubble: { key: 'waiting_permission', tone: 'warn' }, busy: false };
    case 'blocked':
      return { face: 'worried', pose: 'stand', sweat: false, bubble: { key: 'blocked', tone: 'warn' }, busy: false };
    case 'failed':
      return { face: 'troubled', pose: 'stand', sweat: true, bubble: { key: 'failed', tone: 'danger' }, busy: false };
    case 'completed': {
      const celebrate = a.outcome === 'success_estimated' && a.acknowledged;
      return {
        face: celebrate ? 'happy' : 'smile',
        pose: celebrate ? 'cheer' : 'report',
        sweat: false,
        bubble: { key: a.outcome === 'success_estimated' ? 'done' : 'done_unknown', tone: a.outcome === 'success_estimated' ? 'ok' : 'muted' },
        busy: false,
      };
    }
    case 'delegating':
      return { face: 'smile', pose: 'stand', sweat: false, bubble: { key: 'delegating', tone: 'accent' }, busy: true };
    case 'working': {
      if (a.failureStreak > 0) {
        return { face: 'worried', pose: 'type', sweat: true, bubble: { key: 'retrying', tone: 'warn' }, busy: true };
      }
      const act = a.activity ?? 'other';
      if (act === 'thinking') return { face: 'neutral', pose: 'think', sweat: false, bubble: { key: 'thinking', tone: 'muted' }, busy: true };
      if (act === 'reporting') return { face: 'smile', pose: 'report', sweat: false, bubble: { key: 'reporting', tone: 'ok' }, busy: false };
      const key: BubbleKey = act === 'other' ? 'executing' : act;
      return { face: 'focused', pose: 'type', sweat: false, bubble: { key, tone: act === 'testing' ? 'warn' : 'accent' }, busy: true };
    }
    case 'created':
      return { face: 'smile', pose: 'stand', sweat: false, busy: false };
    case 'idle':
    case 'unknown':
    default:
      return { face: 'smile', pose: 'stand', sweat: false, busy: false };
  }
}
