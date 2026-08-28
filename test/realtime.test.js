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

  it('onPresence maps enter/leave', async () => {
    const { ctor, channel } = makeAblyStub();
    const rt = createRealtime({ roomCode: 'ABCDE', AblyRealtime: ctor });
    await rt.connect();
    rt.onPresence('enter', () => {});
    expect(channel.presence.subscribe).toHaveBeenCalledWith('enter', expect.any(Function));
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
