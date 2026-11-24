/**
 * Animasu adapter hardening: SSRF guards, media-host allowlist, playback
 * authorization, timeouts and log/persist redaction.
 *
 * Everything here runs against an injected fetcher, so no network call is made
 * and no real provider is required.
 */
import { AnimasuError, AnimasuProvider, isBlockedHostname, type AnimasuConfig, type AnimasuFetcher } from '../../src/providers/anime/animasu';

const BASE = 'https://api.nexadev.my.id/animasu';

function config(overrides: Partial<AnimasuConfig> = {}): AnimasuConfig {
  return {
    enabled: true,
    baseUrl: BASE,
    streamingAuthorized: false,
    allowedStreamHosts: [],
    timeoutMs: 4321,
    cacheTtlSec: 0,
    rateLimitPerMin: 60,
    ...overrides,
  };
}

interface RecordingFetcher {
  fetcher: AnimasuFetcher;
  calls: { url: string; opts?: { timeoutMs?: number; retries?: number } }[];
}

function recordingFetcher(payload: unknown): RecordingFetcher {
  const calls: RecordingFetcher['calls'] = [];
  const fetcher = async <T,>(url: string, opts?: { timeoutMs?: number; retries?: number }): Promise<T> => {
    calls.push({ url, opts });
    return payload as T;
  };
  return { fetcher, calls };
}

function failingFetcher(error: Error): RecordingFetcher {
  const calls: RecordingFetcher['calls'] = [];
  const fetcher = async <T,>(url: string, opts?: { timeoutMs?: number; retries?: number }): Promise<T> => {
    calls.push({ url, opts });
    throw error;
  };
  return { fetcher, calls };
}

/** Awaits a rejection and returns it typed as an AnimasuError. */
async function caughtFrom(promise: Promise<unknown>): Promise<AnimasuError> {
  try {
    await promise;
  } catch (error) {
    return error as AnimasuError;
  }
  throw new Error('expected the call to reject');
}

/** Calls a synchronous guard and returns the thrown AnimasuError. */
function caughtSync(fn: () => unknown): AnimasuError {
  try {
    fn();
  } catch (error) {
    return error as AnimasuError;
  }
  throw new Error('expected the call to throw');
}

const listEnvelope = {
  success: true,
  status: 200,
  data: { page: 1, total: 2, animeList: [{ title: 'A', link: '/a' }, { title: 'B', link: '/b' }] },
};

describe('Animasu request construction', () => {
  it('always builds the URL from the configured https origin plus fixed query keys', async () => {
    const { fetcher, calls } = recordingFetcher(listEnvelope);
    const provider = new AnimasuProvider(config(), fetcher);
    const page = await provider.popular(2);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BASE}?popular=1&page=2`);
    expect(page.items.map((item) => item.link)).toEqual(['/a', '/b']);
  });

  it('passes the configured timeout and a bounded retry count to the HTTP layer', async () => {
    const { fetcher, calls } = recordingFetcher(listEnvelope);
    await new AnimasuProvider(config({ timeoutMs: 7000 }), fetcher).ongoing(1);
    expect(calls[0].opts).toEqual({ timeoutMs: 7000, retries: 1 });
  });

  it('uses the documented query key for every endpoint', async () => {
    const { fetcher, calls } = recordingFetcher(listEnvelope);
    const provider = new AnimasuProvider(config(), fetcher);
    await provider.ongoing(3);
    await provider.completed(1);
    await provider.schedule();
    await provider.search('frieren', 2);
    expect(calls.map((call) => call.url)).toEqual([
      `${BASE}?ongoing=1&page=3`,
      `${BASE}?completed=1&page=1`,
      `${BASE}?schedule=1`,
      `${BASE}?search=frieren&page=2`,
    ]);
  });

  it('refuses to call anything when the provider is disabled', async () => {
    const { fetcher, calls } = recordingFetcher(listEnvelope);
    const provider = new AnimasuProvider(config({ enabled: false }), fetcher);
    await expect(provider.popular(1)).rejects.toMatchObject({ code: 'PROVIDER_DISABLED', status: 503 });
    expect(calls).toHaveLength(0);
  });

  it('refuses a non-https or blocked base origin', async () => {
    const { fetcher, calls } = recordingFetcher(listEnvelope);
    await expect(new AnimasuProvider(config({ baseUrl: 'http://api.nexadev.my.id/animasu' }), fetcher).popular(1)).rejects.toBeInstanceOf(AnimasuError);
    await expect(new AnimasuProvider(config({ baseUrl: 'https://127.0.0.1/animasu' }), fetcher).popular(1)).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    expect(calls).toHaveLength(0);
  });

  it('normalizes provider failures into an error code and redacts URLs from the message', async () => {
    const { fetcher } = failingFetcher(new Error('upstream reset while fetching https://cdn.example/secret.m3u8?token=abc123'));
    const provider = new AnimasuProvider(config(), fetcher);
    const error = await caughtFrom(provider.popular(1));
    expect(error).toBeInstanceOf(AnimasuError);
    expect(error.code).toBe('PROVIDER_UNAVAILABLE');
    expect(error.message).not.toContain('token=abc123');
    expect(error.message).not.toContain('cdn.example');
    expect(error.message).toContain('<url-redacted>');
  });

  it('keeps a 4xx status from the provider instead of reporting 502', async () => {
    const { fetcher } = failingFetcher(Object.assign(new Error('not found'), { status: 404 }));
    await expect(new AnimasuProvider(config(), fetcher).details('/missing')).rejects.toMatchObject({ status: 404, code: 'PROVIDER_UNAVAILABLE' });
  });
});

describe('SSRF guard on provider-supplied targets', () => {
  const provider = new AnimasuProvider(config(), recordingFetcher(listEnvelope).fetcher);

  it('accepts a relative path and reduces a same-origin absolute URL to its path', () => {
    expect(provider.assertRelativeTarget('/anime/jujutsu-kaisen', 'link')).toBe('/anime/jujutsu-kaisen');
    expect(provider.assertRelativeTarget(`${BASE}/anime/frieren?page=2`, 'link')).toBe('/animasu/anime/frieren?page=2');
  });

  it.each([
    ['another origin', 'https://evil.example/anime/x'],
    ['protocol-relative', '//evil.example/anime/x'],
    ['loopback host', 'http://127.0.0.1/anime/x'],
    ['cloud metadata host', 'http://169.254.169.254/latest/meta-data/'],
    ['whitespace injection', '/anime/x https://evil.example'],
    ['control characters', '/anime/x\u0000'],
    ['backslash escape', '/anime/x\\..\\..'],
    ['empty target', '   '],
  ])('rejects %s', async (_label, target) => {
    const error = caughtSync(() => provider.assertRelativeTarget(target, 'link'));
    expect(error).toBeInstanceOf(AnimasuError);
    expect(error.code).toBe('BAD_TARGET');
    expect(error.status).toBe(400);
  });

  it('never forwards a rejected target to the network', async () => {
    const { fetcher, calls } = recordingFetcher(listEnvelope);
    const live = new AnimasuProvider(config(), fetcher);
    await expect(live.details('https://evil.example/anime/x')).rejects.toMatchObject({ code: 'BAD_TARGET' });
    await expect(live.stream('//169.254.169.254/latest/meta-data/')).rejects.toMatchObject({ code: 'BAD_TARGET' });
    expect(calls).toHaveLength(0);
  });

  it('percent-encodes the validated target as a query parameter', async () => {
    const { fetcher, calls } = recordingFetcher({ success: true, data: { title: 'A' } });
    await new AnimasuProvider(config(), fetcher).details('/anime/a+b');
    expect(calls[0].url).toBe(`${BASE}?details=%2Fanime%2Fa%2Bb`);
  });

  it('flags private, link-local and internal hostnames as blocked', () => {
    for (const host of ['localhost', '127.0.0.1', '10.1.2.3', '192.168.0.1', '172.16.5.4', '169.254.169.254', '::1', 'metadata.google.internal', 'db.local']) {
      expect(isBlockedHostname(host)).toBe(true);
    }
    for (const host of ['api.nexadev.my.id', 'cdn.example.com', '8.8.8.8']) {
      expect(isBlockedHostname(host)).toBe(false);
    }
  });
});

describe('media host allowlist and playback authorization', () => {
  it('refuses to return a media URL when playback is not authorized', () => {
    const provider = new AnimasuProvider(config({ streamingAuthorized: false, allowedStreamHosts: ['cdn.example.com'] }), recordingFetcher({}).fetcher);
    const error = caughtSync(() => provider.assertAllowedStreamUrl('https://cdn.example.com/video.m3u8'));
    expect(error).toBeInstanceOf(AnimasuError);
    expect(error.code).toBe('STREAM_NOT_AUTHORIZED');
    expect(error.status).toBe(403);
    expect(error.message).not.toContain('cdn.example.com');
  });

  it('returns the sanitized URL only for an allowlisted https host without credentials', () => {
    const provider = new AnimasuProvider(
      config({ streamingAuthorized: true, allowedStreamHosts: ['cdn.example.com'] }),
      recordingFetcher({}).fetcher,
    );
    expect(provider.assertAllowedStreamUrl('https://cdn.example.com/video.m3u8#t=10')).toBe('https://cdn.example.com/video.m3u8');
  });

  it('supports wildcard allowlist entries without opening every subdomain of another host', () => {
    const provider = new AnimasuProvider(
      config({ streamingAuthorized: true, allowedStreamHosts: ['*.example.com'] }),
      recordingFetcher({}).fetcher,
    );
    expect(provider.assertAllowedStreamUrl('https://cdn.example.com/a.m3u8')).toContain('cdn.example.com');
    expect(provider.assertAllowedStreamUrl('https://example.com/a.m3u8')).toContain('example.com');
    expect(() => provider.assertAllowedStreamUrl('https://cdn.notexample.com/a.m3u8')).toThrow(AnimasuError);
  });

  it.each([
    ['a non-allowlisted host', 'https://evil.example/video.m3u8'],
    ['plain http', 'http://cdn.example.com/video.m3u8'],
    ['embedded credentials', 'https://user:pass@cdn.example.com/video.m3u8'],
    ['a loopback host', 'https://127.0.0.1/video.m3u8'],
    ['the cloud metadata endpoint', 'https://169.254.169.254/latest/meta-data/'],
    ['a malformed URL', 'not-a-url'],
    ['an empty URL', '   '],
  ])('rejects %s', (_label, url) => {
    const provider = new AnimasuProvider(
      config({ streamingAuthorized: true, allowedStreamHosts: ['cdn.example.com'] }),
      recordingFetcher({}).fetcher,
    );
    expect(() => provider.assertAllowedStreamUrl(url)).toThrow(AnimasuError);
  });

  it('validates the primary URL and filters non-allowlisted alternatives out of a stream response', async () => {
    const streamEnvelope = {
      success: true,
      data: {
        streamUrl: 'https://cdn.example.com/video.m3u8',
        alternativeLinks: ['https://mirror.example.com/a.m3u8', 'https://cdn.example.com/b.m3u8', 'http://insecure.example.com/c.m3u8'],
        episodeInfo: { title: 'Episode 12', heading: 'Jujutsu Kaisen' },
      },
    };
    const { fetcher, calls } = recordingFetcher(streamEnvelope);
    const provider = new AnimasuProvider(
      config({ streamingAuthorized: true, allowedStreamHosts: ['cdn.example.com'] }),
      fetcher,
    );
    const stream = await provider.stream('/episode/jujutsu-kaisen-12');
    expect(calls[0].url).toBe(`${BASE}?stream=%2Fepisode%2Fjujutsu-kaisen-12`);
    expect(stream.streamUrl).toBe('https://cdn.example.com/video.m3u8');
    expect(stream.alternativeLinks).toEqual(['https://cdn.example.com/b.m3u8']);
    expect(stream.episodeTitle).toBe('Episode 12');
  });

  it('rejects the whole stream call when the primary URL host is not allowlisted', async () => {
    const { fetcher } = recordingFetcher({ data: { streamUrl: 'https://unknown.example/video.m3u8' } });
    const provider = new AnimasuProvider(
      config({ streamingAuthorized: true, allowedStreamHosts: ['cdn.example.com'] }),
      fetcher,
    );
    await expect(provider.stream('/episode/x')).rejects.toMatchObject({ code: 'STREAM_HOST_NOT_ALLOWED', status: 403 });
  });

  it('reports not-authorized (403) for an authorized-looking URL when the deployment has not opted in', async () => {
    const { fetcher } = recordingFetcher({ data: { streamUrl: 'https://cdn.example.com/video.m3u8' } });
    const provider = new AnimasuProvider(config(), fetcher);
    await expect(provider.stream('/episode/x')).rejects.toMatchObject({ code: 'STREAM_NOT_AUTHORIZED', status: 403 });
  });
});

describe('Animasu connectivity probe', () => {
  it('reports reachability and payload shape without persisting anything', async () => {
    const { fetcher, calls } = recordingFetcher(listEnvelope);
    const result = await new AnimasuProvider(config(), fetcher).probe();
    expect(result.reachable).toBe(true);
    expect(result.items).toBe(2);
    expect(result.scheduleShape).toBe('empty');
    expect(result.reason).toContain('catalog data');
    expect(calls.map((call) => call.url)).toEqual([`${BASE}?popular=1&page=1`, `${BASE}?schedule=1`]);
  });

  it('reports an unreachable provider with a redacted reason', async () => {
    const { fetcher } = failingFetcher(new Error('connect ETIMEDOUT https://api.nexadev.my.id/animasu?popular=1'));
    const result = await new AnimasuProvider(config(), fetcher).probe();
    expect(result.reachable).toBe(false);
    expect(result.items).toBe(0);
    expect(result.reason).not.toContain('https://');
    expect(result.reason).toContain('<url-redacted>');
  });
});
