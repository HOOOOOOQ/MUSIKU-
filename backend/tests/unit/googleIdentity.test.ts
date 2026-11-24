import { OAuth2Client } from 'google-auth-library';
import { env } from '../../src/config/env';
import { googleIdentity } from '../../src/services/googleIdentity';
const verify = jest.spyOn(OAuth2Client.prototype, 'verifyIdToken');
const payload = () => ({ sub: 'google-sub', email: 'verified@example.com', email_verified: true, aud: 'web-client', iss: 'https://accounts.google.com', exp: Math.floor(Date.now()/1000)+3600 });
beforeEach(() => { env.GOOGLE_CLIENT_ID = 'web-client'; verify.mockReset(); });
test('uses Google library signature verification and configured audience', async () => {
  verify.mockResolvedValue({ getPayload: payload } as never);
  expect((await googleIdentity.verify('signed-token')).sub).toBe('google-sub');
  expect(verify).toHaveBeenCalledWith({ idToken: 'signed-token', audience: 'web-client' });
});
test.each([{exp:1}, {aud:'attacker'}, {iss:'https://attacker.invalid'}, {email_verified:false}, {sub:''}])('rejects invalid claims %j', async claims => {
  verify.mockResolvedValue({ getPayload: () => ({ ...payload(), ...claims }) } as never);
  await expect(googleIdentity.verify('invalid')).rejects.toThrow('Invalid or expired');
});
test('rejects invalid signature/library errors', async () => {
  verify.mockRejectedValue(new Error('Signature mismatch') as never);
  await expect(googleIdentity.verify('invalid')).rejects.toThrow('Invalid or expired');
});
