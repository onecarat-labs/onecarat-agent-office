import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { TerminalLink } from './live/useTerminal.ts';

/** xterm.js view of the embedded `claude`. Keystrokes go to the terminal only when the user types them. */
const BASE_FONT = 13;

export function TerminalView({ term, label, fontScale = 1, onZoom }: { term: TerminalLink; label: string; fontScale?: number; onZoom?: (dir: -1 | 1) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const x = useRef<XTerm | undefined>(undefined);
  const fitRef = useRef<FitAddon | undefined>(undefined);
  const { send, attach } = term;
  const fontSize = Math.round(BASE_FONT * fontScale);
  const fontSizeRef = useRef(fontSize);
  fontSizeRef.current = fontSize;

  useEffect(() => {
    const el = host.current!;
    const xt = new XTerm({
      fontFamily: "'Cascadia Mono', Consolas, Menlo, 'DejaVu Sans Mono', monospace",
      fontSize: fontSizeRef.current,
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
    // While claude has mouse reporting on, a right click is already sent to it as a button press; xterm would
    // still let the browser menu open on top. Give the click to claude only. Shift+right click keeps the browser
    // menu (copy/paste), matching xterm's "Shift forces selection" rule.
    const onContextMenu = (ev: MouseEvent) => {
      if (ev.shiftKey || xt.modes.mouseTrackingMode === 'none') return;
      ev.preventDefault();
      ev.stopPropagation();
    };
    el.addEventListener('contextmenu', onContextMenu, true);
    attach({ write: (d) => xt.write(d), reset: () => xt.reset() });
    return () => {
      attach(undefined);
      el.removeEventListener('contextmenu', onContextMenu, true);
      sub.dispose();
      ro.disconnect();
      xt.dispose();
      x.current = undefined;
    };
  }, [send, attach]);

  // Text size changed in the settings: same pane, different cols/rows.
  useEffect(() => {
    const xt = x.current;
    if (!xt || xt.options.fontSize === fontSize) return;
    xt.options.fontSize = fontSize;
    try {
      fitRef.current?.fit();
      send({ t: 'resize', cols: xt.cols, rows: xt.rows });
    } catch {
      /* not laid out (pane hidden): the ResizeObserver refits when it shows */
    }
  }, [fontSize, send]);

  // Ctrl + wheel over the terminal: one step larger / smaller (instead of the browser zooming the whole page).
  // Only over the terminal, only with Ctrl: plain wheel scrolling and the page zoom elsewhere are untouched.
  const onZoomRef = useRef(onZoom);
  onZoomRef.current = onZoom;
  useEffect(() => {
    const el = host.current!;
    let lastZoom = 0;
    const onWheel = (ev: WheelEvent) => {
      if (!ev.ctrlKey || !onZoomRef.current || ev.deltaY === 0) return;
      ev.preventDefault();
      ev.stopPropagation();
      // A touchpad pinch arrives as a burst of Ctrl+wheel events: one step per burst, not one per event.
      const now = Date.now();
      if (now - lastZoom < 150) return;
      lastZoom = now;
      onZoomRef.current(ev.deltaY < 0 ? 1 : -1);
    };
    el.addEventListener('wheel', onWheel, { capture: true, passive: false });
    return () => el.removeEventListener('wheel', onWheel, true);
  }, []);

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
