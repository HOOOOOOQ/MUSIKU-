# Google OAuth setup — MUSIKU+

## Cloud Console

1. In Google Cloud Console, create/select your own project. Configure **Google Auth Platform / OAuth consent screen**: application name, support/developer contact, audience, verified domains, privacy policy, and test users while in testing. Request only email/profile/openid identity access.
2. Create a **Web application OAuth client**. Its client ID is the server audience: set backend `GOOGLE_CLIENT_ID` and Flutter `GOOGLE_WEB_CLIENT_ID` to this same public ID. ID-token verification does not need a Google client secret. `GOOGLE_CLIENT_SECRET` is reserved backend-only for future server authorization-code flows; never place it in Flutter or build artifacts.
3. Create an **Android OAuth client** for package **`com.musikuplus.app`**, with the SHA-1 fingerprint of the actual signing certificate. Debug and release signing certificates are different: register each certificate/client as needed. Register the Play App Signing certificate too if distributing through Play.
4. Obtain fingerprints locally with JDK keytool:

```sh
# Debug certificate, after Android has generated the normal development keystore:
keytool -list -v -alias androiddebugkey -keystore ~/.android/debug.keystore
# Release certificate: let keytool prompt locally for the password.
keytool -list -v -keystore /secure/path/release.jks -alias YOUR_ALIAS
```

Use SHA-1 for the Android OAuth client. Record SHA-256 where required by your Google services/App Links/Play configuration. Do not post keystores/passwords here or commit them.

## Configuration

Backend environment (server only): `GOOGLE_CLIENT_ID=<web-client-id>.apps.googleusercontent.com`. Android package must match `mobile/android/app/build.gradle.kts`; do not change one without registering the new package/client.

```sh
cd mobile
flutter run --dart-define=API_URL=https://YOUR_BACKEND/api \
  --dart-define=GOOGLE_WEB_CLIENT_ID=YOUR_WEB_CLIENT_ID.apps.googleusercontent.com
```

For CI, use repository **Variables** `GOOGLE_WEB_CLIENT_ID` and `API_URL`. Client IDs are public identifiers, not client secrets. The Google button is hidden if the build-time client ID is absent. No Apple button is displayed: the `IdentityProvider` abstraction provides an extension boundary, not a fake Apple implementation.

Flutter obtains the Google ID token using google_sign_in and exchanges it at `POST /api/auth/google`. The backend uses google-auth-library certificate/signature verification and validates audience, issuer, expiry and verified email. Client-supplied email/user IDs are ignored. MUSIKU+ issues its own session-bound JWTs; it does not use a Google ID token as an API bearer token.

## Linking and replay policy

Google `sub` has a sparse unique index. Existing email/password accounts can be linked only if their stored email has been verified and the Google email is verified. Conflicting subjects/unverified accounts are rejected. New Google accounts receive a profile and a unique username candidate. Review/resolve duplicate historical googleId values before deploying the new unique index.

An exchanged Google token hash is stored in `oauth_replays` with a TTL ending at token expiry. Reusing the same token is rejected, including concurrent attempts through the unique index. The user may need to sign out of Google and obtain a fresh token after logout; a retry after a lost network response can also be rejected rather than issuing duplicate sessions. No raw Google token is persisted or logged. Authentication endpoints are rate-limited.

## Device verification checklist

- Configure Atlas, run indexes/seed, confirm backend status (configuration does not equal live verification).
- Install the APK with a registered debug/release SHA. Sign in with a consent-screen test user.
- Confirm `/auth/me`, session/device entry and Google login-history entry, then revoke the session and confirm the old access token gets 401.
- Check verified existing-account linking, rejection of unverified/conflicting accounts, cancellation, wrong-audience/expired tokens and repeated exchange.
- Test on a real device with Google Play services and reachable HTTPS API. Developer error 10 usually indicates package/SHA/web client mismatch.

Automated tests mock the Google library/identity boundary. They do not prove Cloud Console configuration or live Google login. No owner OAuth credentials have been supplied in this session.
