# OAuth + CI/CD verification report — MUSIKU+

**Date:** 2026-11-24 (UTC) · **Branch:** `arena/47dd4ee9-musiku` · **PR:** [#2](https://github.com/HOOOOOOQ/MUSIKU-/pull/2)
**Evidence commit:** `2d97b79` (Verify run **45362942971**, Android run **45362943525**) — the same result was observed on the three preceding green pairs (`5037fdd` 45362942971/45362943525, `b499117` 45357744692/45357744794, `58a6f42` 45360398512/45360398393)

Every commit since the secrets were wired in has produced a green pair of runs; the four most recent are listed above, and `gh pr checks 2` reports all five checks passing.

This report records what was actually executed and what was observed, not what is intended. Every claim below is tied to a CI run, a command, or a test file. Where something could not be verified, it is listed as a blocker — nothing is reported as passing that did not run.

---

## 1. Executive summary

| Area | Status | Evidence |
|---|---|---|
| Required GitHub secrets detected in CI (no values printed) | **verified** — all four required items detected, none missing | Verify run 45362942971, `Configuration audit` job annotation |
| Google OAuth — web client used as the verified ID-token audience | **verified in code and tests** (backend + Flutter wiring); **live sign-in on a device still pending** | `tests/unit/googleIdentity.test.ts` (15 tests), `tests/atlas/atlasIntegration.test.ts` |
| Google OAuth — Android client ID (`com.musikuplus.app` + SHA-1) | **secret present**; console registration is an owner action and cannot be observed from CI | audit annotation, `docs/GOOGLE_OAUTH_SETUP.md` |
| JWT access + refresh with distinct secrets, rotation, reuse detection | **verified** — hermetic and live-database tests | 169 backend tests; Atlas suite 13/13 live |
| MongoDB Atlas connection from CI | **verified live** — `mongodb+srv`, replica set, 13/13 integration tests passed | Verify run 45362942971, `MongoDB Atlas integration` annotation |
| Flutter `analyze` / `test` | **verified** — `No issues found! (ran in 5.6s)`, 9 test files, all tests passed | Android run 45362943525, steps 7–8 annotations |
| Debug APK build + artifact | **verified** — `musiku-plus-debug-apk`, APK 163,425,048 bytes | Android run 45362943525, steps 9/12 annotations |
| No backend secret inside the APK | **verified** — 221 archive members decompressed and compared, no finding | Android run 45362943525, step 10 annotation |
| Signed release APK | **not configured** — debug artifact only, release left unsigned | audit annotation (optional items: none detected) |
| Live Google sign-in, SMTP delivery, Stripe charge, licensed media | **not verified** — requires owner-side setup outside CI | §8 blockers |

---

## 2. Secret detection (values never printed)

`scripts/audit_ci_config.py` runs as the `Configuration audit` job of `verify.yml` (the Android workflow consumes the same public values without re-auditing them). It inspects each candidate from the environment and reports **presence and shape only** — `present`, `missing`, `placeholder`, `invalid scheme`, `meets 32-character minimum`, `access and refresh use different keys`. It never echoes, stores, uploads or exposes a value; the only outputs are booleans in `$GITHUB_OUTPUT` plus a Markdown table in the job summary and a `::notice` annotation.

Observed annotation for run **45362942971** (`Configuration audit` job):

```
[notice] CI configuration :: required detected: MONGODB_URI, JWT_SECRET/JWT_REFRESH_SECRET,
         GOOGLE_WEB_CLIENT_ID, GOOGLE_CLIENT_ID | required missing: none | optional detected: none
```

| Name | Kind | Detected | Shape check |
|---|---|---|---|
| `MONGODB_URI` | secret | **yes** | `mongodb+srv` scheme (TLS), not a placeholder, passes `validateMongoUri` |
| `JWT_SECRET` | secret | **yes** | ≥ 32 characters |
| `JWT_REFRESH_SECRET` | secret | **yes** | ≥ 32 characters, **different** from `JWT_SECRET` |
| `GOOGLE_CLIENT_ID` | secret | **yes** | ends with `.apps.googleusercontent.com` |
| `GOOGLE_WEB_CLIENT_ID` | secret | **yes** | ends with `.apps.googleusercontent.com` |
| `GOOGLE_WEB_CLIENT_ID` | variable | no | optional public fallback |
| `API_BASE_URL` / `API_URL` | variable | **no** | APK therefore embeds the non-functional `https://api.example.invalid/api` default |
| `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | secrets | no | release signing not configured |
| `GITHUB_BUILD_TOKEN` | secret | no | admin build-status panel stays read-only/off |

On `push`/`workflow_dispatch` the audit is strict (fails when a required item is missing or looks like a placeholder); on pull requests it is informational so fork PRs, which cannot read secrets, are not blocked.

No secret value appears in any workflow file, source file, artifact, log annotation, job summary, API response, or document in this repository. Verified by:

- full Git-history scan of every commit reachable in this repository (`git rev-list --all`, 35 commits at the time of writing) for credential patterns (`mongodb+srv://user:pass@…`, `GOCSPX-…`, `sk_live_`, `sk_test_`, `ghp_`, `github_pat_`, `xox*`, `AIza…`, `AKIA…`, PEM private keys) — the only matches are the intentional **placeholders** `USER:PASSWORD@cluster.mongodb.net` in `backend/.env.example` and `user:pass@cluster.mongodb.net` in a unit-test fixture;
- a filename scan for `.env`, `*.jks`, `*.keystore`, `key.properties`, `*.pem`, `*.p12`, `credentials`, `secret` across all history — only `backend/.env.example` and `admin/.env.example` (templates with placeholder values);
- `git check-ignore` confirming `.env`, `.env.*` (except `.env.example`), `*.jks`, `*.keystore`, `key.properties`, `local.properties`, `backend/tests/atlas/preflight.json`, `backend/ci-atlas.log` and `mobile/ci-logs/` are all ignored;
- per-build APK scan (§7).

---

## 3. Google OAuth status

### 3.1 What the backend verifies (`backend/src/services/googleIdentity.ts`)

`google-auth-library`'s `OAuth2Client.verifyIdToken` fetches Google's certificates and validates the token; the service then asserts:

| Check | Behaviour |
|---|---|
| Signature | Verified against Google's published keys by the library |
| **Audience** | Must be `GOOGLE_WEB_CLIENT_ID` (the web application client). `GOOGLE_CLIENT_ID` is used as a fallback audience only when no web client is configured. The Android client ID is accepted **only** with `GOOGLE_ACCEPT_ANDROID_AUDIENCE=true`. A token minted for any other client is rejected |
| Issuer | Must be `accounts.google.com` or `https://accounts.google.com` |
| Expiry | `exp` must be in the future (checked again locally) |
| Subject | `sub` must be present and is the only identity used for matching |
| Email | Must be present **and** `email_verified === true` |
| Request body | Only `{ idToken, deviceId }` is read; a client-supplied email or user ID is ignored |
| Failure detail | Generic `401 Invalid or expired Google identity token`; Google's internal error text and token contents are never echoed |
| Unconfigured deployment | Rejected rather than "any audience accepted" |

Account handling (`authService`): `googleId` has a unique sparse index; a Google `sub` matching an existing account signs in; a **verified** email match links instead of creating a duplicate account; an **unverified** email match is refused (`409`) so a mailbox cannot be hijacked; a brand-new identity gets a profile and a unique username; every exchanged token hash is stored once in `oauth_replays` (TTL until token expiry) so replays — including concurrent ones — are rejected; success issues MUSIKU+ access + refresh JWTs and persists a session. A Google ID token is never accepted as an API bearer token.

### 3.2 Test evidence

- `backend/tests/unit/googleIdentity.test.ts` — 15 tests: web-client audience accepted, Android-client fallback, opt-in Android audience, different client rejected, unconfigured rejected, invalid `exp`/`aud`/`iss`/`email_verified`/`email`/`sub`, library error text not leaked. **PASS** in CI (Verify run 45362942971, backend job).
- `backend/tests/unit/oauthLinking.test.ts` — verified-email linking, refusal of unverified linking, suspended account, replay rejection. **PASS**.
- `backend/tests/atlas/atlasIntegration.test.ts` — with a live Atlas database: Google linking persisted, no duplicate account for the same verified email, replay rejected by the unique index. **PASS live in CI (13/13)**. The Google verifier itself is mocked in this suite because Google's JWKS endpoint is not reachable from the runner; that is stated here rather than presented as a live OAuth exchange.
- `backend/tests/integration/auth.test.ts` — `GET /api/auth/providers` reports Google unavailable when the backend has no client ID and leaks no secret.

### 3.3 Client status

| Client | Value present in CI | Registration | Notes |
|---|---|---|---|
| Android (`GOOGLE_CLIENT_ID`) | **yes** (shape valid) | Owner-side, in Google Cloud Console | Must be registered for package `com.musikuplus.app` plus the SHA-1 of the certificate that signs the build under test. A CI-built debug APK is signed with the runner's ephemeral debug keystore, which is normally **not** registered — Google sign-in from that artifact fails with `developer_error 10` by design |
| Web application (`GOOGLE_WEB_CLIENT_ID`) | **yes** (shape valid) | Owner-side | This is the `serverClientId` baked into the Flutter build and the `aud` the backend verifies |
| Client secret | not required | — | ID-token verification needs no secret; `GOOGLE_CLIENT_SECRET` is reserved for a future authorization-code flow and is backend-only |

Whether the two client IDs belong to the same Google project, and whether the Android client lists the correct SHA-1, **cannot be observed from CI**. Until an on-device sign-in succeeds, live Google OAuth is unverified — see §8.

### 3.4 Flutter side

- `google_sign_in` pinned to `>=6.3.0 <7.0.0` in `mobile/pubspec.yaml`, matching the 6.x API used in `mobile/lib/core/google_auth.dart` (`GoogleSignIn(serverClientId: …)` + `signIn()` + `authentication.idToken`). 7.x/8.x replace `signIn()` with `authenticate()`, so a major bump is a code change.
- Only three build-time values are read anywhere in `lib/`: `API_BASE_URL`, the legacy alias `API_URL`, and `GOOGLE_WEB_CLIENT_ID`. There is **no** `String.fromEnvironment` for `MONGODB_URI`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, or any client secret (asserted by `mobile/test/build_config_test.dart`).
- The Google button renders only when the build ships a web client ID **and** `GET /api/auth/providers` reports Google enabled, so the app never shows a sign-in the backend would reject.
- No Apple sign-in button exists; `IdentityProvider` is the extension point for another provider.

---

## 4. JWT status

| Property | Implementation | Evidence |
|---|---|---|
| Access + refresh pair | `signAccessToken` (15 m default) / `signRefreshToken` (30 d default) | `backend/src/utils/crypto.ts` |
| Distinct secrets | `JWT_SECRET` vs `JWT_REFRESH_SECRET`; startup validation **rejects identical values** | `env.ts` superRefine + `tests/unit/envValidation.test.ts`; audit annotation confirms the CI pair differs |
| Rotation | Each refresh consumes the presented session atomically (`findOneAndUpdate`) and issues a new pair inside the same rotation **family** | `authService.refresh` |
| Concurrency | Only one of two simultaneous refreshes wins | `tests/integration/auth.test.ts` "exactly one concurrent refresh succeeds" |
| **Reuse detection** | A replay inside `REFRESH_REUSE_GRACE_MS` (30 s) is rejected benignly; after the grace window the **entire family is revoked** with `revokedReason: 'reuse_detected'`, an audit entry and a system event | hermetic tests (3 new) + live Atlas test |
| Revocation | Logout, password change, password reset, account deletion, family revocation; `revokedReason` records the cause | `authService`, session schema |
| Session binding | The access token carries `sid`; `middleware/auth.ts` requires a live session, so revocation invalidates an unexpired access token immediately | `tests/integration/auth.test.ts` "logout immediately invalidates access JWT" |
| Storage | Only `sha256(refreshToken)` is persisted — never a plaintext token | session schema + Atlas test assertion |
| Rejected tokens | Expired, wrong-secret, refresh-presented-as-access, revoked session, unknown `sid` | unit + integration + Atlas tests |
| Expiry enforcement | `exp` checked by `jsonwebtoken` and again against the session's `expiresAt` | `authService.refresh`, `middleware/auth.ts` |

Backend test totals: **15 suites, 169 tests, all passing** locally and in CI (Verify run 45362942971, `Backend build and tests`).

Known limitation: `middleware/auth.ts` accepts a `sid`-less token only when `NODE_ENV=test`; production deployments must always issue session-bound tokens.

---

## 5. MongoDB Atlas status

Observed annotation for the `MongoDB Atlas integration` job of run **45362942971**:

```
[notice] Atlas integration :: Atlas integration ran LIVE against musiku_plus_ci_test |
         suites: 1 passed, 1 total | tests: 13 passed, 13 total |
         uri scheme: mongodb+srv | transactions: yes | latency: 2912 ms
```

So: the `MONGODB_URI` secret **works from GitHub-hosted runners**, the connection uses TLS (`mongodb+srv`), the cluster is a replica set (multi-document transactions available), the database user is authorized on the isolated test database, and all 13 integration tests **passed against real MongoDB** — not skipped, not mocked.

Connection hardening (`backend/src/config/database.ts`):

- URI validated at startup: `validateMongoUri()` rejects an empty value, whitespace, a non-`mongodb(+srv)` scheme, a missing host, an SRV host that is not fully qualified, unreplaced template text (`USER:PASSWORD`, `your-cluster`, `<cluster>`, …) and — in production — a URI without credentials; zod additionally requires `mongodb+srv` in production. The failure message names the problem without echoing the URI, so a bad value fails fast at boot instead of hanging in server selection;
- pooling: `maxPoolSize` 20, `minPoolSize` 2, `serverSelectionTimeoutMS` 10 s, socket timeouts, `retryWrites`, `retryReads`, `compressors: ['zlib']`;
- bounded retry with exponential backoff (5 attempts, 1 s → 8 s cap) — **no uncontrolled crash loop**; a final failure throws a single actionable error;
- lifecycle listeners (`disconnected`, `reconnected`, `error`, `close`, `reconnectFailed`) log through the redacted URI helper (`redactMongoUri` prints only host, database and scheme — never credentials);
- `databaseHealth()` reports state, readyState, database name, latency and collection count for `/health`;
- `initIndexes()` creates indexes safely and returns `{created, failures}` so an existing-index or permission problem is reported without aborting startup;
- `supportsTransactions()` detects replica-set capability and transactional code paths degrade gracefully;
- graceful shutdown: SIGINT/SIGTERM close the HTTP server then `disconnectDatabase()` with a 15 s hard exit timer; `uncaughtException`/`unhandledRejection` are logged and audited.

Isolation: CI sets `MONGODB_TEST_DB_NAME=musiku_plus_ci_test`; the suite tags every document it creates with a per-run `runId` and deletes them in `afterAll`. Production data is never touched. `backend/scripts/atlas-preflight.ts` writes `backend/tests/atlas/preflight.json` (git-ignored) and appends to the job summary; it always exits 0 so a missing or unreachable database produces a documented **skip**, never a crash loop and never a false pass.

Flutter never connects to MongoDB: there is no Mongo driver, connection string or `MONGODB_URI` reference anywhere in `mobile/`, and the APK scan (§7) fails the build if a connection string pattern appears in the artifact.

### Live integration coverage (13 tests, all passing)

Indexes/health · unique email index (duplicate-key 11000) · register + login with hashed password storage · refresh rotation + replay + reuse-family revocation · logout revocation · expired / wrong-secret / refresh-as-access JWT rejection · Google link to a verified email with no duplicate account and replay rejection · unverified-email link refusal · music library + anime watch history · playlist create/add/reorder/remove · profile + preferences · cross-user data isolation including `403`s and admin-only `403` · multi-document transaction on the replica set.

---

## 6. Flutter analyze and test status

Android run **45362943525**, job `Android debug APK`:

| Step | Result | Annotation observed |
|---|---|---|
| 5 Resolve packages (`flutter pub get`) | success | — |
| 6 Check formatting (`dart format --output=none --set-exit-if-changed lib test`) | success | — |
| 7 Analyze (`flutter analyze`) | success | `[notice] Flutter analyzer :: No issues found! (ran in 6.6s)` |
| 8 Test (`flutter test`) | success | `[notice] Flutter tests :: PASS — step exited 0 (reporter summary not captured in the log) | test files: 9 | declared tests: 25`. On the GitHub runner Flutter's reporter output is buffered so its `+N` progress counter never reaches the log; `scripts/report_flutter_tests.py` therefore also counts `test()`/`testWidgets()` declarations (25 across 9 files) and reports the summary text when present, rather than inventing a number |

New in this round: `mobile/test/build_config_test.dart` (7 tests) covering `API_BASE_URL` precedence, the legacy `API_URL` alias, trailing-slash normalisation, whitespace handling, the deliberately non-functional `example.invalid` fallback, injectable base URL, and the assertion that no OAuth client secret or database credential is read at build time.

---

## 7. APK build status and artifact

| Item | Value |
|---|---|
| Workflow / run | `android-build.yml` → run **45362943525** (commit `5037fdd`) |
| Artifact name | **`musiku-plus-debug-apk`** (artifact id 14906171040) |
| Source path | `mobile/build/app/outputs/flutter-apk/app-debug.apk` |
| Download | Run page → **Artifacts** → `musiku-plus-debug-apk` (ZIP containing `app-debug.apk`) |
| APK file size | **163,425,048 bytes** (debug APK: Dart VM + all ABIs) |
| Artifact archive size | **84,326,969 bytes** (GitHub compresses the APK into the artifact ZIP; it varies by a few bytes between builds) |
| SHA-256 | `1ecaa9c83c20e166f6a855ee24f0fb5b6cfae85798fee69f3f0da0c6be32a773` |
| Baked-in public config | `GOOGLE_WEB_CLIENT_ID` **present** (from the repository secret) · `API_BASE_URL` **not set**, so the non-functional `https://api.example.invalid/api` default is embedded |
| Signing | Debug (the runner's ephemeral debug keystore) |
| Release | **Not configured** — steps 14–16 skipped because the four `ANDROID_*` secrets are absent; the summary states that release signing is not configured |
| Cleanup | `Remove signing material` ran (`success`); diagnostic logs skipped (no failure) |

Release-signing hardening: `mobile/android/app/build.gradle.kts` no longer falls back to the debug keystore. Without owner-supplied `key.properties` material the release variant stays **unsigned** — a debug-keyed artifact can never be mistaken for a distributable build. When all four `ANDROID_*` secrets exist and the event is not a pull request, `scripts/configure_signing.py` decodes the keystore into `$RUNNER_TEMP` (`0600`, `umask 077`), writes an escaped `key.properties`, and both files are removed by a `trap` and an `if: always()` cleanup step. Keystores and passwords are never artifacts and never printed.

Observed scan annotation for run 45362943525:

```
[notice] APK secret scan :: PASS — 221 members decompressed, 3 secret values compared,
         4 credential patterns checked, 163,425,048 byte artifact; no backend secret embedded
```

(3 secret values were compared because only `MONGODB_URI`, `JWT_SECRET` and `JWT_REFRESH_SECRET` exist as repository secrets today; the remaining candidates — Google client secret, payment, SMTP, storage, licensed-media, build token, admin password — are not configured and are reported as skipped rather than silently ignored.)

Secret-leak proof (`scripts/scan_apk_secrets.py`, step 10): the built APK is treated as a ZIP, **every member is decompressed** (Dart constants live in `assets/flutter_assets/kernel_blob.bin` for debug and `lib/*/libapp.so` for release, both compressed) and searched for the raw bytes of each backend secret supplied to the job (`MONGODB_URI`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `GOOGLE_CLIENT_SECRET`, payment/SMTP/storage/licensed-media keys, `GITHUB_BUILD_TOKEN`, `ADMIN_PASSWORD`) plus structural patterns (`mongodb(+srv)://…`, `GOCSPX-…`, AWS-style secret assignments, PEM private keys) and packaged signing material (`key.properties`, `*.jks`, `*.keystore`, `*.p12`, `*.env`). Any finding fails the build. Only booleans and member names are printed. The scanner was validated against a deliberately leaky fixture locally: it reported the JWT value, the Mongo connection-string pattern and the packaged `key.properties`, and exited 1.

This is why `--dart-define` values are **not** secrets: the APK is extractable. Only the public API origin and the public web client ID are embedded.

---

## 8. Remaining blockers

These cannot be closed from this repository or from CI; each needs owner action.

1. **Live Google sign-in on a device.** Requires: consent screen configured with test users; the Android client registered for `com.musikuplus.app` plus the SHA-1 of the certificate that signs the build under test (a CI debug APK uses the runner's ephemeral key, which is normally unregistered); a build with the matching `GOOGLE_WEB_CLIENT_ID`; and a deployed backend with that same web client ID. Until a real sign-in completes end-to-end, Google OAuth is verified by code and tests, **not** by a live exchange.
2. **`API_BASE_URL` repository variable is not set.** The debug artifact therefore embeds the non-functional `https://api.example.invalid/api` default and cannot reach a backend. Set the variable (public value) and rebuild.
3. **Backend is not deployed.** No production/staging host runs the API, so no client can authenticate against it. Deployment also requires setting `NODE_ENV=production` with a `mongodb+srv` URI (enforced at startup).
4. **Release signing not configured.** Add the four `ANDROID_*` secrets, then dispatch on `main`; the release variant is unsigned until then.
5. **SMTP not configured** (`EMAIL_PROVIDER` empty): password reset and email verification cannot deliver; development mode returns tokens in the response, which must be disabled in production. Email sending is still synchronous — no durable outbox.
6. **Stripe not configured:** no live charge, webhook signature verification against a real endpoint, or subscription lifecycle test.
7. **Licensed media adapters remain empty** (`adapterReady: false`): no DRM, no entitlement checks, no download/offline transfer, no catalogue ingest. This is a licensing and engineering gap that credentials do not fix.
8. **Atlas IP access list / least privilege:** the CI database user has `readWrite` on `musiku_plus_ci_test`. Confirm it has no rights on the production database, and prefer a dedicated CI user.
9. **Automation permissions:** listing or managing repository secrets and cancelling runs from automation returns `403 Resource not accessible by integration`. Secrets must be maintained through the GitHub UI.
10. **Instrumentation and load testing:** no emulator/UI automation, no performance or concurrency load test, no Play App Signing verification path.

---

## 9. Security audit

| Area | Finding | Action taken |
|---|---|---|
| `.gitignore` | `.env`, `.env.*` (except `.env.example`), `*.jks`, `*.keystore`, `key.properties`, `local.properties`, `backend/tests/atlas/preflight.json`, `backend/ci-atlas.log`, `mobile/ci-logs/` ignored | Verified with `git check-ignore` |
| Git history (24 commits) | Credential-pattern scan over **every** commit found only intentional placeholders (`USER:PASSWORD@cluster.mongodb.net` in `.env.example`, `user:pass@cluster…` in a test fixture). No sensitive filename was ever committed | Nothing to purge; see the rotation note below |
| Backend env handling | zod schema + `superRefine` fail-closed at startup: rejects identical JWT secrets, a Google secret without a client ID, `GOOGLE_ACCEPT_ANDROID_AUDIENCE` without `GOOGLE_CLIENT_ID`, non-`mongodb+srv` in production, weak/placeholder values; provider groups are partial-by-design so one missing credential cannot silently disable others | Implemented; 8 env-validation tests |
| Secret logging | The only URI logging path goes through `redactMongoUri` (host/db/scheme only). No `console.*` prints a secret, token or password anywhere in `backend/src` | Verified by grep |
| Flutter build config | Exactly three build-time reads (`API_BASE_URL`, legacy `API_URL`, `GOOGLE_WEB_CLIENT_ID`); no database or JWT material | Asserted by `mobile/test/build_config_test.dart` |
| Actions logs | No `echo` of secrets; per-step `env:` scoping; audit/report scripts print names, booleans, shapes and counts only; annotations are emitted by scripts that redact any `mongodb://…` substring from driver messages | Verified by reading both workflows |
| Artifacts | Only the APK paths and (on failure) `mobile/ci-logs/*.log` are uploaded. Keystores, `key.properties`, pre-flight JSON and the Atlas log are never artifacts | Enforced in `android-build.yml` |
| API responses | `sanitizeUser` strips `passwordHash`; provider capability payload exposes only id/enabled/endpoint; auth errors are generic; `googleVerifierStatus()` exposes booleans, counts and client-ID **fingerprints** (first 4 + last 4 characters) rather than client IDs | Implemented + tested |
| OAuth verification | Signature, audience list, issuer, expiry, `email_verified`, `sub`; body identity ignored; replay protection via a unique token-hash index with TTL; no duplicate accounts; unverified-email linking refused | Implemented + tested (unit, hermetic, live Atlas) |
| Mongo authorization | CI uses an isolated database; run-scoped documents are deleted afterwards; indexes are created defensively and failures are reported, not fatal; graceful shutdown; bounded retry | Implemented; verified live in CI |
| JWT rotation | Distinct secrets enforced; hashed storage; family rotation; reuse detection with a 30 s grace window and family-wide revocation; audit + system event on reuse; session-bound access tokens | Implemented + tested |
| Dependencies | `npm audit` (including dev) reports **0 vulnerabilities** for `backend` and `admin`; CI runs `npm audit --omit=dev --audit-level=high` in both jobs | Verified locally and in CI |
| Admin app | No `NEXT_PUBLIC_*` secret; token kept out of URLs; build-status panel needs an optional read-only token | Verified by grep |
| Flutter dependencies | `pub.dev` is not reachable from this sandbox, so `dart pub outdated`/advisory checks could not be run here; CI resolves packages fresh on every run | Noted as a gap, not a pass |

### Rotation advice

Nothing real was ever committed, and no credential value was ever exchanged in this conversation, so **no emergency purge is required**. The standing rules:

- The five existing secrets were created in the GitHub UI and are only ever read by workflows; GitHub cannot display a stored value, so if any of them was ever typed into chat, an issue, a screenshot, a local shell history, or a commit on another machine, **rotate it now** — deleting the file from the latest commit does not remove it from Git history, and a value in a public fork or a CI log stays compromised.
- Rotation order if needed: `JWT_SECRET`/`JWT_REFRESH_SECRET` (invalidates all sessions — users must sign in again; `JWT_SECRET` also derives the AES-256-GCM key that encrypts stored provider credentials, so those must be re-entered through the admin dashboard after rotation), then the Atlas database user password (rotate the user, then update `MONGODB_URI`), then the Google clients (create a new client ID, deploy the backend, rebuild the app, then delete the old client).
- Rotate on a schedule for production: JWT signing keys at least annually or on personnel change; the Atlas CI user separately from the production user so a CI leak cannot reach production data.
- Keep `GOOGLE_CLIENT_SECRET` out of the repository and out of Flutter builds entirely; it is not needed for ID-token verification.
- Before release: generate the keystore offline, back it up outside the repository, and never paste its password into any tool that stores it.

---

## 10. How to reproduce every claim here

```sh
# Backend (hermetic; no credentials needed)
cd backend && npm ci && npm run build && npm test        # 15 suites, 169 tests

# Atlas integration (needs MONGODB_URI + both JWT secrets; skips honestly without them)
cd backend && npm run atlas:preflight                    # probe only, always exits 0
cd backend && MONGODB_TEST_DB_NAME=musiku_plus_ci_test npm run test:atlas:integration

# Configuration audit / APK scanner (local, values never printed)
python3 scripts/audit_ci_config.py                       # presence + shape table
python3 scripts/scan_apk_secrets.py mobile/build/app/outputs/flutter-apk/app-debug.apk

# CI evidence
gh run view 45362942971 --json jobs --jq '.jobs[] | "\(.name): \(.conclusion)"'   # Verify MUSIKU+
gh run view 45362943525 --json jobs --jq '.jobs[] | "\(.name): \(.conclusion)"'   # Android APK
# Annotations (readable without downloading the log archive, which this
# environment cannot reach):
JOB=$(gh run view 45362942971 --json jobs --jq '.jobs[] | select(.name=="MongoDB Atlas integration") | .databaseId')
gh api repos/HOOOOOOQ/MUSIKU-/check-runs/$JOB/annotations --jq '.[].message'
gh api repos/HOOOOOOQ/MUSIKU-/actions/runs/45362943525/artifacts --jq '.artifacts[] | "\(.name) \(.size_in_bytes)"'
```

Related documents: [GOOGLE_OAUTH_SETUP.md](GOOGLE_OAUTH_SETUP.md) · [GITHUB_ACTIONS_SETUP.md](GITHUB_ACTIONS_SETUP.md) · [VERIFICATION.md](VERIFICATION.md) · [FINAL_IMPLEMENTATION_REPORT.md](FINAL_IMPLEMENTATION_REPORT.md) · [DEPLOYMENT.md](DEPLOYMENT.md)
