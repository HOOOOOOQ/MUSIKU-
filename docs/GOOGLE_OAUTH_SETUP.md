# Google OAuth setup — MUSIKU+

Two Google OAuth clients are involved, and they do **different jobs**. Confusing them is the single most common cause of `developer_error 10` on Android and of `Invalid or expired Google identity token` from the backend.

| Identifier | Type | Registered against | Used for | Where it is configured |
|---|---|---|---|---|
| `GOOGLE_CLIENT_ID` | **Android** OAuth client | package `com.musikuplus.app` + signing-certificate SHA-1 | Authorizes the app with Google Play services so it may request an ID token | GitHub secret → backend environment (and Google Cloud Console) |
| `GOOGLE_WEB_CLIENT_ID` | **Web application** OAuth client | authorized JavaScript origins / redirect URIs | The `serverClientId` for `google_sign_in`, therefore the **`aud`** of the returned ID token, therefore the **audience the backend verifies** | GitHub secret → backend environment **and** Flutter build-time define |

Both values are public identifiers, not credentials. The OAuth **client secret** is never needed for ID-token verification, is never sent to Flutter, and is only accepted by the backend as a reserved variable (`GOOGLE_CLIENT_SECRET`) for a possible future authorization-code flow.

Repository secrets `GOOGLE_CLIENT_ID`, `GOOGLE_WEB_CLIENT_ID`, `JWT_SECRET`, `JWT_REFRESH_SECRET` and `MONGODB_URI` already exist in this repository — see [GITHUB_ACTIONS_SETUP.md](GITHUB_ACTIONS_SETUP.md) for how workflows consume them. No secret value appears in this document.

## 1. Google Cloud Console

1. Create or select your own project.
2. **Google Auth Platform → OAuth consent screen**: application name, support and developer contacts, audience (External while unverified), scopes limited to identity (`openid`, `email`, `profile`), privacy policy and terms URLs, plus test users while the app is in *Testing*.
3. **Create credentials → OAuth client ID → Android**
   - Package name: `com.musikuplus.app` (must match `applicationId` and `namespace` in `mobile/android/app/build.gradle.kts`).
   - SHA-1: the fingerprint of the certificate that actually signs the build you are testing (see §2). Create one Android client per certificate — debug and release are different clients.
   - The resulting client ID is `GOOGLE_CLIENT_ID`.
4. **Create credentials → OAuth client ID → Web application**
   - Name it something recognizable (for example `MUSIKU+ backend`).
   - Authorized JavaScript origins / redirect URIs are only needed if you later add a browser-side or authorization-code flow; backend ID-token verification does not use them.
   - The resulting client ID is `GOOGLE_WEB_CLIENT_ID`. It must end with `.apps.googleusercontent.com`.
5. If you distribute through Google Play with **Play App Signing**, register the Play-managed certificate's SHA-1 as an additional Android client — Google re-signs the uploaded artifact, so the upload certificate alone is not enough.

## 2. SHA-1 fingerprints

Run `keytool` locally (JDK 17). Never paste a keystore or its password into chat, an issue, or a commit.

```sh
# Debug certificate (created automatically by the Android tooling):
keytool -list -v -alias androiddebugkey -keystore ~/.android/debug.keystore

# Release certificate — let keytool prompt for the password:
keytool -list -v -keystore /secure/path/release.jks -alias YOUR_ALIAS

# CI-built debug APK: the runner's debug keystore differs from yours, so either
# register that fingerprint too, or (preferred) test Google sign-in with a build
# signed by a certificate you control.
```

Use **SHA-1** for the Android OAuth client. Record **SHA-256** where your Google services, App Links or Play configuration ask for it.

Important CI consequence: a GitHub-hosted runner generates its own ephemeral debug keystore, so an APK from `musiku-plus-debug-apk` is signed with a fingerprint that is *not* registered in your Google project unless you add it. Google sign-in from that artifact will fail with `developer_error 10` — that is expected and is not a code defect. Test with a release-signed build, or register the runner fingerprint, or use a locally built debug APK whose fingerprint you registered.

## 3. Backend configuration

```dotenv
GOOGLE_CLIENT_ID=<android-oauth-client-id>.apps.googleusercontent.com
GOOGLE_WEB_CLIENT_ID=<web-application-client-id>.apps.googleusercontent.com
# Optional, backend only, for a future authorization-code flow:
GOOGLE_CLIENT_SECRET=
# Only if ID tokens are also issued directly for the Android client:
GOOGLE_ACCEPT_ANDROID_AUDIENCE=false
```

Behaviour implemented in `backend/src/services/googleIdentity.ts`:

- `google-auth-library` (`OAuth2Client.verifyIdToken`) fetches Google's certificates and verifies the **signature**.
- The accepted **audience** is the web client ID (`GOOGLE_WEB_CLIENT_ID`); `GOOGLE_CLIENT_ID` is used as a fallback audience only when no web client is configured, which keeps single-client deployments working. A token minted for any other client is rejected.
- The Android client ID is accepted as an audience **only** when `GOOGLE_ACCEPT_ANDROID_AUDIENCE=true`.
- **Issuer** must be `accounts.google.com` or `https://accounts.google.com`.
- **Expiration** is checked again locally (`exp` must be in the future).
- `sub` must be present and is the only identity used for account matching.
- `email` must be present **and** `email_verified` must be `true`.
- Nothing from the request body is trusted: `POST /api/auth/google` accepts `{ idToken, deviceId }` only. An email or user ID sent by the client is ignored.
- Errors are returned as a generic `401 Invalid or expired Google identity token`; Google's internal error detail and any token content are never echoed.

Account handling in `backend/src/services/authService.ts`:

- `googleId` (the Google `sub`) has a **unique sparse index**; looking it up first guarantees no duplicate account is created for the same Google identity.
- If no account has that `sub` but a **verified** email account exists, Google is linked to it (no second account).
- If the existing account's email is **not** verified, linking is refused with `409` — an attacker cannot hijack an unverified mailbox by owning a Google account with that address.
- A conflicting `googleId` on the same email, or a suspended/deleted account, is refused.
- A brand-new Google identity gets a profile plus a randomized unique username.
- Every exchanged ID token hash is stored once in `oauth_replays` with a TTL until the token's expiry; replaying the same token — including concurrently — is rejected by the unique index. The raw token is never stored or logged.
- On success MUSIKU+ issues **its own** access and refresh JWTs and persists a session document in Atlas. A Google ID token is never accepted as an API bearer token.
- Authentication endpoints are rate-limited.

## 4. Flutter configuration

`mobile/lib/core/google_auth.dart` uses `google_sign_in` pinned to `>=6.3.0 <7.0.0`, whose API is `GoogleSignIn(scopes: [...], serverClientId: ...)` + `signIn()` + `account.authentication.idToken`. (7.x/8.x replace `signIn()` with `authenticate()`, so a major bump is a code change, not a dependency refresh.)

```dart
const googleWebClientId = String.fromEnvironment('GOOGLE_WEB_CLIENT_ID');
GoogleSignIn(scopes: ['email', 'profile'], serverClientId: googleWebClientId);
```

Build with the public web client ID and a reachable HTTPS API origin:

```sh
cd mobile
flutter run \
  --dart-define=API_BASE_URL=https://YOUR_BACKEND/api \
  --dart-define=GOOGLE_WEB_CLIENT_ID=YOUR_WEB_CLIENT_ID.apps.googleusercontent.com
```

`API_URL` is still accepted as a legacy alias; `API_BASE_URL` takes precedence.

Rules enforced by the implementation:

- Only public build-time values are embedded. `MONGODB_URI`, `JWT_SECRET`, `JWT_REFRESH_SECRET` and any client secret are **never** passed to `--dart-define`. CI proves this: `scripts/scan_apk_secrets.py` decompresses every APK member and fails the build if any backend secret value or credential pattern (`mongodb+srv://…`, `GOCSPX-…`, PEM private keys, …) is present.
- The Android client ID is **not** embedded in Dart code: `google_sign_in` 6.x resolves the Android client from the Google Cloud registration for the package + SHA-1.
- The Google button renders only when the build ships a web client ID **and** `GET /api/auth/providers` reports Google enabled, so the app can never show a sign-in button the backend would reject. A backend that is unreachable is treated as "not available".
- Cancellation returns without calling the backend; only a real ID token is exchanged.
- **No Apple button exists.** `IdentityProvider` is the extension point for adding another provider later.

## 5. Testing checklist

Backend/CI (already automated):

- `backend/tests/unit/googleIdentity.test.ts` — signature verification through the library, web-client audience, Android-client fallback, opt-in Android audience, rejection of a different client, rejection when unconfigured, invalid `exp`/`aud`/`iss`/`email_verified`/`email`/`sub`, and no leakage of library error detail.
- `backend/tests/unit/oauthLinking.test.ts` — verified-email linking, refusal of unverified linking, suspended accounts, replay rejection.
- `backend/tests/integration/auth.test.ts` — the public capability endpoint reports Google unavailable without credentials and leaks no secret.
- `backend/tests/atlas/atlasIntegration.test.ts` — when a real Atlas test database is reachable, Google linking is persisted, no duplicate account is created for the same email, and the replay index rejects a repeated token. The Google verifier itself is mocked in that suite (Google's JWKS is not reachable from CI), which is stated in the report rather than presented as a live OAuth test.

On a physical device (requires your credentials and cannot be automated here):

1. Deploy the backend with `GOOGLE_WEB_CLIENT_ID` set, run `npm run db:init`, confirm `/health` and the admin integration page.
2. Install a build signed with a certificate whose SHA-1 is registered, built with the matching `GOOGLE_WEB_CLIENT_ID` and a reachable `API_BASE_URL`.
3. Sign in with a consent-screen test user; confirm the Google button appears and the exchange succeeds.
4. Confirm `/api/auth/me`, a session document, a device entry and a `method: 'google'` login-history entry.
5. Sign in again with an **existing verified** email account and confirm linking (one account, `googleId` set), not duplication.
6. Repeat the same ID token → expect `401` (replay protection). After logout, obtain a fresh token rather than reusing a cached one.
7. Revoke the session from the account-security screen and confirm the old access token now returns `401`.
8. Negative cases: wrong audience (a token from another app), expired token, unverified-email linking (`409`), cancellation (no backend call).

`developer_error 10` almost always means package name, SHA-1 or web client mismatch. A `401` from the backend with a correct sign-in usually means `GOOGLE_WEB_CLIENT_ID` on the server does not match the `serverClientId` used by the build.
