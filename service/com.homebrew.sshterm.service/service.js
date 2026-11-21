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
 *   version      {}                    -> {node, service}
 */
'use strict';

const crypto = require('crypto');
const { StringDecoder } = require('string_decoder');
const Service = require('webos-service');
const { Client, utils } = require('ssh2');
const pkg = require('./package.json');

const service = new Service(pkg.name);
const sessions = new Map();
let nextId = 1;

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
}

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
  if (!message.isSubscription) return fail(message, 'connect requires subscribe:true');
  if (!p.host || !p.username) return fail(message, 'host and username are required');

  const s = {
    id: String(nextId++), msg: message, token: message.uniqueToken, conn: new Client(),
    stream: null, out: '', timer: null, decoder: new StringDecoder('utf8'),
    hostkeyCb: null, authCb: null, closed: false, kbdTries: 0,
  };
  sessions.set(s.id, s);
  updateKeepAlive();
  message.respond({ returnValue: true, sid: s.id, event: 'started' });

  s.conn.on('ready', () => {
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
    readyTimeout: 25000, keepaliveInterval: 15000, tryKeyboard: true,
    hostVerifier: (key, verify) => {
      const fingerprint = 'SHA256:' + crypto.createHash('sha256').update(key).digest('base64').replace(/=+$/, '');
      if (p.knownFingerprint && p.knownFingerprint === fingerprint) return verify(true);
      s.hostkeyCb = verify;
      message.respond({ returnValue: true, sid: s.id, event: 'hostkey', fingerprint, algo: keyAlgo(key),
        changed: !!p.knownFingerprint });
    },
  };
  if (p.password) cfg.password = p.password;
  if (p.privateKey) { cfg.privateKey = p.privateKey; if (p.passphrase) cfg.passphrase = p.passphrase; }
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
  if (cb) cb(!!message.payload.accept);
  message.respond({ returnValue: true });
});

service.register('authReply', (message) => {
  const s = get(message); if (!s) return;
  const cb = s.authCb; s.authCb = null;
  if (cb) cb(Array.isArray(message.payload.responses) ? message.payload.responses.map(String) : []);
  message.respond({ returnValue: true });
});

service.register('write', (message) => {
  const s = get(message); if (!s) return;
  if (s.stream && typeof message.payload.data === 'string') s.stream.write(message.payload.data);
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
  const cmd = "umask 077; mkdir -p ~/.ssh && touch ~/.ssh/authorized_keys && " +
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
  message.respond({ returnValue: true, node: process.version, service: pkg.version });
});
