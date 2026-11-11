// Settings view, three panes: menu (Office display + Claude Code topics) / list / detail.
// Office's own display settings are edited here and kept in this browser. Claude Code's configuration is every
// documented location, present or not, with what it is for and (when present) its current content as read by
// the bridge. That part is read-only: changes are made by asking Claude Code.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { authHeaders } from '../live/token.ts';
import { dict, type Lang } from '../i18n.ts';
import { CATALOG, KEY_TEXT, LAYER_TEXT, OWNER_TEXT, TOPICS, type CatalogEntry, type Layer } from './catalog.ts';

export type Theme = 'system' | 'light' | 'dark';
export type Motion = 'system' | 'reduce' | 'full';

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
const DISPLAY = 'display';
type DisplayId = 'theme' | 'motion' | 'language';
const DISPLAY_IDS: DisplayId[] = ['theme', 'motion', 'language'];

export interface SettingsProps {
  lang: Lang; setLang: (v: Lang) => void;
  theme: Theme; setTheme: (v: Theme) => void;
  motion: Motion; setMotion: (v: Motion) => void;
  cwds: string[];
  live: boolean;
}

export function SettingsView(p: SettingsProps) {
  const { lang, cwds, live } = p;
  const t = dict[lang];
  const [cwd, setCwd] = useState<string | undefined>(cwds[0]);
  const [scan, setScan] = useState<ConfigScan | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [topicId, setTopicId] = useState<string>(DISPLAY);
  // Selected row per menu entry, so coming back to a topic shows what was open.
  const [picked, setPicked] = useState<Record<string, string>>({});

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
  const folders = [...new Set([...(scan ? [scan.cwd] : []), ...cwds])];
  const topic = TOPICS.find((x) => x.id === topicId);
  const inUse = (ids: string[]) => ids.filter((id) => statusOf(byId.get(id)) === 'present').length;
  const summary = (ids: string[]) => t.cfgSummary.replace('{n}', String(inUse(ids))).replace('{total}', String(ids.length));
  const pick = (id: string) => setPicked((cur) => ({ ...cur, [topicId]: id }));

  const displayLabel: Record<DisplayId, string> = { theme: t.theme, motion: t.motion, language: t.language };
  const modeLabel = { system: t.system, light: t.light, dark: t.dark, reduce: t.reduce, full: t.full };
  const displayValue: Record<DisplayId, string> = { theme: modeLabel[p.theme], motion: modeLabel[p.motion], language: lang === 'ja' ? '日本語' : 'English' };

  let list: React.ReactNode;
  let detail: React.ReactNode;
  if (topic) {
    const entries = CATALOG.filter((c) => topic.ids.includes(c.id));
    // Default row: the first location in use (else the first one), until the user picks.
    const selected = entries.find((c) => c.id === picked[topic.id]) ?? entries.find((c) => statusOf(byId.get(c.id)) === 'present') ?? entries[0]!;
    list = (
      <nav className="cfg-list" aria-label={topic.text[lang].title}>
        <div className="cfg-list-head">
          <h3>{topic.text[lang].title}</h3>
          {scan ? <span className="sub">{summary(topic.ids)}</span> : null}
          <p>{topic.text[lang].note}</p>
        </div>
        {LAYERS.filter((layer) => entries.some((c) => c.layer === layer)).map((layer) => (
          <div key={layer} className="cfg-layer">
            <h4 title={LAYER_TEXT[lang][layer].note}>{LAYER_TEXT[lang][layer].title}</h4>
            {entries.filter((c) => c.layer === layer).map((c) => {
              const st = statusOf(byId.get(c.id));
              return (
                <button key={c.id} className={`cfg-item st-${st}`} aria-current={selected.id === c.id} onClick={() => pick(c.id)}>
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
    );
    detail = <Detail cat={selected} entry={byId.get(selected.id)} lang={lang} />;
  } else {
    const selected = DISPLAY_IDS.find((id) => id === picked[DISPLAY]) ?? 'theme';
    list = (
      <nav className="cfg-list" aria-label={t.setDisplay}>
        <div className="cfg-list-head">
          <h3>{t.setDisplay}</h3>
          <p>{t.setDisplayNote}</p>
        </div>
        <div className="cfg-layer">
          {DISPLAY_IDS.map((id) => (
            <button key={id} className="cfg-item plain" aria-current={selected === id} onClick={() => pick(id)}>
              <span className="name">{displayLabel[id]}</span>
              <span className="state">{displayValue[id]}</span>
            </button>
          ))}
        </div>
      </nav>
    );
    detail = (
      <article className="cfg-detail panel">
        <div className="cfg-detail-head ruled"><h3 className="plain">{displayLabel[selected]}</h3></div>
        <div className="cfg-scroll">
          {selected === 'theme' ? (
            <Choice name="theme" label={t.theme} about={t.setThemeAbout} value={p.theme} onChange={p.setTheme} options={[['system', t.system], ['light', t.light], ['dark', t.dark]]} />
          ) : selected === 'motion' ? (
            <Choice name="motion" label={t.motion} about={t.setMotionAbout} value={p.motion} onChange={p.setMotion} options={[['system', t.system], ['reduce', t.reduce], ['full', t.full]]} note={t.highFiveNote} />
          ) : (
            <Choice name="language" label={t.language} about={t.setLanguageAbout} value={lang} onChange={p.setLang} options={[['ja', '日本語'], ['en', 'English']]} />
          )}
        </div>
      </article>
    );
  }

  return (
    <section className="config-view" aria-label={t.settings}>
      <div className="cfg-head">
        <h2>{t.settings}</h2>
        <div className="spacer" />
        {topic && live ? (
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
      <p className="cfg-note">{!topic ? t.setOfficeIntro : live ? (failed ? t.cfgFailed : t.cfgIntro) : t.cfgOffline}</p>

      <div className="cfg-body">
        <nav className="cfg-menu" aria-label={t.settings}>
          <h3>Office</h3>
          <button className="cfg-menu-item" aria-current={!topic} onClick={() => setTopicId(DISPLAY)}><span>{t.setDisplay}</span></button>
          <h3>Claude Code</h3>
          {TOPICS.map((x) => (
            <button key={x.id} className="cfg-menu-item" aria-current={topic?.id === x.id} onClick={() => setTopicId(x.id)}>
              <span>{x.text[lang].title}</span>
              {scan ? <span className="count" title={summary(x.ids)}>{inUse(x.ids)}/{x.ids.length}</span> : null}
            </button>
          ))}
        </nav>
        {list}
        {detail}
      </div>
    </section>
  );
}

function Choice<T extends string>({ name, label, about, value, onChange, options, note }: { name: string; label: string; about: string; value: T; onChange: (v: T) => void; options: [T, string][]; note?: string }) {
  return (
    <>
      <p className="set-about">{about}</p>
      <div className="set-choices" role="radiogroup" aria-label={label}>
        {options.map(([v, text]) => (
          <label key={v} className="set-choice">
            <input type="radio" name={name} checked={value === v} onChange={() => onChange(v)} />
            <span>{text}</span>
          </label>
        ))}
      </div>
      {note ? <p className="cfg-small">{note}</p> : null}
    </>
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
