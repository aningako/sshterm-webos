#!/usr/bin/env node
/*
 * SSH Terminal desktop simulator — run the real app + real luna service on a PC, no TV needed.
 *
 *   node tools/sim/server.js [--port 8080] [--ssh-port 2222] [--rooted]
 *
 * - Serves the app at http://127.0.0.1:8080/ with a stand-in PalmServiceBridge (luna bus over HTTP + SSE).
 * - Loads service/com.homebrew.sshterm.service/service.js unchanged, with a stand-in `webos-service` module.
 * - Starts a mock SSH server on 127.0.0.1:2222 (user "sim", random password printed below) that gives
 *   your own shell in a real pseudo-terminal, so vim/nano/htop/resize all behave like a real server.
 *   The app can also SSH to any real server you can reach from this PC.
 * - Homebrew Channel exec (used by "This TV" setup) answers like a NON-rooted TV unless --rooted is given
 *   (then it pretends success and does not run anything).
 */
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..', '..');
const APP = path.join(ROOT, 'app', 'com.homebrew.sshterm');
const SVC = path.join(ROOT, 'service', 'com.homebrew.sshterm.service');
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const PORT = +arg('--port', 8080), SSH_PORT = +arg('--ssh-port', 2222), ROOTED = process.argv.includes('--rooted');

// Make `require('webos-service')` (and ssh2 from the service's node_modules) resolve.
process.env.NODE_PATH = [path.join(__dirname, 'shim'), path.join(SVC, 'node_modules')].join(path.delimiter);
Module._initPaths();
const WS = require('webos-service');
require(path.join(SVC, 'service.js'));
const svc = WS._registry.get('com.homebrew.sshterm.service');

// ---- luna over HTTP: POST /__sim/call, POST /__sim/cancel, GET /__sim/events (SSE) ----
const clients = new Set();
const live = new Map(); // id -> {method, msg}
function emit(id, obj) {
  const line = 'data: ' + JSON.stringify({ id, r: obj }) + '\n\n';
  for (const c of clients) c.write(line);
}
function call(id, uri, params) {
  const m = /^luna:\/\/([^/]+)\/(.+)$/.exec(uri) || [];
  const [, service, method] = m;
  if (service === 'com.homebrew.sshterm.service') {
    const h = svc.methods.get(method);
    if (!h) return emit(id, { returnValue: false, errorText: 'Unknown method "' + method + '"' });
    const msg = new WS._Message(id, params, (o) => emit(id, o));
    if (msg.isSubscription) live.set(id, { h, msg });
    try { h.handler(msg); } catch (e) { emit(id, { returnValue: false, errorText: String(e) }); }
    return;
  }
  if (service === 'org.webosbrew.hbchannel.service' && method === 'exec') {
    console.log('[sim] hbchannel exec requested:', params.command.slice(0, 160) + '…');
    return setTimeout(() => emit(id, ROOTED
      ? { returnValue: true, stdoutString: 'SSHTERM_OK (simulated, nothing was run)\n', stderrString: '' }
      : { returnValue: false, errorText: 'Service does not exist: org.webosbrew.hbchannel.service (simulated non-rooted TV)' }), 300);
  }
  emit(id, { returnValue: false, errorText: 'Service does not exist: ' + service });
}
function cancel(id) {
  const s = live.get(id);
  if (s) { live.delete(id); if (s.h.cancel) s.h.cancel(s.msg); }
}

const SHIM = fs.readFileSync(path.join(__dirname, 'palm-shim.js'), 'utf8');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ttf': 'font/ttf', '.json': 'application/json' };
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/__sim/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(': hi\n\n'); clients.add(res); req.on('close', () => clients.delete(res)); return;
  }
  if (req.method === 'POST' && url.pathname.startsWith('/__sim/')) {
    let body = ''; req.on('data', (d) => { body += d; });
    req.on('end', () => {
      const j = JSON.parse(body || '{}');
      if (url.pathname === '/__sim/call') call(j.id, j.uri, j.params);
      else if (url.pathname === '/__sim/cancel') cancel(j.id);
      res.writeHead(204); res.end();
    });
    return;
  }
  if (url.pathname === '/__sim/palm.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(SHIM); }
  const file = path.join(APP, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
  if (!file.startsWith(APP) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  let data = fs.readFileSync(file);
  if (file.endsWith('index.html')) data = data.toString().replace('<script src="lib/xterm.js">', '<script src="/__sim/palm.js"></script>\n<script src="lib/xterm.js">');
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(data);
}).listen(PORT, '127.0.0.1', () => console.log('[sim] app:        http://127.0.0.1:' + PORT + '/   (' + (ROOTED ? 'rooted' : 'non-rooted') + ' TV)'));

// ---- mock SSH server ----
const { Server, utils } = require('ssh2');
const PASS = crypto.randomBytes(4).toString('hex');
const hostKey = utils.generateKeyPairSync('ed25519').private;
const authorized = new Set();
new Server({ hostKeys: [hostKey] }, (client) => {
  client.on('authentication', (ctx) => {
    if (ctx.username !== 'sim') return ctx.reject();
    if (ctx.method === 'password' && ctx.password === PASS) return ctx.accept();
    if (ctx.method === 'publickey' && authorized.has(ctx.key.algo + ' ' + ctx.key.data.toString('base64'))) {
      if (!ctx.signature) return ctx.accept(); // key probe
      const k = utils.parseKey(ctx.key.algo + ' ' + ctx.key.data.toString('base64'));
      return k.verify(ctx.blob, ctx.signature, ctx.hashAlgo) ? ctx.accept() : ctx.reject();
    }
    if (ctx.method === 'keyboard-interactive') {
      return ctx.prompt([{ prompt: 'Password (mock keyboard-interactive): ', echo: false }], (answers) => answers[0] === PASS ? ctx.accept() : ctx.reject());
    }
    ctx.reject(['password', 'publickey', 'keyboard-interactive']);
  });
  client.on('ready', () => client.on('session', (accept) => {
    const session = accept();
    let size = { cols: 80, rows: 24 }, child = null;
    session.on('pty', (a, r, info) => { size = { cols: info.cols, rows: info.rows }; a && a(); });
    session.on('window-change', (a, r, info) => { size = { cols: info.cols, rows: info.rows }; if (child) child.stdio[3].write(info.cols + ' ' + info.rows + '\n'); a && a(); });
    session.on('exec', (a, r, info) => {
      const ch = a();
      const m = /echo '([^']+)' >> ~\/\.ssh\/authorized_keys/.exec(info.command);
      if (m) { const parts = m[1].split(' '); authorized.add(parts[0] + ' ' + parts[1]); console.log('[sim] key installed on mock server:', parts[0], parts[2] || ''); ch.write('OK\n'); ch.exit(0); }
      else { ch.stderr.write('mock server only supports the installKey command\n'); ch.exit(1); }
      ch.end();
    });
    session.on('shell', (a) => {
      const ch = a();
      child = spawn('python3', [path.join(__dirname, 'ptyhelper.py'), size.cols, size.rows], { stdio: ['pipe', 'pipe', 'inherit', 'pipe'], env: Object.assign({}, process.env, { SIM_HOME: path.join(ROOT, 'build', 'sim-home') }) });
      child.stdout.pipe(ch); ch.pipe(child.stdin);
      child.on('exit', (code) => { try { ch.exit(code || 0); ch.end(); } catch (e) {} });
      ch.on('close', () => { try { child.kill(); } catch (e) {} });
    });
  }));
  client.on('error', () => {});
}).listen(SSH_PORT, '127.0.0.1', () => {
  console.log('[sim] mock SSH:   127.0.0.1:' + SSH_PORT + '  user "sim"  password "' + PASS + '"  (your own shell, in a real pty)');
});
