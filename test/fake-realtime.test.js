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

  it('otherMembers reflects the peer once both have entered', async () => {
    const [a, b] = createFakeRealtimePair();
    a.enter();
    b.enter();
    await flush();
    expect(await a.otherMembers()).toEqual([{ clientId: b.clientId }]);
    expect(await b.otherMembers()).toEqual([{ clientId: a.clientId }]);
  });

  it('onPresence handler fires on peer enter and leave', async () => {
    const [a, b] = createFakeRealtimePair();
    let calls = 0;
    a.onPresence(() => { calls++; });
    b.enter();
    await flush();
    b.leave();
    await flush();
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it('a client sees no other members before the peer enters', async () => {
    const [a] = createFakeRealtimePair();
    a.enter();
    await flush();
    expect(await a.otherMembers()).toEqual([]);
  });
});
