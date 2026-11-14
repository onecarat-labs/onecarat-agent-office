// Display-side masking (an extra; the main protection is that nothing is stored). We never show file contents, env values or secrets.
// This is best-effort for short strings we DO show (commands, paths, error lines).

// `KEY=value`, `token: value`, `X-API-Key: value`, `--token=value`, `?token=value`: the name may be the bare keyword and may
// contain '-' (HTTP header names, CLI flags). The value may be quoted.
// `auth(?!or\b)` keeps `author:` readable while still catching `authorization:`.
// The name parts are length-bounded on purpose. Unbounded (`*`), a text like `key-key-key-…` made the engine try
// every split of every run: 4000 characters took a second and a 64 KB CLAUDE.md froze the bridge (ReDoS).
const SECRET_ASSIGN = /(?<![A-Za-z0-9_])([A-Za-z0-9_-]{0,48}?(?:key|token|secret|passw(?:or)?d|pwd|auth(?!or\b)|credential|cookie|session)[A-Za-z0-9_-]{0,48})\s{0,8}[=:]\s{0,8}("[^"]*"|'[^']*'|\S+)/gi;
// `--token value`: a CLI flag whose name looks secret, followed by its value as the next word.
const SECRET_FLAG = /(?<![A-Za-z0-9_])(--?[A-Za-z0-9_-]{0,48}?(?:key|token|secret|passw(?:or)?d|pwd|auth(?!or\b)|credential)[A-Za-z0-9_-]{0,48})\s{1,8}("[^"]*"|'[^']*'|[^\s=:-]\S*)/gi;
const BEARER = /\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
// Long runs that mix letters and digits (API keys, hex/base64 tokens). Plain long words and paths are kept readable.
const TOKEN_RUN = /[A-Za-z0-9_+=-]{32,}/g;
const EDGE = new Set(['+', '=', '-']);
/**
 * One run of token characters: masked when, without leading/trailing + = -, it is 32+ long and has a letter and a
 * digit. Done in code, not with look-aheads: a look-ahead per position re-read the rest of the run every time,
 * which is quadratic on a long run of `a-a-a-…`.
 */
function maskRun(run: string): string {
  let i = 0;
  let j = run.length;
  while (i < j && EDGE.has(run[i]!)) i++;
  while (j > i && EDGE.has(run[j - 1]!)) j--;
  const core = run.slice(i, j);
  if (core.length < 32 || !/\d/.test(core) || !/[A-Za-z]/.test(core)) return run;
  return run.slice(0, i) + '***' + run.slice(j);
}

const KNOWN_PREFIX = /\b(sk-[A-Za-z0-9_-]{6,}|gh[pousr]_[A-Za-z0-9]{10,}|xox[abpr]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{12,})\b/g;
// Starts only at the beginning of a word and has bounded parts, so a long `x://a:x://a:…` cannot make it re-scan.
const URL_CREDS = /(?<!\w)(\w{1,64}:\/\/)[^\s/:@]{1,256}:[^\s/@]{1,512}@/g;

export function maskSecrets(s: string): string {
  return s
    // Bearer first: `Authorization: Bearer xxx` would otherwise become `Authorization=*** xxx` (the keyword consumed as the value).
    .replace(BEARER, (_m, k: string) => `${k} ***`)
    .replace(SECRET_ASSIGN, (_m, k: string) => `${k}=***`)
    .replace(SECRET_FLAG, (_m, k: string) => `${k} ***`)
    .replace(URL_CREDS, '$1***@')
    .replace(KNOWN_PREFIX, '***')
    .replace(TOKEN_RUN, maskRun);
}

export function clip(s: string, n: number): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > n ? one.slice(0, n) + '…' : one;
}

const SENSITIVE_PATH = /(^|[\\/])(\.env(\.[^\\/]*)?|\.credentials\.json|id_(rsa|ed25519|ecdsa)(\.pub)?|[^\\/]*\.(pem|key|p12|pfx))$/i;

export function isSensitivePath(p: string): boolean {
  return SENSITIVE_PATH.test(p);
}

/** Show only the file name, and hide names that themselves look sensitive. */
export function displayPath(p: unknown): string {
  if (typeof p !== 'string' || !p) return '';
  if (SENSITIVE_PATH.test(p)) return '(sensitive file)';
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts.slice(-2).join('/');
}
