// Folders the page may name (the terminal's working folder, the folder whose configuration is shown).
// They must be absolute and local. A UNC path (\\host\share) would make this computer contact another machine
// and offer it the user's Windows sign-in, just by being looked at.
import fs from 'node:fs';
import path from 'node:path';

export function isLocalAbsolute(p: unknown, platform: NodeJS.Platform = process.platform): p is string {
  if (typeof p !== 'string' || !p || p.includes('\0')) return false;
  if (platform === 'win32') return /^[A-Za-z]:[\\/]/.test(p);
  return path.posix.isAbsolute(p);
}

export function isLocalDir(p: unknown): p is string {
  return isLocalAbsolute(p) && !!fs.statSync(p, { throwIfNoEntry: false })?.isDirectory();
}
