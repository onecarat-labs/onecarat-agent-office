// UI delivery responsibility: Server-Sent Events. One-way, same-origin, no persistence.
import type { ServerResponse } from 'node:http';
import type { OfficeEvent } from '@onecarat/domain';
import type { EventStore } from './store.ts';

export class Broadcaster {
  private clients = new Set<ServerResponse>();
  private heartbeat: NodeJS.Timeout;
  private readonly store: EventStore;

  constructor(store: EventStore) {
    this.store = store;
    store.subscribe((batch) => this.send('events', batch));
    this.heartbeat = setInterval(() => {
      for (const c of this.clients) c.write(': ping\n\n');
    }, 15000);
    this.heartbeat.unref();
  }

  attach(res: ServerResponse, headers: Record<string, string>): void {
    res.writeHead(200, { ...headers, 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.write('retry: 2000\n\n');
    write(res, 'snapshot', this.store.snapshot());
    this.clients.add(res);
    res.on('close', () => this.clients.delete(res));
  }

  /** Tell UIs to drop their state (e.g. the user cleared the in-memory history). */
  reset(): void {
    this.send('snapshot', []);
  }

  private send(name: string, events: OfficeEvent[]): void {
    for (const c of this.clients) write(c, name, events);
  }

  close(): void {
    clearInterval(this.heartbeat);
    for (const c of this.clients) c.end();
    this.clients.clear();
  }

  get count(): number {
    return this.clients.size;
  }
}

function write(res: ServerResponse, name: string, events: OfficeEvent[]): void {
  res.write(`event: ${name}\ndata: ${JSON.stringify(events)}\n\n`);
}
