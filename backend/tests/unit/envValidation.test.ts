import { envSchema, validateMongoUri } from '../../src/config/env';

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

  it('rejects identical access and refresh signing keys', () => {
    const result = envSchema.safeParse({ ...base, JWT_SECRET: 'same-key-16-characters', JWT_REFRESH_SECRET: 'same-key-16-characters' });
    expect(result.success).toBe(false);
  });

  it('rejects an unconfigured Google audience opt-in', () => {
    expect(envSchema.safeParse({ ...base, GOOGLE_ACCEPT_ANDROID_AUDIENCE: 'true' }).success).toBe(false);
    expect(envSchema.safeParse({ ...base, GOOGLE_ACCEPT_ANDROID_AUDIENCE: 'true', GOOGLE_CLIENT_ID: 'android-client.apps.googleusercontent.com' }).success).toBe(true);
  });

  it('rejects template placeholder connection strings at startup', () => {
    expect(envSchema.safeParse({ ...base, MONGODB_URI: 'mongodb+srv://USER:PASSWORD@cluster.mongodb.net/musiku_plus' }).success).toBe(false);
    expect(envSchema.safeParse({ ...base, MONGODB_URI: 'mongodb+srv://user:pass@your-cluster.mongodb.net/musiku_plus' }).success).toBe(false);
  });

  it('rejects a structurally invalid connection string at startup', () => {
    expect(envSchema.safeParse({ ...base, MONGODB_URI: 'postgres://user:pass@host/db' }).success).toBe(false);
    expect(envSchema.safeParse({ ...base, MONGODB_URI: 'mongodb+srv://' }).success).toBe(false);
    expect(envSchema.safeParse({ ...base, MONGODB_URI: 'mongodb+srv://user:pass@short/db' }).success).toBe(false);
  });
});

describe('validateMongoUri', () => {
  it('accepts a real Atlas SRV URI with options', () => {
    expect(validateMongoUri('mongodb+srv://ci_user:pw@cluster0.ab1cd.mongodb.net/musiku_plus?retryWrites=true&w=majority', true)).toBeNull();
  });

  it('accepts a local development URI without credentials', () => {
    expect(validateMongoUri('mongodb://localhost:27017/musiku_plus_test', false)).toBeNull();
  });

  it('requires credentials in production', () => {
    expect(validateMongoUri('mongodb+srv://cluster0.ab1cd.mongodb.net/musiku_plus', true)).toMatch(/credentials/);
  });

  it('rejects the wrong scheme, a missing host and whitespace', () => {
    expect(validateMongoUri('postgres://user:pass@cluster0.ab1cd.mongodb.net/db', false)).toMatch(/must start with/);
    expect(validateMongoUri('mongodb+srv://', false)).toMatch(/host/);
    expect(validateMongoUri('mongodb+srv://user:pa ss@cluster0.ab1cd.mongodb.net/db', false)).toMatch(/whitespace/);
    expect(validateMongoUri('', false)).toMatch(/required/);
  });

  it('rejects an SRV URI whose host is not fully qualified', () => {
    expect(validateMongoUri('mongodb+srv://user:pass@localhost/db', false)).toMatch(/fully qualified/);
  });

  it('flags unreplaced template text instead of connecting with it', () => {
    expect(validateMongoUri('mongodb+srv://USER:PASSWORD@cluster0.ab1cd.mongodb.net/db', false)).toMatch(/placeholder/);
  });

  it('never echoes the URI back in an error message', () => {
    const message = validateMongoUri('mongodb+srv://USER:PASSWORD@cluster0.ab1cd.mongodb.net/db', false) ?? '';
    expect(message).not.toContain('USER:PASSWORD');
    expect(message).not.toContain('mongodb+srv://');
  });
});
