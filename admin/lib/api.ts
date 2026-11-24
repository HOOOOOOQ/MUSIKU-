/**
 * Backend API client for the admin dashboard.
 * - JWT stored in localStorage (admin session).
 * - Automatic 401 → redirect to /login.
 * - Secrets are never fetched/displayed (backend only returns hasSecret).
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';
const TOKEN_KEY = 'musiku_admin_token';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  error?: { code: string; message: string; details?: unknown };
}

/**
 * Backend failure with the machine-readable `code` and HTTP status attached, so
 * callers can branch on an outcome (403 `STREAM_NOT_AUTHORIZED`) instead of
 * pattern-matching a human-readable message that may be localized later.
 */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const body = (await res.json()) as ApiEnvelope<T>;
  if (res.status === 401) {
    clearToken();
    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
      window.location.href = '/login';
    }
  }
  if (!res.ok || !body.success) {
    throw new ApiRequestError(body.error?.message || `Request failed (${res.status})`, res.status, body.error?.code || '');
  }
  return body.data;
}

export const apiGet = <T>(path: string) => api<T>(path);
export const apiPost = <T>(path: string, body: unknown) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(body) });
export const apiPatch = <T>(path: string, body: unknown) =>
  api<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
export const apiPut = <T>(path: string, body: unknown) =>
  api<T>(path, { method: 'PUT', body: JSON.stringify(body) });
export const apiDelete = <T>(path: string) => api<T>(path, { method: 'DELETE' });

/* ── Types mirroring backend responses ─────────────────────────────── */
export interface DashboardData {
  users: { total: number; active: number; premium: number };
  catalog: { tracks: number; artists: number; albums: number; anime: number; episodes: number };
  providers: {
    enabled: number;
    status: { providerId: string; name: string; type: string; healthStatus: string; avgLatencyMs: number; lastCheckedAt?: string }[];
  };
  subscriptions: { active: number; paidPayments: number };
  database: { status: string; latencyMs: number };
}

export interface AdminUser {
  _id: string;
  email: string;
  username: string;
  role: string;
  status: string;
  premium: boolean;
  emailVerified: boolean;
  createdAt: string;
}

export interface Provider {
  _id: string;
  providerId: string;
  name: string;
  type: string;
  baseUrl: string;
  authMethod: string;
  enabled: boolean;
  priority: number;
  timeoutMs: number;
  maxRetries: number;
  cacheTtlSec: number;
  rateLimitPerMin: number;
  healthStatus: string;
  lastCheckedAt?: string;
  errorCount: number;
  successCount: number;
  avgLatencyMs: number;
  requiresCredentials: boolean;
  notes: string;
  hasSecret?: boolean;
}

export interface ProviderLog {
  _id: string;
  providerId: string;
  operation: string;
  success: boolean;
  statusCode: number;
  latencyMs: number;
  errorMessage: string;
  createdAt: string;
}

export interface AuditLog {
  _id: string;
  actor?: string;
  action: string;
  targetType: string;
  targetId: string;
  ip: string;
  createdAt: string;
}

export interface SystemEvent {
  _id: string;
  level: string;
  source: string;
  message: string;
  createdAt: string;
}

export interface CatalogItem {
  _id: string;
  title?: string;
  name?: string;
  source?: string;
  popularity?: number;
  createdAt: string;
}

/* ── Animeku (consumer-facing anime section; upstream provider "Animasu") ────
 * The admin dashboard manages the Animeku provider, inspects what the backend
 * serves and audits the persistence contract: metadata may be cached, media
 * URLs may not. Nothing in this module returns a media URL. */

/** `GET /api/anime/status` — the configuration the backend actually asserts. */
export interface AnimekuStatus {
  provider: string;
  displayName: string;
  enabled: boolean;
  metadataAvailable: boolean;
  playback: 'authorized' | 'not_authorized';
  playbackAuthorized: boolean;
  /** Count only: the host allowlist itself is never sent to any client. */
  streamHostCount: number;
  cacheTtlSec: number;
  types: string[];
}

export interface AnimekuLatestEpisode {
  text: string;
  number: number | null;
}

/** Normalized anime as served by `/anime/*` (`SerializedAnime` on the backend). */
export interface AnimekuAnime {
  id: string;
  _id: string;
  /** Provider-relative link; empty for documents that did not come from Animeku. */
  providerId: string;
  title: string;
  link: string;
  posterUrl: string;
  synopsis: string;
  type: string;
  rating: number;
  episodeCount: number;
  status: string;
  studio: string;
  genres: string[];
  latestEpisode: AnimekuLatestEpisode;
  source: string;
  updatedAt?: string;
}

/** Episode reference handed to clients: Mongo id when persisted, no media URL. */
export interface AnimekuEpisodeRef {
  number: number;
  label: string;
  title: string;
  date: string;
  id: string;
}

/** How the backend derived episode numbers — surfaced verbatim to operators. */
export interface AnimekuEpisodeOrder {
  reversed: boolean;
  numberSource: string;
}

export interface AnimekuCatalogPage {
  kind?: string;
  query?: string;
  page: number;
  total: number;
  items: AnimekuAnime[];
}

export interface AnimekuDetails {
  anime: AnimekuAnime;
  episodes: AnimekuEpisodeRef[];
  episodeOrder: AnimekuEpisodeOrder;
  playback: 'authorized' | 'not_authorized';
}

export interface AnimekuHealthResult {
  providerId: string;
  status: string;
  latencyMs: number;
}

/** Raw persisted Anime document (`/api/admin/catalog/anime` returns lean docs). */
export interface PersistedAnimeDoc {
  _id: string;
  title: string;
  providerId?: string;
  source?: string;
  format?: string;
  status?: string;
  episodeCount?: number;
  rating?: number;
  createdAt?: string;
  updatedAt?: string;
}

/** Raw persisted episode document — `streamUrl` must always be empty. */
export interface PersistedAnimeEpisode {
  _id: string;
  anime?: string;
  number?: number;
  title?: string;
  providerEpisodeId?: string;
  streamUrl?: string;
  createdAt?: string;
}

/**
 * Playback authorization probe result.
 *
 * Deliberately URL-free: a resolved media link is temporary, must not be
 * cached and must not end up in a browser, a screenshot or a support ticket.
 */
export interface AnimekuStreamProbe {
  authorized: boolean;
  code: string;
  message: string;
  sourceCount: number;
  temporary: boolean;
}

export type AnimekuCatalogKind = 'popular' | 'ongoing' | 'completed';

export const ANIMEKU_CATALOG_KINDS: readonly AnimekuCatalogKind[] = ['popular', 'ongoing', 'completed'];

export function isAnimekuCatalogKind(value: string): value is AnimekuCatalogKind {
  return (ANIMEKU_CATALOG_KINDS as readonly string[]).includes(value);
}

export const animekuStatus = () => apiGet<AnimekuStatus>('/api/anime/status');

export const animekuCatalog = (kind: AnimekuCatalogKind, page = 1, limit = 20, type = '') =>
  apiGet<AnimekuCatalogPage>(`/api/anime/${kind}?page=${page}&limit=${limit}${type ? `&type=${encodeURIComponent(type)}` : ''}`);

export const animekuSearch = (query: string, page = 1, limit = 20) =>
  apiGet<AnimekuCatalogPage>(`/api/anime/search?q=${encodeURIComponent(query.trim())}&page=${page}&limit=${limit}`);

/**
 * Provider links contain `/` and `?`, so they always travel as an encoded query
 * parameter — never as a path segment.
 */
export const animekuDetails = (link: string) => apiGet<AnimekuDetails>(`/api/anime/details?link=${encodeURIComponent(link)}`);

/** Probes every enabled provider; Animeku is probed through its own adapter. */
export const animekuHealthCheck = () => apiPost<AnimekuHealthResult[]>('/api/providers/health-check', {});

/** The seeded Animeku provider record (`providerId: animasu`, `type: animeku`). */
export async function animekuProviderRecord(): Promise<Provider | null> {
  const providers = await apiGet<Provider[]>('/api/providers');
  return providers.find((provider) => provider.type === 'animeku' || provider.providerId === 'animasu') ?? null;
}

export const updateProvider = <T = Provider>(id: string, patch: Partial<Provider>) =>
  apiPatch<T>(`/api/providers/${encodeURIComponent(id)}`, patch);

export const animekuPersistedCatalog = (page = 1, limit = 20) =>
  apiGet<{ items: PersistedAnimeDoc[]; total: number }>(`/api/admin/catalog/anime?page=${page}&limit=${limit}`);

export const animekuPersistedEpisodes = (animeId: string) =>
  apiGet<PersistedAnimeEpisode[]>(`/api/admin/catalog/anime/${encodeURIComponent(animeId)}/episodes`);

/** Compliance audit: how many persisted episodes carry a media URL. Must be 0. */
export function persistedMediaUrlCount(episodes: PersistedAnimeEpisode[]): number {
  return episodes.filter((episode) => typeof episode.streamUrl === 'string' && episode.streamUrl.trim() !== '').length;
}

/**
 * Asks the backend to resolve media for one persisted episode and reduces the
 * answer to a verdict plus a source count. A 403 `STREAM_NOT_AUTHORIZED` is a
 * healthy, expected answer on a deployment that has not asserted distribution
 * rights, so it is reported as such instead of as a failure.
 */
export async function animekuStreamProbe(animeId: string, episodeId: string): Promise<AnimekuStreamProbe> {
  const path = `/api/anime/${encodeURIComponent(animeId)}/episodes/${encodeURIComponent(episodeId)}/stream`;
  try {
    const data = await api<{ streamUrl?: string; alternativeLinks?: unknown[]; temporary?: boolean }>(path);
    const primary = typeof data.streamUrl === 'string' && data.streamUrl.trim() !== '' ? 1 : 0;
    const alternatives = Array.isArray(data.alternativeLinks) ? data.alternativeLinks.length : 0;
    const sourceCount = primary + alternatives;
    if (sourceCount === 0) {
      return { authorized: false, code: 'NO_SOURCE', message: 'The backend answered 200 without a media URL.', sourceCount: 0, temporary: data.temporary === true };
    }
    return {
      authorized: true,
      code: 'AUTHORIZED',
      message: `Playback authorized — ${sourceCount} source(s) resolved. Media URLs are never displayed here.`,
      sourceCount,
      temporary: data.temporary === true,
    };
  } catch (error) {
    const failure = error instanceof ApiRequestError ? error : null;
    return {
      authorized: false,
      code: failure?.code || 'PROBE_FAILED',
      message: failure?.message || 'Playback probe failed.',
      sourceCount: 0,
      temporary: false,
    };
  }
}
