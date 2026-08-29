class FakeRealtime {
  constructor(clientId) {
    this.clientId = clientId;
    this._peer = null;
    this._handlers = new Map();        // type -> Set<fn>
    this._presence = { enter: new Set(), leave: new Set() };
  }

  async connect() {}

  send(type, payload) {
    const peer = this._peer;
    if (!peer) return;
    queueMicrotask(() => {
      const set = peer._handlers.get(type);
      if (set) for (const fn of set) fn(payload, this.clientId);
    });
  }

  on(type, handler) {
    if (!this._handlers.has(type)) this._handlers.set(type, new Set());
    this._handlers.get(type).add(handler);
  }

  onPresence(event, handler) {
    this._presence[event].add(handler);
  }

  enter() {
    const peer = this._peer;
    if (!peer) return;
    queueMicrotask(() => {
      for (const fn of peer._presence.enter) fn();
    });
  }

  leave() {
    const peer = this._peer;
    if (!peer) return;
    queueMicrotask(() => {
      for (const fn of peer._presence.leave) fn();
    });
  }

  close() {
    this._handlers.clear();
    this._presence.enter.clear();
    this._presence.leave.clear();
  }
}

export function createFakeRealtimePair() {
  const a = new FakeRealtime('client-a');
  const b = new FakeRealtime('client-b');
  a._peer = b;
  b._peer = a;
  return [a, b];
}
