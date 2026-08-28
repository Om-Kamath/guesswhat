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
