// Display-side masking (an extra; the main protection is that nothing is stored). We never show file contents, env values or secrets.
// This is best-effort for short strings we DO show (commands, paths, error lines).

const SECRET_ASSIGN = /\b([A-Za-z_][A-Za-z0-9_]*(?:key|token|secret|passw(?:or)?d|pwd|auth|credential|cookie|session)[A-Za-z0-9_]*)\s*[=:]\s*("[^"]*"|'[^']*'|\S+)/gi;
const BEARER = /\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
// Long runs that mix letters and digits (API keys, hex/base64 tokens). Plain long words and paths are kept readable.
const LONG_TOKEN = /\b(?=[A-Za-z0-9_+=-]*\d)(?=[A-Za-z0-9_+=-]*[A-Za-z])[A-Za-z0-9_+=-]{32,}\b/g;
const KNOWN_PREFIX = /\b(sk-[A-Za-z0-9_-]{6,}|gh[pousr]_[A-Za-z0-9]{10,}|xox[abpr]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{12,})\b/g;
const URL_CREDS = /(\w+:\/\/)[^\s/:@]+:[^\s/@]+@/g;

export function maskSecrets(s: string): string {
  return s
    .replace(SECRET_ASSIGN, (_m, k: string) => `${k}=***`)
    .replace(BEARER, (_m, k: string) => `${k} ***`)
    .replace(URL_CREDS, '$1***@')
    .replace(KNOWN_PREFIX, '***')
    .replace(LONG_TOKEN, '***');
}

export function clip(s: string, n: number): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > n ? one.slice(0, n) + '…' : one;
}

const SENSITIVE_PATH = /(^|[\\/])(\.env(\.[^\\/]*)?|\.credentials\.json|id_(rsa|ed25519|ecdsa)(\.pub)?|[^\\/]*\.(pem|key|p12|pfx))$/i;

/** Show only the file name, and hide names that themselves look sensitive. */
export function displayPath(p: unknown): string {
  if (typeof p !== 'string' || !p) return '';
  if (SENSITIVE_PATH.test(p)) return '(sensitive file)';
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts.slice(-2).join('/');
}
