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
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be at least 16 characters'),
  JWT_ACCESS_EXPIRES: z.string().default('15m'),
  JWT_REFRESH_EXPIRES: z.string().default('30d'),
  GITHUB_BUILD_TOKEN: z.string().default(''),
  GOOGLE_CLIENT_ID: z.string().optional().default(''),
  GOOGLE_CLIENT_SECRET: z.string().optional().default(''),
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
  if (config.NODE_ENV === 'production' && !config.MONGODB_URI.startsWith('mongodb+srv://')) context.addIssue({ code: 'custom', path: ['MONGODB_URI'], message: 'Production requires Atlas mongodb+srv TLS URI' });
});

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

export const hasGoogleOAuth = Boolean(env.GOOGLE_CLIENT_ID);
export const hasLicensedMusic = Boolean(env.LICENSED_MUSIC_API_KEY && env.LICENSED_MUSIC_BASE_URL);
export const hasLicensedAnime = Boolean(env.LICENSED_ANIME_API_KEY && env.LICENSED_ANIME_BASE_URL);
export const hasPayments = Boolean(env.PAYMENT_PROVIDER === 'stripe' && env.PAYMENT_SECRET_KEY && env.PAYMENT_WEBHOOK_SECRET);
export const hasEmail = Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD);
export const hasStorage = Boolean(env.STORAGE_ENDPOINT && env.STORAGE_ACCESS_KEY && env.STORAGE_SECRET_KEY);
