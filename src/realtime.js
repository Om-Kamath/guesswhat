import * as Ably from 'ably';

function randomId() {
  return 'c-' + Math.random().toString(36).slice(2, 10);
}

export function createRealtime({ roomCode, tokenUrl = '/api/ably-token', AblyRealtime } = {}) {
  const Ctor = AblyRealtime || Ably.Realtime;
  const clientId = randomId();
  let client = null;
  let channel = null;

  return {
    clientId,

    async connect() {
      client = new Ctor({ authUrl: tokenUrl, clientId });
      channel = client.channels.get(roomCode);
      await channel.attach();
      await channel.presence.enter({});
    },

    send(type, payload) {
      channel.publish(type, { ...payload, from: clientId });
    },

    on(type, handler) {
      channel.subscribe(type, (msg) => handler(msg.data, msg.data && msg.data.from));
    },

    onPresence(event, handler) {
      channel.presence.subscribe(event, () => handler());
    },

    async close() {
      try {
        if (channel) await channel.presence.leave();
      } finally {
        if (client) client.close();
      }
    },
  };
}
