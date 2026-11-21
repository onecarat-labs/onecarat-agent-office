// Where the window's events come from. The window only ever READS: it asks the app (Rust) for the hook inputs
// of its own session and turns them into the office state with the shared adapter and reducer. Nothing here
// (or anywhere in the page) can send anything toward Claude Code.
import { useEffect, useState } from 'react';
import { initialOfficeState, reduceOffice, type OfficeState, type SessionState } from '@onecarat/domain';
import { normalizeHook, type HookInput } from '@onecarat/adapter-claude-code';

/** One stored hook: [sequence number, receive time (ms), the hook input as forwarded]. */
type Item = [number, number, unknown];
interface Polled {
  /** Changes when the app gives this window to another session: the picture then starts from nothing. */
  epoch?: number;
  events?: Item[];
}
type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

declare global {
  interface Window {
    __TAURI__?: { core?: { invoke?: Invoke } };
    /** Only when the page runs outside the app (layout checks in a browser): feed hook inputs by hand. */
    officeDev?: { push: (hook: unknown, at?: number) => void };
  }
}

/** The app's command channel, or undefined in a plain browser. */
export function appInvoke(): Invoke | undefined {
  const f = typeof window !== 'undefined' ? window.__TAURI__?.core?.invoke : undefined;
  return typeof f === 'function' ? f : undefined;
}

/** Tell the app something about this window (title, close). Failures are ignored: the picture goes on. */
export function tellApp(cmd: string, args?: Record<string, unknown>): void {
  try {
    void appInvoke()?.(cmd, args)?.catch(() => undefined);
  } catch {
    /* not in the app */
  }
}

interface FeedState {
  office: OfficeState;
  sessionId?: string;
}

/** Apply stored hooks. A hook that cannot be understood is skipped; it never stops the others. */
export function applyItems(prev: FeedState, items: Item[]): FeedState {
  let { office, sessionId } = prev;
  for (const item of items) {
    try {
      if (!Array.isArray(item)) continue;
      const [seq, at, hook] = item;
      const events = normalizeHook(hook as HookInput, { source: 'live', at: typeof at === 'number' ? at : Date.now(), seq: Number(seq) || 0 });
      for (const e of events) {
        // A window shows one session: the first one it hears from.
        sessionId ??= e.sessionId;
        if (e.sessionId === sessionId) office = reduceOffice(office, e);
      }
    } catch {
      /* ignore this one */
    }
  }
  return office === prev.office && sessionId === prev.sessionId ? prev : { office, sessionId };
}

const POLL_MS = 200;

let epoch = 0;
/** The window's current epoch, sent back with "close_me" so that a late goodbye cannot close a reused window. */
export const currentEpoch = (): number => epoch;

export function useSession(): SessionState | undefined {
  const [st, setSt] = useState<FeedState>({ office: initialOfficeState });

  useEffect(() => {
    const invoke = appInvoke();
    let after = 0;
    if (!invoke) {
      window.officeDev = { push: (hook, at = Date.now()) => setSt((p) => applyItems(p, [[++after, at, hook]])) };
      return () => {
        delete window.officeDev;
      };
    }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const r = (await invoke('poll', { after })) as Polled | null;
        const items = Array.isArray(r?.events) ? r.events : [];
        const fresh = typeof r?.epoch === 'number' && r.epoch !== epoch;
        if (fresh) epoch = r.epoch as number;
        if ((items.length || fresh) && !stopped) {
          for (const it of items) if (Array.isArray(it) && typeof it[0] === 'number' && it[0] > after) after = it[0];
          setSt((p) => applyItems(fresh ? { office: initialOfficeState } : p, items));
        }
      } catch {
        /* the app is busy or closing: try again */
      }
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return st.sessionId ? st.office.sessions[st.sessionId] : undefined;
}
