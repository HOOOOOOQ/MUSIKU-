import {
  hashPassword, verifyPassword, sha256, randomToken,
  encryptSecret, decryptSecret, signAccessToken, verifyAccessToken,
  signRefreshToken, verifyRefreshToken,
} from '../../src/utils/crypto';

describe('crypto utils', () => {
  it('hashes and verifies passwords', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash).not.toBe('correct horse battery staple');
    await expect(verifyPassword('correct horse battery staple', hash)).resolves.toBe(true);
    await expect(verifyPassword('wrong password', hash)).resolves.toBe(false);
    await expect(verifyPassword('anything', undefined)).resolves.toBe(false);
  });

  it('sha256 is deterministic', () => {
    expect(sha256('musiku')).toBe(sha256('musiku'));
    expect(sha256('musiku')).not.toBe(sha256('other'));
  });

  it('randomToken produces unique hex tokens', () => {
    const a = randomToken();
    const b = randomToken();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });

  it('encrypts and decrypts secrets (AES-256-GCM)', () => {
    const secret = 'provider-api-key-123';
    const encrypted = encryptSecret(secret);
    expect(encrypted).not.toContain(secret);
    expect(decryptSecret(encrypted)).toBe(secret);
    expect(decryptSecret('')).toBe('');
  });

  it('signs and verifies access tokens', () => {
    const token = signAccessToken('user-123', 'user');
    const payload = verifyAccessToken(token);
    expect(payload.sub).toBe('user-123');
    expect(payload.role).toBe('user');
    expect(payload.type).toBe('access');
  });

  it('rejects tampered access tokens', () => {
    const token = signAccessToken('user-123', 'user');
    expect(() => verifyAccessToken(`${token}x`)).toThrow();
  });

  it('signs and verifies refresh tokens, rejects access tokens as refresh', () => {
    const refresh = signRefreshToken('user-123');
    expect(verifyRefreshToken(refresh).sub).toBe('user-123');
    const access = signAccessToken('user-123', 'user');
    expect(() => verifyRefreshToken(access)).toThrow();
  });
});
