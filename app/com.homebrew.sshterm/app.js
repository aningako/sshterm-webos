/* SSH Terminal for webOS — created by aning with Claude. */
(function () {
  'use strict';

  var SVC = 'luna://com.homebrew.sshterm.service/';
  var TOOLS = '/media/developer/apps/usr/palm/applications/com.homebrew.sshterm/tools';
  var LOCAL = { id: 'local', name: 'This TV', host: '127.0.0.1', port: 22, user: 'root', auth: 'tvkey', local: true };
  var K = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, OK: 13, BACK: 461, RED: 403, GREEN: 404, YELLOW: 405, BLUE: 406 };

  // ---------- storage ----------
  function load(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  var hosts = load('hosts', []);
  var tvkey = load('tvkey', null);
  var clip = load('clipboard', '');
  var fontSize = load('fontSize', 20);
  var localFp = load('localFp', null);

  // ---------- helpers ----------
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }
  var toastTimer;
  function toast(msg, ms) {
    var t = $('toast'); t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.add('hidden'); }, ms || 2200);
  }

  // ---------- luna ----------
  var bridges = [];
  function luna(uri, params, cb, subscribe) {
    if (typeof PalmServiceBridge === 'undefined') {
      setTimeout(function () { cb && cb({ returnValue: false, errorText: 'Not running on webOS (no luna bus)' }); }, 0);
      return { cancel: function () {} };
    }
    var b = new PalmServiceBridge();
    bridges.push(b);
    var done = function () { var i = bridges.indexOf(b); if (i >= 0) bridges.splice(i, 1); };
    b.onservicecallback = function (s) {
      var r; try { r = JSON.parse(s); } catch (e) { return; }
      if (!subscribe) done();
      cb && cb(r);
    };
    if (subscribe) params.subscribe = true;
    b.call(uri.indexOf('luna://') === 0 ? uri : SVC + uri, JSON.stringify(params || {}));
    return { cancel: function () { try { b.cancel(); } catch (e) {} done(); } };
  }

  // ---------- clipboard ----------
  function setClip(text, what) {
    if (!text) return toast('Nothing to copy');
    clip = text; save('clipboard', clip);
    try { if (navigator.clipboard) navigator.clipboard.writeText(text).catch(function () {}); } catch (e) {}
    toast((what || 'Copied') + ' ' + text.length + ' characters');
  }
  function getClip(cb) {
    // Prefer the system clipboard when the TV allows it, else our own (kept across sessions).
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        return navigator.clipboard.readText().then(function (t) { cb(t || clip); }, function () { cb(clip); });
      }
    } catch (e) {}
    cb(clip);
  }

  // ---------- focus / remote navigation ----------
  var focused = null;
  function scope() {
    if (!$('modal').classList.contains('hidden')) return $('modal');
    if (current === 'termscreen') return $('bar').classList.contains('hidden') ? null : $('bar');
    return $(current);
  }
  function focusables(root) {
    return Array.prototype.filter.call(root.querySelectorAll('.f'), function (el) { return el.offsetParent !== null && !el.disabled; });
  }
  function focusEl(el) {
    if (focused) focused.classList.remove('focus');
    focused = el;
    if (!el) return;
    el.classList.add('focus');
    el.focus();
    if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }
  function focusFirst(root, sel) {
    var list = focusables(root);
    focusEl((sel && root.querySelector(sel)) || list[0] || null);
  }
  function move(dir) {
    var root = scope(); if (!root) return;
    var list = focusables(root);
    var ae = document.activeElement;
    if (ae && ae !== focused && list.indexOf(ae) >= 0) focusEl(ae);
    if (!focused || list.indexOf(focused) < 0) return focusEl(list[0]);
    var a = focused.getBoundingClientRect(), ax = a.left + a.width / 2, ay = a.top + a.height / 2, best = null, bestScore = 1e9;
    list.forEach(function (el) {
      if (el === focused) return;
      var b = el.getBoundingClientRect(), bx = b.left + b.width / 2, by = b.top + b.height / 2;
      var dx = bx - ax, dy = by - ay, main, cross;
      if (dir === K.LEFT) { if (b.right > a.left + 4) return; main = -dx; cross = Math.abs(dy); }
      if (dir === K.RIGHT) { if (b.left < a.right - 4) return; main = dx; cross = Math.abs(dy); }
      if (dir === K.UP) { if (b.bottom > a.top + 4) return; main = -dy; cross = Math.min(Math.abs(dx), Math.abs(b.left - a.left)); }
      if (dir === K.DOWN) { if (b.top < a.bottom - 4) return; main = dy; cross = Math.min(Math.abs(dx), Math.abs(b.left - a.left)); }
      var score = main + cross * 2.5;
      if (score < bestScore) { bestScore = score; best = el; }
    });
    if (best) focusEl(best);
  }
  document.addEventListener('mousemove', function (e) {
    var el = e.target.closest && e.target.closest('.f');
    var root = scope();
    if (el && el !== focused && root && root.contains(el)) focusEl(el);
  });

  // ---------- screens ----------
  var current = 'hosts';
  window.__sim = { get current() { return current; }, get focused() { return focused; }, get term() { return term; } };
  function show(id, sel) {
    ['hosts', 'edit', 'keyscreen', 'termscreen'].forEach(function (s) { $(s).classList.toggle('hidden', s !== id); });
    current = id;
    if (id !== 'termscreen') focusFirst($(id), sel);
    else { if (focused) focused.classList.remove('focus'); focused = null; if (document.activeElement) document.activeElement.blur(); }
  }

  // ---------- modal ----------
  var modalCb = null, modalSess = null;
  function modal(opts) {
    // opts: {title, html, inputs:[{id,label,type,value}], buttons:[{label, value, cls}], onClose(value, inputs)}
    $('m-title').textContent = opts.title || '';
    var body = opts.html || '';
    (opts.inputs || []).forEach(function (inp) {
      body += '<label>' + esc(inp.label) + (inp.type === 'textarea'
        ? '<textarea class="f" id="mi-' + inp.id + '" spellcheck="false">' + esc(inp.value) + '</textarea>'
        : '<input class="f" id="mi-' + inp.id + '" type="' + (inp.type || 'text') + '" value="' + esc(inp.value) +
          '" autocapitalize="off" spellcheck="false">') + '</label>';
    });
    $('m-body').innerHTML = body;
    var bw = $('m-buttons'); bw.innerHTML = '';
    (opts.buttons || [{ label: 'OK', value: true }]).forEach(function (b) {
      var el = document.createElement('button');
      el.className = 'f ' + (b.cls || ''); el.textContent = b.label;
      el.onclick = function () { closeModal(b.value); };
      bw.appendChild(el);
    });
    modalCb = function (v) {
      var vals = {};
      (opts.inputs || []).forEach(function (inp) { vals[inp.id] = $('mi-' + inp.id).value; });
      opts.onClose && opts.onClose(v, vals);
    };
    $('modal').classList.toggle('top', !!(opts.inputs && opts.inputs.length));
    $('modal').classList.remove('hidden');
    focusFirst($('modal'), opts.focus);
  }
  function closeModal(v) {
    $('modal').classList.add('hidden');
    var cb = modalCb; modalCb = null;
    if (current === 'termscreen' && $('bar').classList.contains('hidden')) { if (focused) focused.classList.remove('focus'); focused = null; if (document.activeElement) document.activeElement.blur(); }
    else focusFirst(scope());
    cb && cb(v);
  }
  function alertBox(title, html, cb) { modal({ title: title, html: html, onClose: cb }); }

  // ---------- host list ----------
  function renderHosts() {
    var list = $('host-list'); list.innerHTML = '';
    function card(cls, name, desc, onOK) {
      var b = document.createElement('button');
      b.className = 'f host ' + cls;
      b.innerHTML = '<span class="n">' + esc(name) + '</span><span class="d">' + esc(desc) + '</span>';
      b.onclick = onOK; list.appendChild(b); return b;
    }
    hosts.forEach(function (h) {
      card('', h.name || h.host, h.user + '@' + h.host + (h.port && h.port != 22 ? ':' + h.port : ''), function () { connect(h); });
      var e = document.createElement('button');
      e.className = 'f editbtn'; e.textContent = 'Edit';
      e.onclick = function () { editHost(h); }; list.appendChild(e);
    });
    card('local wide', 'This TV', 'Local root shell · vim, nano, curl, wget, netstat', function () { connect(LOCAL); });
    card('special wide', '+ Add host', 'New SSH server', function () { editHost(null); });
    card('special wide', 'TV key', tvkey ? 'Key ready (' + tvkey.type + ')' : 'Sign in without a password', function () { showKey(); });
  }

  // ---------- edit host ----------
  var editing = null, authSel = 'password';
  function setAuth(v) {
    authSel = v;
    Array.prototype.forEach.call($('f-auth').children, function (b) { b.classList.toggle('on', b.getAttribute('data-v') === v); });
    $('row-pass').classList.toggle('hidden', v !== 'password');
    $('row-key').classList.toggle('hidden', v !== 'custom');
    $('row-kpass').classList.toggle('hidden', v !== 'custom');
  }
  Array.prototype.forEach.call($('f-auth').children, function (b) { b.onclick = function () { setAuth(b.getAttribute('data-v')); }; });
  function editHost(h) {
    editing = h;
    $('edit-title').textContent = h ? 'Edit ' + (h.name || h.host) : 'Add host';
    $('f-name').value = h ? h.name || '' : '';
    $('f-host').value = h ? h.host : '';
    $('f-port').value = h ? h.port || 22 : 22;
    $('f-user').value = h ? h.user : '';
    $('f-pass').value = h ? h.password || '' : '';
    $('f-key').value = h ? h.key || '' : '';
    $('f-kpass').value = h ? h.passphrase || '' : '';
    setAuth(h ? h.auth || 'password' : 'password');
    $('e-delete').classList.toggle('hidden', !h);
    show('edit', '#f-name');
  }
  $('e-save').onclick = function () {
    var host = $('f-host').value.trim(), user = $('f-user').value.trim();
    if (!host || !user) return alertBox('Missing info', 'Host and username are required.');
    var h = editing || { id: String(Date.now()) };
    var changed = editing && (editing.host !== host || String(editing.port || 22) !== String($('f-port').value || 22));
    h.name = $('f-name').value.trim(); h.host = host; h.port = parseInt($('f-port').value, 10) || 22; h.user = user;
    h.auth = authSel; h.password = authSel === 'password' ? $('f-pass').value : '';
    h.key = authSel === 'custom' ? $('f-key').value.trim() : ''; h.passphrase = authSel === 'custom' ? $('f-kpass').value : '';
    if (changed) delete h.fp;
    if (!editing) hosts.push(h);
    save('hosts', hosts); renderHosts(); show('hosts');
  };
  $('e-cancel').onclick = function () { show('hosts'); };
  $('e-delete').onclick = function () {
    modal({ title: 'Delete host?', html: esc(editing.name || editing.host), buttons: [{ label: 'Delete', value: true, cls: 'danger' }, { label: 'Cancel', value: false }],
      onClose: function (v) { if (!v) return; hosts = hosts.filter(function (x) { return x !== editing; }); save('hosts', hosts); renderHosts(); show('hosts'); } });
  };
  // Enter (from the TV keyboard) in a form field jumps to the next field.
  document.addEventListener('keydown', function (e) {
    if (e.keyCode !== K.OK || current !== 'edit' || !$('modal').classList.contains('hidden')) return;
    var t = e.target; if (!t || (t.tagName !== 'INPUT')) return;
    e.preventDefault(); e.stopPropagation(); move(K.DOWN);
  }, true);

  // ---------- TV key ----------
  function showKey() {
    $('pubkey').textContent = tvkey ? tvkey.publicKey : '(no key yet — choose Generate key)';
    $('k-gen').textContent = tvkey ? 'New key' : 'Generate key';
    show('keyscreen');
  }
  function generateKey(cb) {
    toast('Generating key…', 8000);
    luna('generateKey', { comment: 'webos-tv-sshterm' }, function (r) {
      if (!r.returnValue) { toast('Key generation failed'); return alertBox('Could not generate key', esc(r.errorText)); }
      tvkey = { type: r.type, privateKey: r.privateKey, publicKey: r.publicKey.trim() };
      save('tvkey', tvkey); renderHosts(); toast('New ' + r.type + ' key ready');
      cb && cb();
    });
  }
  $('k-gen').onclick = function () {
    if (!tvkey) return generateKey(showKey);
    modal({ title: 'Replace the TV key?', html: 'Servers that have the old key installed will ask for a password again.',
      buttons: [{ label: 'Replace', value: true, cls: 'danger' }, { label: 'Cancel', value: false }],
      onClose: function (v) { if (v) generateKey(showKey); } });
  };
  $('k-copy').onclick = function () { if (tvkey) setClip(tvkey.publicKey, 'Copied public key:'); else toast('Generate a key first'); };
  $('k-back').onclick = function () { show('hosts'); };
  $('k-local').onclick = function () { setupLocal(function (ok) { if (ok) connect(LOCAL); }); };

  // Install the TV key on this TV's own root account (rooted TV + Homebrew Channel).
  // The key gets a forced command (tools/login.sh) that puts vim/nano/curl/wget/netstat on PATH.
  function setupLocal(cb) {
    if (!tvkey) return generateKey(function () { setupLocal(cb); });
    var line = 'command="' + TOOLS + '/login.sh" ' + tvkey.publicKey;
    var body = tvkey.publicKey.split(' ')[1];
    var cmd = 'H=$(awk -F: \'$1=="root"{print $6}\' /etc/passwd); [ -n "$H" ] || H=/home/root; ' +
      'mkdir -p "$H/.ssh" && chmod 700 "$H/.ssh" && touch "$H/.ssh/authorized_keys" && chmod 600 "$H/.ssh/authorized_keys" && ' +
      '{ [ ! -s "$H/.ssh/authorized_keys" ] || [ -z "$(tail -c1 "$H/.ssh/authorized_keys")" ] || echo >> "$H/.ssh/authorized_keys"; } && ' +
      '{ grep -qF \'' + body + '\' "$H/.ssh/authorized_keys" || echo \'' + line + '\' >> "$H/.ssh/authorized_keys"; } && ' +
      'chmod 755 ' + TOOLS + '/login.sh ' + TOOLS + '/bin/* ' + TOOLS + '/libexec/* ' + TOOLS + '/lib/ld-musl-armhf.so.1 2>/dev/null; echo SSHTERM_OK';
    toast('Setting up This TV…', 6000);
    luna('luna://org.webosbrew.hbchannel.service/exec', { command: cmd }, function (r) {
      if (r.returnValue && /SSHTERM_OK/.test(r.stdoutString || '')) { toast('This TV is ready'); return cb && cb(true); }
      setClip(line, 'Copied setup line:');
      alertBox('Couldn\'t set up automatically',
        'This needs a rooted TV with Homebrew Channel (' + esc(r.errorText || r.stderrString || 'exec failed') + ').<br><br>' +
        'From a computer, SSH into the TV as root and add this line to <code>~/.ssh/authorized_keys</code> (also copied to the app clipboard):<br><br><code>' + esc(line) + '</code>',
        function () { cb && cb(false); });
    });
  }

  // ---------- terminal ----------
  var term = null, fit = null, sess = null, sticky = { ctrl: false, alt: false };
  function initTerm() {
    term = new Terminal({
      fontFamily: 'TermMono, monospace', fontSize: fontSize, cursorBlink: true, scrollback: 5000,
      allowProposedApi: true, rightClickSelectsWord: false,
      theme: { background: '#000000', foreground: '#e6edf7', cursor: '#2ee6a6', selectionBackground: 'rgba(63,169,245,.45)' },
    });
    fit = new FitAddon.FitAddon();
    term.loadAddon(fit);
    term.open($('term'));
    // Canvas renderer only off the TV: webOS reports devicePixelRatio 2 for a 1920x1080 page that is really
    // 1:1, and the canvas renderer then drew everything twice as large and cut off half the terminal.
    // The DOM renderer lays text out with CSS, so it is right whatever the ratio says.
    if (typeof PalmSystem === 'undefined' || PalmSystem.simulator) {
      try { term.loadAddon(new CanvasAddon.CanvasAddon()); } catch (e) { /* DOM renderer fallback */ }
    }
    // We read the keyboard ourselves (document keydown) so the TV's on-screen keyboard never pops up over the terminal.
    var ta = term.textarea;
    if (ta) { ta.setAttribute('tabindex', '-1'); ta.setAttribute('inputmode', 'none'); ta.addEventListener('focus', function () { ta.blur(); }); }
    term.onData(function (d) { send(d); });   // mouse reports + paste
    term.onResize(function (sz) { if (sess && sess.sid) luna('resize', { sid: sess.sid, cols: sz.cols, rows: sz.rows }); });
    // Copy on select (like PuTTY): drag with the pointer, release, and it's on the clipboard.
    $('term').addEventListener('mouseup', function () {
      setTimeout(function () { var s = term.getSelection(); if (s) setClip(s); }, 30);
    });
    window.addEventListener('resize', function () { if (current === 'termscreen') fit.fit(); });
  }
  // Writes go one at a time (luna doesn't promise order across calls) and in 8 KB pieces
  // (no huge luna messages), never splitting an emoji's surrogate pair.
  var outQ = '', outBusy = false;
  function send(d) {
    if (!sess || !sess.sid || sess.closed || !d) return;
    outQ += d; pump();
  }
  function pump() {
    if (outBusy || !outQ || !sess || sess.closed) { if (sess && sess.closed) outQ = ''; return; }
    var n = Math.min(outQ.length, 8192), c = outQ.charCodeAt(n - 1);
    if (n < outQ.length && c >= 0xD800 && c <= 0xDBFF) n--;
    var chunk = outQ.slice(0, n), s = sess;
    outQ = outQ.slice(n); outBusy = true;
    luna('write', { sid: s.sid, data: chunk }, function () { outBusy = false; if (s === sess) pump(); else outQ = ''; });
  }
  function termWrite(s) { term.write(s); }
  function ack(s, n) {
    s.drawn = (s.drawn || 0) + n;
    if (s.drawn >= 32768 && !s.closed && s.sid) { luna('ack', { sid: s.sid, bytes: s.drawn }); s.drawn = 0; }
    else if (!s.ackTimer) s.ackTimer = setTimeout(function () { s.ackTimer = null; if (s.drawn && !s.closed && s.sid) { luna('ack', { sid: s.sid, bytes: s.drawn }); s.drawn = 0; } }, 100);
  }

  function connect(h, password) {
    if (h.auth === 'tvkey' && !tvkey) {
      if (h.local) return setupLocal(function (ok) { if (ok) connect(h); });
      return alertBox('No TV key yet', 'Open <b>TV key</b> on the home screen and generate one, or switch this host to password sign-in.');
    }
    if (h.auth === 'password' && !h.password && password == null) {
      return modal({ title: 'Password for ' + h.user + '@' + h.host, inputs: [{ id: 'pw', label: 'Password', type: 'password', value: '' }],
        buttons: [{ label: 'Connect', value: true, cls: 'primary' }, { label: 'Cancel', value: false }],
        onClose: function (v, vals) { if (v) connect(h, vals.pw); } });
    }
    if (sess && !sess.closed) disconnect();
    show('termscreen');
    if (!term) initTerm();
    term.reset(); fit.fit();
    termWrite('\x1b[36mConnecting to ' + h.user + '@' + h.host + ':' + (h.port || 22) + '…\x1b[0m\r\n');
    var p = { host: h.host, port: h.port || 22, username: h.user, cols: term.cols, rows: term.rows, term: 'xterm-256color',
      knownFingerprint: h.local ? localFp : h.fp };
    if (h.auth === 'password') p.password = password != null ? password : h.password;
    if (h.auth === 'tvkey') p.privateKey = tvkey.privateKey;
    if (h.auth === 'custom') { p.privateKey = h.key; if (h.passphrase) p.passphrase = h.passphrase; }
    var s = sess = { host: h, sid: null, closed: false, ready: false, password: p.password };
    s.bridge = luna('connect', p, function (r) { onEvent(s, r); }, true);
  }

  function onEvent(s, r) {
    if (s !== sess) return;
    if (r.returnValue === false) {
      termWrite('\r\n\x1b[31m' + (r.errorText || 'Service error') + '\x1b[0m\r\n');
      return ended(s, r.errorText);
    }
    if (r.sid) s.sid = r.sid;
    switch (r.event) {
      case 'data': (function (len) { term.write(r.data, function () { ack(s, len); }); })(r.data.length); break;
      case 'ready': s.ready = true; break;
      case 'hostkey':
        modalSess = s;
        modal({ title: r.changed ? 'WARNING: server key changed' : 'New server',
          html: (r.changed ? '<p class="warn">The key of ' + esc(s.host.host) + ' is different from last time. Someone may be intercepting the connection, or the server was reinstalled.</p>'
            : '<p>First connection to <b>' + esc(s.host.host) + '</b>. Check that this fingerprint is right:</p>') +
            '<p><code>' + esc(r.algo) + ' ' + esc(r.fingerprint) + '</code></p>',
          buttons: [{ label: r.changed ? 'Trust new key' : 'Trust & connect', value: true, cls: r.changed ? 'danger' : 'primary' }, { label: 'Cancel', value: false }],
          focus: r.changed ? '#m-buttons button:last-child' : null,
          onClose: function (v) {
            if (v) { if (s.host.local) { localFp = r.fingerprint; save('localFp', localFp); } else { s.host.fp = r.fingerprint; save('hosts', hosts); } }
            luna('hostkeyReply', { sid: s.sid, accept: !!v });
          } });
        break;
      case 'auth-prompt':
        modalSess = s;
        modal({ title: r.name || 'Sign in', html: r.instructions ? esc(r.instructions) : '',
          inputs: r.prompts.map(function (pr, i) { return { id: 'p' + i, label: pr.prompt, type: pr.echo ? 'text' : 'password', value: '' }; }),
          buttons: [{ label: 'OK', value: true, cls: 'primary' }, { label: 'Cancel', value: false }],
          onClose: function (v, vals) {
            luna('authReply', { sid: s.sid, responses: v ? r.prompts.map(function (pr, i) { return vals['p' + i]; }) : [] });
          } });
        break;
      case 'error':
        termWrite('\r\n\x1b[31m' + r.message + '\x1b[0m\r\n');
        if (/authentication methods failed/i.test(r.message)) s.authFailed = true;
        break;
      case 'closed': ended(s, r.reason); break;
    }
  }
  function ended(s, reason) {
    if (s.closed) return;
    s.closed = true;
    s.bridge && s.bridge.cancel();
    if (modalSess === s && !$('modal').classList.contains('hidden')) closeModal(false);
    modalSess = null;
    termWrite('\r\n\x1b[33m[' + (reason || 'Closed') + '] OK = reconnect · Back = menu\x1b[0m\r\n');
    if (s.authFailed && s.host.local) {
      modal({ title: 'This TV isn\'t set up yet', html: 'The TV key has to be added to the TV\'s root account once. Do it now?',
        buttons: [{ label: 'Set up', value: true, cls: 'primary' }, { label: 'Cancel', value: false }],
        onClose: function (v) { if (v) setupLocal(function (ok) { if (ok) connect(LOCAL); }); } });
    }
  }
  function disconnect() {
    if (!sess) return;
    var s = sess;
    if (s.sid && !s.closed) luna('disconnect', { sid: s.sid });
    s.closed = true; s.bridge && s.bridge.cancel();
  }

  // ---------- menu bar (Back in terminal) ----------
  var BAR = [
    ['Type…', function () { typeDialog(); }],
    ['Paste', function () { hideBar(); paste(); }],
    ['Copy screen', function () { copyScreen(false); }],
    ['Copy all', function () { copyScreen(true); }],
    ['Esc', '\x1b'], ['Tab', '\t'], ['Ctrl', 'ctrl'], ['Alt', 'alt'],
    ['^C', '\x03'], ['^D', '\x04'], ['^Z', '\x1a'], ['^L', '\x0c'], ['^R', '\x12'], ['^A', '\x01'],
    ['PgUp', '\x1b[5~'], ['PgDn', '\x1b[6~'], ['Home', 'home'], ['End', 'end'],
    ['A−', function () { setFont(fontSize - 2); }], ['A+', function () { setFont(fontSize + 2); }],
    ['Install TV key', function () { installKey(); }],
    ['Reconnect', function () { hideBar(); if (sess) connect(sess.host, sess.password); }],
    ['Hosts', function () { hideBar(); disconnect(); renderHosts(); show('hosts'); }],
    ['Exit app', function () { exitApp(); }],
    ['✕ Close', function () { hideBar(); }],
  ];
  function buildBar() {
    var row = $('bar-row'); row.innerHTML = '';
    BAR.forEach(function (item) {
      var b = document.createElement('button');
      b.className = 'f'; b.textContent = item[0];
      if (item[1] === 'ctrl' || item[1] === 'alt') b.id = 'bar-' + item[1];
      b.onclick = function () {
        var a = item[1];
        if (typeof a === 'function') return a();
        if (a === 'ctrl' || a === 'alt') { sticky[a] = !sticky[a]; b.classList.toggle('on', sticky[a]); if (sticky[a]) { hideBar(); toast(item[0] + ' held for the next key'); } return; }
        if (a === 'home' || a === 'end') a = (term.modes.applicationCursorKeysMode ? '\x1bO' : '\x1b[') + (a === 'home' ? 'H' : 'F');
        send(a); hideBar();
      };
      row.appendChild(b);
    });
  }
  function showBar() { $('bar').classList.remove('hidden'); focusFirst($('bar')); }
  function hideBar() { $('bar').classList.add('hidden'); if (focused) focused.classList.remove('focus'); focused = null; if (document.activeElement) document.activeElement.blur(); }
  function clearSticky() {
    sticky.ctrl = sticky.alt = false;
    ['ctrl', 'alt'].forEach(function (k) { var el = $('bar-' + k); if (el) el.classList.remove('on'); });
  }
  function setFont(n) {
    fontSize = Math.max(12, Math.min(48, n)); save('fontSize', fontSize);
    term.options.fontSize = fontSize; fit.fit(); toast('Font ' + fontSize + 'px · ' + term.cols + '×' + term.rows);
  }
  function paste() { getClip(function (t) { if (!t) return toast('Clipboard is empty — select text with the pointer first'); term.paste(t); }); }
  function copyScreen(all) {
    var buf = term.buffer.active, lines = [];
    var from = all ? 0 : buf.viewportY, to = all ? buf.length : buf.viewportY + term.rows;
    for (var y = from; y < to; y++) { var l = buf.getLine(y); lines.push(l ? l.translateToString(true) : ''); }
    while (lines.length && !lines[lines.length - 1]) lines.pop();
    setClip(lines.join('\n'), all ? 'Copied scrollback:' : 'Copied screen:');
    hideBar();
  }
  function typeDialog() {
    modal({ title: 'Type', html: sticky.ctrl || sticky.alt ? '<p>' + (sticky.ctrl ? 'Ctrl ' : '') + (sticky.alt ? 'Alt ' : '') + 'applies to the first character.</p>' : '',
      inputs: [{ id: 't', label: 'Text to send', value: '' }],
      buttons: [{ label: 'Send + Enter', value: 'enter', cls: 'primary' }, { label: 'Send', value: 'send' },
        { label: 'Paste clipboard here', value: 'clip' }, { label: 'Cancel', value: false }],
      onClose: function (v, vals) {
        if (v === 'clip') { return getClip(function (t) { typeDialog(); $('mi-t').value = t; }); }
        hideBar();
        if (!v) return;
        var t = vals.t;
        if (t && (sticky.ctrl || sticky.alt)) { t = applyMods(t.charAt(0), sticky.ctrl, sticky.alt) + t.slice(1); clearSticky(); }
        send(t + (v === 'enter' ? '\r' : ''));
      } });
  }
  function installKey() {
    hideBar();
    if (!sess || !sess.ready || sess.closed) return toast('Connect to a server first');
    var go = function () {
      luna('installKey', { sid: sess.sid, publicKey: tvkey.publicKey }, function (r) {
        if (!r.returnValue) return alertBox('Install failed', esc(r.errorText));
        var h = sess.host;
        if (!h.local && h.auth === 'password') {
          modal({ title: 'TV key installed', html: 'Switch <b>' + esc(h.name || h.host) + '</b> to TV-key sign-in (and forget the saved password)?',
            buttons: [{ label: 'Yes', value: true, cls: 'primary' }, { label: 'No', value: false }],
            onClose: function (v) { if (v) { h.auth = 'tvkey'; h.password = ''; save('hosts', hosts); toast('Saved'); } } });
        } else toast('TV key installed');
      });
    };
    if (!tvkey) generateKey(go); else go();
  }

  // ---------- keyboard → terminal ----------
  function applyMods(ch, ctrl, alt) {
    var out = ch;
    if (ctrl) {
      var c = ch.toLowerCase();
      if (c >= 'a' && c <= 'z') out = String.fromCharCode(c.charCodeAt(0) - 96);
      else if (c === ' ' || c === '@' || c === '2') out = '\x00';
      else if (c === '[' || c === '3') out = '\x1b';
      else if (c === '\\' || c === '4') out = '\x1c';
      else if (c === ']' || c === '5') out = '\x1d';
      else if (c === '^' || c === '6') out = '\x1e';
      else if (c === '_' || c === '-' || c === '7') out = '\x1f';
      else if (c === '?' || c === '8') out = '\x7f';
    }
    return alt ? '\x1b' + out : out;
  }
  var FKEYS = { 112: '\x1bOP', 113: '\x1bOQ', 114: '\x1bOR', 115: '\x1bOS', 116: '\x1b[15~', 117: '\x1b[17~', 118: '\x1b[18~',
    119: '\x1b[19~', 120: '\x1b[20~', 121: '\x1b[21~', 122: '\x1b[23~', 123: '\x1b[24~' };
  function keySeq(e) {
    var ctrl = e.ctrlKey || sticky.ctrl, alt = e.altKey || sticky.alt, shift = e.shiftKey;
    var mod = 1 + (shift ? 1 : 0) + (alt ? 2 : 0) + (ctrl ? 4 : 0);
    var app = term.modes.applicationCursorKeysMode;
    var arrows = { 38: 'A', 40: 'B', 39: 'C', 37: 'D' };
    function tilde(n) { return mod > 1 ? '\x1b[' + n + ';' + mod + '~' : '\x1b[' + n + '~'; }
    if (arrows[e.keyCode]) return mod > 1 ? '\x1b[1;' + mod + arrows[e.keyCode] : (app ? '\x1bO' : '\x1b[') + arrows[e.keyCode];
    switch (e.keyCode) {
      case 13: return alt ? '\x1b\r' : '\r';
      case 8: return ctrl ? '\x08' : (alt ? '\x1b\x7f' : '\x7f');
      case 9: return shift ? '\x1b[Z' : '\t';
      case 27: return '\x1b';
      case 33: return tilde(5);
      case 34: return tilde(6);
      case 35: return mod > 1 ? '\x1b[1;' + mod + 'F' : (app ? '\x1bOF' : '\x1b[F');
      case 36: return mod > 1 ? '\x1b[1;' + mod + 'H' : (app ? '\x1bOH' : '\x1b[H');
      case 45: return tilde(2);
      case 46: return tilde(3);
    }
    if (FKEYS[e.keyCode]) {
      var f = FKEYS[e.keyCode];
      if (mod === 1) return f;
      return f.charAt(1) === 'O' ? '\x1b[1;' + mod + f.charAt(2) : f.slice(0, -1) + ';' + mod + '~';
    }
    if (e.key && e.key.length === 1 && !e.metaKey) return applyMods(e.key, ctrl, alt);
    return null;
  }

  // In a text field, Left/Right move the caret; at the start/end of the text they move focus instead.
  function caretEdge(el, kc) {
    try {
      if (el.selectionStart == null) return true;
      return kc === K.LEFT ? el.selectionStart === 0 && el.selectionEnd === 0 : el.selectionEnd === el.value.length;
    } catch (e) { return true; }
  }

  // ---------- global key handling ----------
  // Back twice quickly exits, from the home screen or the terminal (first Back there opens the menu).
  var backArmed = 0;
  function exitApp() {
    try { disconnect(); } catch (x) {}
    try { window.close(); } catch (x) {}
    // (if the platform ignored close(), send the app to the background instead)
    setTimeout(function () {
      try { if (window.webOSSystem && webOSSystem.platformBack) return webOSSystem.platformBack(); } catch (x) {}
      try { if (window.PalmSystem && PalmSystem.platformBack) PalmSystem.platformBack(); } catch (x) {}
    }, 300);
  }
  function backTwice() {
    if (Date.now() - backArmed < 2000) { backArmed = 0; exitApp(); return true; }
    backArmed = Date.now(); return false;
  }
  document.addEventListener('keydown', function (e) {
    var kc = e.keyCode;
    var ae = document.activeElement;
    if (ae && ae !== focused && ae.classList && ae.classList.contains('f')) focusEl(ae);
    var modalOpen = !$('modal').classList.contains('hidden');
    var inText = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA');

    if (modalOpen) {
      if (kc === K.BACK) { e.preventDefault(); return closeModal(false); }
      if (kc === K.OK && inText) { e.preventDefault(); var pri = $('m-buttons').querySelector('button'); if (pri) pri.click(); return; }
      if (kc === K.UP || kc === K.DOWN || ((kc === K.LEFT || kc === K.RIGHT) && (!inText || caretEdge(e.target, kc)))) { e.preventDefault(); return move(kc); }
      if (kc === K.OK && focused && !inText) { e.preventDefault(); return focused.click(); }
      return;
    }

    if (current === 'termscreen') {
      var barOpen = !$('bar').classList.contains('hidden');
      if (barOpen) {
        e.preventDefault();
        if (kc === K.BACK) { if (Date.now() - backArmed < 2000) { backArmed = 0; return exitApp(); } backArmed = 0; return hideBar(); }
        if (kc >= 37 && kc <= 40) return move(kc);
        if (kc === K.OK && focused) return focused.click();
        return;
      }
      if (kc === K.BACK) { e.preventDefault(); backTwice(); toast('Press Back again to exit', 2000); return showBar(); }
      if (kc === K.RED) { e.preventDefault(); return send('\x03'); }
      if (kc === K.GREEN) { e.preventDefault(); return send('\t'); }
      if (kc === K.YELLOW) { e.preventDefault(); return send('\x1b'); }
      if (kc === K.BLUE) { e.preventDefault(); return typeDialog(); }
      if (e.ctrlKey && e.shiftKey && (e.key === 'C' || e.key === 'c')) { e.preventDefault(); var s = term.getSelection(); return s ? setClip(s) : copyScreen(false); }
      if ((e.ctrlKey && e.shiftKey && (e.key === 'V' || e.key === 'v')) || (e.shiftKey && kc === 45)) { e.preventDefault(); return paste(); }
      if (e.shiftKey && (kc === 33 || kc === 34)) { e.preventDefault(); return term.scrollPages(kc === 33 ? -1 : 1); }
      if (sess && sess.closed && kc === K.OK) { e.preventDefault(); return connect(sess.host, sess.password); }
      if (e.key === 'Control' || e.key === 'Shift' || e.key === 'Alt' || e.key === 'Meta') return;
      var seq = keySeq(e);
      if (seq != null) {
        e.preventDefault();
        if (sticky.ctrl || sticky.alt) clearSticky();
        term.scrollToBottom();
        send(seq);
      }
      return;
    }

    // menus / forms
    if (kc === K.BACK) {
      e.preventDefault();
      if (current === 'hosts') {
        if (backTwice()) return;
        return toast('Press Back again to exit', 2000);
      }
      return show('hosts');
    }
    if (kc === K.UP || kc === K.DOWN || ((kc === K.LEFT || kc === K.RIGHT) && (!inText || caretEdge(e.target, kc)))) { e.preventDefault(); return move(kc); }
    if (kc === K.OK && focused && !inText) { e.preventDefault(); return focused.click(); }
  });

  // Real keyboard paste (Ctrl+V) into the terminal
  document.addEventListener('paste', function (e) {
    if (current !== 'termscreen' || !$('modal').classList.contains('hidden')) return;
    var t = e.clipboardData && e.clipboardData.getData('text');
    if (t) { e.preventDefault(); term.paste(t); }
  });

  // Relaunch from the launcher while running: just come to front.
  document.addEventListener('webOSRelaunch', function () { try { PalmSystem.activate(); } catch (e) {} });

  // ---------- start ----------
  buildBar();
  renderHosts();
  show('hosts');
  try { $('ver').textContent = JSON.parse(PalmSystem.appInfo || '{}').version || '1.0.0'; } catch (e) { $('ver').textContent = '1.0.0'; }
  // Make sure the font is ready before xterm measures cells.
  if (document.fonts && document.fonts.load) document.fonts.load(fontSize + 'px TermMono').catch(function () {});
  luna('version', {}, function (r) {
    if (!r.returnValue) return console.warn('service:', r.errorText);
    if (r.ssh2 === false) alertBox('Not supported on this TV', esc(r.error));
  });
})();
