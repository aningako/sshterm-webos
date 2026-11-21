/*
 * SSH Terminal for webOS — luna service that bridges the web app to SSH servers.
 * Created by aning with Claude.
 *
 * Methods (luna://com.homebrew.sshterm.service/...):
 *   connect      (subscribe) {host, port, username, password?, privateKey?, passphrase?, cols, rows, term?}
 *                events: started{sid} hostkey{fingerprint,algo} auth-prompt{prompts} ready data{data} closed{reason} error{message}
 *   hostkeyReply {sid, accept}
 *   authReply    {sid, responses:[...]}
 *   write        {sid, data}
 *   resize       {sid, cols, rows}
 *   disconnect   {sid}
 *   installKey   {sid, publicKey}      append key to ~/.ssh/authorized_keys on the connected server
 *   generateKey  {comment?}            -> {privateKey, publicKey} (OpenSSH format)
 *   ack          {sid, bytes}          flow control: the app confirms it has drawn this much output
 *   version      {}                    -> {node, service, ssh2}
 */
'use strict';

const crypto = require('crypto');
const { StringDecoder } = require('string_decoder');
const Service = require('webos-service');
const pkg = require('./package.json');

// ssh2 needs Node >= 10.16 (webOS 5+). On older TVs report why instead of failing silently.
let Client, utils, loadError = null;
try { ({ Client, utils } = require('ssh2')); }
catch (e) { loadError = 'This TV\'s webOS is too old for SSH Terminal (Node ' + process.version + ', needs webOS 5 or newer): ' + e.message; }

const service = new Service(pkg.name);
const sessions = new Map();
const CONNECT_TIMEOUT = 25000;              // TCP + key exchange only; paused while the user answers a prompt
const PAUSE_AT = 256 * 1024, RESUME_AT = 64 * 1024;   // output flow control (bytes not yet drawn by the app)
// Session ids are random so another app on the TV can't guess one and type into a session.
function newId() { return crypto.randomBytes(16).toString('hex'); }

// webOS kills idle JS services after a few seconds; hold an activity while any session is open.
let keepAlive = null;
function updateKeepAlive() {
  try {
    if (sessions.size && !keepAlive) {
      keepAlive = 'pending';
      service.activityManager.create('sshterm-keepalive', (activity) => {
        if (sessions.size) keepAlive = activity;
        else { keepAlive = null; service.activityManager.complete(activity, () => {}); }
      });
    } else if (!sessions.size && keepAlive && keepAlive !== 'pending') {
      const a = keepAlive;
      keepAlive = null;
      service.activityManager.complete(a, () => {});
    }
  } catch (e) { /* activity manager unavailable: subscriptions still keep us alive */ }
}

function fail(message, text) {
  message.respond({ returnValue: false, errorText: String(text) });
}

function keyAlgo(buf) {
  try {
    const n = buf.readUInt32BE(0);
    return buf.slice(4, 4 + n).toString('ascii');
  } catch (e) { return 'unknown'; }
}

function closeSession(s, reason) {
  if (s.closed) return;
  s.closed = true;
  flush(s);
  try { s.msg.respond({ returnValue: true, sid: s.id, event: 'closed', reason: reason || 'Connection closed' }); } catch (e) {}
  if (s.connTimer) { clearTimeout(s.connTimer); s.connTimer = null; }
  try { s.conn.end(); } catch (e) {}
  sessions.delete(s.id);
  updateKeepAlive();
}

// Coalesce output so a burst (e.g. `cat bigfile`) doesn't become thousands of luna messages.
function flush(s) {
  if (s.timer) { clearTimeout(s.timer); s.timer = null; }
  if (!s.out) return;
  const data = s.out;
  s.out = '';
  try { s.msg.respond({ returnValue: true, sid: s.id, event: 'data', data }); } catch (e) {}
  s.unacked += data.length;
  if (!s.paused && s.unacked > PAUSE_AT && s.stream) {
    s.paused = true;
    s.stream.pause(); s.stream.stderr.pause();
  }
}

function startConnTimer(s) {
  if (s.connTimer) clearTimeout(s.connTimer);
  s.connTimer = setTimeout(() => {
    s.connTimer = null;
    try { s.msg.respond({ returnValue: true, sid: s.id, event: 'error', message: 'Timed out connecting to the server' }); } catch (e) {}
    closeSession(s, 'Timed out');
  }, CONNECT_TIMEOUT);
}
function stopConnTimer(s) { if (s.connTimer) { clearTimeout(s.connTimer); s.connTimer = null; } }

function onOutput(s, chunk) {
  s.out += s.decoder.write(chunk);
  if (s.out.length > 32768) flush(s);
  else if (!s.timer) s.timer = setTimeout(() => flush(s), 12);
}

function get(message) {
  const s = sessions.get(message.payload.sid);
  if (!s || s.closed) { fail(message, 'No such session'); return null; }
  return s;
}

service.register('connect', (message) => {
  const p = message.payload || {};
  if (loadError) return fail(message, loadError);
  if (!message.isSubscription) return fail(message, 'connect requires subscribe:true');
  if (!p.host || !p.username) return fail(message, 'host and username are required');

  const s = {
    id: newId(), msg: message, connTimer: null, unacked: 0, paused: false, token: message.uniqueToken, conn: new Client(),
    stream: null, out: '', timer: null, decoder: new StringDecoder('utf8'),
    hostkeyCb: null, authCb: null, closed: false, kbdTries: 0,
  };
  sessions.set(s.id, s);
  updateKeepAlive();
  message.respond({ returnValue: true, sid: s.id, event: 'started' });

  s.conn.on('ready', () => {
    stopConnTimer(s);
    message.respond({ returnValue: true, sid: s.id, event: 'ready' });
    s.conn.shell({ term: p.term || 'xterm-256color', cols: p.cols || 80, rows: p.rows || 24 }, (err, stream) => {
      if (err) { message.respond({ returnValue: true, sid: s.id, event: 'error', message: err.message }); return closeSession(s, err.message); }
      s.stream = stream;
      stream.on('data', (d) => onOutput(s, d));
      stream.stderr.on('data', (d) => onOutput(s, d));
      stream.on('close', () => closeSession(s, 'Session ended'));
    });
  });

  s.conn.on('keyboard-interactive', (name, instructions, lang, prompts, finish) => {
    // Answer a single hidden prompt with the saved password once; otherwise ask the user.
    if (p.password && s.kbdTries === 0 && prompts.length === 1 && !prompts[0].echo) {
      s.kbdTries++;
      return finish([p.password]);
    }
    if (!prompts.length) return finish([]);
    stopConnTimer(s);
    s.authCb = finish;
    message.respond({ returnValue: true, sid: s.id, event: 'auth-prompt', name, instructions,
      prompts: prompts.map((x) => ({ prompt: x.prompt, echo: !!x.echo })) });
  });

  s.conn.on('error', (err) => {
    try { message.respond({ returnValue: true, sid: s.id, event: 'error', message: err.message, level: err.level }); } catch (e) {}
    closeSession(s, err.message);
  });
  s.conn.on('close', () => closeSession(s, 'Connection closed'));

  const cfg = {
    host: p.host, port: p.port || 22, username: p.username,
    readyTimeout: 0, keepaliveInterval: 15000, tryKeyboard: true,
    hostVerifier: (key, verify) => {
      const fingerprint = 'SHA256:' + crypto.createHash('sha256').update(key).digest('base64').replace(/=+$/, '');
      if (p.knownFingerprint && p.knownFingerprint === fingerprint) return verify(true);
      stopConnTimer(s);
      s.hostkeyCb = verify;
      message.respond({ returnValue: true, sid: s.id, event: 'hostkey', fingerprint, algo: keyAlgo(key),
        changed: !!p.knownFingerprint });
    },
  };
  if (p.password) cfg.password = p.password;
  if (p.privateKey) { cfg.privateKey = p.privateKey; if (p.passphrase) cfg.passphrase = p.passphrase; }
  startConnTimer(s);
  try { s.conn.connect(cfg); }
  catch (e) {
    message.respond({ returnValue: true, sid: s.id, event: 'error', message: e.message });
    closeSession(s, e.message);
  }
}, (message) => {
  // Subscriber went away (app closed / cancelled): drop its session.
  for (const s of sessions.values()) if (s.token === message.uniqueToken) closeSession(s, 'Cancelled');
});

service.register('hostkeyReply', (message) => {
  const s = get(message); if (!s) return;
  const cb = s.hostkeyCb; s.hostkeyCb = null;
  if (cb) { if (message.payload.accept) startConnTimer(s); cb(!!message.payload.accept); }
  message.respond({ returnValue: true });
});

service.register('authReply', (message) => {
  const s = get(message); if (!s) return;
  const cb = s.authCb; s.authCb = null;
  if (cb) startConnTimer(s);
  if (cb) cb(Array.isArray(message.payload.responses) ? message.payload.responses.map(String) : []);
  message.respond({ returnValue: true });
});

service.register('write', (message) => {
  const s = get(message); if (!s) return;
  if (s.stream && typeof message.payload.data === 'string') s.stream.write(message.payload.data);
  message.respond({ returnValue: true });
});

service.register('ack', (message) => {
  const s = get(message); if (!s) return;
  s.unacked = Math.max(0, s.unacked - (+message.payload.bytes || 0));
  if (s.paused && s.unacked < RESUME_AT && s.stream) {
    s.paused = false;
    s.stream.resume(); s.stream.stderr.resume();
  }
  message.respond({ returnValue: true });
});

service.register('resize', (message) => {
  const s = get(message); if (!s) return;
  const { cols, rows } = message.payload;
  if (s.stream && cols > 0 && rows > 0) s.stream.setWindow(rows, cols, 0, 0);
  message.respond({ returnValue: true });
});

service.register('disconnect', (message) => {
  const s = sessions.get(message.payload.sid);
  if (s) closeSession(s, 'Disconnected');
  message.respond({ returnValue: true });
});

service.register('installKey', (message) => {
  const s = get(message); if (!s) return;
  const key = String(message.payload.publicKey || '').trim();
  if (!/^(ssh-ed25519|ssh-rsa|ecdsa-sha2-[a-z0-9]+) [A-Za-z0-9+/=]+( [\w@.\-]+)?$/.test(key)) return fail(message, 'Invalid public key');
  // (make sure the file ends with a newline first, or the key would be glued onto the last line)
  const cmd = "umask 077; mkdir -p ~/.ssh && touch ~/.ssh/authorized_keys && " +
    "{ [ ! -s ~/.ssh/authorized_keys ] || [ -z \"$(tail -c1 ~/.ssh/authorized_keys)\" ] || echo >> ~/.ssh/authorized_keys; } && " +
    "(grep -qxF '" + key + "' ~/.ssh/authorized_keys || echo '" + key + "' >> ~/.ssh/authorized_keys) && echo OK";
  s.conn.exec(cmd, (err, stream) => {
    if (err) return fail(message, err.message);
    let out = '', errOut = '';
    stream.on('data', (d) => { out += d; });
    stream.stderr.on('data', (d) => { errOut += d; });
    stream.on('close', (code) => {
      if (code === 0 && /OK/.test(out)) message.respond({ returnValue: true });
      else fail(message, (errOut || out || ('exit ' + code)).trim());
    });
  });
});

service.register('generateKey', (message) => {
  if (loadError) return fail(message, loadError);
  const comment = String((message.payload && message.payload.comment) || 'webos-tv').replace(/[^\w@.\-]/g, '');
  const tries = [['ed25519', { comment }], ['ecdsa', { bits: 256, comment }], ['rsa', { bits: 3072, comment }]];
  for (const [type, opts] of tries) {
    try {
      const k = utils.generateKeyPairSync(type, opts);
      return message.respond({ returnValue: true, type, privateKey: k.private, publicKey: k.public });
    } catch (e) { /* older node: try the next type */ }
  }
  fail(message, 'Key generation not supported on this TV');
});

service.register('version', (message) => {
  message.respond({ returnValue: true, node: process.version, service: pkg.version, ssh2: !loadError, error: loadError || undefined });
});
