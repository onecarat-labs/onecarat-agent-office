// `check` only: asks the user's Claude Code for its version, to say whether the Research Lab can work with it.
//
// This is the one place where the launcher runs `claude` itself. It is kept as small as it can be:
//   - only `claude --version` (prints one line and exits: no session, no model call, no prompt);
//   - the file is an absolute path (the same one the built-in terminal would start), run WITHOUT a shell;
//   - a timeout, a small output limit, stdin closed, stderr dropped;
//   - from the output only "N.N.N" is read. Nothing else of it is shown or kept.
// Office itself (start / stop / status / open, and the bridge) never does this.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

export type Version = [number, number, number];

/** Below this the Research Lab cannot work (public changelog: subagents run in the background from 2.1.198). */
export const RESEARCH_MIN: Version = [2, 1, 198];
/** The range the Research Lab was actually checked on, on a real machine. */
export const RESEARCH_CHECKED: { from: Version; to: Version } = { from: [2, 1, 323], to: [2, 1, 325] };

export const versionText = (v: Version) => v.join('.');
const cmp = (a: Version, b: Version) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** The first "N.N.N" in the text (digits only, each part at most 6 digits). Anything else is ignored. */
export function parseVersion(out: unknown): Version | undefined {
  if (typeof out !== 'string') return undefined;
  const m = /(?:^|[^\d.])(\d{1,6})\.(\d{1,6})\.(\d{1,6})(?![\d])/.exec(out.slice(0, 400));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined;
}

export type ResearchSupport = 'too-old' | 'untested' | 'checked' | 'newer';

/** Where a version stands. "untested" and "newer" are exactly that: not known to work, not known to fail. */
export function researchSupport(v: Version): ResearchSupport {
  if (cmp(v, RESEARCH_MIN) < 0) return 'too-old';
  if (cmp(v, RESEARCH_CHECKED.from) < 0) return 'untested';
  return cmp(v, RESEARCH_CHECKED.to) <= 0 ? 'checked' : 'newer';
}

type Run = (file: string, args: string[], opts: { timeout: number; shell: false; windowsHide: true; encoding: 'utf8'; maxBuffer: number; stdio: ['ignore', 'pipe', 'ignore']; env: Record<string, string> }) => string;

/**
 * Runs `<file> --version` and returns the version, or undefined when it cannot be read (not an absolute path, a
 * script that needs a shell on Windows, a timeout, an error, no version in the output). Never throws.
 */
export function readClaudeVersion(file: string | undefined, env: Record<string, string>, run: Run = execFileSync as unknown as Run, platform: NodeJS.Platform = process.platform): Version | undefined {
  if (!file || !path.isAbsolute(file)) return undefined;
  // A .cmd / .bat can only be started through a shell on Windows. No shell is used here: not read.
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(file)) return undefined;
  try {
    return parseVersion(run(file, ['--version'], { timeout: 5000, shell: false, windowsHide: true, encoding: 'utf8', maxBuffer: 64 * 1024, stdio: ['ignore', 'pipe', 'ignore'], env }));
  } catch {
    return undefined;
  }
}

/** The lines `check` prints about the Research Lab. */
export function researchLines(v: Version | undefined, claudeFound: boolean): string[] {
  const facts = [
    `Research Lab: checked on Claude Code ${versionText(RESEARCH_CHECKED.from)} to ${versionText(RESEARCH_CHECKED.to)}.`,
    `Research Lab: does not work below ${versionText(RESEARCH_MIN)} (according to the public changelog).`,
    'Research Lab: versions in between are untested.',
  ];
  if (!v) return [...facts, claudeFound ? 'Claude Code version: could not be read (claude --version gave no version).' : 'Claude Code version: not read (claude was not found).'];
  const where: Record<ResearchSupport, string> = {
    'too-old': `too old for the Research Lab (needs ${versionText(RESEARCH_MIN)} or newer). The rest of Office is not affected.`,
    untested: 'Research Lab untested on this version (between the minimum and the checked range).',
    checked: 'Research Lab checked on this version.',
    newer: 'Research Lab untested on this version (newer than the checked range).',
  };
  return [...facts, `Claude Code version: ${versionText(v)} — ${where[researchSupport(v)]}`];
}
