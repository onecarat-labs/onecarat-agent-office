// Claude Code configuration view: every documented location, present or not, with what it is for and
// (when present) its current content as read by the bridge. Read-only: changes are made by asking Claude Code.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { authHeaders } from '../live/token.ts';
import { dict, type Lang } from '../i18n.ts';
import { CATALOG, KEY_TEXT, LAYER_TEXT, OWNER_TEXT, type CatalogEntry, type Layer } from './catalog.ts';

/** Mirrors packages/event-bridge/src/config-scan.ts (the UI does not import Node code). */
interface ConfigItem { name: string; file: string; description?: string }
interface ConfigEntry {
  id: string;
  layer: Layer;
  kind: string;
  path: string;
  exists: boolean;
  error?: string;
  size?: number;
  mtime?: number;
  json?: unknown;
  text?: string;
  truncated?: boolean;
  items?: ConfigItem[];
}
interface ConfigScan { cwd: string; userDir: string; scannedAt: number; entries: ConfigEntry[] }

type Status = 'present' | 'empty' | 'missing' | 'error' | 'unknown';

function statusOf(e: ConfigEntry | undefined): Status {
  if (!e) return 'unknown';
  if (e.error) return 'error';
  if (!e.exists) return 'missing';
  if (e.items && e.items.length === 0 && !e.text) return 'empty';
  return 'present';
}

const LAYERS: Layer[] = ['managed', 'user', 'project'];

export function ConfigView({ lang, cwds, live }: { lang: Lang; cwds: string[]; live: boolean }) {
  const t = dict[lang];
  const [cwd, setCwd] = useState<string | undefined>(cwds[0]);
  const [scan, setScan] = useState<ConfigScan | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState('user-settings');

  const load = useCallback(async () => {
    if (!live) return;
    setLoading(true);
    try {
      const q = cwd ? `?cwd=${encodeURIComponent(cwd)}` : '';
      const r = await fetch(`/api/config${q}`, { headers: authHeaders(), cache: 'no-store' });
      if (!r.ok) throw new Error(String(r.status));
      setScan((await r.json()) as ConfigScan);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [cwd, live]);
  useEffect(() => void load(), [load]);

  const byId = useMemo(() => new Map((scan?.entries ?? []).map((e) => [e.id, e])), [scan]);
  const present = CATALOG.filter((c) => statusOf(byId.get(c.id)) === 'present').length;
  const cat = CATALOG.find((c) => c.id === selected) ?? CATALOG[0]!;
  const folders = [...new Set([...(scan ? [scan.cwd] : []), ...cwds])];

  return (
    <section className="config-view" aria-label={t.cfgTitle}>
      <div className="cfg-head">
        <h2>{t.cfgTitle}</h2>
        {scan ? <span className="sub">{t.cfgSummary.replace('{n}', String(present)).replace('{total}', String(CATALOG.length))}</span> : null}
        <div className="spacer" />
        {live ? (
          <>
            <label className="cfg-folder">
              <span>{t.cfgProject}</span>
              <select value={cwd ?? scan?.cwd ?? ''} onChange={(e) => setCwd(e.target.value)}>
                {folders.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </label>
            <button className="btn" onClick={() => void load()} disabled={loading}>{loading ? t.cfgLoading : t.cfgReload}</button>
          </>
        ) : null}
      </div>
      <p className="cfg-note">{live ? (failed ? t.cfgFailed : t.cfgIntro) : t.cfgOffline}</p>

      <div className="cfg-body">
        <nav className="cfg-list" aria-label={t.cfgTitle}>
          {LAYERS.map((layer) => (
            <div key={layer} className="cfg-layer">
              <h3>{LAYER_TEXT[lang][layer].title}</h3>
              <p>{LAYER_TEXT[lang][layer].note}</p>
              {CATALOG.filter((c) => c.layer === layer).map((c) => {
                const st = statusOf(byId.get(c.id));
                return (
                  <button key={c.id} className={`cfg-item st-${st}`} aria-current={selected === c.id} onClick={() => setSelected(c.id)}>
                    <span className="dot" aria-hidden="true" />
                    <span className="name">{c.label}</span>
                    <span className="state">{statusText(t, st)}</span>
                  </button>
                );
              })}
            </div>
          ))}
          <p className="cfg-precedence">{t.cfgPrecedence}</p>
        </nav>
        <Detail cat={cat} entry={byId.get(cat.id)} lang={lang} />
      </div>
    </section>
  );
}

function statusText(t: (typeof dict)[Lang], st: Status): string {
  return st === 'present' ? t.cfgPresent : st === 'empty' ? t.cfgEmpty : st === 'missing' ? t.cfgMissing : st === 'error' ? t.cfgError : '—';
}

function Detail({ cat, entry, lang }: { cat: CatalogEntry; entry: ConfigEntry | undefined; lang: Lang }) {
  const t = dict[lang];
  const tx = cat.text[lang];
  const st = statusOf(entry);
  return (
    <article className="cfg-detail panel">
      <div className="cfg-detail-head">
        <h3>{cat.label}</h3>
        <span className={`pill ${st === 'present' ? 'ok' : st === 'error' ? 'danger' : 'muted'}`}>{statusText(t, st)}</span>
        <span className="pill muted">{OWNER_TEXT[lang][cat.owner]}</span>
      </div>
      {entry ? (
        <div className="cfg-path">
          <code>{entry.path}</code>
          <button className="btn" onClick={() => void navigator.clipboard?.writeText(entry.path)}>{t.cfgCopy}</button>
        </div>
      ) : null}
      <div className="cfg-scroll">
        <h4>{t.cfgRole}</h4>
        <p>{tx.role}</p>
        <h4>{t.cfgSettable}</h4>
        <ul>{tx.settable.map((s) => <li key={s}>{s}</li>)}</ul>

        <h4>{t.cfgCurrent}</h4>
        <Current entry={entry} lang={lang} />

        <h4>{t.cfgEdit}</h4>
        <p className="cfg-example">{tx.example}</p>
        <p className="cfg-small">{t.cfgEditNote}</p>
      </div>
    </article>
  );
}

function Current({ entry, lang }: { entry: ConfigEntry | undefined; lang: Lang }) {
  const t = dict[lang];
  if (!entry) return <p className="cfg-small">{t.cfgNoData}</p>;
  if (entry.error) return <p className="cfg-small">{t.cfgError}: {entry.error}</p>;
  if (!entry.exists) return <p className="cfg-small">{t.cfgNotYet}</p>;
  const meta = entry.mtime ? <p className="cfg-small">{t.cfgUpdated} {new Date(entry.mtime).toLocaleString(lang)}{entry.size !== undefined ? ` · ${entry.size.toLocaleString(lang)} B` : ''}</p> : null;
  return (
    <>
      {meta}
      {entry.json !== undefined ? <JsonKeys value={entry.json} lang={lang} /> : null}
      {entry.items ? (
        entry.items.length ? (
          <ul className="cfg-items">
            {entry.items.map((i) => (
              <li key={i.file}><b>{i.name}</b>{i.description ? <span> — {i.description}</span> : null}<code>{i.file}</code></li>
            ))}
          </ul>
        ) : (
          <p className="cfg-small">{t.cfgNoItems}</p>
        )
      ) : null}
      {entry.text !== undefined ? (
        <>
          {entry.kind === 'memory' ? <p className="cfg-small">MEMORY.md</p> : null}
          <pre className="cfg-pre">{entry.text || t.cfgBlank}</pre>
          {entry.truncated ? <p className="cfg-small">{t.cfgTruncated}</p> : null}
        </>
      ) : null}
    </>
  );
}

function JsonKeys({ value, lang }: { value: unknown; lang: Lang }) {
  const t = dict[lang];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return <pre className="cfg-pre">{JSON.stringify(value, null, 2)}</pre>;
  const keys = Object.entries(value as Record<string, unknown>);
  if (!keys.length) return <p className="cfg-small">{t.cfgBlank}</p>;
  return (
    <div className="cfg-keys">
      {keys.map(([k, v]) => (
        <div key={k} className="cfg-key">
          <div><code>{k}</code>{KEY_TEXT[lang][k] ? <span className="cfg-small"> — {KEY_TEXT[lang][k]}</span> : null}</div>
          <pre className="cfg-pre">{typeof v === 'string' ? v : JSON.stringify(v, null, 2)}</pre>
        </div>
      ))}
      <p className="cfg-small">{t.cfgHiddenNote}</p>
    </div>
  );
}
