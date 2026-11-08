// The per-launch access key. The launcher opens http://127.0.0.1:<port>/#t=<token>: the fragment is never sent
// to the server (so it is in no request line or log). It is moved out of the address bar at once and kept for
// this tab only (sessionStorage), so a reload keeps working but a new tab must be opened from the launcher.
const KEY = 'office.t';
let token: string | undefined;

function init(): string | undefined {
  const m = /(?:^#|&)t=([0-9a-f]{32,128})(?:&|$)/.exec(location.hash);
  if (m) {
    history.replaceState(null, '', location.pathname + location.search);
    try {
      sessionStorage.setItem(KEY, m[1]!);
    } catch {
      /* storage blocked: memory only */
    }
    return m[1];
  }
  try {
    return sessionStorage.getItem(KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function officeToken(): string | undefined {
  if (token === undefined) token = init();
  return token;
}

export function authHeaders(): Record<string, string> {
  const t = officeToken();
  return t ? { 'x-office-token': t } : {};
}
