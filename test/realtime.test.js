import { describe, it, expect, vi } from 'vitest';
import { createRealtime } from '../src/realtime.js';

function makeAblyStub() {
  const channel = {
    publish: vi.fn(),
    subscribe: vi.fn(),
    attach: vi.fn().mockResolvedValue(undefined),
    presence: {
      enter: vi.fn().mockResolvedValue(undefined),
      leave: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn(),
      get: vi.fn().mockResolvedValue([]),
    },
  };
  const client = {
    channels: { get: vi.fn().mockReturnValue(channel) },
    close: vi.fn(),
  };
  const ctor = vi.fn().mockImplementation(() => client);
  return { ctor, client, channel };
}

describe('createRealtime', () => {
  it('connects to the channel named after the room code and enters presence', async () => {
    const { ctor, client, channel } = makeAblyStub();
    const rt = createRealtime({ roomCode: 'ABCDE', AblyRealtime: ctor });
    await rt.connect();
    expect(ctor).toHaveBeenCalledWith(
      expect.objectContaining({ authUrl: '/api/ably-token', echoMessages: false }),
    );
    expect(client.channels.get).toHaveBeenCalledWith('ABCDE');
    expect(channel.attach).toHaveBeenCalled();
    expect(channel.presence.enter).toHaveBeenCalled();
  });

  it('send() publishes with type as name and from in the data', async () => {
    const { ctor, channel } = makeAblyStub();
    const rt = createRealtime({ roomCode: 'ABCDE', AblyRealtime: ctor });
    await rt.connect();
    rt.send('guess', { value: 7 });
    expect(channel.publish).toHaveBeenCalledWith('guess', expect.objectContaining({ value: 7, from: rt.clientId }));
  });

  it('on() subscribes and unwraps msg.data', async () => {
    const { ctor, channel } = makeAblyStub();
    let handlerArg;
    channel.subscribe.mockImplementation((name, cb) => { if (name === 'guess') handlerArg = cb; });
    const rt = createRealtime({ roomCode: 'ABCDE', AblyRealtime: ctor });
    await rt.connect();
    const seen = [];
    rt.on('guess', (payload, from) => seen.push({ payload, from }));
    handlerArg({ data: { value: 7, from: 'peer' } });
    expect(seen).toEqual([{ payload: { value: 7, from: 'peer' }, from: 'peer' }]);
  });

  it('on() drops self-originated messages', async () => {
    const { ctor, channel } = makeAblyStub();
    let handlerArg;
    channel.subscribe.mockImplementation((name, cb) => { if (name === 'guess') handlerArg = cb; });
    const rt = createRealtime({ roomCode: 'ABCDE', AblyRealtime: ctor });
    await rt.connect();
    const seen = [];
    rt.on('guess', (payload) => seen.push(payload));
    handlerArg({ data: { value: 7, from: rt.clientId } });
    expect(seen).toEqual([]);
  });

  it('onPresence subscribes to all presence actions with a bare handler', async () => {
    const { ctor, channel } = makeAblyStub();
    const rt = createRealtime({ roomCode: 'ABCDE', AblyRealtime: ctor });
    await rt.connect();
    const handler = vi.fn();
    rt.onPresence(handler);
    expect(channel.presence.subscribe).toHaveBeenCalledWith(expect.any(Function));
    // simulate Ably firing a presence event
    channel.presence.subscribe.mock.calls[0][0]();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('otherMembers excludes the own clientId', async () => {
    const { ctor, channel } = makeAblyStub();
    channel.presence.get = vi.fn().mockResolvedValue([
      { clientId: 'someone-else' },
      { clientId: null },
    ]);
    const rt = createRealtime({ roomCode: 'ABCDE', AblyRealtime: ctor });
    await rt.connect();
    const others = await rt.otherMembers();
    expect(others).toEqual([{ clientId: 'someone-else' }, { clientId: null }]);
  });

  it('close() leaves presence then closes the client', async () => {
    const { ctor, client, channel } = makeAblyStub();
    const rt = createRealtime({ roomCode: 'ABCDE', AblyRealtime: ctor });
    await rt.connect();
    await rt.close();
    expect(channel.presence.leave).toHaveBeenCalled();
    expect(client.close).toHaveBeenCalled();
  });
});
