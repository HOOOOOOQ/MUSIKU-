import 'dotenv/config';
import { z } from 'zod';

/**
 * Environment validation. The backend refuses to start with missing
 * critical secrets. Optional integrations (Google OAuth, licensed
 * streaming, payments, email, Redis, object storage) are validated as
 * optional — features that need them return `needs_credentials` errors
 * instead of pretending to work.
 */
export const envSchema = z.object({
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required (MongoDB Atlas connection string)'),
  MONGODB_DB_NAME: z.string().default('musiku_plus'),
  // Isolated database used by the Atlas integration suite (never production data).
  MONGODB_TEST_DB_NAME: z.string().default(''),
  MONGODB_MAX_POOL_SIZE: z.coerce.number().int().min(1).max(200).default(20),
  MONGODB_MIN_POOL_SIZE: z.coerce.number().int().min(0).max(50).default(2),
  MONGODB_SERVER_SELECTION_TIMEOUT_MS: z.coerce.number().int().min(500).max(120000).default(10000),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be at least 16 characters'),
  JWT_ACCESS_EXPIRES: z.string().default('15m'),
  JWT_REFRESH_EXPIRES: z.string().default('30d'),
  // Grace window in which a duplicate presentation of an already-rotated refresh
  // token is treated as a benign concurrent retry instead of token theft.
  REFRESH_REUSE_GRACE_MS: z.coerce.number().int().min(0).max(300000).default(30000),
  GITHUB_BUILD_TOKEN: z.string().default(''),
  // Android OAuth client ID (package com.musikuplus.app + SHA-1). It identifies
  // the app to Google Play services; it is NOT an ID-token audience.
  GOOGLE_CLIENT_ID: z.string().optional().default(''),
  // Web application OAuth client ID. This is the audience of ID tokens obtained
  // by google_sign_in with serverClientId, so the backend verifies against it.
  GOOGLE_WEB_CLIENT_ID: z.string().optional().default(''),
  // Reserved for a future server-side authorization-code flow. Never sent to clients.
  GOOGLE_CLIENT_SECRET: z.string().optional().default(''),
  // Set to 'true' only if ID tokens are also issued directly for the Android
  // client (no serverClientId). Defaults to rejecting that audience.
  GOOGLE_ACCEPT_ANDROID_AUDIENCE: z.enum(['true', 'false']).default('false'),
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  CLIENT_URL: z.string().default('http://localhost:8080'),
  ADMIN_URL: z.string().default('http://localhost:3001'),
  REDIS_URL: z.string().optional().default(''),
  STORAGE_ENDPOINT: z.string().optional().default(''),
  STORAGE_ACCESS_KEY: z.string().optional().default(''),
  STORAGE_SECRET_KEY: z.string().optional().default(''),
  STORAGE_BUCKET: z.string().optional().default(''),
  LICENSED_MUSIC_API_KEY: z.string().optional().default(''),
  LICENSED_MUSIC_BASE_URL: z.string().optional().default(''),
  LICENSED_ANIME_API_KEY: z.string().optional().default(''),
  LICENSED_ANIME_BASE_URL: z.string().optional().default(''),
  /* ── Animasu (internal provider behind the consumer-facing "Animeku") ──────
   * Metadata (catalog, search, schedule, details, episodes) is served from this
   * public API. Video playback is a *rights* question, not a technical one, so
   * stream URLs are only returned when the deployer explicitly asserts that the
   * distribution is authorized AND names the hosts that may serve media.
   * Without both, the API returns metadata plus an explicit
   * `playback: 'not_authorized'` state instead of pretending playback works. */
  ANIMASU_BASE_URL: z.string().default('https://api.nexadev.my.id/animasu'),
  ANIMASU_ENABLED: z.enum(['true', 'false']).default('true'),
  ANIMASU_STREAMING_AUTHORIZED: z.enum(['true', 'false']).default('false'),
  // Comma-separated host allowlist for resolved media URLs (SSRF + rights guard).
  ANIMASU_ALLOWED_STREAM_HOSTS: z.string().default(''),
  ANIMASU_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(10000),
  ANIMASU_CACHE_TTL_SEC: z.coerce.number().int().min(0).max(86400).default(900),
  ANIMASU_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).max(600).default(60),
  PAYMENT_SUCCESS_URL: z.string().url().default('https://musikuplus.app/payment/success'),
  PAYMENT_CANCEL_URL: z.string().url().default('https://musikuplus.app/payment/cancel'),
  PAYMENT_PROVIDER: z.string().optional().default(''),
  PAYMENT_SECRET_KEY: z.string().optional().default(''),
  PAYMENT_WEBHOOK_SECRET: z.string().optional().default(''),
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_USER: z.string().default(''),
  SMTP_PASSWORD: z.string().default(''),
  SMTP_SECURE: z.enum(['true', 'false']).default('false'),
  EMAIL_ACTION_URL: z.string().url().default('https://musikuplus.app/auth'),
  // Only the implemented SMTP adapter is accepted; naming another provider is a
  // startup error instead of a silently ignored configuration.
  EMAIL_PROVIDER: z.enum(['', 'smtp']).default(''),
  EMAIL_FROM: z.string().default('noreply@musikuplus.app'),
  ADMIN_EMAIL: z.string().default('admin@musikuplus.app'),
  ADMIN_PASSWORD: z.string().default(''),
}).superRefine((config, context) => {
  const groups = [ ['SMTP_HOST','SMTP_USER','SMTP_PASSWORD'], ['LICENSED_MUSIC_API_KEY','LICENSED_MUSIC_BASE_URL'], ['LICENSED_ANIME_API_KEY','LICENSED_ANIME_BASE_URL'], ['PAYMENT_PROVIDER','PAYMENT_SECRET_KEY','PAYMENT_WEBHOOK_SECRET'], ['STORAGE_ENDPOINT','STORAGE_ACCESS_KEY','STORAGE_SECRET_KEY','STORAGE_BUCKET'] ] as const;
  for (const group of groups) {
    if (group.some(key => Boolean(config[key])) && !group.every(key => Boolean(config[key]))) context.addIssue({ code: 'custom', path: [group[0]], message: `Configure all of ${group.join(', ')} or leave all empty` });
  }
  if (config.EMAIL_PROVIDER === 'smtp' && !config.SMTP_HOST) context.addIssue({ code: 'custom', path: ['EMAIL_PROVIDER'], message: 'EMAIL_PROVIDER=smtp requires SMTP_HOST, SMTP_USER and SMTP_PASSWORD' });
  if (config.REDIS_URL && !/^rediss?:\/\//.test(config.REDIS_URL)) context.addIssue({ code: 'custom', path: ['REDIS_URL'], message: 'REDIS_URL must use the redis:// or rediss:// scheme (reserved; no Redis adapter is wired yet)' });
  if (config.PAYMENT_PROVIDER && config.PAYMENT_PROVIDER !== 'stripe') context.addIssue({ code: 'custom', path: ['PAYMENT_PROVIDER'], message: 'Only the implemented stripe adapter is supported' });
  if (config.GOOGLE_CLIENT_SECRET && !config.GOOGLE_WEB_CLIENT_ID && !config.GOOGLE_CLIENT_ID) context.addIssue({ code: 'custom', path: ['GOOGLE_CLIENT_SECRET'], message: 'GOOGLE_CLIENT_SECRET requires GOOGLE_WEB_CLIENT_ID (or GOOGLE_CLIENT_ID)' });
  if (config.GOOGLE_ACCEPT_ANDROID_AUDIENCE === 'true' && !config.GOOGLE_CLIENT_ID) context.addIssue({ code: 'custom', path: ['GOOGLE_ACCEPT_ANDROID_AUDIENCE'], message: 'GOOGLE_ACCEPT_ANDROID_AUDIENCE=true requires GOOGLE_CLIENT_ID' });
  if (config.JWT_SECRET === config.JWT_REFRESH_SECRET) context.addIssue({ code: 'custom', path: ['JWT_REFRESH_SECRET'], message: 'JWT_SECRET and JWT_REFRESH_SECRET must be different keys' });
  if (!/^https:\/\/[^\s]+/.test(config.ANIMASU_BASE_URL)) context.addIssue({ code: 'custom', path: ['ANIMASU_BASE_URL'], message: 'ANIMASU_BASE_URL must be an https:// origin (no credentials, no whitespace)' });
  if (/^https:\/\/[^/@\s]+:[^/@\s]*@/.test(config.ANIMASU_BASE_URL)) context.addIssue({ code: 'custom', path: ['ANIMASU_BASE_URL'], message: 'ANIMASU_BASE_URL must not embed credentials in the URL' });
  if (config.ANIMASU_STREAMING_AUTHORIZED === 'true' && !config.ANIMASU_ALLOWED_STREAM_HOSTS.trim()) context.addIssue({ code: 'custom', path: ['ANIMASU_ALLOWED_STREAM_HOSTS'], message: 'ANIMASU_STREAMING_AUTHORIZED=true requires ANIMASU_ALLOWED_STREAM_HOSTS so media URLs are restricted to known hosts' });
  const uriIssue = validateMongoUri(config.MONGODB_URI, config.NODE_ENV === 'production');
  if (uriIssue) context.addIssue({ code: 'custom', path: ['MONGODB_URI'], message: uriIssue });
  if (config.NODE_ENV === 'production' && !config.MONGODB_URI.startsWith('mongodb+srv://')) context.addIssue({ code: 'custom', path: ['MONGODB_URI'], message: 'Production requires Atlas mongodb+srv TLS URI' });
});

const URI_PLACEHOLDER_MARKERS = ['change-me', 'user:password', 'your-cluster', 'your_cluster', '<cluster>', '<password>', '<user>', 'example.invalid'];

/**
 * Startup validation of the MongoDB connection string.
 *
 * Returns `null` when the URI is acceptable, otherwise a human-readable reason.
 * This deliberately checks structure only (scheme, host, credentials, obviously
 * unreplaced template text) and never logs or returns the URI itself, so a
 * malformed value fails fast at boot instead of hanging in server selection or
 * leaking into a driver error message.
 */
export function validateMongoUri(uri: string, requireCredentials: boolean): string | null {
  const value = (uri ?? '').trim();
  if (!value) return 'MONGODB_URI is required';
  if (/\s/.test(value)) return 'MONGODB_URI must not contain whitespace';
  const match = /^(mongodb|mongodb\+srv):\/\/([^/?#]*)(.*)$/.exec(value);
  if (!match) return 'MONGODB_URI must start with mongodb:// or mongodb+srv://';
  const [, scheme, authority, rest] = match;
  const hostPart = authority.includes('@') ? authority.slice(authority.lastIndexOf('@') + 1) : authority;
  if (!hostPart) return 'MONGODB_URI must include a host';
  if (scheme === 'mongodb+srv' && hostPart.split(':')[0].split('.').length < 3) {
    return 'MONGODB_URI with mongodb+srv:// must use a fully qualified Atlas SRV host';
  }
  if (scheme === 'mongodb' && !hostPart.includes(':') && requireCredentials) {
    return 'MONGODB_URI must include an explicit port for a direct (non-SRV) connection in production';
  }
  if (requireCredentials && !authority.includes('@')) {
    return 'MONGODB_URI must include credentials in production';
  }
  const lowered = value.toLowerCase();
  if (URI_PLACEHOLDER_MARKERS.some((marker) => lowered.includes(marker))) {
    return 'MONGODB_URI still contains template placeholder text — replace it with the real Atlas connection string';
  }
  if (rest && !/^[/?#]/.test(rest)) return 'MONGODB_URI has an invalid path/options section';
  return null;
}

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    // In tests we allow a dummy URI so the app factory can be built without Atlas.
    if (process.env.NODE_ENV === 'test') {
      return envSchema.parse({
        MONGODB_URI: 'mongodb://localhost:27017/musiku_plus_test',
        JWT_SECRET: 'test-secret-at-least-16-chars',
        JWT_REFRESH_SECRET: 'test-refresh-secret-16-chars',
        ...process.env,
      });
    }
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export const env: Env = loadEnv();

/**
 * Google OAuth identifiers, resolved on demand so configuration changes and
 * tests are reflected without reloading the module.
 *
 * `audiences` is the accepted `aud` claim set for ID-token verification. The Web
 * application client ID is the audience produced by google_sign_in when
 * `serverClientId` is configured, so it is the primary (and normally only)
 * accepted value. `GOOGLE_CLIENT_ID` (the Android OAuth client, bound to package
 * `com.musikuplus.app` + SHA-1) identifies the app to Google Play services and is
 * accepted as an audience only when explicitly opted in: a token minted for a
 * different client must be rejected.
 */
export function googleOAuthConfig(): {
  audiences: string[];
  webClientId: string;
  androidClientId: string;
  configured: boolean;
} {
  const webClientId = env.GOOGLE_WEB_CLIENT_ID || env.GOOGLE_CLIENT_ID;
  const androidClientId = env.GOOGLE_CLIENT_ID;
  const audiences = [
    ...(webClientId ? [webClientId] : []),
    ...(env.GOOGLE_ACCEPT_ANDROID_AUDIENCE === 'true' && androidClientId && androidClientId !== webClientId
      ? [androidClientId]
      : []),
  ];
  return { audiences, webClientId, androidClientId, configured: audiences.length > 0 };
}

export const hasGoogleOAuth = googleOAuthConfig().configured;

/**
 * Animasu provider configuration, resolved on demand (same pattern as
 * `googleOAuthConfig`) so tests and configuration reloads stay coherent.
 *
 * `streamingAuthorized` is deliberately conservative: it is only true when the
 * deployer set ANIMASU_STREAMING_AUTHORIZED=true *and* named at least one
 * allowed media host. Everything else stays metadata-only.
 */
export function animasuConfig(): {
  enabled: boolean;
  baseUrl: string;
  streamingAuthorized: boolean;
  allowedStreamHosts: string[];
  timeoutMs: number;
  cacheTtlSec: number;
  rateLimitPerMin: number;
} {
  const allowedStreamHosts = env.ANIMASU_ALLOWED_STREAM_HOSTS.split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  return {
    enabled: env.ANIMASU_ENABLED === 'true',
    baseUrl: env.ANIMASU_BASE_URL.replace(/\/+$/, ''),
    streamingAuthorized: env.ANIMASU_STREAMING_AUTHORIZED === 'true' && allowedStreamHosts.length > 0,
    allowedStreamHosts,
    timeoutMs: env.ANIMASU_TIMEOUT_MS,
    cacheTtlSec: env.ANIMASU_CACHE_TTL_SEC,
    rateLimitPerMin: env.ANIMASU_RATE_LIMIT_PER_MIN,
  };
}

export const hasAnimasu = animasuConfig().enabled;

export const hasLicensedMusic = Boolean(env.LICENSED_MUSIC_API_KEY && env.LICENSED_MUSIC_BASE_URL);
export const hasLicensedAnime = Boolean(env.LICENSED_ANIME_API_KEY && env.LICENSED_ANIME_BASE_URL);
export const hasPayments = Boolean(env.PAYMENT_PROVIDER === 'stripe' && env.PAYMENT_SECRET_KEY && env.PAYMENT_WEBHOOK_SECRET);
export const hasEmail = Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD);
export const hasStorage = Boolean(env.STORAGE_ENDPOINT && env.STORAGE_ACCESS_KEY && env.STORAGE_SECRET_KEY);

/** Database used by the Atlas integration suite; never the production database. */
export const testDatabaseName = env.MONGODB_TEST_DB_NAME || `${env.MONGODB_DB_NAME}_ci_test`;

/** Redacts a Mongo connection string so it can never reach a log or CI summary. */
export function redactMongoUri(uri: string): string {
  if (!uri) return '(unset)';
  try {
    const withoutCredentials = uri.replace(/^(mongodb(?:\+srv)?:\/\/)([^@/]+)@/, '$1<redacted>@');
    return withoutCredentials.replace(/:[^:@/]*@/, ':<redacted>@');
  } catch {
    return '(redacted)';
  }
}
