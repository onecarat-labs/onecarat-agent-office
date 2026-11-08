// Vendors node-pty (N-API, prebuilt binaries) into plugin/onecarat-agent-office/dist/vendor/node-pty
// straight from the upstream npm tarball, and verifies it.
//
//   node scripts/vendor-node-pty.mjs          populate dist/vendor/node-pty from the upstream tarball
//   node scripts/vendor-node-pty.mjs --check  fail unless every vendored file is byte-identical to the
//                                             upstream tarball (whose sha512 must equal INTEGRITY) and no
//                                             file is missing or extra
//
// node-pty is built with node-addon-api (N-API), so one binary per OS/CPU works across Node major versions.
// Nothing here is compiled by us: the binaries are Microsoft's own prebuilds shipped in the npm package.
import { execFileSync, execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const VERSION = '1.1.0';
const INTEGRITY = 'sha512-20JqtutY6JPXTUnL0ij1uad7Qe1baT46lyolh2sSENDd4sTzKZ4nmAFkeAARDKwmlLjPx6XKRlwRUxwjOy+lUg==';
// Linux has no upstream prebuild: Office runs read-only there for now.
const PLATFORMS = ['win32-x64', 'win32-arm64', 'darwin-x64', 'darwin-arm64'];

const root = path.resolve(import.meta.dirname, '..');
const dest = path.join(root, 'plugin/onecarat-agent-office/dist/vendor/node-pty');
const check = process.argv.includes('--check');

/** Which tarball paths (relative to package/) are shipped. */
function selected(rel) {
  const p = rel.split(path.sep).join('/');
  if (p === 'package.json' || p === 'LICENSE') return true;
  if (p.startsWith('lib/')) return p.endsWith('.js') && !p.endsWith('.test.js');
  const m = /^prebuilds\/([^/]+)\//.exec(p);
  return !!m && PLATFORMS.includes(m[1]) && !p.endsWith('.pdb');
}

function walk(dir, base = dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full, base));
    else out.push(path.relative(base, full));
  }
  return out.sort();
}

const sha256 = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

// 1. fetch the upstream tarball and check it is the published one
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'node-pty-vendor-'));
try {
  // Fixed command line (no user input); a string so it also works with npm.cmd on Windows.
  const name = execSync(`npm pack node-pty@${VERSION} --silent --pack-destination "${tmp}"`, { encoding: 'utf8' }).trim().split(/\r?\n/).at(-1);
  const tgz = path.join(tmp, name);
  const integrity = 'sha512-' + crypto.createHash('sha512').update(fs.readFileSync(tgz)).digest('base64');
  if (integrity !== INTEGRITY) throw new Error(`upstream tarball integrity mismatch:\n  got      ${integrity}\n  expected ${INTEGRITY}`);
  execFileSync('tar', ['-xzf', name], { cwd: tmp });
  const pkg = path.join(tmp, 'package');
  const want = walk(pkg).filter(selected);

  if (!check) {
    fs.rmSync(dest, { recursive: true, force: true });
    for (const rel of want) {
      fs.mkdirSync(path.dirname(path.join(dest, rel)), { recursive: true });
      fs.copyFileSync(path.join(pkg, rel), path.join(dest, rel));
    }
    const bytes = want.reduce((n, rel) => n + fs.statSync(path.join(dest, rel)).size, 0);
    console.log(`vendored node-pty ${VERSION}: ${want.length} files, ${(bytes / 1024 / 1024).toFixed(1)} MB (${PLATFORMS.join(', ')})`);
  } else {
    if (!fs.existsSync(dest)) throw new Error(`missing ${path.relative(root, dest)}`);
    const have = walk(dest);
    const problems = [];
    for (const rel of want) if (!have.includes(rel)) problems.push(`missing: ${rel}`);
    for (const rel of have) {
      if (!want.includes(rel)) problems.push(`extra (not from upstream selection): ${rel}`);
      else if (sha256(path.join(dest, rel)) !== sha256(path.join(pkg, rel))) problems.push(`differs from upstream: ${rel}`);
    }
    if (problems.length) {
      console.error(problems.join('\n'));
      process.exit(1);
    }
    console.log(`dist/vendor/node-pty matches upstream node-pty@${VERSION} (${INTEGRITY.slice(0, 20)}…): ${have.length} files`);
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
