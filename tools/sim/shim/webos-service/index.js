// Desktop stand-in for webOS's built-in `webos-service` module (used only by the simulator).
'use strict';
const registry = new Map();

class Message {
  constructor(id, payload, emit) {
    this.payload = payload || {};
    this.isSubscription = !!this.payload.subscribe;
    this.uniqueToken = 'sim-' + id;
    this._emit = emit;
  }
  respond(obj) { this._emit(obj); }
}

class Service {
  constructor(name) {
    this.name = name;
    this.activityManager = {
      create: (id, cb) => setImmediate(() => cb({ id })),
      complete: (a, cb) => cb && setImmediate(cb),
    };
    registry.set(name, this);
    this.methods = new Map();
  }
  register(method, handler, cancel) { this.methods.set(method, { handler, cancel }); }
}

module.exports = Service;
module.exports._registry = registry;
module.exports._Message = Message;
