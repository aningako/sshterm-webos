// Simulator stand-in for webOS's PalmServiceBridge / PalmSystem (luna bus over HTTP + SSE).
(function () {
  var next = 1, handlers = {};
  var es = new EventSource('/__sim/events');
  var ready = new Promise(function (res) { es.onopen = res; });
  es.onmessage = function (ev) {
    var m = JSON.parse(ev.data), h = handlers[m.id];
    if (h && h.onservicecallback) h.onservicecallback(JSON.stringify(m.r));
  };
  function post(p, body) { return ready.then(function () { return fetch(p, { method: 'POST', body: JSON.stringify(body) }); }); }
  window.PalmServiceBridge = function () { this.id = 'b' + (next++); handlers[this.id] = this; };
  PalmServiceBridge.prototype.call = function (uri, params) { post('/__sim/call', { id: this.id, uri: uri, params: JSON.parse(params) }); };
  PalmServiceBridge.prototype.cancel = function () { post('/__sim/cancel', { id: this.id }); delete handlers[this.id]; };
  window.PalmSystem = { appInfo: JSON.stringify({ id: 'com.homebrew.sshterm', version: 'sim' }), activate: function () {}, simulator: true };
  // Keyboard stand-ins for remote buttons: F1 = Back, F2..F5 = Red/Green/Yellow/Blue.
  var REMAP = { F1: 461, F2: 403, F3: 404, F4: 405, F5: 406 };
  document.addEventListener('keydown', function (e) {
    var kc = REMAP[e.key];
    if (!kc || e.isTrusted === false) return;
    e.preventDefault(); e.stopImmediatePropagation();
    var ev = new KeyboardEvent('keydown', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'keyCode', { get: function () { return kc; } });
    (document.activeElement || document.body).dispatchEvent(ev);
  }, true);
  console.log('[sim] PalmServiceBridge shim active (F1 = Back, F2-F5 = color keys)');
})();
