import { fetchJson, ProviderHttpError } from '../../src/providers/http';

const mockFetch = jest.fn();
(global as unknown as { fetch: unknown }).fetch = mockFetch;

describe('fetchJson', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('returns parsed JSON on success', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ hello: 'world' }) });
    await expect(fetchJson('https://example.com')).resolves.toEqual({ hello: 'world' });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('retries on 5xx then succeeds', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });
    await expect(fetchJson('https://example.com', { retries: 2 })).resolves.toEqual({ ok: true });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('does not retry on 4xx (except 429)', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
    await expect(fetchJson('https://example.com', { retries: 3 })).rejects.toBeInstanceOf(ProviderHttpError);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('throws after exhausting retries', async () => {
    mockFetch.mockRejectedValue(new Error('network down'));
    await expect(fetchJson('https://example.com', { retries: 1 })).rejects.toThrow('network down');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('sends POST body and headers', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    await fetchJson('https://example.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ a: 1 }),
    });
    const [, init] = mockFetch.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ a: 1 }));
    expect(init.headers['User-Agent']).toContain('MUSIKUPlus');
  });
});
