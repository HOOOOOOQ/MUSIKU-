import { providerContext } from '../providers/context';
import { ApiProvider, ProviderCache, ProviderHealth, ProviderLog } from '../models/Provider';
import { decryptSecret } from '../utils/crypto';

/**
 * Multi-API Provider Manager.
 *
 * Responsibilities:
 * - Resolve enabled providers for a type, ordered by priority.
 * - Execute an operation with fallback: try providers in order until
 *   one succeeds; record latency/errors per attempt.
 * - Cache successful responses in `provider_cache` (TTL per provider).
 * - Maintain health status + statistics and write `provider_logs`.
 *
 * The manager is provider-agnostic: callers pass a function that
 * receives the provider record and performs the actual HTTP call via
 * the matching adapter. This keeps DB config (priority/enabled) and
 * adapter logic decoupled.
 */

export interface ProviderRecord {
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
  requiresCredentials: boolean;
  rateLimitPerMin?: number;
}

export interface ExecuteOptions {
  cacheKey?: string;
  operation: string;
}

const memoryCache = new Map<string, { value: unknown; expiresAt: number }>();

export class ProviderManager {
  constructor(
    private providerModel: typeof ApiProvider = ApiProvider,
    private cacheModel: typeof ProviderCache = ProviderCache,
    private logModel: typeof ProviderLog = ProviderLog,
    private healthModel: typeof ProviderHealth = ProviderHealth,
  ) {}

  async listProviders(type?: string): Promise<ProviderRecord[]> {
    const filter: Record<string, unknown> = { enabled: true };
    if (type) filter.type = type;
    const docs = await this.providerModel.find(filter).sort({ priority: 1 }).lean();
    return docs as unknown as ProviderRecord[];
  }

  async getCached<T>(cacheKey: string): Promise<T | null> {
    const mem = memoryCache.get(cacheKey);
    if (mem && mem.expiresAt > Date.now()) return mem.value as T;
    const doc = await this.cacheModel.findOne({ cacheKey }).lean();
    if (doc && new Date(doc.expiresAt).getTime() > Date.now()) {
      memoryCache.set(cacheKey, { value: doc.payload, expiresAt: new Date(doc.expiresAt).getTime() });
      return doc.payload as T;
    }
    return null;
  }

  async setCached(cacheKey: string, providerId: string, payload: unknown, ttlSec: number): Promise<void> {
    const expiresAt = new Date(Date.now() + ttlSec * 1000);
    if (memoryCache.size >= 1000) memoryCache.delete(memoryCache.keys().next().value!);
    memoryCache.set(cacheKey, { value: payload, expiresAt: expiresAt.getTime() });
    await this.cacheModel.findOneAndUpdate(
      { cacheKey },
      { $set: { cacheKey, providerId, payload, expiresAt } },
      { upsert: true, new: true },
    );
  }

  /**
   * Execute `fn` against each enabled provider of `type` in priority
   * order until one returns a non-empty result. Throws the last error
   * if all providers fail.
   */
  async execute<T>(
    type: string,
    opts: ExecuteOptions,
    fn: (provider: ProviderRecord, apiKey: string) => Promise<T>,
    isEmpty: (result: T) => boolean = (r) => r === null || r === undefined,
  ): Promise<{ data: T; providerId: string; fromCache: boolean }> {
    if (opts.cacheKey) {
      const cached = await this.getCached<T>(opts.cacheKey);
      if (cached !== null) return { data: cached, providerId: 'cache', fromCache: true };
    }

    const providers = await this.listProviders(type);
    if (providers.length === 0) {
      throw new Error(`No enabled provider configured for type "${type}"`);
    }

    let lastError: unknown;
    for (const provider of providers) {
      const started = Date.now();
      try {
        const apiKey = await this.resolveApiKey(provider);
        const result = await providerContext.run({ timeoutMs: provider.timeoutMs, retries: provider.maxRetries }, () => fn(provider, apiKey));
        const latency = Date.now() - started;
        await this.recordSuccess(provider, latency);
        if (!isEmpty(result)) {
          if (opts.cacheKey) await this.setCached(opts.cacheKey, provider.providerId, result, provider.cacheTtlSec);
          return { data: result, providerId: provider.providerId, fromCache: false };
        }
        lastError = new Error(`Provider ${provider.providerId} returned empty result`);
      } catch (err) {
        lastError = err;
        await this.recordFailure(provider, Date.now() - started, err instanceof Error ? err.message : String(err));
      }
    }
    throw lastError instanceof Error ? lastError : new Error('All providers failed');
  }

  private async resolveApiKey(provider: ProviderRecord): Promise<string> {
    if (provider.authMethod === 'none') return '';
    const { ProviderCredential } = require('../models/Provider') as typeof import('../models/Provider');
    const cred = await ProviderCredential.findOne({ provider: provider._id }).lean();
    if (!cred?.apiKeyEncrypted) return '';
    try {
      return decryptSecret(cred.apiKeyEncrypted);
    } catch {
      return '';
    }
  }

  private async recordSuccess(provider: ProviderRecord, latencyMs: number): Promise<void> {
    await this.providerModel.updateOne(
      { _id: provider._id },
      {
        $inc: { successCount: 1 },
        $set: { healthStatus: 'healthy', lastCheckedAt: new Date(), lastError: '', avgLatencyMs: latencyMs },
      },
    );
    await this.logModel.create({
      provider: provider._id,
      providerId: provider.providerId,
      operation: 'execute',
      success: true,
      latencyMs,
    });
    await this.healthModel.findOneAndUpdate(
      { provider: provider._id },
      { $set: { status: 'healthy', avgLatencyMs: latencyMs, lastCheckAt: new Date() } },
      { upsert: true, new: true },
    );
  }

  private async recordFailure(provider: ProviderRecord, latencyMs: number, message: string): Promise<void> {
    await this.providerModel.updateOne(
      { _id: provider._id },
      {
        $inc: { errorCount: 1 },
        $set: { healthStatus: 'degraded', lastCheckedAt: new Date(), lastError: message.slice(0, 500), avgLatencyMs: latencyMs },
      },
    );
    await this.logModel.create({
      provider: provider._id,
      providerId: provider.providerId,
      operation: 'execute',
      success: false,
      latencyMs,
      errorMessage: message.slice(0, 500),
    });
  }

  /** Health check: verify each enabled provider's base URL responds. */
  async healthCheckAll(): Promise<{ providerId: string; status: string; latencyMs: number }[]> {
    const providers = await this.providerModel.find({ enabled: true }).lean();
    const results: { providerId: string; status: string; latencyMs: number }[] = [];
    for (const p of providers as unknown as ProviderRecord[]) {
      const started = Date.now();
      let status = 'healthy';
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), p.timeoutMs || 8000);
        const res = await fetch(p.baseUrl, { method: 'GET', signal: controller.signal });
        clearTimeout(timer);
        if (!res.ok) status = 'degraded';
      } catch {
        status = 'down';
      }
      const latencyMs = Date.now() - started;
      await this.providerModel.updateOne(
        { _id: p._id },
        { $set: { healthStatus: status, lastCheckedAt: new Date(), avgLatencyMs: latencyMs } },
      );
      results.push({ providerId: p.providerId, status, latencyMs });
    }
    return results;
  }
}

export const providerManager = new ProviderManager();
