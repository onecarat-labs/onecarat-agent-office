// Which language the launcher speaks: Japanese when the Windows display language is Japanese, English
// otherwise. There is no option and no setting for it.
//
// Node itself only knows the regional format ("ja-JP" for dates and numbers), which a user may set apart from
// the display language. Windows keeps the display language in the registry, so the launcher reads it there
// (read only, with reg.exe from the Windows folder) and falls back to the regional format.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { langOf, type Lang } from '@onecarat/domain';

/** Where Windows keeps the display language, most specific first: the user's own choice, then the PC's. */
const KEYS: [key: string, value: string][] = [
  ['HKCU\\Control Panel\\Desktop', 'PreferredUILanguages'],
  ['HKCU\\Control Panel\\Desktop\\MuiCached', 'MachinePreferredUILanguages'],
];

/** The first language tag in the output of `reg query <key> /v <value>` ("… REG_MULTI_SZ    ja-JP\0en-US"). */
export function firstLanguageInRegOutput(out: string, value: string): string | undefined {
  for (const line of out.split(/\r?\n/)) {
    const m = /^\s*(\S+)\s+REG_(?:MULTI_)?SZ\s+(\S.*)$/.exec(line);
    if (!m || m[1]!.toLowerCase() !== value.toLowerCase()) continue;
    const tag = m[2]!.split(/\\0|\s/)[0]!;
    if (/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]+)*$/.test(tag)) return tag;
  }
  return undefined;
}

type Query = (key: string, value: string) => string | undefined;

function regQuery(key: string, value: string): string | undefined {
  const root = process.env.SystemRoot;
  if (!root) return undefined;
  try {
    return execFileSync(path.join(root, 'System32', 'reg.exe'), ['query', key, '/v', value], { encoding: 'utf8', timeout: 2000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return undefined; // no such value (the usual case for the user's own choice), or reg.exe did not run
  }
}

/** The Windows display language as a tag, or undefined where it cannot be read (not Windows, no registry value). */
export function windowsDisplayLanguage(platform: string = process.platform, query: Query = regQuery): string | undefined {
  if (platform !== 'win32') return undefined;
  for (const [key, value] of KEYS) {
    const out = query(key, value);
    const tag = out === undefined ? undefined : firstLanguageInRegOutput(out, value);
    if (tag) return tag;
  }
  return undefined;
}

export function detectLang(platform: string = process.platform, query: Query = regQuery, fallback: () => string = () => Intl.DateTimeFormat().resolvedOptions().locale): Lang {
  let tag = windowsDisplayLanguage(platform, query);
  if (!tag) {
    try {
      tag = fallback();
    } catch {
      tag = undefined;
    }
  }
  return langOf(tag);
}
