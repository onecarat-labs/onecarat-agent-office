// The launcher's options, as an allow-list. Nothing else is ever passed on to the app.
//
// The plugin skill pre-approves `office.mjs <subcommand> …`, so whatever the launcher accepts can be run by
// the model without a permission prompt. It therefore accepts very little: a command and a port.

export const COMMANDS = ['check', 'start', 'stop', 'status'] as const;
export type Command = (typeof COMMANDS)[number];

export interface LauncherArgs {
  cmd: Command;
  port?: number;
}

/** What was wrong, and the argument it was about. The words for it are in the one table (domain/i18n.ts). */
export interface ArgsError {
  error: 'unknownCommand' | 'unknownOption' | 'badPort';
  arg: string;
}

export function parseLauncherArgs(argv: string[]): LauncherArgs | ArgsError {
  const [first = 'status', ...rest] = argv;
  if (!(COMMANDS as readonly string[]).includes(first)) return { error: 'unknownCommand', arg: first };
  const out: LauncherArgs = { cmd: first as Command };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === '--port') {
      const v = rest[++i];
      if (!v || !/^\d{4,5}$/.test(v) || Number(v) < 1024 || Number(v) > 65535) return { error: 'badPort', arg: v ?? '' };
      out.port = Number(v);
    } else return { error: 'unknownOption', arg: a };
  }
  return out;
}

/** Arguments for the app, built from the parsed values only (never copied from argv). */
export function appArgs(a: LauncherArgs): string[] {
  return a.port ? ['--port', String(a.port)] : [];
}
