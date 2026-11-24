import { env, hasEmail, hasPayments, hasLicensedMusic, hasLicensedAnime } from '../config/env';
import { googleVerifierStatus } from '../services/googleIdentity';
import { githubBuildStatus } from './githubBuildStatus';

/**
 * Integration readiness for administrators. Reports configuration state only:
 * no credential value, token or raw upstream payload is ever included.
 * `liveVerified`/`adapterReady` stay false until an owner supplies credentials
 * and a real end-to-end check succeeds, so the dashboard cannot imply an
 * integration works merely because a key is present.
 */
export async function integrationStatus() {
  return {
    google: { ...googleVerifierStatus(), liveVerified: false },
    email: { configured: hasEmail, adapter: 'smtp', liveVerified: false },
    payments: { configured: hasPayments, adapter: 'stripe', webhookSignatureVerification: true, liveVerified: false },
    musicStreaming: { credentialsPresent: hasLicensedMusic, adapterReady: false },
    animeStreaming: { credentialsPresent: hasLicensedAnime, adapterReady: false },
    githubBuild: await githubBuildStatus(),
    environment: env.NODE_ENV,
  };
}
