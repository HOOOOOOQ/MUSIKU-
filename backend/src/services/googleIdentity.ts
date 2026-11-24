import { OAuth2Client, TokenPayload } from 'google-auth-library';
import { googleOAuthConfig } from '../config/env';
import { unauthorized } from '../utils/apiResponse';

export interface IdentityVerifier { verify(token: string): Promise<TokenPayload> }

/**
 * Google ID-token verification.
 *
 * `google-auth-library` performs the cryptographic work: it fetches Google's
 * public certificates (cached), verifies the token signature and checks `aud`
 * against the accepted audience set. On top of that we independently re-check
 * every claim MUSIKU+ relies on, because the identity of a user must never come
 * from anything the client asserts in the request body.
 *
 * Accepted audience: the **Web application** OAuth client ID
 * (`GOOGLE_WEB_CLIENT_ID`), which is the `aud` of ID tokens issued to
 * google_sign_in when `serverClientId` is configured. The Android OAuth client
 * ID (`GOOGLE_CLIENT_ID`, package `com.musikuplus.app` + SHA-1) authenticates the
 * app to Google Play services and is rejected as an audience unless
 * `GOOGLE_ACCEPT_ANDROID_AUDIENCE=true`. Tokens issued for any other client are
 * rejected.
 */
const client = new OAuth2Client();
const VALID_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

export const googleIdentity: IdentityVerifier = {
  async verify(token) {
    const { audiences } = googleOAuthConfig();
    if (audiences.length === 0) {
      throw unauthorized('Google Sign-In is not configured on this server');
    }
    try {
      const ticket = await client.verifyIdToken({ idToken: token, audience: audiences });
      const payload = ticket.getPayload();
      if (!payload || !payload.sub || !payload.email || payload.email_verified !== true ||
        !payload.aud || !audiences.includes(payload.aud) ||
        !payload.iss || !VALID_ISSUERS.includes(payload.iss) ||
        (payload.exp ?? 0) * 1000 <= Date.now()) throw new Error('Invalid claims');
      return payload;
    } catch {
      // Never echo Google's error detail or any token content to the client.
      throw unauthorized('Invalid or expired Google identity token');
    }
  },
};

/** Configuration view for administrators; contains no secret material. */
export function googleVerifierStatus(): Record<string, unknown> {
  const { audiences, webClientId, androidClientId, configured } = googleOAuthConfig();
  return {
    configured,
    verifier: 'google-auth-library',
    webClientIdConfigured: Boolean(webClientId),
    androidClientIdConfigured: Boolean(androidClientId),
    acceptedAudiences: audiences.length,
    // Fingerprints only: an ID is a public identifier, but a truncated form is
    // enough to confirm which client a deployment is using.
    audienceFingerprints: audiences.map(fingerprintClientId),
  };
}

export function fingerprintClientId(clientId: string): string {
  if (!clientId) return '';
  const [prefix] = clientId.split('.');
  const head = prefix.slice(0, 6);
  const tail = clientId.slice(-4);
  return `${head}…${tail}`;
}
