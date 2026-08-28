import * as Ably from 'ably';

export async function makeTokenRequest(AblyRest = Ably.Rest, apiKey = process.env.ABLY_API_KEY) {
  if (!apiKey) throw new Error('ABLY_API_KEY is not set');
  const rest = new AblyRest(apiKey);
  return rest.auth.createTokenRequest({});
}

export default async function handler(req, res) {
  try {
    const tokenRequest = await makeTokenRequest();
    res.status(200).json(tokenRequest);
  } catch (err) {
    res.status(500).json({ error: String(err && err.message ? err.message : err) });
  }
}
