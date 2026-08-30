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
});
