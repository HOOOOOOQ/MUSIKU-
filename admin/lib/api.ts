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
    throw new Error(body.error?.message || `Request failed (${res.status})`);
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
