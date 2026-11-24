# MUSIKU+ — Final implementation report

Date: 2026-11-24 · Branch: `arena/47dd4ee9-musiku` · Pull request: https://github.com/HOOOOOOQ/MUSIKU-/pull/2
Code commit verified in CI: `20a44d1` (Animeku round; earlier sections reference `2d97b79`/`e2917e7` runs and remain accurate for those commits) · This report records **executed** results, not intentions.

## Verdict

**MUSIKU+ is NOT production-ready.** The application code, CI pipelines and a real debug APK artifact now exist and pass. Since the owner added the five repository secrets, **MongoDB Atlas is verified live in CI** (13/13 real-database integration tests, replica-set transactions) and **JWT rotation with reuse detection is verified** both hermetically and against that database. The **Animeku** anime section (backend adapter + service + routes, Flutter section with its own player, admin management page) is implemented and covered by 89 dedicated backend tests, 53 Flutter tests and 11 admin tests — with video playback **deliberately unauthorized** until distribution rights and a media host allowlist are configured. Still **unmet because they need owner-side action outside CI**: live Google sign-in on a device, SMTP delivery, Stripe charging, licensed media providers, Android release signing, a deployed backend, and an Animeku rights decision plus a live upstream verification.

> **Latest verified state (commit `2d97b79`, 2026-11-24).** Verify run [45362942971](https://github.com/HOOOOOOQ/MUSIKU-/actions/runs/45362942971): configuration audit — required `MONGODB_URI`, distinct `JWT_SECRET`/`JWT_REFRESH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_WEB_CLIENT_ID` all detected, none missing (values never printed); backend build + **169 tests / 15 suites**; **Atlas integration LIVE — 13/13 passed** against `musiku_plus_ci_test` (`mongodb+srv`, transactions available, probe latency 2912 ms); admin tests + production build; `npm audit` 0 vulnerabilities. Android run [45362943525](https://github.com/HOOOOOOQ/MUSIKU-/actions/runs/45362943525): format, analyze (`No issues found! (ran in 5.6s)`), tests across **9 files** all passing, debug APK **163,425,048 bytes** (`sha256 1ecaa9c8…a773`) uploaded as `musiku-plus-debug-apk` (artifact archive 84,326,969 bytes), **APK secret scan PASS** (221 archive members decompressed and compared against the three configured backend secrets — none embedded), `GOOGLE_WEB_CLIENT_ID` baked in from the repository secret, release signing skipped as unconfigured. Full evidence and the security audit: [OAUTH_CICD_VERIFICATION.md](OAUTH_CICD_VERIFICATION.md).

> **Latest verified state (commit `20a44d1`, Animeku round, 2026-11-24).** Verify run [45393363566](https://github.com/HOOOOOOQ/MUSIKU-/actions/runs/45393363566): configuration audit (all required secrets detected, none missing, no value printed); backend build + **268 tests / 18 suites**; **Atlas integration LIVE — 13/13** against `musiku_plus_ci_test` (transactions, 3994 ms probe); admin **11 tests** + production build (10 routes); `npm audit` 0 vulnerabilities. Android run [45393363556](https://github.com/HOOOOOOQ/MUSIKU-/actions/runs/45393363556): self-healing `dart format` (pushed style commit `9a2c9f9`), analyze **"No issues found! (ran in 5.5s)"**, **53 tests across 10 files**, debug APK **163,517,924 bytes** (`sha256 05b1cadf…168c`) uploaded as `musiku-plus-debug-apk` (archive **84,412,675 bytes**, id 14919913360), **APK secret scan PASS** (221 members decompressed, 3 secret values compared, 4 credential patterns checked), release signing skipped as unconfigured. Animeku contract, configuration and security invariants: [ANIMEKU.md](ANIMEKU.md). The style commit's own runs are `action_required` (bot-authored commits need a human **Approve and run**; the agent token receives `403`), and the identical tree is verified by the pair above.

Everything below distinguishes three states: **verified** (executed and observed), **implemented but unverified** (code exists, needs live credentials), **gap** (code does not yet exist; credentials alone will not fix it).

## 1. Verified results

### 1.1 GitHub Actions — Android APK (`.github/workflows/android-build.yml`)

Run: https://github.com/HOOOOOOQ/MUSIKU-/actions/runs/45348016082 (commit `e2917e7`, `pull_request` event) — **conclusion: success**.

| Step | Result |
|---|---|
| actions/checkout@v5, setup-java@v5 (Temurin 17), subosito/flutter-action@v2 (stable) | success |
| Resolve packages (`flutter pub get`) | success |
| Check formatting (`dart format --output=none --set-exit-if-changed lib test`) | success |
| Analyze (`flutter analyze`) | success — **"No issues found! (ran in 5.6s)"** |
| Test (`flutter test`) | success — **18 tests** across 8 files |
| Build debug APK (`flutter build apk --debug`) | success — `mobile/build/app/outputs/flutter-apk/app-debug.apk` asserted non-empty |
| Upload artifact `musiku-plus-debug-apk` | success — **84,320,526 bytes** (ZIP container, `if-no-files-found: error`) |
| Check signing availability | success — `ready=false` (no signing secrets, PR event) |
| Build signed release APK / upload `musiku-plus-release-apk` | **skipped — release signing is not configured** |
| Remove signing material / Upload diagnostic logs | success / skipped (no failure) |

A real debug APK file now exists as a GitHub Actions artifact. It was produced by GitHub's runners; this sandbox has no Flutter/Dart/Java/Android SDK, so **no APK was ever built locally**.

Artifact download: the run's **Artifacts** section (`musiku-plus-debug-apk`). The archive download API URL is `https://api.github.com/repos/HOOOOOOQ/MUSIKU-/actions/artifacts/14896012186/zip` (owner authentication required; it was not downloaded here).

Caveats that matter before installing that APK:
- Repository variable `API_URL` was not set by the owner (the Actions variables API returns `403 Resource not accessible by integration` for this session), so the artifact embeds the deliberately nonfunctional default `https://api.example.invalid/api`. It cannot reach a real backend until `API_URL` is set and the APK is rebuilt.
- `GOOGLE_WEB_CLIENT_ID` was likewise unset, so the Google button is hidden in this artifact by design (no nonfunctional provider button is rendered).
- It is a **debug** build signed with the runner's debug key: not a distributable release artifact.

### 1.2 GitHub Actions — backend/admin (`.github/workflows/verify.yml`)

Run: https://github.com/HOOOOOOQ/MUSIKU-/actions/runs/45348016205 (commit `e2917e7`) — **success**. Jobs: `backend` (Node 22, `npm ci`, `npm run build`, `npm test` — 146 tests) and `admin` (Node 22, `npm ci`, `npm test`, `npm run build`). This workflow has been green on every commit of this branch, including 45348016205 for `e2917e7`: 45345204565, 45344818574, 45344330595, 45343933406, 45343054471, 45342691383, 45342291387, 45340616814, 45340564425, 45339850139, 45339775589, 45339330154.

### 1.3 Local execution in this sandbox

| Command | Result |
|---|---|
| `cd backend && npm run build` | PASS (TypeScript, 0 errors) |
| `cd backend && npm test` | PASS — **15 suites, 169 tests** (146 before the reuse-detection tests were added); re-run at `20a44d1` with `npx jest --runInBand`: **18 suites, 268 tests** |
| `cd backend && npm audit --omit=dev --audit-level=high` | PASS — 0 vulnerabilities |
| `cd admin && npm test` | PASS — 3 tests before the Animeku page; **11 tests** at `20a44d1` |
| `cd admin && npm run build` | PASS — Next.js production build, 10 dashboard routes at `20a44d1` (Animeku added) |
| `cd backend && npm run test:atlas:integration` (local) | SKIPPED with reason — `13 skipped`: this sandbox has no `MONGODB_URI`/JWT secrets, and the pre-flight records that instead of faking a pass |
| `npm run test:atlas:integration` in CI (run 45362942971) | **PASS — 13/13 live against MongoDB Atlas** (`musiku_plus_ci_test`, `mongodb+srv`, replica set, transactions exercised) |
| `flutter analyze` / `flutter test` / `flutter build apk` locally | **NOT RUN** — no Flutter/Dart/Java/Android SDK here; pub.dev, dl.google.com, services.gradle.org and repo.maven.apache.org are outside the network allowlist. GitHub Actions is the authoritative Flutter execution and it passed. |

### 1.4 CI failures found and fixed (evidence the pipeline really runs)

1. Run 45338327587 — `dart format --set-exit-if-changed` failed; all Dart sources formatted with a `dart_style`-compatible formatter.
2. Run 45338551153 — `flutter analyze` failed on `material.dart` export deprecation notices and missing braces in multiline `if`; fixed with explicit compatibility ignores and braces.
3. Run 45338810110 — analyzer error: `VideoPlayerController.seek` does not exist → replaced with `seekTo`; remaining brace infos fixed.
4. Run 45339330114 — Gradle script compilation errors from an outdated Android toolchain (AGP/Gradle/KGP below Flutter stable minimums) → aligned to AGP `9.3.1`, Gradle `9.5.0`, KGP `2.4.20`, `minSdk = flutter.minSdkVersion`, `kotlin { compilerOptions { jvmTarget = JVM_17 } }`.
5. Run 45339850020 — Kotlin DSL error `Unresolved reference 'util'`: the `java` project extension shadowed the `java.util` package → added a top-level `import java.util.Properties` and hardened release-signing detection.
6. Run 45340616795 — success (first green Android run, artifact 84,293,175 bytes).
7. Run 45342691264 — `flutter analyze` reported two unused imports: the premium/notification screens were imported but their `GoRoute`s were never inserted (a string patch had silently missed the reformatted router). Routes added; run 45343054434 went green (artifact 84,304,602 bytes).
8. Run 45343933409 — analyzer info: `ReorderableListView.onReorder` is deprecated in favour of `onReorderItem` in this Flutter version. `onReorderItem` is not available on every supported stable release, so the classic callback is kept with a documented `// ignore: deprecated_member_use` and the index correction lives in the pure helper `reorderedTrackIds`.
9. Run 45344330610 — `flutter test` failed 1/17: the playlist share assertion waited for a SnackBar that was queued behind earlier ones (`pumpAndSettle` does not drain SnackBar timers). The test now asserts the recorded platform `Clipboard.setData` call and its URL instead.
10. Run 45344818579 — analyzer error `Undefined name 'platformCalls'`: the previous patch had not matched the reformatted `setUp` block. Fixed with an exact edit.
11. Run 45345204617 — success: format, analyze (no issues), 17 tests, debug APK, artifact 84,329,106 bytes.
12. Run 45346690412 — analyzer info `curly_braces_in_flow_control_structures`: converting `_AuthState.build` to a block body deepened indentation, so the formatter split an `if (mounted) setState(...)` onto two lines. Braces added.
13. Run 45347277654 — `flutter test` failed 1/18: `AuthScreen` unconditionally watched the new Google-capability provider, so widget tests issued a real HTTP request during mount. The capability request is now made only when the build actually ships `GOOGLE_WEB_CLIENT_ID`, and the workflow's failure diagnostics were improved (`scripts/ci_notice.py` anchors the notice at the failing-test marker instead of emitting the log tail, which GitHub truncates).
14. Run 45348016082 — **success**: format, analyze (no issues), **18 tests**, debug APK, artifact **84,320,526 bytes**; release steps skipped (no signing secrets, PR event). Docs-only commit `14d78a2` re-ran both workflows green: Android run 45349000598 (artifact `musiku-plus-debug-apk`, 84,320,526 bytes) and Verify run 45349000671. PR #2's check list always shows the newest result.

Android runs 45339134473, 45339249111, 45339775474, 45340564428 and 45342291344 were superseded/cancelled by the workflow concurrency group when newer commits were pushed; `gh run cancel` returns `403 Resource not accessible by integration` for this session, so concurrency performed the cancellation. The Android workflow's own history is: 45339330114 fail → 45339850020 fail → 45340616795 **success** → 45342691264 fail → 45343054434 **success** → 45343933409 fail → 45344330610 fail → 45344818579 fail → 45345204617 **success**.

## 2. Feature status

### 2.1 Authentication (requirement 1)

| # | Feature | State | Where |
|---|---|---|---|
| 1 | Email + password | verified in tests | `POST /api/auth/register`, `/login`; Argon2/bcrypt-style hashing in `authService` |
| 2 | Google Sign-In OAuth 2.0 | implemented, **not live-verified** | Flutter `mobile/lib/core/google_auth.dart` (google_sign_in 6.3) → `POST /api/auth/google` → `backend/src/services/googleIdentity.ts` (`google-auth-library` `OAuth2Client.verifyIdToken`, audience/issuer/expiry/`sub`/verified-email checks). The button renders only when the build ships `GOOGLE_WEB_CLIENT_ID` **and** the public capability endpoint `GET /api/auth/providers` reports Google enabled, so a client can never offer a sign-in the backend would reject |
| 3 | Forgot password | verified in tests | `POST /api/auth/forgot-password` (non-enumerating response) |
| 4 | Reset password | verified in tests | `POST /api/auth/reset-password`, atomic single-use consumption (`$exists:false` + expiry), Flutter token screen `/auth-action` |
| 5 | Email verification | implemented, delivery unverified | `POST /api/auth/verify-email`, `/resend-verification`; SMTP via `emailService` |
| 6 | Refresh token rotation | verified in tests | `POST /api/auth/refresh`; exactly one concurrent refresh wins; old session revoked |
| 7 | Logout + revoke session | verified in tests | `POST /api/auth/logout`, `/revoke-all`, `DELETE /api/auth/sessions/:id`; access JWTs are session-bound (`sid`+`jti`) so revocation invalidates them immediately |
| 8 | Account deletion | implemented | `DELETE /api/auth/account`, `DELETE /api/users/account`; Flutter confirmation dialog in `/account-security` |
| 9 | Login history | implemented | `LoginHistory` model, `GET /api/users/login-history`, aggregated in admin integration status |
| 10 | Connected devices | implemented | `GET /api/users/devices`, `DELETE /api/users/devices/:deviceId`, random secure device ID persisted by the Flutter API client |

Rate limiting and replay protection: auth endpoints are rate-limited; each exchanged Google token hash is stored once in `oauth_replays` with a TTL to the token expiry, so a replayed ID token is rejected even concurrently (unique index). No raw Google token is stored or logged. Client-supplied email/user IDs are never trusted — identity comes only from the verified token payload.

Provider extensibility: `IdentityProvider` is an interface, `GoogleIdentityProvider` the only concrete implementation. **No Apple button is rendered** anywhere; Apple Sign-In can be added by implementing the interface plus a backend verifier. The Google button itself renders only when a build-time `GOOGLE_WEB_CLIENT_ID` exists.

### 2.2 API keys and providers (requirement 2)

Adapters implemented: **music** — Deezer, iTunes Search, MusicBrainz, LRCLIB, licensed-music slot; **anime** — **Animeku/Animasu catalog adapter** (`providers/anime/animasu.ts`: catalog, schedule, search, details, episodes, guarded stream resolution), AniList GraphQL, Jikan, licensed-anime slot. Orchestration in `providerManager` supports enable/disable, priority, timeout, retry with backoff, bounded in-memory cache (1000 entries), health checks, fallback and structured logging; `providers/context.ts` propagates per-request timeout/retry budget through `AsyncLocalStorage` into `providers/http.ts`.

- **Verified**: orchestration behaviour against controlled HTTP responses (9 provider tests + 11 provider-manager tests + 5 HTTP tests) and the Animeku adapter against a **fake fetcher** (29 normalization + 34 security + 26 API-integration tests). No live provider request was made — those hosts are outside this sandbox's allowlist, and no owner API keys exist.
- **Implemented, unverified**: SMTP (nodemailer, STARTTLS enforced for port 587, production fails closed with `503` when unconfigured), Stripe payments (official SDK, one-time premium Checkout, raw-body webhook with `constructEvent` signature verification, amount/currency/metadata checks, idempotent activation inside a MongoDB transaction).
- **Gap**: licensed music/anime adapters are extension slots that return no data even when a key+base URL pair is configured; `integrationStatus` reports `adapterReady: false` truthfully. Stream routes do not implement entitlement/DRM/session resolution. No distributed provider rate budget (single-process in-memory only).
- Credentials live only in backend environment variables. Nothing is embedded in the APK except the public `API_URL` and `GOOGLE_WEB_CLIENT_ID` build configuration. `backend/.env.example` contains no real credentials. A tracked-file scan for private keys, live secret keys, Atlas URIs with embedded passwords, Google API keys, GitHub PATs and Slack tokens found only an obvious unit-test placeholder, since renamed to `unit-only-payment-key`.

Startup configuration validation (`backend/src/config/env.ts`) rejects: partial SMTP, licensed-provider, payment and object-storage groups; unsupported `PAYMENT_PROVIDER` (only the implemented `stripe` adapter); `EMAIL_PROVIDER` values other than empty or `smtp` (the unused `EMAIL_API_KEY` variable was removed from the inventory rather than pretending an HTTP email adapter exists); a `REDIS_URL` that is not `redis://`/`rediss://` (Redis remains reserved and unwired, and the message says so); and a non-`mongodb+srv` `MONGODB_URI` in production. This is why `test:atlas` exits with a clear configuration error instead of silently passing, and it is covered by 8 dedicated tests.

### 2.3 Android release signing (requirement 4)

`scripts/configure_signing.py` decodes `ANDROID_KEYSTORE_BASE64` into `$RUNNER_TEMP/musiku-release.jks` (`chmod 600`, `umask 077`) and writes an escaped `mobile/android/key.properties`; the workflow builds release only on non-PR events when **all four** secrets exist, uploads only the exact APK path, and removes both files in a trap and an `if: always()` step. Passwords are never printed and the keystore is never an artifact. With no secrets the release steps are skipped and the summary states that release signing is not configured — no fake key is generated. `mobile/android/app/build.gradle.kts` falls back to the debug signing config so a release build is reproducible but obviously not distributable. **No signed release APK exists.**

### 2.4 MongoDB Atlas (requirement 7)

Sole primary database. Models with explicit collection names, `timestamps`, references, unique/sparse indexes (`email`, `username`, `googleId`), TTL declarations (sessions, replay hashes, verification/reset tokens), validation and pagination helpers cover users, sessions, login history, devices, OAuth linking, provider configuration, audit logs, system events, catalog, playlists, library, history, notifications, subscriptions, payments and download records. `npm run db:init` creates declared indexes; `scripts/verify-atlas.ts` performs a tagged probe document lifecycle against a real deployment. User data isolation is enforced by ownership filters plus `requireAuth`; Flutter never touches MongoDB — every access goes through the REST API. **Not verified against a real Atlas deployment**: no URI exists here, so index creation, transactions (used by the payment webhook) and TTL expiry are unproven at runtime.

### 2.5 Flutter feature surface

Splash/onboarding, email register/login, forgot/reset/verify token entry, Google sign-in (rendered only when the build ships a web client ID **and** `GET /api/auth/providers` confirms the backend can verify tokens; otherwise an explicit "not enabled on the backend" note is shown), authenticated-route redirect, home/browse/search/detail for music and anime, the **Animeku** section (home rails with continue-watching, paged catalogs, broadcast schedule with day chips, debounced search with history, detail with watchlist/favorites and derived-ordering notes, and a player that checkpoints progress every 15 s and renders an explicit playback-unavailable state), official preview playback with background media notification, video player with subtitle selection/speed/history checkpoints and resume, library (liked songs, watchlist, anime favourites, music/anime history, downloads list), **playlist management** (list owned/followed, create, reorder by drag, add/remove track, rename, visibility toggle, duplicate, follow/unfollow, copy share URL, delete, read-only shared view), **premium** (status, plans with rupiah pricing, real backend checkout that opens the provider-hosted payment page, cancel, payment history), **notifications** (list, mark read, mark all read, delete, nine preference switches), **account security** (sessions, devices, login history, per-session/device revocation, revoke all, resend verification, account deletion) and profile editing. Every control calls a real endpoint; there are no decorative buttons and no nonfunctional provider button.

### 2.6 Admin dashboard (requirement 8)

Next.js 15 + TypeScript, 10 routes (dashboard, users, catalog, providers, **Animeku**, subscriptions, settings, logs, integrations, login). The integrations page renders structured status rather than raw JSON: an integration table with configured/implementation/live-verified badges, an Atlas card with `HealthBadge` and ping latency, a GitHub build card linking the sanitized workflow run, authentication statistics with a 24h login-attempt table, a provider-health table and a **Run provider health checks** button that calls the admin-only `POST /api/providers/health-check`. `GET /api/admin/integration-status` returns: OAuth/email/payment/licensed-media configuration state with `liveVerified: false` until real checks pass, database ping, authentication statistics (email users, Google users, active sessions, 24h login aggregation by method/success), sanitized GitHub Actions build status for the Android workflow on `main` (server-side fetch, 60s cache, 4s timeout, optional backend-only `GITHUB_BUILD_TOKEN`; the token, raw payload and arbitrary caller-chosen URLs are never exposed), plus audit logs and feature flags pages. Provider credential fields are write-only; encrypted credential records are never returned to the browser. The **Animeku** page adds provider status, adapter-based upstream health probing, provider tuning (enable/disable, priority, timeouts, retries, cache TTL, rate limit), a live catalog/detail/episode inspector with a playback-authorization probe that never displays a media URL, and a persistence audit counting non-empty `streamUrl` values on stored episodes (must be 0). Dashboard tests cover the API client envelope/auth/error handling and the Animeku helpers (11 tests), not browser E2E.

### 2.7 Animeku (anime section, internal provider `animasu`)

**Implemented and tested against fakes; upstream never contacted; playback unauthorized by design.**

- Backend: `AnimasuProvider` adapter (provider-relative targeting with SSRF guards, https media allowlist, playback-authorization gate, URL redaction), `animeService` (catalog/schedule/search/details/episodes/stream/home/progress with normalization of episode numbering, ordering, schedule shapes, list payloads, types and ratings), `/api/anime/*` routes registered before `/:id`, `withAnimekuFallback` on `/anime/popular` and in universal search, metadata persistence that always writes `streamUrl: ''`, and startup validation that refuses `ANIMASU_STREAMING_AUTHORIZED=true` with an empty `ANIMASU_ALLOWED_STREAM_HOSTS`.
- Flutter: Animeku as the fifth tab with home/list/search/detail/player, provider links as encoded query parameters, `numberOf()`-tolerant payload reading, 15 s progress checkpoints, https-only media, no autoplay after resume, and honest error/empty/unauthorized states driven by the API envelope's `error.code`.
- Admin: the Animeku page described in §2.6, with `ApiRequestError` carrying the backend code so `403 STREAM_NOT_AUTHORIZED` is reported as the expected state of an unauthorized deployment rather than as a failure.
- **Gap**: no live provider call, no real playback session, no DRM/entitlement/subtitle licence path, per-process rate budget. Full contract and invariants: [ANIMEKU.md](ANIMEKU.md).

## 3. Tests actually executed

### 3.1 Backend — 268 tests, 18 suites, all passing locally and in CI (plus 13 live Atlas integration tests)

Animeku suites at `20a44d1` (re-run locally with `npx jest --runInBand`): `unit/animasuNormalization` **29**, `unit/animasuSecurity` **34**, `integration/animeku` **26**, `unit/envValidation` **24** (5 of them Animeku startup rules), `unit/providerManager` **11** (adapter-based Animeku health probe). 169 tests / 15 suites was the count before this round.

Auth/OAuth/security tests include: `uses Google library signature verification and configured audience`, `rejects invalid signature/library errors`, `links only verified existing email and records login/device`, `rejects unverified email linking`, `rejects suspended Google account`, `unique replay record rejects repeated exchange`, `refresh rotates tokens and revokes the old session`, `exactly one concurrent refresh succeeds`, `logout immediately invalidates access JWT through session binding`, `logout revokes the session`, `forgot + reset password flow works in development`, `forgot response does not disclose nonexistent account`, `change password requires the current password`, `registers a new user and returns tokens without password hash`, `rejects duplicate registration (409)`, `GET /api/auth/me returns profile + preferences`, `reports Google as unavailable without backend credentials and leaks no secret`,  plus API authorization/schema/pagination/crypto/provider regression suites, and a startup configuration suite (`accepts a minimal valid configuration`, `rejects unsupported EMAIL_PROVIDER values instead of ignoring them`, `requires SMTP credentials when EMAIL_PROVIDER=smtp`, `rejects a partial SMTP group`, `rejects a partial object storage group`, `rejects a non-redis REDIS_URL scheme`, `rejects unsupported payment gateways and partial payment groups`, `requires an Atlas SRV URI in production`), `SMTP enforces STARTTLS and includes actionable reset token`, `GitHub status maps only public safe fields and fixed main workflow URL`, and Stripe tests `refuses absent gateway credentials`, `rejects invalid webhook signature before persistence`, `valid signature for ignored event is acknowledged without DB access`, `tampered body with valid header rejected`.

**These are unit/API tests with fake persistence and a mocked Google verifier boundary.** They prove logic, not integration. Expired-token and invalid-signature behaviour is exercised through the mocked `google-auth-library` verifier, not through Google.

### 3.2 Flutter — 53 tests in 10 files, passing in CI (`flutter test`)

`api_test.dart` (record/list normalization, stable entity IDs), `google_auth_test.dart` (`Google button requires explicit backend confirmation`, `Google cancellation never calls backend`, `Google ID token exchanged for MUSIKU tokens only`), `http_client_test.dart` (`401 refresh rotates secure tokens and retries authorized request`), `navigation_test.dart` (`protected navigation redirects anonymous user to login`), `player_test.dart` (`preview player loads source and forwards transport controls`), `widgets_test.dart` (auth/register/reset modes, empty media list), `premium_notifications_test.dart` (`premium checkout reports unconfigured payment honestly`, `notification read, delete and preference controls call the API`), `animeku_test.dart` (payload helpers: episode numbering and ordering notes, schedule day picking including the empty-`Semua` skip, resume position, error-code classification, link encoding, duration formatting; widget tests: home rails and playback notice, notice hidden when media is authorized, retry on catalog failure, schedule day chips, debounced search with history chips, detail with watchlist/favorites, player states), `playlists_test.dart` (`reorder helper converts Flutter indices into persisted track order`, `playlist identity helpers tolerate unpopulated references`, `playlist list shows owned and followed sections`, `owner management actions call the playlist API`, `shared playlist opens read-only through its token`).

All of these use fakes for the API/identity/player/clipboard boundaries: no test proves a real Google Play services sign-in, a real payment, or behaviour on a physical device. No instrumentation/emulator tests exist.

### 3.3 Admin — 11 tests + production build, passing locally and in CI

Added with the Animeku page: provider-link query encoding, catalog kind/paging/type filters, playback-probe URL redaction (no `http`, host or `.m3u8` may appear in the probe result), `403 STREAM_NOT_AUTHORIZED` mapped to an unauthorized verdict, the persisted-media-URL audit counter, Animeku provider-record selection, the `PATCH` shape, and `ApiRequestError` carrying code + status.

## 4. Environment variables required

Backend (`backend/.env.example` is the full inventory; set on the hosting service, never in Git, never in Flutter):

| Group | Variables | Status |
|---|---|---|
| Database (required) | `MONGODB_URI` (`mongodb+srv://…`), `MONGODB_DB_NAME` | **missing here** |
| Tokens (required) | `JWT_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_EXPIRES`, `JWT_REFRESH_EXPIRES` | **missing here** |
| Server | `PORT`, `NODE_ENV`, `CLIENT_URL`, `ADMIN_URL` | defaults present |
| Google OAuth | `GOOGLE_CLIENT_ID` (web client ID = token audience), `GOOGLE_CLIENT_SECRET` (optional, backend-only) | **missing here** |
| Email | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SECURE`, `EMAIL_FROM`, `EMAIL_ACTION_URL` | **missing here** — production email actions return `503` until set |
| Payments | `PAYMENT_PROVIDER=stripe`, `PAYMENT_SECRET_KEY`, `PAYMENT_WEBHOOK_SECRET`, `PAYMENT_SUCCESS_URL`, `PAYMENT_CANCEL_URL` | **missing here** — checkout fails closed |
| Animeku (anime section) | `ANIMASU_BASE_URL`, `ANIMASU_ENABLED`, `ANIMASU_STREAMING_AUTHORIZED`, `ANIMASU_ALLOWED_STREAM_HOSTS`, `ANIMASU_TIMEOUT_MS`, `ANIMASU_CACHE_TTL_SEC`, `ANIMASU_RATE_LIMIT_PER_MIN` | defaults present; **no API key needed**. Playback stays `not_authorized` (`403 STREAM_NOT_AUTHORIZED`) until the rights switch **and** a non-empty host allowlist are set — startup refuses the switch alone |
| Licensed media | `LICENSED_MUSIC_API_KEY`/`_BASE_URL`, `LICENSED_ANIME_API_KEY`/`_BASE_URL` | **missing here**; adapters remain non-functional slots even when set |
| Storage (optional) | `STORAGE_ENDPOINT`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`, `STORAGE_BUCKET` | not configured |
| Admin bootstrap (seed) | `ADMIN_EMAIL`, `ADMIN_PASSWORD` (≥12 chars, no default) | not run |
| Optional | `GITHUB_BUILD_TOKEN` (fine-grained, Actions read, this repo only), `REDIS_URL` (reserved, unused) | not configured |

GitHub repository **Variables** (public build configuration): `API_URL`, `GOOGLE_WEB_CLIENT_ID`.
GitHub repository **Secrets** (release signing only): `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.
Setup instructions: `docs/GITHUB_ACTIONS_SETUP.md`, `docs/GOOGLE_OAUTH_SETUP.md`, `docs/PROVIDER_CONFIGURATION.md`, `docs/DEPLOYMENT.md`.

## 5. API providers and OAuth actually tested

| Integration | Live-tested? | What was executed instead |
|---|---|---|
| Deezer, iTunes Search, MusicBrainz, LRCLIB | **No** | adapter/manager tests against controlled HTTP responses (timeouts, retries, fallback, cache, health) |
| AniList GraphQL, Jikan | **No** | same |
| Animeku catalog (`animasu`) | **No** | 89 adapter/service/API tests against a **fake fetcher**: normalization (episode numbering/ordering, schedule shapes, list variants, types, ratings), security (SSRF target validation, blocked hosts, https media allowlist, authorization gate, URL redaction) and route behaviour including `403 STREAM_NOT_AUTHORIZED` before any network call. No live catalog fetch, no real media session |
| Licensed music/anime video/subtitle | **No** | none — placeholder adapters; `adapterReady: false` |
| Google OAuth | **No** | mocked `google-auth-library` verifier: signature/audience/issuer/expiry, verified-email linking, unverified/suspended rejection, replay rejection, token exchange; Flutter cancellation and exchange with a fake identity provider |
| SMTP email | **No** | transport construction (STARTTLS/secure/host) and message content assertion with a mocked transporter |
| Stripe payments | **No** | SDK checkout construction with fake key, raw-body webhook signature verification (valid/invalid/tampered), idempotent transactional activation logic against fake models |
| MongoDB Atlas | **No** | Mongoose schema/index/TTL contract tests and API tests against in-memory model fakes; `test:atlas` blocked by missing URI |
| GitHub Actions | **Yes** | both workflows executed on GitHub runners; debug APK artifact produced |

## 6. Owner actions required to close acceptance

1. **MongoDB Atlas**: create a replica-set deployment and least-privilege user, set `MONGODB_URI`/`MONGODB_DB_NAME`, run `npm run db:init`, `npm run seed` (explicit strong `ADMIN_PASSWORD`) and `npm run test:atlas` against an isolated test database; review any historical duplicate `googleId` values before the unique index applies.
2. **Google OAuth**: configure the consent screen, a **Web application** client (backend `GOOGLE_CLIENT_ID`) and an **Android** client for package `com.musikuplus.app` with the SHA-1 of the certificates you actually sign with; add `GOOGLE_WEB_CLIENT_ID` as a repository variable; then sign in on a physical device with Play services and a reachable HTTPS backend.
3. **SMTP**: provide host/port/user/password plus a verified sender and `EMAIL_ACTION_URL`; confirm verification and reset emails are delivered and that links/tokens complete the flow (hosted deep links/App Links are a remaining gap — the app currently offers a manual token screen).
4. **Stripe**: provide test-mode keys, register the webhook endpoint (`POST /api/premium/webhook`, raw body), and complete a real charge + webhook activation. Decide separately whether auto-renewing subscriptions, refunds/chargebacks, tax and reconciliation are in scope — they are **not implemented**.
5. **Android release signing**: add the four secrets through GitHub Settings → Secrets and variables → Actions (the agent's API access to secrets/variables returns `403`, and secrets must never be pasted into chat), then run the workflow on `main` or via `workflow_dispatch` to obtain `musiku-plus-release-apk`.
6. **Deploy the backend and set `API_URL`** so APK builds embed a reachable origin; rebuild and re-download the artifact.
7. **Licensed media**: supply agreements, API documentation, credentials and content-ID mapping; then implement the concrete adapters, entitlement checks and stream/DRM handling that do not exist yet.
8. **Animeku rights and live verification**: decide whether MUSIKU+ holds redistribution rights for the Animasu catalog. If yes, set `ANIMASU_STREAMING_AUTHORIZED=true` **and** `ANIMASU_ALLOWED_STREAM_HOSTS` to the exact https media hosts (startup refuses the switch alone), then verify a real playback session on a device and add entitlement/DRM handling. If no, leave the defaults: metadata stays available and media answers `403 STREAM_NOT_AUTHORIZED`. Either way, run one live smoke test against the upstream provider — CI never contacts it.
9. **Repository permissions**: grant the automation administrative access if CI secrets/variables or run cancellation should be manageable from this session. Approving bot-authored workflow runs (the `dart format` self-heal commits) also needs a human click in the Actions UI.

## 7. Remaining gaps (not fixed by credentials)

- Animeku video playback is unauthorized by design and unverified: no rights decision, no live upstream call, no real playback session, no DRM/entitlement/subtitle licence path, and media resolution stays allowlist-gated and temporary (never persisted, cached or logged).
- Licensed music/anime adapters and stream entitlement/DRM resolution are absent; downloads are record-keeping only (no transfer worker, offline entitlement/expiry engine or Flutter download manager).
- Payments cover one-time premium access; no subscription auto-renewal, refunds, chargebacks, tax or reconciliation. The Flutter premium screen opens the provider-hosted checkout URL and reports an explicit error when the backend has no payment credentials, rather than pretending a purchase succeeded.
- Email delivery is synchronous with no durable outbox: a delivery failure can leave an account registered until `/resend-verification` is used. No hosted App Links/email deep-link handler.
- Provider rate budgets and cache are per-process; no Redis-backed distributed enforcement (`REDIS_URL` is reserved and unused).
- Several Flutter management surfaces remain partial (synced lyric highlighting, cross-device queue synchronization, offline download manager, artist/album management screens). Premium checkout, notification management and playlist management (reorder, add/remove track, rename, visibility, duplicate, follow/unfollow, share-token copy, delete, shared read-only view) are implemented, but checkout cannot complete without a configured payment provider and no real purchase has been made.
- The share flow copies the backend share URL to the clipboard; hosted App Links / universal links that would open a shared playlist directly from a browser are not configured.
- Admin dashboard stores access tokens in `localStorage`; needs hardened session/CSP review. Dashboard tests are not browser E2E.
- No Android instrumentation/emulator tests, no load/performance testing, no production observability dashboards.
- The replay-protection design means a Google token can be exchanged only once: after a lost network response the user must obtain a fresh token (documented, intentional, but a UX constraint).

## 8. Acceptance checklist

| Criterion | Result |
|---|---|
| Google OAuth integrated (code path, backend verification) | implemented and tested; `GOOGLE_CLIENT_ID` + `GOOGLE_WEB_CLIENT_ID` detected in CI and the web client is the verified ID-token audience; **live on-device sign-in pending console registration for the test certificate and a deployed backend** |
| Email authentication functional | verified in tests; **live SMTP pending** |
| MongoDB Atlas connected and tested | **met** — `MONGODB_URI` secret is configured; CI connected live to `musiku_plus_ci_test` and **13/13 integration tests passed** (connection, register/login, Google linking, profile, music library, anime watch history, playlists, data isolation, transactions) |
| Provider configuration available | met (env validation, manager, docs); live provider calls not performed |
| Flutter connected with backend | implemented (Dio, secure storage, single-flight refresh, device ID); **no deployed backend to point at** |
| GitHub Actions workflow runs | **met** — both workflows green |
| Debug APK produced | **met** — `musiku-plus-debug-apk`; APK 163,517,924 bytes (`sha256 05b1cadf…168c`), artifact archive 84,412,675 bytes (run 45393363556); APK secret scan PASS |
| Animeku anime section | **implemented, tested against fakes, live-unverified** — 89 backend + 53 Flutter + 11 admin tests, CI green at `20a44d1`; playback intentionally unauthorized (`403 STREAM_NOT_AUTHORIZED`) until rights and a media host allowlist are configured |
| Release APK produced when signing secrets exist | **NOT met** — the four `ANDROID_*` secrets are absent; release steps skipped, not faked, and the release variant is now left **unsigned** instead of falling back to the debug keystore |
| Admin dashboard usable | builds and serves; live data requires deployed backend + Atlas |
| Setup documentation complete | met — GOOGLE_OAUTH_SETUP, GITHUB_ACTIONS_SETUP, **OAUTH_CICD_VERIFICATION**, PROVIDER_CONFIGURATION, DEPLOYMENT, VERIFICATION, **ANIMEKU** |
| No credentials leaked to GitHub | met — tracked-file scan and full 24-commit history scan clean; secrets only via GitHub Settings; per-build APK scan proves none is embedded in the artifact |
| All tests reported with real results | met — this document |

Atlas is now verified live. Because on-device Google sign-in, SMTP, Stripe, licensed media and release signing remain unverified — and no backend is deployed — the product must not be described as complete or production-ready.
