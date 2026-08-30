import { describe, it, expect, vi } from 'vitest';
import { Game } from '../src/game.js';
import { createFakeRealtimePair } from './fake-realtime.js';
import { wire } from '../src/wire.js';

const flush = () => new Promise((r) => setTimeout(r, 0));

// Publishes a Game's outbound messages, the way main.js's send() does for local actions.
const pub = (rt, msgs) => {
  for (const m of msgs || []) rt.send(m.type, m.payload);
};

// Attach a freshly booted client to an existing peer, replacing whatever it was paired to.
function repair(existing, fresh) {
  existing._peer = fresh;
  fresh._peer = existing;
}

async function handshake(rtA, rtB) {
  rtA.enter();
  rtB.enter();
  await flush();
  await flush();
}

// Sets up a wired setter+guesser mid-round: secret 42, two guesses answered with hints.
async function playedRound() {
  const [rtSetter, rtGuesser] = createFakeRealtimePair();
  const setter = new Game({ role: 'setter' });
  const guesser = new Game({ role: 'guesser' });
  wire(setter, rtSetter);
  wire(guesser, rtGuesser);
  await handshake(rtSetter, rtGuesser);

  pub(rtSetter, setter.startRound({ preset: 'medium', secret: 42, message: 'kiss' }));
  await flush();
  pub(rtGuesser, guesser.submitGuess(50));
  await flush();
  pub(rtSetter, setter.sendHint('lower'));
  await flush();
  pub(rtGuesser, guesser.submitGuess(25));
  await flush();
  pub(rtSetter, setter.sendHint('higher'));
  await flush();

  return { rtSetter, rtGuesser, setter, guesser };
}

// What main.js does on the hash-reload path: wire, hello, resync, then presence enter.
async function reboot(peerRt) {
  const [fresh] = createFakeRealtimePair();
  repair(peerRt, fresh);
  const game = new Game({ role: null });
  wire(game, fresh);
  pub(fresh, game.hello());
  pub(fresh, game.resync());
  fresh.enter();
  await flush();
  await flush();
  await flush();
  return { game, rt: fresh };
}

describe('guesser reconnect mid-round', () => {
  it("leaves the setter's live round untouched and resumes the guesser", async () => {
    const { rtSetter, rtGuesser, setter, guesser } = await playedRound();
    expect(setter.state.phase).toBe('playing');
    expect(guesser.state.guesses).toHaveLength(2);

    vi.useFakeTimers();
    try {
      rtGuesser.leave();
      await vi.advanceTimersByTimeAsync(3001);
      expect(setter.state.partnerPresent).toBe(false);
    } finally {
      vi.useRealTimers();
    }

    const { game: rejoined } = await reboot(rtSetter);

    // The established setter kept everything.
    expect(setter.state.phase).toBe('playing');
    expect(setter.state.secret).toBe(42);
    expect(setter.state.guesses).toHaveLength(2);
    expect(setter.state.guesses.map((g) => g.value)).toEqual([50, 25]);
    expect(setter.state.partnerPresent).toBe(true);

    // The rejoining guesser adopted the round.
    expect(rejoined.state.role).toBe('guesser');
    expect(rejoined.state.phase).toBe('playing');
    expect(rejoined.state.min).toBe(1);
    expect(rejoined.state.max).toBe(100);
    expect(rejoined.state.guesses).toEqual([
      { n: 1, value: 50, hint: 'lower' },
      { n: 2, value: 25, hint: 'higher' },
    ]);
    // And it still never learns the secret or the hidden message.
    expect(rejoined.state.secret).toBe(null);
    expect(rejoined.state.revealMessage).toBe(null);
    expect(rejoined.state.revealedMessage).toBe(null);
  });
});

describe('setter refresh mid-round', () => {
  it('moves both sides to round_lost, and new_round returns both to setup with roles unchanged', async () => {
    const { rtGuesser, guesser } = await playedRound();

    rtGuesser.leave(); // not strictly needed; the setter is the one reloading
    const { game: refreshed, rt: rtRefreshed } = await reboot(rtGuesser);

    expect(refreshed.state.role).toBe('setter');
    expect(refreshed.state.secret).toBe(null);
    expect(refreshed.state.phase).toBe('round_lost');
    expect(guesser.state.phase).toBe('round_lost');

    pub(rtRefreshed, refreshed.newRound());
    await flush();

    expect(refreshed.state.phase).toBe('setup');
    expect(guesser.state.phase).toBe('setup');
    expect(refreshed.state.role).toBe('setter');
    expect(guesser.state.role).toBe('guesser');
    expect(refreshed.state.roundNumber).toBe(guesser.state.roundNumber);
  });
});

describe('play again through the wire', () => {
  it('swaps roles exactly once with echo off', async () => {
    const { rtSetter, rtGuesser, setter, guesser } = await playedRound();

    pub(rtGuesser, guesser.submitGuess(42));
    await flush();
    expect(setter.state.canConfirmWin).toBe(true);
    pub(rtSetter, setter.confirmWin());
    await flush();
    expect(guesser.state.phase).toBe('finished');

    pub(rtSetter, setter.playAgain());
    await flush();

    // Initiator swapped exactly once (setter -> guesser, not back again via an echo).
    expect(setter.state.role).toBe('guesser');
    expect(guesser.state.role).toBe('setter');
    expect(setter.state.roundNumber).toBe(2);
    expect(guesser.state.roundNumber).toBe(2);
    expect(setter.state.phase).toBe('setup');
    expect(guesser.state.phase).toBe('setup');
  });
});
