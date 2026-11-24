# Verification and acceptance report

Date: 2026-11-24 · Branch `arena/47dd4ee9-musiku` · Verified code commit `e2917e7` · Companion narrative: [FINAL_IMPLEMENTATION_REPORT.md](FINAL_IMPLEMENTATION_REPORT.md).

This is a record of actual execution. It is **not** an assertion that all acceptance criteria are met.

## Executed

| Check | Result | Limits |
|---|---|---|
| CI `android-build.yml` run [45348016082](https://github.com/HOOOOOOQ/MUSIKU-/actions/runs/45348016082) | **SUCCESS** | `pull_request` event; debug only |
| ↳ `dart format --set-exit-if-changed lib test` | PASS | formatting only |
| ↳ `flutter analyze` | PASS — "No issues found! (ran in 6.6s)" | static analysis, not runtime |
| ↳ `flutter test` | PASS — **18 tests** in 8 files | widget/unit tests with fakes (API, identity, player, clipboard); no device, no Play services |
| ↳ `flutter build apk --debug` + artifact upload | PASS — `musiku-plus-debug-apk`, 84,320,526 bytes | debug-signed; embeds placeholder `API_URL` because the repository variable is unset |
| ↳ Release signing check / release build / release artifact | SKIPPED — `ready=false` | four signing secrets absent and PR event; **no signed release APK exists** |
| CI `verify.yml` run [45348016205](https://github.com/HOOOOOOQ/MUSIKU-/actions/runs/45348016205) | **SUCCESS** (green on every commit of this branch) | backend `npm ci`/build/test + admin `npm ci`/test/build on Node 22 |
| Backend `npm run build` (local) | PASS | TypeScript compilation |
| Backend `npm test` (local) | PASS — **15 suites, 146 tests** | unit + Supertest flows against in-memory model fakes and a mocked Google verifier; no real Atlas, no real Google/SMTP/Stripe |
| Mongoose schema/index/TTL contract tests | PASS (included above) | declarations, not server-side index creation |
| Stripe webhook signature tests | PASS (included above) | signature math against fake bodies; no live charge |
| SMTP transport test | PASS (included above) | mocked transporter; no message was delivered |
| GitHub build-status sanitizer test | PASS (included above) | mocked `fetch`; no private-repo token |
| Startup configuration validation tests | PASS — 8 tests (included above) | schema-level checks; no live service contact |
| Admin `npm test` (local + CI) | PASS — 3 tests | API client envelope/auth/error; not browser E2E |
| Admin `npm run build` (local + CI) | PASS | Next.js production build of 9 dashboard routes |
| `npm audit --omit=dev --audit-level=high` (backend) | PASS — 0 vulnerabilities | dependency advisories only, not a code security audit |
| Tracked-file credential scan | PASS — no private keys, live secret keys, Atlas URIs with passwords, Google API keys, GitHub PATs or Slack tokens | one obvious unit-test placeholder was renamed to `unit-only-payment-key` |
| Backend `npm run test:atlas` | **BLOCKED** | startup validation rejected absent `MONGODB_URI`/`JWT_SECRET`/`JWT_REFRESH_SECRET`; no real Atlas test has run |
| Local `flutter analyze` / `flutter test` / `flutter build apk` | **NOT RUN** | no Flutter/Dart/Java/Android SDK in this sandbox; pub.dev, dl.google.com, services.gradle.org and repo.maven.apache.org are outside the network allowlist. GitHub Actions is the authoritative Flutter execution. |

## CI history (real failures, real fixes)

| Run | Outcome | Cause and fix |
|---|---|---|
| 45338327587 | failed at format | Dart sources reformatted with a `dart_style`-compatible formatter |
| 45338551153 | failed at analyze | `material.dart` export deprecation notices + multiline `if` braces; compatibility ignores and braces added |
| 45338810110 | failed at analyze | `VideoPlayerController.seek` does not exist → `seekTo`; remaining brace infos fixed |
| 45339330114 | failed at debug build | Android toolchain below Flutter stable minimums → AGP 9.3.1, Gradle 9.5.0, KGP 2.4.20, `minSdk = flutter.minSdkVersion`, Kotlin `compilerOptions` JVM 17 |
| 45339850020 | failed at debug build | Kotlin DSL `Unresolved reference 'util'`: the `java` extension shadowed `java.util` → top-level `import java.util.Properties`, hardened signing detection |
| 45340616795 | **success** | first green Android run; debug APK artifact 84,293,175 bytes |
| 45342691264 | failed at analyze | two unused imports: premium/notification screens imported but their `GoRoute`s were never inserted (a text patch missed the reformatted router) → routes added |
| 45343054434 | **success** | debug APK artifact 84,304,602 bytes |
| 45343933409 | failed at analyze | `ReorderableListView.onReorder` deprecation info; kept with a documented ignore because `onReorderItem` is unavailable on some supported stable releases, index correction lives in `reorderedTrackIds` |
| 45344330610 | failed at test | playlist share assertion waited for a SnackBar queued behind earlier ones → now asserts the recorded `Clipboard.setData` call and URL |
| 45344818579 | failed at analyze | `Undefined name 'platformCalls'`: previous patch did not match the reformatted `setUp` block → exact edit applied |
| 45345204617 | **success** | format, analyze (no issues), 17 tests, debug APK artifact 84,329,106 bytes |
| 45346690412 | failed at analyze | block-body conversion deepened indentation, so the formatter split an `if (mounted) setState(...)`; braces added |
| 45347277654 | failed at test | `AuthScreen` watched the new Google-capability provider unconditionally, so widget tests issued a real HTTP request during mount → capability request now only when `GOOGLE_WEB_CLIENT_ID` is built in; `scripts/ci_notice.py` added so failing-test details survive GitHub's annotation truncation |
| 45348016082 | **success** | format, analyze (no issues), 18 tests, debug APK artifact 84,320,526 bytes |

Runs 45339134473, 45339249111, 45339775474, 45340564428 and 45342291344 were superseded/cancelled by the workflow concurrency group when newer commits were pushed (`gh run cancel` returns `403 Resource not accessible by integration`).

## Implemented source, not end-to-end verified

- Auth: register/login, public capability endpoint `GET /api/auth/providers` (no credentials exposed) that clients use to avoid rendering a provider the backend cannot verify, Google ID-token verification (`google-auth-library` signature/audience/issuer/expiry/`sub`/verified email), verified-email linking with unique sparse `googleId`, one-time replay hashes with TTL, refresh rotation with single-winner concurrency, session-bound access JWTs (`sid`+`jti`) so logout/device/session/password revocation invalidates tokens immediately, forgot/reset/verify with atomic single-use consumption, resend verification, account deletion, login history, connected devices, rate limiting.
- Identity extensibility: Flutter `IdentityProvider` abstraction with only Google implemented; no Apple button is rendered; no nonfunctional provider UI.
- Email: nodemailer SMTP with STARTTLS enforcement, production fail-closed `503` when unconfigured, no-op in dev/test.
- Payments: official Stripe SDK, one-time premium Checkout with idempotency key, raw-body webhook signature verification, amount/currency/metadata validation, idempotent activation inside a MongoDB transaction.
- Providers: Deezer, iTunes, MusicBrainz, LRCLIB, AniList, Jikan adapters; enable/disable, priority, timeout, retry/backoff, bounded cache, health checks, fallback, logging; `AsyncLocalStorage` request context propagating timeout/retry budgets; grouped startup configuration validation.
- Admin: login, dashboard statistics, users, provider management with write-only credentials, catalog, plans, settings/feature flags, logs, audit logs, integration status (OAuth/DB/auth stats/sanitized GitHub build status).
- Flutter: splash/onboarding, register/login/reset/verify token entry, Google sign-in (when configured), discovery/search/detail, likes/watchlist/favorites, playlists, library/history, profile, account security (sessions/devices/login history, revoke-all, delete account), premium plans/status/checkout via the provider-hosted payment page and payment history, notification list with mark-read/mark-all-read/delete plus nine preference switches, playlist management with drag reorder, add/remove track, rename, visibility, duplicate, follow/unfollow, share-token copy, delete and a read-only shared-playlist view, secure token storage, single-flight refresh + retry, audio playback with background media service, video player with subtitle selection/speed/history checkpoints. Authenticated routes are guarded by a router redirect; no nonfunctional provider button is rendered.

## Missing credentials / external dependencies

- Real Atlas deployment URI + least-privilege user + network access list. No live schema/index/transaction/TTL test has been performed.
- Google Cloud OAuth clients (Web + Android with actual SHA-1) and `GOOGLE_WEB_CLIENT_ID` repository variable.
- SMTP account and verified sender.
- Stripe account keys plus a registered webhook endpoint.
- Licensed full-track audio and anime video/subtitle agreements, documentation, keys, content-ID mapping, territorial/DRM requirements.
- Authorized object storage for licensed media.
- The four Android release signing secrets (must stay outside Git and outside chat).
- `API_URL` repository variable pointing at a deployed backend, so APK artifacts are usable.

## Known implementation gaps — credentials alone do not fix these

The strict full-product acceptance criteria are **not met**. In particular:

- Licensed music/anime adapters are extension slots returning empty data even when a key/base-URL pair is configured (`adapterReady: false` is reported truthfully). Stream routes do not implement provider entitlement, DRM or session resolution.
- Payments are one-time premium access: no subscription auto-renewal, refunds, chargebacks, tax handling or reconciliation.
- Email delivery is synchronous with no durable outbox; a failed send can leave an account registered until `/resend-verification` is used. Hosted App Links / email deep-link handling is absent — the mobile app offers a manual token screen.
- Replay protection means a Google ID token can be exchanged exactly once; after a lost network response the user must obtain a fresh token. No raw token is stored.
- Provider rate budgets and caches are per-process in-memory; there is no distributed enforcement (`REDIS_URL` is reserved and unused). Admin-configured provider `baseUrl` does not yet re-point the official-endpoint adapters dynamically.
- Downloads are record-keeping only: no licensed transfer worker, offline entitlement/expiry manager, protected media cache, resume/cancel engine or complete Flutter download manager.
- Flutter management surfaces remain partial: synced lyric highlighting, cross-device queue/repeat/shuffle synchronization, offline download manager, artist/album management screens. Playlist management (reorder/add/remove/rename/visibility/duplicate/follow/share/delete and a read-only shared view) is implemented; sharing copies the backend share URL because hosted App Links/universal links are not configured. Premium checkout, notification management and playlist management are implemented in the app, but checkout depends on a configured payment provider and no real purchase has been completed.
- Admin catalog/episodes are read-only; subscription management and notification campaign editors are incomplete; dashboard stores access tokens in `localStorage` and needs hardened session/CSP review.
- No Android instrumentation/emulator tests, no load/performance testing, no production observability. Multi-document transactions are not used in every atomic flow that would benefit (they are used for payment activation and require an Atlas replica set).
- Access JWTs without `sid` are accepted only when `NODE_ENV=test`, to keep legacy fixtures working; production requires session-bound tokens.

These gaps are reported explicitly rather than presenting partial implementation as a finished product. **MUSIKU+ must not be called production-ready** while Atlas, Google OAuth, SMTP, Stripe and release signing remain unverified.
