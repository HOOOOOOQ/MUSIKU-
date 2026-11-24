import { OAuth2Client } from 'google-auth-library';
import { env, googleOAuthConfig } from '../../src/config/env';
import { googleIdentity, googleVerifierStatus, fingerprintClientId } from '../../src/services/googleIdentity';

const verify = jest.spyOn(OAuth2Client.prototype, 'verifyIdToken');
const payload = (overrides: Record<string, unknown> = {}) => ({
  sub: 'google-sub',
  email: 'verified@example.com',
  email_verified: true,
  aud: 'web-client',
  iss: 'https://accounts.google.com',
  exp: Math.floor(Date.now() / 1000) + 3600,
  ...overrides,
});

beforeEach(() => {
  env.GOOGLE_CLIENT_ID = 'android-client';
  env.GOOGLE_WEB_CLIENT_ID = 'web-client';
  env.GOOGLE_ACCEPT_ANDROID_AUDIENCE = 'false';
  verify.mockReset();
});

describe('Google ID token verification', () => {
  it('verifies the signature through google-auth-library against the web client audience', async () => {
    verify.mockResolvedValue({ getPayload: () => payload() } as never);
    expect((await googleIdentity.verify('signed-token')).sub).toBe('google-sub');
    expect(verify).toHaveBeenCalledWith({ idToken: 'signed-token', audience: ['web-client'] });
  });

  it('uses GOOGLE_WEB_CLIENT_ID as the audience, not the Android client ID', () => {
    expect(googleOAuthConfig().audiences).toEqual(['web-client']);
    expect(googleOAuthConfig().androidClientId).toBe('android-client');
  });

  it('falls back to GOOGLE_CLIENT_ID when no web client is configured', () => {
    env.GOOGLE_WEB_CLIENT_ID = '';
    expect(googleOAuthConfig().audiences).toEqual(['android-client']);
  });

  it('accepts the Android audience only when explicitly opted in', async () => {
    env.GOOGLE_ACCEPT_ANDROID_AUDIENCE = 'true';
    expect(googleOAuthConfig().audiences).toEqual(['web-client', 'android-client']);
    verify.mockResolvedValue({ getPayload: () => payload({ aud: 'android-client' }) } as never);
    expect((await googleIdentity.verify('android-audience-token')).aud).toBe('android-client');
  });

  it('rejects a token issued for a different client', async () => {
    verify.mockResolvedValue({ getPayload: () => payload({ aud: 'some-other-client' }) } as never);
    await expect(googleIdentity.verify('wrong-audience')).rejects.toThrow('Invalid or expired');
  });

  it('rejects an unconfigured deployment instead of accepting any audience', async () => {
    env.GOOGLE_CLIENT_ID = '';
    env.GOOGLE_WEB_CLIENT_ID = '';
    await expect(googleIdentity.verify('any-token')).rejects.toThrow('not configured');
    expect(verify).not.toHaveBeenCalled();
  });

  it.each([
    { exp: 1 },
    { aud: 'attacker' },
    { iss: 'https://attacker.invalid' },
    { iss: 'accounts.google.evil' },
    { email_verified: false },
    { email: '' },
    { sub: '' },
  ])('rejects invalid claims %j', async (claims) => {
    verify.mockResolvedValue({ getPayload: () => payload(claims) } as never);
    await expect(googleIdentity.verify('invalid')).rejects.toThrow('Invalid or expired');
  });

  it('rejects invalid signatures and library errors without leaking detail', async () => {
    verify.mockRejectedValue(new Error('Signature mismatch: certificate fingerprint abc123') as never);
    await expect(googleIdentity.verify('invalid')).rejects.toThrow('Invalid or expired Google identity token');
  });

  it('does not expose client IDs in the administrator status view', () => {
    const status = googleVerifierStatus();
    expect(status.configured).toBe(true);
    expect(status.acceptedAudiences).toBe(1);
    expect(JSON.stringify(status)).not.toContain('web-client');
    expect(fingerprintClientId('1234567890-abcdef.apps.googleusercontent.com')).toBe('123456….com');
  });
});
