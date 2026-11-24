# MUSIKU+

Flutter + Express/TypeScript + MongoDB Atlas + Next.js music/anime application.

**Acceptance status: incomplete, not production-ready.** The repository contains executable backend/admin code and a Flutter client implementation, but does not yet satisfy the entire full-product specification. No APK has been produced. See [verification and gaps](docs/VERIFICATION.md) before deploying. Missing implementation is distinguished from missing credentials there.

## Repository

- `backend/`: Express REST API, Mongoose models, authentication, provider adapters, catalog, library/history, administration, tests.
- `admin/`: Next.js dashboard consuming the same API; no database connection in browser code.
- `mobile/`: Material 3/Riverpod/GoRouter client with Dio, secure token storage, just_audio/audio_service, video_player, and Android configuration.
- `.github/workflows/verify.yml`: backend/admin verification plus Flutter analysis/tests/debug APK job. Workflow exists but has not been run in GitHub in this session.

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

Keystores/signing properties are ignored by Git. Expected output paths after a successful real build are `mobile/build/app/outputs/flutter-apk/app-debug.apk` and `app-release.apk`; **neither currently exists**.

## Media and commercial integrations

Deezer/iTunes adapters expose public metadata/preview URLs; MusicBrainz metadata, LRCLIB lyrics, AniList/Jikan metadata adapters are included. These integrations were tested against controlled HTTP responses, not live providers in this restricted environment. Public availability does not itself grant commercial redistribution rights.

Full-track music, anime video, offline licensing, payment processing, email delivery and Google sign-in require provider agreements/configuration and in some cases additional concrete adapters, not merely an API key. No DRM bypass or unauthorized video source is implemented. See the exact gaps in [VERIFICATION.md](docs/VERIFICATION.md).
