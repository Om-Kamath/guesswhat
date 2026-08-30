import { describe, it, expect, vi } from 'vitest';
import { Game } from '../src/game.js';
import { wire } from '../src/wire.js';
import { createFakeRealtimePair } from './fake-realtime.js';

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('wire — presence', () => {
  it('a client that joins second still sees the partner as present', async () => {
    const [rtA, rtB] = createFakeRealtimePair();
    const gameA = new Game({ role: 'setter' });
    const gameB = new Game({ role: 'guesser' });
    wire(gameA, rtA);
    rtA.enter();
    await flush();
    wire(gameB, rtB);   // B wires AFTER A is already in the room
    rtB.enter();
    await flush();
    await flush();
    expect(gameB.state.partnerPresent).toBe(true);
    expect(gameA.state.partnerPresent).toBe(true);
  });

  it('a client wired into an already-populated room sees the partner without any further presence event', async () => {
    const [rtA, rtB] = createFakeRealtimePair();
    const gameA = new Game({ role: 'setter' });
    const gameB = new Game({ role: 'guesser' });
    wire(gameA, rtA);
    rtA.enter();
    await flush();
    // B enters BEFORE wiring, and we let A fully react to that enter first — A
    // publishes its hello into the void (B has no 'hello' subscriber yet) and
    // latches prevOthers=1, so it will NOT re-handshake when B wires. The only
    // remaining path to partnerPresent for B is wire()'s immediate onPresenceChange().
    rtB.enter();
    await flush();
    await flush();
    wire(gameB, rtB);
    await flush();
    await flush();
    expect(gameB.state.partnerPresent).toBe(true);
  });

  it('a brief leave/enter within the grace period does not fire partner_left', async () => {
    vi.useFakeTimers();
    try {
      const [rtA, rtB] = createFakeRealtimePair();
      const gameA = new Game({ role: 'setter' });
      wire(gameA, rtA);
      wire(new Game({ role: 'guesser' }), rtB);
      rtA.enter();
      rtB.enter();
      await vi.advanceTimersByTimeAsync(0);
      expect(gameA.state.partnerPresent).toBe(true);
      rtB.leave();
      await vi.advanceTimersByTimeAsync(1000);
      rtB.enter();
      await vi.advanceTimersByTimeAsync(5000);
      expect(gameA.state.partnerPresent).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a sustained leave fires partner_left after the grace period', async () => {
    vi.useFakeTimers();
    try {
      const [rtA, rtB] = createFakeRealtimePair();
      const gameA = new Game({ role: 'setter' });
      wire(gameA, rtA);
      wire(new Game({ role: 'guesser' }), rtB);
      rtA.enter();
      rtB.enter();
      await vi.advanceTimersByTimeAsync(0);
      rtB.leave();
      await vi.advanceTimersByTimeAsync(3001);
      expect(gameA.state.partnerPresent).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('an out-of-order otherMembers() resolution cannot strand partnerPresent', async () => {
    // otherMembers() returns 1 then 0, but the FIRST call resolves LAST.
    let call = 0;
    const resolvers = [];
    const rt = {
      on() {},
      send() {},
      _presence: null,
      onPresence(h) { this._presence = h; },
      otherMembers() {
        call += 1;
        const count = call === 1 ? 1 : 0;   // 1st event: partner present; 2nd: gone
        return new Promise((res) => resolvers.push(() => res(
          Array.from({ length: count }, (_, i) => ({ clientId: 'p' + i })),
        )));
      },
    };
    const game = new Game({ role: 'setter' });
    wire(game, rt);          // fires onPresenceChange() once (call 1, pending)
    rt._presence();          // fires again (call 2, pending)
    await flush();
    resolvers[1]();          // newer call resolves first: 0 others
    await flush();
    resolvers[0]();          // stale call resolves last: 1 other
    await flush();
    // Without the generation guard the stale "1" would land last and flip
    // partnerPresent to true off a superseded query.
    expect(game.state.partnerPresent).toBe(false);
  });

  it('a redundant presence event with the partner already present does not re-emit', async () => {
    const [rtA, rtB] = createFakeRealtimePair();
    const game = new Game({ role: 'setter' });
    let emits = 0;
    game.onChange(() => { emits += 1; });
    wire(game, rtA);
    rtA.enter();
    rtB.enter();
    await flush();
    await flush();
    expect(game.state.partnerPresent).toBe(true);
    const afterFirst = emits;
    // A presence event with no membership change (B is already in the room).
    rtB.enter();
    await flush();
    await flush();
    expect(game.state.partnerPresent).toBe(true);
    expect(emits).toBe(afterFirst);   // no redundant partner_here -> no re-render
  });
});
