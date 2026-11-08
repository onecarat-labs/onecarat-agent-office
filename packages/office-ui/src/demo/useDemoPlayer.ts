import { useEffect, useReducer, useRef, useState } from 'react';
import { initialOfficeState, reduceOffice, type OfficeEvent, type OfficeState } from '@onecarat/domain';
import { normalizeHook, type HookInput } from '@onecarat/adapter-claude-code';
import demo from '../../../../examples/demo-events/office-demo.json';

type Action = { kind: 'reset' } | { kind: 'events'; events: OfficeEvent[] };

function reducer(state: OfficeState, action: Action): OfficeState {
  if (action.kind === 'reset') return initialOfficeState;
  return action.events.reduce(reduceOffice, state);
}

const script = demo as { durationMs: number; events: { at: number; hook: HookInput }[] };
const LOOP_GAP_MS = 6000;

/**
 * Replays the scripted demo through the SAME adapter + reducer as live data.
 * Every event is tagged source:'demo' and the session id starts with "demo-", so it can never be mistaken for live data.
 */
export function useDemoPlayer(active: boolean) {
  const [state, dispatch] = useReducer(reducer, initialOfficeState);
  const [paused, setPaused] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const elapsed = useRef(0);
  const cursor = useRef(0);
  const seq = useRef(0);
  const startWall = useRef(Date.now());

  useEffect(() => {
    dispatch({ kind: 'reset' });
    elapsed.current = 0;
    cursor.current = 0;
    startWall.current = Date.now();
  }, [epoch]);

  useEffect(() => {
    if (paused || !active) return;
    let last = Date.now();
    const iv = setInterval(() => {
      const now = Date.now();
      elapsed.current += now - last;
      last = now;
      const due: OfficeEvent[] = [];
      while (cursor.current < script.events.length && script.events[cursor.current]!.at <= elapsed.current) {
        const { at, hook } = script.events[cursor.current++]!;
        due.push(...normalizeHook(hook, { source: 'demo', at: startWall.current + at, seq: ++seq.current }));
      }
      if (due.length) dispatch({ kind: 'events', events: due });
      if (elapsed.current > script.durationMs + LOOP_GAP_MS) setEpoch((n) => n + 1);
    }, 100);
    return () => clearInterval(iv);
  }, [paused, epoch, active]);

  // Keep wall-clock alignment when paused/resumed.
  useEffect(() => {
    if (!paused) startWall.current = Date.now() - elapsed.current;
  }, [paused]);

  return { state, paused, setPaused, restart: () => setEpoch((n) => n + 1) };
}
