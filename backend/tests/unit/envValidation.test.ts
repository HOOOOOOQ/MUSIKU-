import { envSchema } from '../../src/config/env';

const base = {
  MONGODB_URI: 'mongodb+srv://user:pass@cluster.mongodb.net/musiku_plus',
  JWT_SECRET: 'access-secret-16-chars-min',
  JWT_REFRESH_SECRET: 'refresh-secret-16-chars-min',
};

describe('startup configuration validation', () => {
  it('accepts a minimal valid configuration', () => {
    expect(envSchema.safeParse(base).success).toBe(true);
  });

  it('rejects unsupported EMAIL_PROVIDER values instead of ignoring them', () => {
    const result = envSchema.safeParse({ ...base, EMAIL_PROVIDER: 'sendgrid' });
    expect(result.success).toBe(false);
  });

  it('requires SMTP credentials when EMAIL_PROVIDER=smtp', () => {
    expect(envSchema.safeParse({ ...base, EMAIL_PROVIDER: 'smtp' }).success).toBe(false);
    expect(envSchema.safeParse({ ...base, EMAIL_PROVIDER: 'smtp', SMTP_HOST: 'smtp.test.invalid', SMTP_USER: 'user', SMTP_PASSWORD: 'password' }).success).toBe(true);
  });

  it('rejects a partial SMTP group', () => {
    expect(envSchema.safeParse({ ...base, SMTP_HOST: 'smtp.test.invalid' }).success).toBe(false);
  });

  it('rejects a partial object storage group', () => {
    expect(envSchema.safeParse({ ...base, STORAGE_ENDPOINT: 'https://r2.test.invalid', STORAGE_ACCESS_KEY: 'key' }).success).toBe(false);
  });

  it('rejects a non-redis REDIS_URL scheme', () => {
    expect(envSchema.safeParse({ ...base, REDIS_URL: 'http://cache.test.invalid' }).success).toBe(false);
    expect(envSchema.safeParse({ ...base, REDIS_URL: 'rediss://cache.test.invalid:6379' }).success).toBe(true);
  });

  it('rejects unsupported payment gateways and partial payment groups', () => {
    expect(envSchema.safeParse({ ...base, PAYMENT_PROVIDER: 'paypal' }).success).toBe(false);
    expect(envSchema.safeParse({ ...base, PAYMENT_PROVIDER: 'stripe', PAYMENT_SECRET_KEY: 'key' }).success).toBe(false);
  });

  it('requires an Atlas SRV URI in production', () => {
    expect(envSchema.safeParse({ ...base, NODE_ENV: 'production', MONGODB_URI: 'mongodb://localhost:27017/musiku' }).success).toBe(false);
    expect(envSchema.safeParse({ ...base, NODE_ENV: 'production' }).success).toBe(true);
  });
});
