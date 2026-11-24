import { fetchJson } from '../http';
import { safeErrorMessage } from '../../utils/redact';
import { animasuConfig } from '../../config/env';
import {
  normalizeAnimasuDetails,
  normalizeAnimasuList,
  normalizeAnimasuSchedule,
  normalizeAnimasuStream,
  type AnimasuDetails,
  type AnimasuListPage,
  type AnimasuSchedule,
  type AnimasuStream,
} from '../../validators/anime.validator';

/**
 * Animasu adapter — the internal provider behind the consumer-facing "Animeku".
 *
 * Base API: `https://api.nexadev.my.id/animasu` with a query-parameter routing
 * scheme (`?popular=1&page=1`, `?search=…`, `?details=…`, `?stream=…`).
 *
 * Security rules implemented here (not left to callers):
 *  - **No arbitrary URL fetching.** The request URL is always the configured
 *    base origin plus a fixed query key; `link` / `episodeUrl` values are
 *    validated as provider-relative targets and percent-encoded, so they cannot
 *    redirect the backend to another host (SSRF guard).
 *  - **No open proxy.** Stream resolution returns a URL for the client to play;
 *    the backend never fetches or relays media bytes.
 *  - **Domain allowlist for media.** A resolved stream URL is only returned when
 *    streaming is explicitly authorized *and* its host is allowlisted, uses
 *    https, and carries no embedded credentials.
 *  - **No secret or media URL logging.** Errors name the operation and the HTTP
 *    status only; stream URLs are never written to logs, never persisted, and
 *    never cached.
 */

export type AnimasuConfig = ReturnType<typeof animasuConfig>;
export type AnimasuFetcher = <T>(url: string, opts?: { timeoutMs?: number; retries?: number }) => Promise<T>;

export class AnimasuError extends Error {
  constructor(
    public code:
      | 'PROVIDER_DISABLED'
      | 'BAD_TARGET'
      | 'BAD_RESPONSE'
      | 'STREAM_NOT_AUTHORIZED'
      | 'STREAM_HOST_NOT_ALLOWED'
      | 'STREAM_UNAVAILABLE'
      | 'PROVIDER_UNAVAILABLE',
    message: string,
    public readonly status: number = 502,
  ) {
    super(message);
    this.name = 'AnimasuError';
  }
}

/** Hosts that may never be targeted, whatever the configuration says. */
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
  '169.254.169.254',
  '0.0.0.0',
  '[::1]',
  '::1',
]);

const BLOCKED_HOST_SUFFIXES = ['.internal', '.local', '.localhost'];

export function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (BLOCKED_HOSTNAMES.has(host)) return true;
  if (BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  // Link-local / private ranges must never be reached through a provider link.
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host)) return true;
  return false;
}

export class AnimasuProvider {
  readonly id = 'animasu';
  readonly name = 'Animasu (Animeku catalog provider)';

  constructor(
    private readonly config: AnimasuConfig = animasuConfig(),
    private readonly fetcher: AnimasuFetcher = fetchJson,
  ) {}

  get enabled(): boolean {
    return this.config.enabled;
  }

  get baseUrl(): string {
    return this.config.baseUrl;
  }

  get streamingAuthorized(): boolean {
    return this.config.streamingAuthorized;
  }

  /** Size of the media-host allowlist (never the contents). */
  get allowedStreamHostCount(): number {
    return this.config.allowedStreamHosts.length;
  }

  get cacheTtlSec(): number {
    return this.config.cacheTtlSec;
  }

  private baseHost(): string {
    try {
      return new URL(this.config.baseUrl).hostname.toLowerCase();
    } catch {
      throw new AnimasuError('PROVIDER_UNAVAILABLE', 'Animasu base URL is not a valid https origin', 500);
    }
  }

  /**
   * Builds the request URL from the configured base origin and a fixed set of
   * query keys. Values are percent-encoded by URLSearchParams; nothing is
   * concatenated by hand.
   */
  private endpoint(params: Record<string, string | number>): string {
    if (!this.config.enabled) {
      throw new AnimasuError('PROVIDER_DISABLED', 'The Animasu provider is disabled (ANIMASU_ENABLED=false)', 503);
    }
    const url = new URL(this.config.baseUrl);
    if (url.protocol !== 'https:') {
      throw new AnimasuError('PROVIDER_UNAVAILABLE', 'Animasu must be configured with an https origin', 500);
    }
    if (isBlockedHostname(url.hostname)) {
      throw new AnimasuError('PROVIDER_UNAVAILABLE', 'Animasu base URL points at a blocked host', 500);
    }
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    return url.toString();
  }

  /**
   * Validates a provider-supplied `link` / `episodeUrl` before it is used as a
   * query parameter. Only relative paths (or same-origin absolute URLs, which
   * are reduced to their path) are accepted.
   */
  assertRelativeTarget(value: string, field: string): string {
    const trimmed = (value ?? '').trim();
    if (!trimmed) throw new AnimasuError('BAD_TARGET', `${field} is required`, 400);
    if (/[\s\u0000-\u001f\\]/.test(trimmed)) throw new AnimasuError('BAD_TARGET', `${field} contains invalid characters`, 400);
    if (trimmed.startsWith('//')) throw new AnimasuError('BAD_TARGET', `${field} must not be protocol-relative`, 400);
    if (trimmed.startsWith('/')) {
      if (trimmed.includes('://')) throw new AnimasuError('BAD_TARGET', `${field} must be a provider-relative path`, 400);
      return trimmed;
    }
    // Absolute URLs are only accepted for the configured provider origin.
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      throw new AnimasuError('BAD_TARGET', `${field} must be a provider-relative path`, 400);
    }
    if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== this.baseHost()) {
      throw new AnimasuError('BAD_TARGET', `${field} must point at the configured Animasu origin`, 400);
    }
    return parsed.pathname + parsed.search;
  }

  /**
   * Validates a resolved media URL. Returns the sanitized URL or throws.
   * The URL itself is never part of an error message — only the host, and only
   * when the host is allowed (otherwise the host is omitted as well).
   */
  /**
   * Fails closed when the deployment has not asserted distribution rights.
   * Called before any network request so an unauthorized deployment never even
   * asks the provider for media.
   */
  assertPlaybackAuthorized(): void {
    if (!this.config.streamingAuthorized) {
      throw new AnimasuError(
        'STREAM_NOT_AUTHORIZED',
        'Animeku playback is not authorized on this deployment: metadata is available, video playback is disabled',
        403,
      );
    }
  }

  assertAllowedStreamUrl(rawUrl: string): string {
    this.assertPlaybackAuthorized();
    const value = (rawUrl ?? '').trim();
    if (!value) throw new AnimasuError('STREAM_UNAVAILABLE', 'The provider did not return a playable URL', 502);

    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new AnimasuError('STREAM_UNAVAILABLE', 'The provider returned a malformed media URL', 502);
    }
    if (parsed.protocol !== 'https:') {
      throw new AnimasuError('STREAM_HOST_NOT_ALLOWED', 'Media URLs must use https', 403);
    }
    if (parsed.username || parsed.password) {
      throw new AnimasuError('STREAM_HOST_NOT_ALLOWED', 'Media URLs must not embed credentials', 403);
    }
    const host = parsed.hostname.toLowerCase();
    if (isBlockedHostname(host)) {
      throw new AnimasuError('STREAM_HOST_NOT_ALLOWED', 'Media host is not allowed', 403);
    }
    const allowed = this.config.allowedStreamHosts.some((entry) =>
      entry.startsWith('*.') ? host === entry.slice(2) || host.endsWith(entry.slice(1)) : host === entry,
    );
    if (!allowed) {
      throw new AnimasuError('STREAM_HOST_NOT_ALLOWED', 'Media host is not on the allowlist (ANIMASU_ALLOWED_STREAM_HOSTS)', 403);
    }
    parsed.hash = '';
    return parsed.toString();
  }

  private async request<T>(params: Record<string, string | number>, operation: string): Promise<T> {
    const url = this.endpoint(params);
    try {
      return await this.fetcher<T>(url, { timeoutMs: this.config.timeoutMs, retries: 1 });
    } catch (error) {
      const status = (error as { status?: number })?.status;
      const message = error instanceof Error ? error.message : String(error);
      // Never propagate provider internals or a media URL to clients/logs.
      throw new AnimasuError(
        'PROVIDER_UNAVAILABLE',
        `Animasu ${operation} failed${status ? ` with HTTP ${status}` : ''}: ${safeErrorMessage(message, 200)}`,
        status && status >= 400 && status < 500 ? status : 502,
      );
    }
  }

  async popular(page = 1): Promise<AnimasuListPage> {
    const envelope = await this.request<unknown>({ popular: 1, page }, 'popular');
    return normalizeAnimasuList(envelope, 'popular', page);
  }

  async ongoing(page = 1): Promise<AnimasuListPage> {
    const envelope = await this.request<unknown>({ ongoing: 1, page }, 'ongoing');
    return normalizeAnimasuList(envelope, 'ongoing', page);
  }

  async completed(page = 1): Promise<AnimasuListPage> {
    const envelope = await this.request<unknown>({ completed: 1, page }, 'completed');
    return normalizeAnimasuList(envelope, 'completed', page);
  }

  async schedule(): Promise<AnimasuSchedule> {
    const envelope = await this.request<unknown>({ schedule: 1 }, 'schedule');
    return normalizeAnimasuSchedule(envelope);
  }

  async search(query: string, page = 1): Promise<AnimasuListPage> {
    const envelope = await this.request<unknown>({ search: query.trim(), ...(page > 1 ? { page } : {}) }, 'search');
    return normalizeAnimasuList(envelope, 'search', page);
  }

  async details(link: string): Promise<AnimasuDetails> {
    const target = this.assertRelativeTarget(link, 'link');
    const envelope = await this.request<unknown>({ details: target }, 'details');
    return normalizeAnimasuDetails(envelope);
  }

  /**
   * Resolves an episode's media URL. The returned value is **temporary and
   * untrusted**: it is validated against the allowlist, never stored, never
   * cached and never logged.
   */
  async stream(episodeUrl: string): Promise<AnimasuStream> {
    const target = this.assertRelativeTarget(episodeUrl, 'episodeUrl');
    // Authorization is checked before the provider call, not after: an
    // unauthorized deployment must not request media it cannot serve.
    this.assertPlaybackAuthorized();
    const envelope = await this.request<unknown>({ stream: target }, 'stream');
    const normalized = normalizeAnimasuStream(envelope);
    const primary = this.assertAllowedStreamUrl(normalized.streamUrl);
    const alternatives = normalized.alternativeLinks
      .map((candidate) => {
        try {
          return this.assertAllowedStreamUrl(candidate);
        } catch {
          return '';
        }
      })
      .filter(Boolean);
    return { ...normalized, streamUrl: primary, alternativeLinks: alternatives };
  }

  /**
   * Connectivity probe used by the pre-flight script and the live contract test.
   * Reports reachability and payload shape without persisting anything.
   */
  async probe(): Promise<{ reachable: boolean; latencyMs: number; items: number; scheduleShape: string; reason: string }> {
    const started = Date.now();
    try {
      const page = await this.popular(1);
      const schedule = await this.schedule();
      return {
        reachable: true,
        latencyMs: Date.now() - started,
        items: page.items.length,
        scheduleShape: schedule.shape,
        reason: page.items.length > 0 ? 'Animasu responded with catalog data' : 'Animasu responded but the catalog list was empty',
      };
    } catch (error) {
      return {
        reachable: false,
        latencyMs: Date.now() - started,
        items: 0,
        scheduleShape: 'unknown',
        reason: safeErrorMessage(error instanceof Error ? error.message : String(error), 300),
      };
    }
  }
}

export const animasuProvider = new AnimasuProvider();
