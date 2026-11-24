import { OAuth2Client, TokenPayload } from 'google-auth-library';
import { env } from '../config/env';
import { unauthorized } from '../utils/apiResponse';

export interface IdentityVerifier { verify(token: string): Promise<TokenPayload> }
const client = new OAuth2Client();
export const googleIdentity: IdentityVerifier = {
  async verify(token) {
    try {
      const ticket = await client.verifyIdToken({ idToken: token, audience: env.GOOGLE_CLIENT_ID });
      const payload = ticket.getPayload();
      if (!payload || !payload.sub || !payload.email || payload.email_verified !== true ||
        payload.aud !== env.GOOGLE_CLIENT_ID || !['accounts.google.com', 'https://accounts.google.com'].includes(payload.iss) ||
        payload.exp * 1000 <= Date.now()) throw new Error('Invalid claims');
      return payload;
    } catch { throw unauthorized('Invalid or expired Google identity token'); }
  },
};
