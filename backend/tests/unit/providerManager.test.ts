import { ProviderManager } from '../../src/services/providerManager';
import { createFakeModel } from '../helpers/fakeModel';

/* The Animeku health probe is mocked: `healthCheckAll` must reach the adapter
 * (not the network) for query-routed providers. */
const mockProbe = jest.fn(async () => ({ reachable: true, latencyMs: 12, items: 0, scheduleShape: 'empty', reason: 'probe ok' }));
jest.mock('../../src/providers/anime/animasu', () => ({ animasuProvider: { probe: mockProbe } }));

function setup() {
  const providerModel = createFakeModel();
  const cacheModel = createFakeModel();
  const logModel = createFakeModel();
  const healthModel = createFakeModel();
  const manager = new ProviderManager(
    providerModel as never,
    cacheModel as never,
    logModel as never,
    healthModel as never,
  );
  return { manager, providerModel, cacheModel, logModel };
}

const provider = (id: string, priority: number) => ({
  _id: `id-${id}`,
  providerId: id,
  name: id,
  type: 'music_metadata',
  baseUrl: 'https://example.com',
  authMethod: 'none',
  enabled: true,
  priority,
  timeoutMs: 8000,
  maxRetries: 0,
  cacheTtlSec: 60,
  requiresCredentials: false,
});

describe('ProviderManager', () => {
  it('falls back to the next provider when the first fails', async () => {
    const { manager, providerModel } = setup();
    await providerModel.create(provider('primary', 10));
    await providerModel.create(provider('secondary', 20));

    const result = await manager.execute('music_metadata', { operation: 'test' }, async (p) => {
      if (p.providerId === 'primary') throw new Error('primary down');
      return ['from-secondary'];
    });

    expect(result.data).toEqual(['from-secondary']);
    expect(result.providerId).toBe('secondary');
    expect(result.fromCache).toBe(false);
  });

  it('skips empty results and tries the next provider', async () => {
    const { manager, providerModel } = setup();
    await providerModel.create(provider('primary', 10));
    await providerModel.create(provider('secondary', 20));

    const result = await manager.execute(
      'music_metadata',
      { operation: 'test' },
      async (p) => (p.providerId === 'primary' ? [] : ['data']),
      (r) => r.length === 0,
    );
    expect(result.providerId).toBe('secondary');
  });

  it('throws when all providers fail', async () => {
    const { manager, providerModel } = setup();
    await providerModel.create(provider('primary', 10));

    await expect(
      manager.execute('music_metadata', { operation: 'test' }, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });

  it('throws when no provider is configured for the type', async () => {
    const { manager } = setup();
    await expect(
      manager.execute('anime_video', { operation: 'test' }, async () => 'x'),
    ).rejects.toThrow(/No enabled provider/);
  });

  it('caches successful results and serves them from cache', async () => {
    const { manager, providerModel } = setup();
    await providerModel.create(provider('primary', 10));

    let calls = 0;
    const fn = async () => {
      calls += 1;
      return ['cached-data'];
    };

    const first = await manager.execute('music_metadata', { operation: 'test', cacheKey: 'k1' }, fn);
    expect(first.fromCache).toBe(false);
    const second = await manager.execute('music_metadata', { operation: 'test', cacheKey: 'k1' }, fn);
    expect(second.fromCache).toBe(true);
    expect(second.providerId).toBe('cache');
    expect(calls).toBe(1);
  });

  it('records success and failure in provider logs', async () => {
    const { manager, providerModel, logModel } = setup();
    await providerModel.create(provider('primary', 10));
    await providerModel.create(provider('secondary', 20));

    await manager.execute('music_metadata', { operation: 'test' }, async (p) => {
      if (p.providerId === 'primary') throw new Error('down');
      return ['ok'];
    });

    const logs = logModel._docs;
    expect(logs.some((l) => l.success === false)).toBe(true);
    expect(logs.some((l) => l.success === true)).toBe(true);
  });
  it('redacts media URLs from persisted provider errors', async () => {
    const { manager, providerModel, logModel } = setup();
    await providerModel.create(provider('primary', 10));

    await expect(
      manager.execute('music_metadata', { operation: 'test' }, async () => {
        throw new Error('segment fetch failed for https://cdn.example/seg.m3u8?token=super-secret');
      }),
    ).rejects.toThrow();

    const failure = logModel._docs.find((log) => log.success === false);
    expect(failure?.errorMessage).toContain('<url-redacted>');
    expect(failure?.errorMessage).not.toContain('super-secret');
    expect(String(providerModel._docs[0].lastError)).not.toContain('super-secret');
  });
});

describe('ProviderManager health checks', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    (global as unknown as { fetch: unknown }).fetch = realFetch;
    mockProbe.mockClear();
  });

  it('probes a query-routed Animeku provider through its adapter, never the bare base URL', async () => {
    const { manager, providerModel } = setup();
    await providerModel.create({ ...provider('animasu', 10), type: 'animeku', baseUrl: 'https://api.nexadev.my.id/animasu' });
    const fetchSpy = jest.fn();
    (global as unknown as { fetch: unknown }).fetch = fetchSpy;

    const results = await manager.healthCheckAll();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mockProbe).toHaveBeenCalledTimes(1);
    // reachable but empty catalog => degraded, not "healthy"
    expect(results).toEqual([{ providerId: 'animasu', status: 'degraded', latencyMs: 12 }]);
    expect(providerModel._docs[0].healthStatus).toBe('degraded');
  });

  it('reports a healthy Animeku provider when the probe returns catalog items', async () => {
    mockProbe.mockResolvedValueOnce({ reachable: true, latencyMs: 30, items: 12, scheduleShape: 'object', reason: 'ok' });
    const { manager, providerModel } = setup();
    await providerModel.create({ ...provider('animasu', 10), type: 'animeku' });
    const results = await manager.healthCheckAll();
    expect(results[0].status).toBe('healthy');
  });

  it('reports a down Animeku provider when the probe cannot reach it', async () => {
    mockProbe.mockResolvedValueOnce({ reachable: false, latencyMs: 5000, items: 0, scheduleShape: 'unknown', reason: 'timeout' });
    const { manager, providerModel } = setup();
    await providerModel.create({ ...provider('animasu', 10), type: 'animeku' });
    const results = await manager.healthCheckAll();
    expect(results[0].status).toBe('down');
  });

  it('still checks other providers with a bounded GET on their base URL', async () => {
    const { manager, providerModel } = setup();
    await providerModel.create(provider('deezer', 10));
    const fetchSpy = jest.fn(async () => ({ ok: true }));
    (global as unknown as { fetch: unknown }).fetch = fetchSpy;

    const results = await manager.healthCheckAll();
    expect(results[0]).toMatchObject({ providerId: 'deezer', status: 'healthy' });
    expect(fetchSpy).toHaveBeenCalledWith('https://example.com', expect.objectContaining({ method: 'GET' }));
  });
});
