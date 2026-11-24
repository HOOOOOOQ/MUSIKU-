import { env, hasGoogleOAuth, hasEmail, hasPayments, hasLicensedMusic, hasLicensedAnime } from '../config/env';
export function integrationStatus() {
  return { google: { configured: hasGoogleOAuth, verifier: 'google-auth-library', liveVerified: false }, email: { configured: hasEmail, adapter: 'smtp' }, payments: { configured: hasPayments, adapter: 'stripe', webhookSignatureVerification: true }, musicStreaming: { credentialsPresent: hasLicensedMusic, adapterReady: false }, animeStreaming: { credentialsPresent: hasLicensedAnime, adapterReady: false }, githubBuild: { available: false, reason: 'No server-side GitHub build integration configured; inspect repository Actions' }, environment: env.NODE_ENV };
}
