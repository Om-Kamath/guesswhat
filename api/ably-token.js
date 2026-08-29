import * as Ably from 'ably';

export async function makeTokenRequest(AblyRest = Ably.Rest, apiKey = process.env.ABLY_API_KEY) {
  if (!apiKey) throw new Error('ABLY_API_KEY is not set');
  const rest = new AblyRest(apiKey);
  // clientId '*' lets each browser assume its own clientId (src/realtime.js sets one
  // explicitly and enters presence). The capability limits the blast radius of this
  // unauthenticated endpoint to publish/subscribe/presence — no history, no admin.
  return rest.auth.createTokenRequest({
    clientId: '*',
    capability: JSON.stringify({ '*': ['publish', 'subscribe', 'presence'] }),
  });
}

export default async function handler(req, res) {
  try {
    const tokenRequest = await makeTokenRequest();
    res.status(200).json(tokenRequest);
  } catch (err) {
    res.status(500).json({ error: String(err && err.message ? err.message : err) });
  }
}
