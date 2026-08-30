import { describe, it, expect } from 'vitest';
import { Game } from '../src/game.js';
import { PRESETS } from '../src/presets.js';

const outbound = (res, type) => res.find((m) => m.type === type);

describe('PRESETS', () => {
  it('has the three exact ranges', () => {
    expect(PRESETS.easy).toMatchObject({ min: 1, max: 20 });
    expect(PRESETS.medium).toMatchObject({ min: 1, max: 100 });
    expect(PRESETS.hard).toMatchObject({ min: 1, max: 1000 });
  });
});

describe('Game construction', () => {
  it('starts in lobby with defaults', () => {
    const g = new Game();
    expect(g.state.phase).toBe('lobby');
    expect(g.state.role).toBe(null);
    expect(g.state.roundNumber).toBe(1);
  });

  it('accepts an explicit role and round number', () => {
    const g = new Game({ role: 'setter', roundNumber: 3 });
    expect(g.state.role).toBe('setter');
    expect(g.state.roundNumber).toBe(3);
  });
});

describe('onChange', () => {
  it('fires after receive mutates state', () => {
    const g = new Game({ role: 'setter' });
    let calls = 0;
    g.onChange(() => { calls++; });
    g.receive({ type: 'hello', payload: { role: 'guesser' }, from: 'x' });
    expect(calls).toBeGreaterThan(0);
  });
});

describe('hello handshake', () => {
  it('hello() announces our role', () => {
    const g = new Game({ role: 'setter' });
    expect(g.hello()).toEqual([{ type: 'hello', payload: { role: 'setter' } }]);
  });

  it('setter moves lobby -> setup when it sees the guesser', () => {
    const g = new Game({ role: 'setter' });
    g.receive({ type: 'hello', payload: { role: 'guesser' }, from: 'x' });
    expect(g.state.phase).toBe('setup');
    expect(g.state.partnerPresent).toBe(true);
  });

  it('a role-less (refreshed) client resolves its role from the peer', () => {
    const g = new Game({ role: null });
    g.receive({ type: 'hello', payload: { role: 'guesser' }, from: 'x' });
    expect(g.state.role).toBe('setter');
  });

  it('an established client replies with hello when the peer has no role', () => {
    const g = new Game({ role: 'guesser' });
    g.state.phase = 'setup';
    const res = g.receive({ type: 'hello', payload: { role: null }, from: 'x' });
    expect(outbound(res, 'hello')).toEqual({ type: 'hello', payload: { role: 'guesser' } });
  });

  it('does not leave lobby until the opposite role is seen', () => {
    const g = new Game({ role: 'setter' });
    g.receive({ type: 'hello', payload: { role: 'setter' }, from: 'x' });
    expect(g.state.phase).toBe('lobby');
  });
});

describe('startRound', () => {
  it('setter enters playing and broadcasts range only', () => {
    const g = new Game({ role: 'setter' });
    g.state.phase = 'setup';
    const res = g.startRound({ preset: 'medium', secret: 42, message: 'i love you' });
    expect(g.state.phase).toBe('playing');
    expect(g.state.min).toBe(1);
    expect(g.state.max).toBe(100);
    expect(g.state.secret).toBe(42);
    expect(g.state.revealMessage).toBe('i love you');
    const msg = outbound(res, 'round_start');
    expect(msg.payload).toEqual({ preset: 'medium', min: 1, max: 100, roundNumber: 1 });
    expect(JSON.stringify(msg)).not.toContain('42');
    expect(JSON.stringify(msg)).not.toContain('love');
  });
});

describe('receive round_start', () => {
  it('guesser adopts the range and enters playing', () => {
    const g = new Game({ role: 'guesser' });
    g.state.phase = 'setup';
    g.receive({ type: 'round_start', payload: { preset: 'hard', min: 1, max: 1000, roundNumber: 2 }, from: 'x' });
    expect(g.state.phase).toBe('playing');
    expect(g.state.min).toBe(1);
    expect(g.state.max).toBe(1000);
    expect(g.state.roundNumber).toBe(2);
  });

  it('setter ignores round_start', () => {
    const g = new Game({ role: 'setter' });
    g.state.phase = 'setup';
    g.receive({ type: 'round_start', payload: { preset: 'easy', min: 1, max: 20, roundNumber: 1 }, from: 'x' });
    expect(g.state.phase).toBe('setup');
  });
});

describe('guesses and hints', () => {
  it('guesser records its own guess and emits a guess message', () => {
    const g = new Game({ role: 'guesser' });
    g.state.phase = 'playing';
    const res = g.submitGuess(50);
    expect(g.state.guesses).toEqual([{ n: 1, value: 50, hint: null }]);
    expect(outbound(res, 'guess').payload).toEqual({ value: 50, guessNumber: 1 });
  });

  it('setter records an incoming guess', () => {
    const g = new Game({ role: 'setter' });
    g.state.phase = 'playing';
    g.state.secret = 42;
    g.receive({ type: 'guess', payload: { value: 50, guessNumber: 1 }, from: 'x' });
    expect(g.state.guesses).toEqual([{ n: 1, value: 50, hint: null }]);
    expect(g.state.canConfirmWin).toBe(false);
  });

  it('setter flags canConfirmWin when a guess equals the secret', () => {
    const g = new Game({ role: 'setter' });
    g.state.phase = 'playing';
    g.state.secret = 42;
    g.receive({ type: 'guess', payload: { value: 42, guessNumber: 3 }, from: 'x' });
    expect(g.state.canConfirmWin).toBe(true);
  });

  it('setter hint targets the latest un-hinted guess', () => {
    const g = new Game({ role: 'setter' });
    g.state.phase = 'playing';
    g.state.secret = 42;
    g.receive({ type: 'guess', payload: { value: 50, guessNumber: 1 }, from: 'x' });
    g.receive({ type: 'guess', payload: { value: 25, guessNumber: 2 }, from: 'x' });
    const res = g.sendHint('higher');
    expect(outbound(res, 'hint').payload).toEqual({ direction: 'higher', forGuessNumber: 2 });
    expect(g.state.guesses[1].hint).toBe('higher');
    expect(g.state.guesses[0].hint).toBe(null);
  });

  it('guesser applies an incoming hint to the matching guess', () => {
    const g = new Game({ role: 'guesser' });
    g.state.phase = 'playing';
    g.submitGuess(50);
    g.receive({ type: 'hint', payload: { direction: 'lower', forGuessNumber: 1 }, from: 'x' });
    expect(g.state.guesses[0].hint).toBe('lower');
  });
});

describe('confirm win and reveal', () => {
  it('setter confirmWin enters finished and broadcasts the message', () => {
    const g = new Game({ role: 'setter' });
    g.state.phase = 'playing';
    g.state.secret = 42;
    g.state.revealMessage = 'call me tonight';
    g.receive({ type: 'guess', payload: { value: 42, guessNumber: 4 }, from: 'x' });
    const res = g.confirmWin();
    expect(g.state.phase).toBe('finished');
    expect(g.state.revealedMessage).toBe('call me tonight');
    expect(g.state.totalGuesses).toBe(1);
    expect(g.state.canConfirmWin).toBe(false);
    expect(outbound(res, 'reveal').payload).toEqual({ message: 'call me tonight', totalGuesses: 1 });
  });

  it('guesser applies an incoming reveal', () => {
    const g = new Game({ role: 'guesser' });
    g.state.phase = 'playing';
    g.submitGuess(42);
    g.receive({ type: 'reveal', payload: { message: 'call me tonight', totalGuesses: 6 }, from: 'x' });
    expect(g.state.phase).toBe('finished');
    expect(g.state.revealedMessage).toBe('call me tonight');
    expect(g.state.totalGuesses).toBe(6);
  });
});

describe('play again and new round', () => {
  it('playAgain swaps role and bumps the round', () => {
    const g = new Game({ role: 'setter', roundNumber: 1 });
    g.state.phase = 'finished';
    g.state.secret = 42;
    g.state.guesses = [{ n: 1, value: 42, hint: null }];
    const res = g.playAgain();
    expect(g.state.role).toBe('guesser');
    expect(g.state.roundNumber).toBe(2);
    expect(g.state.phase).toBe('setup');
    expect(g.state.secret).toBe(null);
    expect(g.state.guesses).toEqual([]);
    expect(outbound(res, 'play_again').payload).toEqual({ roundNumber: 2 });
  });

  it('receive play_again swaps the other side symmetrically', () => {
    const g = new Game({ role: 'guesser', roundNumber: 1 });
    g.state.phase = 'finished';
    g.receive({ type: 'play_again', payload: { roundNumber: 2 }, from: 'x' });
    expect(g.state.role).toBe('setter');
    expect(g.state.roundNumber).toBe(2);
    expect(g.state.phase).toBe('setup');
  });

  it('newRound keeps role and bumps the round', () => {
    const g = new Game({ role: 'setter', roundNumber: 4 });
    g.state.phase = 'round_lost';
    const res = g.newRound();
    expect(g.state.role).toBe('setter');
    expect(g.state.roundNumber).toBe(5);
    expect(g.state.phase).toBe('setup');
    expect(outbound(res, 'new_round').payload).toEqual({ roundNumber: 5 });
  });

  it('receive new_round keeps role', () => {
    const g = new Game({ role: 'guesser', roundNumber: 4 });
    g.state.phase = 'round_lost';
    g.receive({ type: 'new_round', payload: { roundNumber: 5 }, from: 'x' });
    expect(g.state.role).toBe('guesser');
    expect(g.state.roundNumber).toBe(5);
    expect(g.state.phase).toBe('setup');
  });
});

describe('snapshot', () => {
  it('never contains the secret or the pre-win message', () => {
    const g = new Game({ role: 'setter' });
    g.state.phase = 'playing';
    g.state.secret = 42;
    g.state.revealMessage = 'secret note';
    g.state.min = 1; g.state.max = 100; g.state.preset = 'medium';
    const snap = g.snapshot();
    expect(JSON.stringify(snap)).not.toContain('42');
    expect(JSON.stringify(snap)).not.toContain('secret note');
    expect(snap.phase).toBe('playing');
    expect(snap.min).toBe(1);
  });
});

describe('reconnection', () => {
  it('resync responder returns hello + snapshot when mid-game', () => {
    const g = new Game({ role: 'guesser' });
    g.state.phase = 'playing';
    g.state.min = 1; g.state.max = 100;
    const res = g.receive({ type: 'resync', payload: {}, from: 'x' });
    expect(outbound(res, 'hello')).toBeTruthy();
    expect(outbound(res, 'state_snapshot')).toBeTruthy();
  });

  it('a refreshed setter (no secret) mid-playing declares the round lost', () => {
    const g = new Game({ role: null });
    g.receive({ type: 'hello', payload: { role: 'guesser' }, from: 'x' }); // role -> setter
    g.resync(); // the rebooting client asked for the snapshot
    const res = g.receive({
      type: 'state_snapshot',
      payload: { phase: 'playing', preset: 'medium', min: 1, max: 100, roundNumber: 1, guesses: [{ n: 1, value: 5, hint: 'higher' }], revealedMessage: null, totalGuesses: null },
      from: 'x',
    });
    expect(g.state.phase).toBe('round_lost');
    expect(outbound(res, 'round_lost')).toBeTruthy();
  });

  it('a refreshed guesser mid-playing resumes with the guess history', () => {
    const g = new Game({ role: null });
    g.receive({ type: 'hello', payload: { role: 'setter' }, from: 'x' }); // role -> guesser
    g.resync(); // the rebooting client asked for the snapshot
    g.receive({
      type: 'state_snapshot',
      payload: { phase: 'playing', preset: 'medium', min: 1, max: 100, roundNumber: 1, guesses: [{ n: 1, value: 5, hint: 'higher' }], revealedMessage: null, totalGuesses: null },
      from: 'x',
    });
    expect(g.state.phase).toBe('playing');
    expect(g.state.guesses).toEqual([{ n: 1, value: 5, hint: 'higher' }]);
  });

  it('an established setter with its secret intact ignores the round_lost path', () => {
    const g = new Game({ role: 'setter' });
    g.state.phase = 'playing';
    g.state.secret = 42;
    const res = g.receive({
      type: 'state_snapshot',
      payload: { phase: 'playing', preset: 'medium', min: 1, max: 100, roundNumber: 1, guesses: [{ n: 1, value: 5, hint: null }], revealedMessage: null, totalGuesses: null },
      from: 'x',
    });
    expect(g.state.phase).toBe('playing');
    expect(outbound(res, 'round_lost')).toBeFalsy();
  });

  it('a client still awaiting its own snapshot does not answer a peer resync', () => {
    const g = new Game({ role: null });
    g.receive({ type: 'hello', payload: { role: 'setter' }, from: 'x' }); // role -> guesser, phase setup
    g.resync();
    const res = g.receive({ type: 'resync', payload: {}, from: 'x' });
    expect(outbound(res, 'state_snapshot')).toBeFalsy();
  });

  it('a just-booted client in setup with no preset does not answer a peer resync', () => {
    const g = new Game({ role: null });
    g.receive({ type: 'hello', payload: { role: 'setter' }, from: 'x' });
    expect(g.state.phase).toBe('setup');
    const res = g.receive({ type: 'resync', payload: {}, from: 'x' });
    expect(outbound(res, 'state_snapshot')).toBeFalsy();
  });

  it('ignores a state_snapshot it did not ask for', () => {
    const g = new Game({ role: 'setter' });
    g.startRound({ preset: 'medium', secret: 42, message: 'hi' });
    g.receive({
      type: 'state_snapshot',
      payload: { phase: 'setup', preset: null, min: null, max: null, roundNumber: 1, guesses: [], revealedMessage: null, totalGuesses: null },
      from: 'x',
    });
    expect(g.state.phase).toBe('playing');
    expect(g.state.secret).toBe(42);
    expect(g.state.min).toBe(1);
  });

  it('an unanswered resync latch self-heals once this client starts a round', () => {
    // A reloads while alone: it sends resync, nobody authoritative answers, latch sticks.
    const g = new Game({ role: null });
    g.resync();
    g.receive({ type: 'hello', payload: { role: 'guesser' }, from: 'x' }); // role -> setter
    // The round proceeds normally; A is the setter.
    g.startRound({ preset: 'medium', secret: 42, message: 'hi' });
    // Later the partner reloads mid-round and asks for a snapshot. A must answer.
    const res = g.receive({ type: 'resync', payload: {}, from: 'x' });
    const snap = outbound(res, 'state_snapshot');
    expect(snap).toBeTruthy();
    expect(snap.payload.phase).toBe('playing');
    expect(outbound(res, 'hello')).toBeTruthy();
  });

  it('an unanswered resync latch self-heals when this client receives round_start', () => {
    const g = new Game({ role: null });
    g.resync();
    g.receive({ type: 'hello', payload: { role: 'setter' }, from: 'x' }); // role -> guesser
    g.receive({
      type: 'round_start',
      payload: { preset: 'medium', min: 1, max: 100, roundNumber: 1 },
      from: 'x',
    });
    const res = g.receive({ type: 'resync', payload: {}, from: 'x' });
    expect(outbound(res, 'state_snapshot')).toBeTruthy();
  });

  it('self-healing does not break the ordinary reload path (hello then snapshot)', () => {
    // The answering peer sends hello BEFORE state_snapshot, so role resolution must not
    // clear the latch — the snapshot we asked for still has to be accepted.
    const g = new Game({ role: null });
    g.resync();
    g.receive({ type: 'hello', payload: { role: 'setter' }, from: 'x' }); // role -> guesser
    g.receive({
      type: 'state_snapshot',
      payload: { phase: 'playing', preset: 'medium', min: 1, max: 100, roundNumber: 1, guesses: [{ n: 1, value: 5, hint: 'higher' }], revealedMessage: null, totalGuesses: null },
      from: 'x',
    });
    expect(g.state.phase).toBe('playing');
    expect(g.state.guesses).toEqual([{ n: 1, value: 5, hint: 'higher' }]);
  });

  it('newRound and playAgain also clear a stuck latch', () => {
    const a = new Game({ role: 'setter' });
    a.resync();
    a.newRound();
    a.startRound({ preset: 'easy', secret: 5, message: 'hi' });
    expect(outbound(a.receive({ type: 'resync', payload: {}, from: 'x' }), 'state_snapshot')).toBeTruthy();

    const b = new Game({ role: 'setter' });
    b.state.phase = 'finished';
    b.resync();
    b.playAgain(); // b is now the guesser, in setup with no preset — still not authoritative
    b.receive({ type: 'round_start', payload: { preset: 'easy', min: 1, max: 20, roundNumber: 2 }, from: 'x' });
    expect(outbound(b.receive({ type: 'resync', payload: {}, from: 'x' }), 'state_snapshot')).toBeTruthy();
  });

  it('round_lost message moves either side to the round_lost screen', () => {
    const g = new Game({ role: 'guesser' });
    g.state.phase = 'playing';
    g.receive({ type: 'round_lost', payload: {}, from: 'x' });
    expect(g.state.phase).toBe('round_lost');
  });

  it('synthetic presence messages toggle partnerPresent', () => {
    const g = new Game({ role: 'setter' });
    g.receive({ type: 'partner_here', payload: {}, from: 'local' });
    expect(g.state.partnerPresent).toBe(true);
    g.receive({ type: 'partner_left', payload: {}, from: 'local' });
    expect(g.state.partnerPresent).toBe(false);
  });
});

describe('chat', () => {
  it('sendChat appends a mine=true message and returns one trimmed chat message', () => {
    const g = new Game({ role: 'setter' });
    const res = g.sendChat('  hey there  ');
    expect(g.state.chatMessages).toEqual([{ mine: true, text: 'hey there' }]);
    expect(res).toEqual([{ type: 'chat', payload: { text: 'hey there' } }]);
  });

  it('sendChat caps text at 280 characters', () => {
    const g = new Game({ role: 'guesser' });
    const res = g.sendChat('x'.repeat(500));
    expect(g.state.chatMessages[0].text).toHaveLength(280);
    expect(res[0].payload.text).toHaveLength(280);
  });

  it('sendChat ignores empty / whitespace-only text', () => {
    const g = new Game({ role: 'setter' });
    expect(g.sendChat('   ')).toEqual([]);
    expect(g.sendChat('')).toEqual([]);
    expect(g.state.chatMessages).toEqual([]);
  });

  it('receive chat appends a mine=false message regardless of role or phase', () => {
    const g = new Game({ role: 'guesser' });
    g.state.phase = 'finished';
    g.receive({ type: 'chat', payload: { text: 'lol' }, from: 'x' });
    expect(g.state.chatMessages).toEqual([{ mine: false, text: 'lol' }]);
  });

  it('snapshot never includes chatMessages', () => {
    const g = new Game({ role: 'setter' });
    g.sendChat('secret-ish banter');
    expect(g.snapshot()).not.toHaveProperty('chatMessages');
  });

  it('chatMessages clears on startRound', () => {
    const g = new Game({ role: 'setter' });
    g.state.phase = 'setup';
    g.sendChat('a');
    g.startRound({ preset: 'easy', secret: 5, message: 'm' });
    expect(g.state.chatMessages).toEqual([]);
  });

  it('chatMessages clears on round_start (guesser side)', () => {
    const g = new Game({ role: 'guesser' });
    g.state.phase = 'playing';
    g.receive({ type: 'chat', payload: { text: 'c' }, from: 'x' });
    g.receive({ type: 'round_start', payload: { preset: 'easy', min: 1, max: 20, roundNumber: 2 }, from: 'x' });
    expect(g.state.chatMessages).toEqual([]);
  });

  it('chatMessages clears on play_again and new_round', () => {
    const a = new Game({ role: 'setter' });
    a.state.phase = 'finished';
    a.receive({ type: 'chat', payload: { text: 'x' }, from: 'y' });
    a.playAgain();
    expect(a.state.chatMessages).toEqual([]);

    const b = new Game({ role: 'guesser' });
    b.state.phase = 'round_lost';
    b.receive({ type: 'chat', payload: { text: 'x' }, from: 'y' });
    b.receive({ type: 'new_round', payload: { roundNumber: 3 }, from: 'y' });
    expect(b.state.chatMessages).toEqual([]);
  });
});
