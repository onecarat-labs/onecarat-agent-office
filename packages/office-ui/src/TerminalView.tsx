import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { TerminalLink } from './live/useTerminal.ts';

/** xterm.js view of the embedded `claude`. Keystrokes go to the terminal only when the user types them. */
export function TerminalView({ term, label }: { term: TerminalLink; label: string }) {
  const host = useRef<HTMLDivElement>(null);
  const x = useRef<XTerm | undefined>(undefined);
  const fitRef = useRef<FitAddon | undefined>(undefined);
  const { send, attach } = term;

  useEffect(() => {
    const el = host.current!;
    const xt = new XTerm({
      fontFamily: "'Cascadia Mono', Consolas, Menlo, 'DejaVu Sans Mono', monospace",
      fontSize: 13,
      cursorBlink: true,
      scrollback: 5000,
      // Claude Code draws for a dark terminal by default; keep one fixed dark palette in both page themes.
      theme: { background: '#0b1220', foreground: '#e2e8f0', cursor: '#38bdf8', selectionBackground: '#334155' },
    });
    const fit = new FitAddon();
    xt.loadAddon(fit);
    xt.open(el);
    x.current = xt;
    fitRef.current = fit;
    const refit = () => {
      try {
        fit.fit();
        send({ t: 'resize', cols: xt.cols, rows: xt.rows });
      } catch {
        /* not laid out yet */
      }
    };
    const ro = new ResizeObserver(refit);
    ro.observe(el);
    refit();
    const sub = xt.onData((d) => send({ t: 'in', d }));
    attach({ write: (d) => xt.write(d), reset: () => xt.reset() });
    return () => {
      attach(undefined);
      sub.dispose();
      ro.disconnect();
      xt.dispose();
      x.current = undefined;
    };
  }, [send, attach]);

  // Tell the pty our size again whenever a link (re)opens or claude (re)starts.
  useEffect(() => {
    const xt = x.current;
    if (!xt || term.link !== 'open') return;
    try {
      fitRef.current?.fit();
    } catch {
      /* ignore */
    }
    send({ t: 'resize', cols: xt.cols, rows: xt.rows });
    if (term.state?.running) xt.focus();
  }, [term.link, term.state?.running, term.state?.sessionId, send]);

  return <div className="term" ref={host} role="region" aria-label={label} />;
}
