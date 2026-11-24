import { ProviderManager } from '../../src/services/providerManager';
import { createFakeModel } from '../helpers/fakeModel';

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
});
