# MUSIKU+

Flutter + Express/TypeScript + MongoDB Atlas + Next.js music/anime application.

**Acceptance status: incomplete, not production-ready — but the database layer is verified live and the Animeku anime section is implemented end to end.** Both CI workflows pass on GitHub runners at head `b067ad0` (all five PR checks green; every docs-only follow-up re-verifies them): `verify.yml` ([run 45397567881](https://github.com/HOOOOOOQ/MUSIKU-/actions/runs/45397567881)) runs a secret-presence audit, the backend build + **268 tests / 18 suites**, the **MongoDB Atlas integration suite live against `musiku_plus_ci_test` (13/13 passing, replica-set transactions included, 2945 ms probe)** and the admin tests (**11**) + production build; `android-build.yml` ([run 45397567853](https://github.com/HOOOOOOQ/MUSIKU-/actions/runs/45397567853)) runs a self-healing `dart format` (canonical — no fix-up needed), `flutter analyze` (**"No issues found! (ran in 5.6s)"**), **53 Flutter tests across 10 files**, builds the debug APK artifact `musiku-plus-debug-apk` (APK 163,517,924 bytes, `sha256 1119667b…15c0`; artifact archive 84,412,675 bytes) and **proves by scan that no backend secret is embedded in it** (221 archive members decompressed, 3 secret values compared, 4 credential patterns checked).

Repository secrets `MONGODB_URI`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `GOOGLE_CLIENT_ID` and `GOOGLE_WEB_CLIENT_ID` are configured and consumed by CI without any value being printed. **Animeku** — backend adapter/service/routes (**89 dedicated tests**: 29 normalization, 34 security, 26 API integration), a Flutter section with its own player and progress checkpointing, and an admin management page — is implemented, but **no live upstream provider request is exercised by CI** (the adapter is tested through a fake fetcher) and **video playback stays unauthorized by design**: media answers `403 STREAM_NOT_AUTHORIZED` until an operator asserts distribution rights (`ANIMASU_STREAMING_AUTHORIZED=true`) *and* allow-lists the media hosts. Still **unverified**: live Google sign-in on a device (needs console registration for the test certificate and a deployed backend), SMTP delivery, Stripe charging, licensed media, and a **signed release APK** (the four `ANDROID_*` signing secrets are absent, so release builds stay unsigned — the debug keystore is never used as a release key). Read [OAUTH_CICD_VERIFICATION.md](docs/OAUTH_CICD_VERIFICATION.md) for the credential/CI evidence, [FINAL_IMPLEMENTATION_REPORT.md](docs/FINAL_IMPLEMENTATION_REPORT.md) for what is verified versus pending, and [VERIFICATION.md](docs/VERIFICATION.md) for gaps that credentials alone will not fix.

## Repository

- `backend/`: Express REST API, Mongoose models, authentication, provider adapters, catalog, library/history, administration, tests.
- `admin/`: Next.js dashboard consuming the same API; no database connection in browser code. Includes a dedicated **Animeku** page (provider status, upstream health, tuning, catalog/episode inspector, persistence audit).
- `mobile/`: Material 3/Riverpod/GoRouter client with Dio, secure token storage, Google Sign-In, just_audio/audio_service, video_player, premium checkout, notification management, playlist management, account security (sessions/devices/login history/deletion), the **Animeku** anime section (home, catalog, schedule, search, detail, player with progress checkpointing), and Android configuration pinned to AGP 9.3.1 / Gradle 9.5.0 / Kotlin 2.4.20.
- `.github/workflows/verify.yml`: configuration audit (presence/shape only, never values) + backend build/tests + **Atlas integration against the real cluster** + admin tests/build on Node 22. Executed on GitHub: [success](https://github.com/HOOOOOOQ/MUSIKU-/actions/runs/45362942971).
- `.github/workflows/android-build.yml`: Java 17 + Flutter stable; `pub get`, a **self-healing `dart format` step** (a canonical tree passes `--set-exit-if-changed`; on same-repo `push`/`pull_request` runs a non-canonical tree is reformatted and pushed as a `style(mobile) … [skip ci]` commit — the healing run itself continues and verifies the formatted tree, and `[skip ci]` avoids creating bot-authored runs that GitHub gates behind a human approval click; on fork PRs the offending files are reported and the job fails), `flutter analyze`, `flutter test`, debug APK, **APK secret scan**, artifact `musiku-plus-debug-apk`; optional signed release (`musiku-plus-release-apk`) only when all four `ANDROID_*` signing secrets exist on a non-PR event, with secure decode/cleanup and failure diagnostics. Executed on GitHub: [success (debug only)](https://github.com/HOOOOOOQ/MUSIKU-/actions/runs/45362943525).
- `scripts/configure_signing.py`: CI-only keystore decode and escaped `key.properties` generation; never prints secret values.
- `scripts/audit_ci_config.py`: reports whether required/optional configuration exists and has a plausible shape — names, booleans and categories only, never values.
- `scripts/scan_apk_secrets.py`: decompresses every APK member and fails the build if a backend secret value or credential pattern (`mongodb+srv://…`, `GOCSPX-…`, PEM keys, packaged keystores) is embedded.
- `docs/ANIMEKU.md`: the Animeku contract — configuration, playback authorization, endpoints, error codes, security invariants, normalization, persistence and verification status.
- `scripts/report_atlas_outcome.py`: publishes the honest Atlas result (live run vs. documented skip, with counts) as a CI annotation and job summary.
- `backend/scripts/atlas-preflight.ts` + `backend/tests/atlas/`: real-database integration suite that skips with a recorded reason when Atlas is unavailable, instead of reporting a false pass.

## Backend

Node 22 recommended.

```sh
cd backend
npm ci
cp .env.example .env
# Set your actual Atlas URI, independent strong JWT secrets, and admin bootstrap password.
npm run db:init
npm run seed
npm run build
npm start
```

Never put `.env` in Git. Seed requires an explicit unique `ADMIN_PASSWORD` (12+ characters); there is no usable default admin password. Seeding installs provider configuration and taxonomy, not fabricated user/catalog data. Do not run seed with production credentials until you have reviewed the configured provider terms.

MongoDB Atlas is the only primary database. Models use explicit collection names, `timestamps: true`, references and indexes. See [deployment](docs/DEPLOYMENT.md) for Atlas least-privilege/TLS/network requirements.

```sh
npm test                 # isolated unit/API/auth/schema tests; fake persistence, not Atlas
npm run test:atlas       # real Atlas ping/index initialization/isolated CRUD; needs .env
```

## Animeku

Animeku is the anime section of MUSIKU+: catalog (popular/ongoing/completed), broadcast schedule, search, details, episode lists, watchlist/favorites and watch progress, served by `/api/anime/*` and rendered as the fifth app tab. The upstream catalog provider is internally called `animasu`; Flutter never calls it directly, never sees a provider credential and never touches MongoDB.

```sh
# backend/.env — metadata needs no API key; the base URL must be an https origin
ANIMASU_BASE_URL=https://api.nexadev.my.id/animasu
ANIMASU_ENABLED=true
# Distribution-rights switch. A provider returning a video URL is NOT proof of rights.
ANIMASU_STREAMING_AUTHORIZED=false
# Required (non-empty) when authorization is on; startup fails otherwise.
ANIMASU_ALLOWED_STREAM_HOSTS=
ANIMASU_TIMEOUT_MS=10000
ANIMASU_CACHE_TTL_SEC=900
ANIMASU_RATE_LIMIT_PER_MIN=60
```

Playback is conditional by design. While `ANIMASU_STREAMING_AUTHORIZED=false`, `/anime/status` reports `playback: "not_authorized"`, metadata keeps working and every media request answers `403 STREAM_NOT_AUTHORIZED` **before any network call** — the player renders that honestly instead of a black rectangle. When it is on, resolved media must be `https` and on the host allowlist (`403 STREAM_HOST_NOT_ALLOWED` otherwise), and media URLs are never persisted, cached or logged: episode documents are stored with `streamUrl: ''` and resolved per playback session. Provider links always travel as encoded query parameters, provider-relative targets are validated against SSRF, and upstream URLs are redacted in errors and logs.

The admin dashboard's **Animeku** page shows the asserted status, probes upstream health through the adapter, tunes the provider record, inspects live catalog/details/episode normalization (including how episode numbers were derived), probes playback authorization without ever displaying a media URL, and audits persisted episodes for stored media URLs — which must be zero.

Full contract, normalization rules, error codes and verification status: [ANIMEKU.md](docs/ANIMEKU.md).

## Admin

```sh
cd admin
npm ci
cp .env.example .env.local
# BACKEND_URL is a server-only API origin. Default: http://127.0.0.1:3000
npm run dev -- --hostname 0.0.0.0
```

Open port 3001. Requests use a same-origin `/api` rewrite; browser requests do not call localhost. Login with the administrator created by seed. The API enforces role checks regardless of dashboard UI. Provider credentials are write-only inputs; encrypted credential records are never sent to the client.

```sh
npm test
npm run build
```

## Android

Requires Flutter stable with Dart >=3.6, JDK 17, Android SDK, and network access to pub.dev/Google Maven/Gradle distribution servers.

```sh
cd mobile
flutter pub get
flutter analyze
flutter test
flutter run --dart-define=API_URL=https://YOUR_API_HOST/api
flutter build apk --debug --dart-define=API_URL=https://YOUR_API_HOST/api
```

Use a reachable HTTPS API endpoint, not localhost on a physical device. The default API URL is deliberately nonfunctional (`example.invalid`), not a fake active integration.

The Android Gradle wrapper is included. For a signed release, create local `mobile/android/key.properties` with `storeFile`, `storePassword`, `keyAlias`, `keyPassword`, point it to your own keystore, then run:

```sh
flutter build apk --release --dart-define=API_URL=https://YOUR_API_HOST/api
```

Keystores/signing properties are ignored by Git. Build outputs are `mobile/build/app/outputs/flutter-apk/app-debug.apk` and `app-release.apk`. `app-debug.apk` currently exists **only as a GitHub Actions artifact** from run 45348016082 (this sandbox cannot build it locally); no signed `app-release.apk` exists because the four signing secrets are not configured. The Android toolchain is pinned to AGP 9.3.1 / Gradle 9.5.0 / Kotlin 2.4.20 to satisfy Flutter stable's minimums.

## Media and commercial integrations

Deezer/iTunes adapters expose public metadata/preview URLs; MusicBrainz metadata, LRCLIB lyrics, AniList/Jikan metadata adapters are included. The Animeku catalog adapter (`animasu`) is metadata-first as well: video playback stays disabled until the operator asserts distribution rights and allow-lists media hosts. These integrations were tested against controlled HTTP responses, not live providers in this restricted environment. Public availability does not itself grant commercial redistribution rights. See [PROVIDER_CONFIGURATION.md](docs/PROVIDER_CONFIGURATION.md) for every provider, its variables and its honest readiness state.

Full-track music, anime video, offline licensing, payment processing, email delivery and Google sign-in require provider agreements/configuration and in some cases additional concrete adapters, not merely an API key. No DRM bypass or unauthorized video source is implemented. See the exact gaps in [VERIFICATION.md](docs/VERIFICATION.md).
