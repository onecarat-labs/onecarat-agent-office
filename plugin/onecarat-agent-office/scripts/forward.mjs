#!/usr/bin/env node
// Claude Code command hook -> Onecarat Agent Office bridge (127.0.0.1).
// Configure in exec form with async: { "type": "command", "command": "node", "args": ["<this file>"], "async": true, "timeout": 5 }
// Guarantees: always exits 0 and prints nothing, so Claude Code never shows a hook error and never waits on Office.
// When Office is not running (no runtime file, or a stale one) it does not even open a connection.
// Nothing from the hook is sent until the listener has proved that it is the Office that wrote the runtime file.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import { looksStale, pickHookFields, proofMatches, runtimeFilePath } from './forward-lib.mjs';

const hookTime = Date.now();
const done = () => process.exit(0);
setTimeout(done, 3000).unref();

let info;
try {
  info = JSON.parse(fs.readFileSync(runtimeFilePath(), 'utf8'));
} catch {
  done();
}
if (looksStale(info)) done();

const chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('error', done);
process.stdin.on('end', () => {
  let picked;
  try {
    picked = pickHookFields(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  } catch {
    return done();
  }
  if (!picked) return done();
  const body = Buffer.from(JSON.stringify(picked));
  verify(() => post(body));
});

/** Ask the listener for HMAC(token, nonce). Neither the token nor any hook data is in this request. */
function verify(then) {
  const nonce = crypto.randomBytes(16).toString('hex');
  const req = http.get({ host: '127.0.0.1', port: info.port, path: '/api/health', timeout: 1000, headers: { 'x-office-nonce': nonce } }, (res) => {
    const c = [];
    let size = 0;
    res.on('data', (d) => {
      size += d.length;
      if (size > 16 * 1024) return done();
      c.push(d);
    });
    res.on('error', done);
    res.on('end', () => {
      try {
        const j = JSON.parse(Buffer.concat(c).toString('utf8'));
        if (j && j.app === 'onecarat-agent-office' && proofMatches(j.proof, info.token, nonce)) return then();
      } catch {
        /* not Office */
      }
      done();
    });
  });
  req.on('error', done);
  req.on('timeout', () => {
    req.destroy();
    done();
  });
}

function post(body) {
  const req = http.request(
    {
      host: '127.0.0.1',
      port: info.port,
      path: '/hook',
      method: 'POST',
      timeout: 1500,
      headers: {
        'content-type': 'application/json',
        'content-length': body.length,
        'x-office-token': info.token,
        'x-office-hook-time': String(hookTime),
      },
    },
    (res) => {
      res.resume();
      res.on('end', done);
    },
  );
  req.on('error', done);
  req.on('timeout', () => {
    req.destroy();
    done();
  });
  req.end(body);
}
