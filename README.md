# MUSIKU+

Flutter + Express/TypeScript + MongoDB Atlas + Next.js music/anime application.

**Acceptance status: incomplete, not production-ready.** Both CI workflows pass on GitHub runners and a real **debug APK artifact** (`musiku-plus-debug-apk`, 84,293,175 bytes) was produced by [`android-build.yml`](https://github.com/HOOOOOOQ/MUSIKU-/actions/runs/45340616795); backend (137 tests / 14 suites), admin (3 tests + production build), `flutter analyze` (no issues) and `flutter test` all pass. **Release signing is not configured**, and MongoDB Atlas, Google OAuth, SMTP, Stripe and licensed media remain **unverified because no owner credentials exist**. Read [FINAL_IMPLEMENTATION_REPORT.md](docs/FINAL_IMPLEMENTATION_REPORT.md) for what is verified versus pending, and [VERIFICATION.md](docs/VERIFICATION.md) for gaps that credentials alone will not fix.

## Repository

- `backend/`: Express REST API, Mongoose models, authentication, provider adapters, catalog, library/history, administration, tests.
- `admin/`: Next.js dashboard consuming the same API; no database connection in browser code.
- `mobile/`: Material 3/Riverpod/GoRouter client with Dio, secure token storage, Google Sign-In, just_audio/audio_service, video_player, premium checkout, notification management, account security (sessions/devices/login history/deletion), and Android configuration pinned to AGP 9.3.1 / Gradle 9.5.0 / Kotlin 2.4.20.
- `.github/workflows/verify.yml`: backend build/tests + admin tests/build on Node 22. Executed on GitHub: [success](https://github.com/HOOOOOOQ/MUSIKU-/actions/runs/45340616814).
- `.github/workflows/android-build.yml`: Java 17 + Flutter stable; `pub get`, `dart format --set-exit-if-changed`, `flutter analyze`, `flutter test`, debug APK, artifact `musiku-plus-debug-apk`; optional signed release (`musiku-plus-release-apk`) only when all four `ANDROID_*` signing secrets exist on a non-PR event, with secure decode/cleanup and failure diagnostics. Executed on GitHub: [success (debug only)](https://github.com/HOOOOOOQ/MUSIKU-/actions/runs/45340616795).
- `scripts/configure_signing.py`: CI-only keystore decode and escaped `key.properties` generation; never prints secret values.

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

Keystores/signing properties are ignored by Git. Build outputs are `mobile/build/app/outputs/flutter-apk/app-debug.apk` and `app-release.apk`. `app-debug.apk` currently exists **only as a GitHub Actions artifact** from run 45340616795 (this sandbox cannot build it locally); no signed `app-release.apk` exists because the four signing secrets are not configured. The Android toolchain is pinned to AGP 9.3.1 / Gradle 9.5.0 / Kotlin 2.4.20 to satisfy Flutter stable's minimums.

## Media and commercial integrations

Deezer/iTunes adapters expose public metadata/preview URLs; MusicBrainz metadata, LRCLIB lyrics, AniList/Jikan metadata adapters are included. These integrations were tested against controlled HTTP responses, not live providers in this restricted environment. Public availability does not itself grant commercial redistribution rights. See [PROVIDER_CONFIGURATION.md](docs/PROVIDER_CONFIGURATION.md) for every provider, its variables and its honest readiness state.

Full-track music, anime video, offline licensing, payment processing, email delivery and Google sign-in require provider agreements/configuration and in some cases additional concrete adapters, not merely an API key. No DRM bypass or unauthorized video source is implemented. See the exact gaps in [VERIFICATION.md](docs/VERIFICATION.md).
