import { describe, it, expect, vi } from 'vitest';
import { makeTokenRequest } from '../api/ably-token.js';

describe('makeTokenRequest', () => {
  it('creates a token request using the API key', async () => {
    const createTokenRequest = vi.fn().mockResolvedValue({ keyName: 'k', nonce: 'n' });
    const AblyRest = vi.fn().mockImplementation(() => ({ auth: { createTokenRequest } }));
    const out = await makeTokenRequest(AblyRest, 'app.key:secret');
    expect(AblyRest).toHaveBeenCalledWith('app.key:secret');
    expect(createTokenRequest).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: '*', capability: expect.any(String) }),
    );
    expect(JSON.parse(createTokenRequest.mock.calls[0][0].capability)).toEqual({
      '*': ['publish', 'subscribe', 'presence'],
    });
    expect(out).toEqual({ keyName: 'k', nonce: 'n' });
  });

  it('throws when the API key is missing', async () => {
    const AblyRest = vi.fn();
    await expect(makeTokenRequest(AblyRest, undefined)).rejects.toThrow(/ABLY_API_KEY/);
  });
});
