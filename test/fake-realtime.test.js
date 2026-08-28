import { describe, it, expect } from 'vitest';
import { createFakeRealtimePair } from './fake-realtime.js';

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('createFakeRealtimePair', () => {
  it('delivers a message from A to B with from = A.clientId', async () => {
    const [a, b] = createFakeRealtimePair();
    const received = [];
    b.on('ping', (payload, from) => received.push({ payload, from }));
    a.send('ping', { n: 1 });
    await flush();
    expect(received).toEqual([{ payload: { n: 1 }, from: a.clientId }]);
  });

  it('does not deliver a message back to the sender', async () => {
    const [a, b] = createFakeRealtimePair();
    let got = 0;
    a.on('ping', () => { got++; });
    a.send('ping', {});
    await flush();
    expect(got).toBe(0);
  });

  it('enter() fires the peer enter handler', async () => {
    const [a, b] = createFakeRealtimePair();
    let entered = 0;
    b.onPresence('enter', () => { entered++; });
    a.enter();
    await flush();
    expect(entered).toBe(1);
  });

  it('leave() fires the peer leave handler', async () => {
    const [a, b] = createFakeRealtimePair();
    let left = 0;
    b.onPresence('leave', () => { left++; });
    a.leave();
    await flush();
    expect(left).toBe(1);
  });
});
