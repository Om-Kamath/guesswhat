import { describe, it, expect } from 'vitest';
import { Game } from '../src/game.js';
import { createFakeRealtimePair } from './fake-realtime.js';
import { wire } from '../src/wire.js';

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('full round', () => {
  it('plays a round, reveals the message, and swaps roles on play again', async () => {
    const [rtSetter, rtGuesser] = createFakeRealtimePair();
    const setter = new Game({ role: 'setter' });
    const guesser = new Game({ role: 'guesser' });
    wire(setter, rtSetter);
    wire(guesser, rtGuesser);

    // handshake
    rtSetter.send('hello', { role: 'setter' });
    rtGuesser.send('hello', { role: 'guesser' });
    await flush();
    expect(setter.state.phase).toBe('setup');
    expect(guesser.state.phase).toBe('setup');

    // setter starts a medium round, secret 42
    rtSetter.send('round_start', setter.startRound({ preset: 'medium', secret: 42, message: 'kiss' })[0].payload);
    await flush();
    expect(guesser.state.phase).toBe('playing');
    expect(guesser.state.max).toBe(100);

    // guesser: 50 (too high), 25 (too low), 42 (correct)
    rtGuesser.send('guess', guesser.submitGuess(50)[0].payload);
    await flush();
    rtSetter.send('hint', setter.sendHint('lower')[0].payload);
    await flush();
    expect(guesser.state.guesses[0].hint).toBe('lower');

    rtGuesser.send('guess', guesser.submitGuess(25)[0].payload);
    await flush();
    rtSetter.send('hint', setter.sendHint('higher')[0].payload);
    await flush();

    rtGuesser.send('guess', guesser.submitGuess(42)[0].payload);
    await flush();
    expect(setter.state.canConfirmWin).toBe(true);

    rtSetter.send('reveal', setter.confirmWin()[0].payload);
    await flush();
    expect(guesser.state.phase).toBe('finished');
    expect(guesser.state.revealedMessage).toBe('kiss');
    expect(guesser.state.totalGuesses).toBe(3);
    expect(setter.state.totalGuesses).toBe(3);

    // play again -> roles swap
    rtSetter.send('play_again', setter.playAgain()[0].payload);
    await flush();
    expect(setter.state.role).toBe('guesser');
    expect(guesser.state.role).toBe('setter');
    expect(setter.state.phase).toBe('setup');
    expect(guesser.state.phase).toBe('setup');
    expect(guesser.state.roundNumber).toBe(2);
  });

  it('chat reaches the partner (not the sender) and clears on a new round', async () => {
    const [rtA, rtB] = createFakeRealtimePair();
    const a = new Game({ role: 'setter' });
    const b = new Game({ role: 'guesser' });
    wire(a, rtA);
    wire(b, rtB);
    rtA.enter();
    rtB.enter();
    await flush();

    for (const m of a.sendChat('can i fit six slices')) rtA.send(m.type, m.payload);
    await flush();
    expect(b.state.chatMessages).toEqual([{ mine: false, text: 'can i fit six slices' }]);
    expect(a.state.chatMessages).toEqual([{ mine: true, text: 'can i fit six slices' }]);

    for (const m of a.startRound({ preset: 'easy', secret: 3, message: 'x' })) rtA.send(m.type, m.payload);
    await flush();
    expect(a.state.chatMessages).toEqual([]);
    expect(b.state.chatMessages).toEqual([]);
  });
});
