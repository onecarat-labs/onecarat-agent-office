import { useCallback, useEffect, useRef, useState } from 'react';
import { officeToken } from './token.ts';

export interface TermState {
  available: boolean;
  reason?: string;
  running: boolean;
  cwd: string;
  sessionId?: string;
  exitCode?: number;
}
export type TermLink = 'connecting' | 'open' | 'closed';
export type TermSend = (m: { t: 'in'; d: string } | { t: 'resize'; cols: number; rows: number } | { t: 'start'; cwd?: string } | { t: 'stop' }) => void;
export interface TermSink {
  write(d: string): void;
  reset(): void;
}

/**
 * WebSocket link to the bridge's embedded terminal. The access key goes in a subprotocol (browsers cannot set
 * WebSocket headers); the server answers with "office.v1" only. Nothing is stored: output goes straight to xterm.
 */
export function useTerminal(enabled: boolean) {
  const [state, setState] = useState<TermState | undefined>();
  const [link, setLink] = useState<TermLink>('connecting');
  const ws = useRef<WebSocket | undefined>(undefined);
  const sink = useRef<TermSink | undefined>(undefined);
  const pending = useRef<string[]>([]);

  useEffect(() => {
    const token = officeToken();
    if (!enabled || !token) {
      setLink('closed');
      return;
    }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const open = () => {
      setLink('connecting');
      const s = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/pty`, ['office.v1', `office-token.${token}`]);
      ws.current = s;
      s.onopen = () => setLink('open');
      s.onmessage = (ev) => {
        const m = JSON.parse(String(ev.data)) as { t: 'state'; state: TermState } | { t: 'out'; d: string } | { t: 'reset' };
        if (m.t === 'state') setState(m.state);
        else if (m.t === 'out') {
          if (sink.current) sink.current.write(m.d);
          else pending.current.push(m.d);
        } else if (m.t === 'reset') {
          pending.current = [];
          sink.current?.reset();
        }
      };
      s.onclose = () => {
        setLink('closed');
        if (stopped) return;
        // The server replays its in-memory scrollback on reconnect, so start from a clean screen.
        timer = setTimeout(() => {
          pending.current = [];
          sink.current?.reset();
          open();
        }, 2000);
      };
    };
    open();
    return () => {
      stopped = true;
      clearTimeout(timer);
      ws.current?.close();
      ws.current = undefined;
    };
  }, [enabled]);

  const send = useCallback<TermSend>((m) => {
    const s = ws.current;
    if (s && s.readyState === WebSocket.OPEN) s.send(JSON.stringify(m));
  }, []);

  const attach = useCallback((s: TermSink | undefined) => {
    sink.current = s;
    if (s) {
      for (const d of pending.current) s.write(d);
      pending.current = [];
    }
  }, []);

  return { state, link, send, attach };
}

export type TerminalLink = ReturnType<typeof useTerminal>;
