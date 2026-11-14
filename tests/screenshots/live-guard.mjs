// Scripts that touch the RUNNING Office (or start / stop the Claude Code inside it) must be asked for explicitly.
// By default they do nothing: a check that is run by habit, or by an agent, must never end the user's session.
export const LIVE_ENV = 'ONECARAT_OFFICE_LIVE';

/** Was the live run asked for? Only the exact value "1" counts. */
export function liveAllowed(env = process.env) {
  return env[LIVE_ENV] === '1';
}

/** Ends the process, having done nothing, unless the live run was asked for. Exit code 2: "not run", not "passed". */
export function requireLive(script, what, env = process.env) {
  if (liveAllowed(env)) return;
  console.error(`${script} was NOT run.`);
  console.error(`It ${what}.`);
  console.error(`It is for the user to run on purpose: set ${LIVE_ENV}=1 to run it.`);
  process.exit(2);
}
