import { useEffect, useReducer, useState } from 'react';
import { initialOfficeState, reduceOffice, type OfficeEvent, type OfficeState } from '@onecarat/domain';
import { authHeaders, officeToken } from './token.ts';

/** locked = a bridge answers, but this page has no (valid) access key. */
export type LinkStatus = 'checking' | 'connected' | 'reconnecting' | 'unavailable' | 'locked';

type Action = { kind: 'snapshot'; events: OfficeEvent[] } | { kind: 'events'; events: OfficeEvent[] };

function reducer(state: OfficeState, a: Action): OfficeState {
  // Live feed accepts live events only; a demo event can never enter the live state.
  const live = a.events.filter((e) => e.source === 'live');
  if (a.kind === 'snapshot') return live.reduce(reduceOffice, initialOfficeState);
  return live.reduce(reduceOffice, state);
}

/**
 * Connects to the local bridge (same origin). The event stream is Server-Sent Events read with fetch, because
 * EventSource cannot send the access-key header. State lives in memory only.
 */
export function useLiveFeed(enabled: boolean) {
  const [state, dispatch] = useReducer(reducer, initialOfficeState);
  const [status, setStatus] = useState<LinkStatus>('checking');

  useEffect(() => {
    if (!enabled) return;
    const ac = new AbortController();
    let retry: ReturnType<typeof setTimeout> | undefined;

    const connect = async () => {
      try {
        const r = await fetch('/events', { headers: authHeaders(), cache: 'no-store', signal: ac.signal });
        if (r.status === 401) return setStatus('locked');
        if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
        setStatus('connected');
        const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
        let buf = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += value;
          let i: number;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const block = buf.slice(0, i);
            buf = buf.slice(i + 2);
            let name = 'message';
            let data = '';
            for (const line of block.split('\n')) {
              if (line.startsWith('event: ')) name = line.slice(7);
              else if (line.startsWith('data: ')) data += line.slice(6);
            }
            if ((name === 'snapshot' || name === 'events') && data) dispatch({ kind: name, events: JSON.parse(data) as OfficeEvent[] });
          }
        }
        throw new Error('stream ended');
      } catch {
        if (ac.signal.aborted) return;
        // The bridge answered health already: keep retrying instead of falling back to the demo.
        setStatus('reconnecting');
        retry = setTimeout(() => void connect(), 2000);
      }
    };

    (async () => {
      // Is anything Office-like listening? (No data without the key.)
      try {
        const r = await fetch('/api/health', { headers: authHeaders(), cache: 'no-store', signal: ac.signal });
        const j = (await r.json()) as { app?: string; authed?: boolean };
        if (j.app !== 'onecarat-agent-office') throw new Error('not a bridge');
        if (!officeToken() || j.authed === false) return setStatus('locked');
      } catch {
        if (!ac.signal.aborted) setStatus('unavailable');
        return;
      }
      void connect();
    })();

    return () => {
      ac.abort();
      clearTimeout(retry);
    };
  }, [enabled]);

  return { state, status };
}
