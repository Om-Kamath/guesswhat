class FakeRealtime {
  constructor(clientId) {
    this.clientId = clientId;
    this._peer = null;
    this._handlers = new Map();        // type -> Set<fn>
    this._present = false;             // is THIS client in the room
    this._presenceListeners = [];      // handlers registered via onPresence()
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

  onPresence(handler) {
    this._presenceListeners.push(handler);
  }

  async otherMembers() {
    const peer = this._peer;
    return peer && peer._present ? [{ clientId: peer.clientId }] : [];
  }

  _firePresence() {
    const peer = this._peer;
    queueMicrotask(() => {
      for (const fn of this._presenceListeners) fn();
      if (peer) for (const fn of peer._presenceListeners) fn();
    });
  }

  enter() {
    this._present = true;
    this._firePresence();
  }

  leave() {
    this._present = false;
    this._firePresence();
  }

  close() {
    this._present = false;
    this._handlers.clear();
    this._presenceListeners.length = 0;
  }
}

export function createFakeRealtimePair() {
  const a = new FakeRealtime('client-a');
  const b = new FakeRealtime('client-b');
  a._peer = b;
  b._peer = a;
  return [a, b];
}
