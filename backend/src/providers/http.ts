import { providerContext } from './context';
/**
 * Minimal HTTP helper over global fetch (Node >= 18).
 * - Per-request timeout via AbortController
 * - Bounded retries with exponential backoff
 * - Provider-compliant User-Agent (required by MusicBrainz policy)
 */
export interface HttpOptions {
  timeoutMs?: number;
  retries?: number;
  headers?: Record<string, string>;
  method?: string;
  body?: string;
}

export class ProviderHttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ProviderHttpError';
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchJson<T>(url: string, opts: HttpOptions = {}): Promise<T> {
  const context = providerContext.getStore();
  const { timeoutMs = context?.timeoutMs ?? 8000, retries = context?.retries ?? 2, headers = {}, method = 'GET', body } = opts;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        body,
        signal: controller.signal,
        headers: {
          'User-Agent': 'MUSIKUPlus/1.0 (https://musikuplus.app; contact: api@musikuplus.app)',
          Accept: 'application/json',
          ...headers,
        },
      });
      if (!res.ok) {
        throw new ProviderHttpError(res.status, `Provider responded ${res.status} for ${url}`);
      }
      return (await res.json()) as T;
    } catch (err) {
      lastError = err;
      const status = (err as ProviderHttpError)?.status;
      // Don't retry client errors (4xx except 429)
      if (status && status >= 400 && status < 500 && status !== 429) break;
      if (attempt < retries) await sleep(300 * 2 ** attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Request failed: ${url}`);
}
