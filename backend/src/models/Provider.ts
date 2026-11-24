import mongoose, { Schema } from 'mongoose';

/* Multi-API Provider Manager storage.
 * Secrets are stored server-side only and are NEVER returned by the API
 * (only `hasSecret: boolean` is exposed). */

export const PROVIDER_TYPES = [
  'music_metadata',
  'music_artwork',
  'music_lyrics',
  'music_audio',
  'anime_metadata',
  'anime_artwork',
  'anime_schedule',
  'anime_video',
  'anime_subtitle',
] as const;

const apiProviderSchema = new Schema(
  {
    providerId: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    type: { type: String, enum: PROVIDER_TYPES, required: true, index: true },
    baseUrl: { type: String, required: true },
    authMethod: { type: String, enum: ['none', 'api_key', 'bearer', 'oauth2'], default: 'none' },
    enabled: { type: Boolean, default: true, index: true },
    priority: { type: Number, default: 100, index: true },
    timeoutMs: { type: Number, default: 8000 },
    maxRetries: { type: Number, default: 2 },
    cacheTtlSec: { type: Number, default: 3600 },
    rateLimitPerMin: { type: Number, default: 60 },
    healthStatus: { type: String, enum: ['unknown', 'healthy', 'degraded', 'down'], default: 'unknown', index: true },
    lastCheckedAt: { type: Date, default: undefined },
    lastError: { type: String, default: '' },
    errorCount: { type: Number, default: 0 },
    successCount: { type: Number, default: 0 },
    avgLatencyMs: { type: Number, default: 0 },
    requiresCredentials: { type: Boolean, default: false },
    notes: { type: String, default: '' },
  },
  { timestamps: true },
);
apiProviderSchema.index({ type: 1, enabled: 1, priority: 1 });
export const ApiProvider = mongoose.model('ApiProvider', apiProviderSchema, 'api_providers');

/* Credentials are stored separately so provider listing never touches them. */
const providerCredentialSchema = new Schema(
  {
    provider: { type: Schema.Types.ObjectId, ref: 'ApiProvider', required: true, unique: true, index: true },
    apiKeyEncrypted: { type: String, default: '' },
    clientId: { type: String, default: '' },
    clientSecretEncrypted: { type: String, default: '' },
    extra: { type: Schema.Types.Mixed, default: undefined },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: undefined },
  },
  { timestamps: true },
);
export const ProviderCredential = mongoose.model('ProviderCredential', providerCredentialSchema, 'provider_credentials');

const providerLogSchema = new Schema(
  {
    provider: { type: Schema.Types.ObjectId, ref: 'ApiProvider', required: true, index: true },
    providerId: { type: String, default: '', index: true },
    operation: { type: String, required: true },
    success: { type: Boolean, required: true, index: true },
    statusCode: { type: Number, default: 0 },
    latencyMs: { type: Number, default: 0 },
    errorMessage: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);
providerLogSchema.index({ provider: 1, createdAt: -1 });
providerLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 }); // 30d TTL
export const ProviderLog = mongoose.model('ProviderLog', providerLogSchema, 'provider_logs');

const providerHealthSchema = new Schema(
  {
    provider: { type: Schema.Types.ObjectId, ref: 'ApiProvider', required: true, unique: true, index: true },
    status: { type: String, enum: ['unknown', 'healthy', 'degraded', 'down'], default: 'unknown' },
    uptimePct: { type: Number, default: 0 },
    avgLatencyMs: { type: Number, default: 0 },
    lastCheckAt: { type: Date, default: undefined },
    checks: { type: [Schema.Types.Mixed], default: [] },
  },
  { timestamps: true },
);
export const ProviderHealth = mongoose.model('ProviderHealth', providerHealthSchema, 'provider_health');

const providerCacheSchema = new Schema(
  {
    cacheKey: { type: String, required: true, unique: true, index: true },
    providerId: { type: String, default: '', index: true },
    payload: { type: Schema.Types.Mixed, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);
providerCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const ProviderCache = mongoose.model('ProviderCache', providerCacheSchema, 'provider_cache');
