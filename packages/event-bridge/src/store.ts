// Aggregation responsibility: keeps normalized events IN MEMORY ONLY (no disk persistence).
import type { OfficeEvent } from '@onecarat/domain';

export interface StoreOptions {
  /** Max events kept across all sessions. Oldest are dropped first. */
  maxEvents: number;
}

export type Listener = (events: OfficeEvent[]) => void;

export class EventStore {
  private events: OfficeEvent[] = [];
  private listeners = new Set<Listener>();
  private readonly opts: StoreOptions;
  constructor(opts: StoreOptions = { maxEvents: 20000 }) {
    this.opts = opts;
  }

  append(batch: OfficeEvent[]): void {
    if (batch.length === 0) return;
    this.events.push(...batch);
    const over = this.events.length - this.opts.maxEvents;
    if (over > 0) this.events.splice(0, over);
    for (const l of this.listeners) l(batch);
  }

  snapshot(): OfficeEvent[] {
    return this.events.slice();
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  clear(): void {
    this.events = [];
  }

  get size(): number {
    return this.events.length;
  }
}

/**
 * Async hooks run in parallel processes, so posts can arrive slightly out of order.
 * Hold events for a short window and release them sorted by the time the hook process started.
 */
export class ReorderBuffer {
  private pending: OfficeEvent[] = [];
  private timer: NodeJS.Timeout | undefined;
  private readonly windowMs: number;
  private readonly sink: (batch: OfficeEvent[]) => void;
  constructor(windowMs: number, sink: (batch: OfficeEvent[]) => void) {
    this.windowMs = windowMs;
    this.sink = sink;
  }

  push(events: OfficeEvent[]): void {
    this.pending.push(...events);
    if (!this.timer) this.timer = setTimeout(() => this.flush(), this.windowMs);
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    const batch = this.pending.sort((a, b) => a.at - b.at || cmpId(a.id, b.id));
    this.pending = [];
    if (batch.length) this.sink(batch);
  }
}

function cmpId(a: string, b: string): number {
  const [a1 = 0, a2 = 0] = a.split('.').map(Number);
  const [b1 = 0, b2 = 0] = b.split('.').map(Number);
  return a1 - b1 || a2 - b2;
}
