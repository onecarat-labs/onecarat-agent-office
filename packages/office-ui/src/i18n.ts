// The window's language. The words themselves are in @onecarat/domain (i18n.ts), the one table for the window,
// its title bar and the launcher.
import { builtinAlias, dict, langOf, type Lang } from '@onecarat/domain';

export { bubbleShort, dict, type Lang } from '@onecarat/domain';

/**
 * Japanese when the Windows display language is Japanese, English otherwise. WebView2 reports the display
 * language as the page's language. There is no setting.
 */
export function detectLang(): Lang {
  try {
    return langOf(navigator.language);
  } catch {
    return 'en';
  }
}

export function displayName(a: { role: 'manager' | 'subagent'; agentType: string; label: string }, lang: Lang): string {
  if (a.role === 'manager') return dict[lang].manager;
  const name = builtinAlias[lang][a.agentType] ?? a.label;
  // "plugin:agent" -> "agent"; long custom names are cut so that a nameplate stays inside its desk.
  const short = name.includes(':') ? name.slice(name.lastIndexOf(':') + 1) : name;
  return [...short].length > 12 ? [...short].slice(0, 11).join('') + '…' : short;
}
