# GitHub Actions and Android artifacts

## Repository Secrets

Open `HOOOOOOQ/MUSIKU-` on GitHub → **Settings → Secrets and variables → Actions → Secrets → New repository secret**.

Add these only in GitHub's secret UI or an approved local secret-management process:

| Secret | Purpose |
|---|---|
| ANDROID_KEYSTORE_BASE64 | Base64 of your existing Android release keystore |
| ANDROID_KEYSTORE_PASSWORD | Keystore password |
| ANDROID_KEY_ALIAS | Existing key alias |
| ANDROID_KEY_PASSWORD | Private key password |

Do not send values in chat, put them in workflow YAML, or commit a keystore. Generate/choose release signing material under your organization's custody; this implementation does not invent a signing identity. Base64 is encoding, not encryption. Keep an offline backup of release signing material.

Release signing runs only on non-PR events when all four secrets are present. PRs, including fork PRs, build debug only. On push to main or manual dispatch with secrets, the workflow decodes the keystore under RUNNER_TEMP with restricted permissions, writes escaped Java-properties configuration, builds release and cleans both files on success or failure. Only exact APK paths are uploaded, never keystores. Passwords are not printed. GitHub's normal secret-masking remains enabled.

## Repository Variables (public build configuration)

Under **Secrets and variables → Actions → Variables**, add:

- `API_URL`: reachable HTTPS backend origin ending in `/api`.
- `GOOGLE_WEB_CLIENT_ID`: Google **Web** OAuth client ID, matching backend `GOOGLE_CLIENT_ID`.

These are public in the APK; do not put passwords, Atlas URIs, Google client secrets, payment or provider secret keys here. Without API_URL, a debug APK may compile using `https://api.example.invalid/api` but cannot contact a production backend. Without GOOGLE_WEB_CLIENT_ID, Google login is hidden.

## Backend environment is separate

Set Atlas, JWT, SMTP, provider and payment secrets on the backend hosting service, not in Flutter GitHub build variables. `backend/.env.example` is the inventory. Never use `NEXT_PUBLIC_` prefixes for these secrets. The admin uses the same backend via its server-side `BACKEND_URL` rewrite.

## Run and download

`.github/workflows/android-build.yml` triggers on main pushes, pull requests, and `workflow_dispatch`.

1. Open **Actions → Android APK → Run workflow**, select the intended branch and run. New workflows must be merged to the default branch before GitHub exposes them for normal manual dispatch; PR events can test them before merge.
2. Open the run. Wait for package resolution, format check, analysis, tests and APK build/upload to complete. A created run is not a successful build.
3. Download **musiku-plus-debug-apk** from the successful run's **Artifacts** section. If signing was configured on a non-PR run, download **musiku-plus-release-apk** too. Artifacts are ZIP containers holding APK files.
4. A failure uploads **musiku-plus-android-build-logs** when logs exist. Logs contain toolchain/package/test output, not intentionally printed signing values.

Build outputs: `mobile/build/app/outputs/flutter-apk/`. Installation is permitted only after trusting the APK source; a debug artifact is not a signed production distribution. Debug keystores may vary between runners: use/register a stable organization-managed development certificate for repeatable OAuth testing, or use a properly configured release certificate.

## GitHub Release

Only after a successful signed build and device testing: open **Releases → Draft a new release**, select an approved tag/commit, attach the verified release APK, include checksums/test results and publish according to repository policy. This workflow does not automatically publish releases or tags.

## Troubleshooting

- **Format failure**: run `dart format lib test`, commit changes, rerun. CI checks do not silently rewrite source.
- **Analyze/test failure**: inspect the failing step and diagnostic logs; fix source, don't skip checks.
- **No artifact**: build or upload did not succeed. Check run conclusion and output existence, not just workflow presence.
- **Release skipped**: missing/partial signing secrets or PR event. Debug should still run.
- **Keystore alias/password**: validate locally using keytool; do not echo secret values in CI.
- **OAuth error**: verify package name, exact certificate SHA and Web audience; see GOOGLE_OAUTH_SETUP.md.
- **Actions disabled/billing/approval**: repository owner must enable/approve Actions and provide runner capacity.
- **API 403 for secrets/variables**: automation may lack administrative permission. Owner must configure via Settings; do not share secret values with the agent.

The general `verify.yml` independently runs backend build/tests and admin tests/build. A green Node job is not proof that the Android workflow passed.
