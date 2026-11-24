# GitHub Actions setup — MUSIKU+

Two workflows run on this repository:

| Workflow | File | Jobs |
|---|---|---|
| **Android APK** | `.github/workflows/android-build.yml` | `config-audit`, `backend`, `atlas-integration`, `admin`, `android` (debug APK, optional signed release) |
| **Verify MUSIKU+** | `.github/workflows/verify.yml` | `backend`, `admin` (Node-only gate, kept for fast feedback) |

Both trigger on pushes to `main`, on pull requests, and manually via `workflow_dispatch`. Each workflow uses a concurrency group (`android-${{ github.ref }}` / `verify-${{ github.ref }}`, `cancel-in-progress: true`), so pushing a new commit cancels the superseded run.

Action versions are pinned to current Node-24 majors: `actions/checkout@v7`, `actions/setup-node@v7`, `actions/setup-java@v6`, `actions/upload-artifact@v7`, `subosito/flutter-action@v2`. (`upload-artifact@v4` still works but emits a *Node.js 20 is deprecated* warning; v7 also supports `archive: false` for direct single-file uploads, which is deliberately **not** used here because the required artifact name `musiku-plus-debug-apk` would be replaced by the file name.)

## 1. Secrets that already exist

These five repository secrets are **already configured** for `HOOOOOOQ/MUSIKU-`. Do not recreate or rename them; GitHub never reveals a stored value, and no value is printed by any workflow step.

| Secret | Consumed by | Purpose |
|---|---|---|
| `MONGODB_URI` | `atlas-integration` job only | Atlas connection string for the pre-flight probe and the live integration suite |
| `JWT_SECRET` | `atlas-integration` job only | Access-token signing key used by the integration suite |
| `JWT_REFRESH_SECRET` | `atlas-integration` job only | Refresh-token signing key (must differ from `JWT_SECRET`) |
| `GOOGLE_CLIENT_ID` | `config-audit` (presence/shape check only) | Android OAuth client ID |
| `GOOGLE_WEB_CLIENT_ID` | `config-audit`, and `android` as a public build-time define | Web OAuth client ID = ID-token audience verified by the backend |

How workflows consume them: per-step `env:` mapping with `${{ secrets.NAME }}`, scoped to the job that needs it. `MONGODB_URI`, `JWT_SECRET` and `JWT_REFRESH_SECRET` are **never** passed to `--dart-define` and never reach the Flutter or admin jobs.

Optional secrets, added later if needed:

| Secret | Purpose |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | Base64 of an existing release keystore |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password |
| `ANDROID_KEY_ALIAS` | Key alias |
| `ANDROID_KEY_PASSWORD` | Key password |
| `GOOGLE_CLIENT_SECRET` | Reserved for a future server-side authorization-code flow (backend only) |
| `GITHUB_BUILD_TOKEN` | Fine-grained Actions-read token for the admin build-status panel |
| `PAYMENT_SECRET_KEY`, `PAYMENT_WEBHOOK_SECRET`, `SMTP_PASSWORD`, `ADMIN_PASSWORD` | Deploy-time secrets for the backend host; used in CI only by the APK leak scan |

Repository **variables** (public build configuration, not secrets):

| Variable | Purpose |
|---|---|
| `API_BASE_URL` (or legacy `API_URL`) | HTTPS backend origin ending in `/api`, baked into the APK |
| `GOOGLE_WEB_CLIENT_ID` | Optional fallback when the value is stored as a variable instead of a secret |

Without `API_BASE_URL`/`API_URL` the APK embeds the deliberately non-functional `https://api.example.invalid/api` default and cannot reach a backend. Without a web client ID the Google button is hidden.

## 2. How each job uses configuration

- **`config-audit`** runs `scripts/audit_ci_config.py`. It reports *presence and shape only* — `present`, `missing`, `placeholder`, `invalid scheme`, `meets 32-character minimum`, `access and refresh use different keys` — and writes GitHub outputs (`atlas_ready`, `google_ready`, `jwt_ready`, `signing_ready`, `api_base_url_ready`, `all_required_ready`). No value is echoed, stored, uploaded or exposed. On `push`/`workflow_dispatch` (`STRICT=true`) it fails when a required item is missing; on pull requests it stays informational so fork PRs are not blocked.
- **`backend`** — `npm ci`, TypeScript build, hermetic test suite (fake persistence, no secrets needed), `npm audit --omit=dev --audit-level=high`.
- **`atlas-integration`** — the only job that receives `MONGODB_URI`/`JWT_SECRET`/`JWT_REFRESH_SECRET`. It runs `npm run test:atlas:integration`: first `scripts/atlas-preflight.ts` probes Atlas, then Jest runs the live suite. It writes to the isolated database `musiku_plus_ci_test` (`MONGODB_TEST_DB_NAME`), never to production data, and deletes everything it creates. When Atlas is unreachable, unauthorized for that database, or unconfigured, the pre-flight records the reason and the suite is reported as **skipped** — a skip is never presented as a pass.
- **`admin`** — `npm ci`, tests, production build, dependency audit.
- **`android`** — `needs: [backend, admin]`, so no APK is built when a mandatory gate failed. Steps: Java 17 (Temurin), Flutter stable, `flutter pub get`, `dart format --output=none --set-exit-if-changed lib test`, `flutter analyze`, `flutter test`, `flutter build apk --debug` with `--dart-define=API_BASE_URL=…` and `--dart-define=GOOGLE_WEB_CLIENT_ID=…`, an APK secret scan, APK metadata (size + SHA-256), and the artifact upload.

## 3. Running a workflow manually

1. GitHub → **Actions** → **Android APK** (or **Verify MUSIKU+**) → **Run workflow**.
2. Choose the branch (for release signing, `main`) and run it.
3. A workflow file must exist on the default branch before GitHub offers manual dispatch for it; pull-request events exercise it before merge.

## 4. Reading results and downloading artifacts

1. Open the run. Every job shows per-step conclusions; a green run means the steps really executed.
2. The run's **Summary** page contains: the configuration audit table, the Atlas pre-flight outcome, debug APK path/size/SHA-256, whether `API_BASE_URL` and `GOOGLE_WEB_CLIENT_ID` were baked in, the APK secret-scan result, and the release-signing status.
3. The same conclusions are emitted as **annotations**, so they can be read without downloading the log archive (which automation often cannot reach):
   ```sh
   JOB=$(gh run view <run-id> --json jobs --jq '.jobs[] | select(.name=="MongoDB Atlas integration") | .databaseId')
   gh api repos/HOOOOOOQ/MUSIKU-/check-runs/$JOB/annotations --jq '.[].message'
   gh api repos/HOOOOOOQ/MUSIKU-/actions/runs/<run-id>/artifacts --jq '.artifacts[] | "\(.name) \(.size_in_bytes)"'
   ```
   Example observed output: `Atlas integration ran LIVE against musiku_plus_ci_test | suites: 1 passed, 1 total | tests: 13 passed, 13 total | uri scheme: mongodb+srv | transactions: yes | latency: 3112 ms` and `APK secret scan :: PASS — 221 members decompressed, 3 secret values compared, 4 credential patterns checked, 163,425,048 byte artifact; no backend secret embedded`.
4. Download **`musiku-plus-debug-apk`** from the **Artifacts** section of a successful run (a ZIP containing `app-debug.apk`). With signing configured on a non-PR run, **`musiku-plus-release-apk`** also appears.
5. Artifact output paths in the workspace: `mobile/build/app/outputs/flutter-apk/app-debug.apk` and `app-release.apk`.
6. A failed run uploads **`musiku-plus-android-build-logs`** (`mobile/ci-logs/*.log`: toolchain, pub get, format, analyze, tests, build). `scripts/ci_notice.py` also emits an annotation anchored at the failing test or the Gradle `FAILURE` block, because GitHub truncates long annotations and keeps the head.

## 5. Release signing (optional, added later)

Add all four `ANDROID_*` secrets in one go; the release path activates only when every one is present **and** the event is not a pull request (fork PRs cannot read secrets).

1. Repository → **Settings → Secrets and variables → Actions → Secrets → New repository secret**.
2. Add `ANDROID_KEYSTORE_BASE64` (`base64 -w0 release.jks`), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.
3. Run the workflow on `main` (push or `workflow_dispatch`).
4. `scripts/configure_signing.py` decodes the keystore to `$RUNNER_TEMP/musiku-release.jks` with `0600` permissions under `umask 077`, writes an escaped `mobile/android/key.properties`, and both files are removed by a `trap` and by an `if: always()` cleanup step.
5. Only the exact APK path is uploaded. Keystores, `key.properties` and passwords are never artifacts and never printed; GitHub's secret masking stays on.

Guarantees in `mobile/android/app/build.gradle.kts`:

- Release signing comes **only** from that owner-supplied material. The debug keystore is deliberately **not** a fallback, so an unsigned build can never be mistaken for a distributable release.
- Without `key.properties`, no release signing config exists and CI simply skips the release steps, marking release as not configured. No signing key is generated by the pipeline.
- `.gitignore` excludes `*.jks`, `*.keystore`, `key.properties` and `local.properties`.

Base64 is encoding, not encryption. Keep an offline backup of release signing material; losing it means losing the ability to update the app.

## 6. Creating a GitHub Release

Only after a successful **signed** build and device testing: **Releases → Draft a new release**, pick an approved tag/commit, attach the verified `app-release.apk`, and include the SHA-256 from the run summary plus the test results. No workflow publishes releases or tags automatically.

## 7. Troubleshooting

- **Format failure**: run `dart format lib test` locally, commit, rerun. CI never rewrites source silently.
- **Analyze failure**: the analyzer emits one annotation per line; fix the source rather than relaxing analysis. Known Flutter-version-sensitive items are handled with narrowly scoped `// ignore:` comments and an explanatory note.
- **Test failure**: read the `Flutter tests` annotation (anchored at the failing test) or download `musiku-plus-android-build-logs`.
- **Gradle `Script compilation errors` about versions**: Flutter stable enforces minimums (currently AGP 9.3.1, Gradle 9.5.0, Kotlin 2.4.20, Java 17). Keep `mobile/android/settings.gradle.kts`, `gradle/wrapper/gradle-wrapper.properties` and `app/build.gradle.kts` aligned; never downgrade to silence the checker.
- **`Unresolved reference 'util'` in `build.gradle.kts`**: the Gradle `java` extension shadows the `java.util` package in Kotlin DSL. Add `import java.util.Properties` at the top of the script.
- **Atlas suite skipped**: read the `Atlas integration outcome` section of the job summary. Typical reasons: `MONGODB_URI` missing/placeholder; Atlas IP access list does not include GitHub runner addresses; DNS/network blocked; the database user is not authorized on `musiku_plus_ci_test` (grant `readWrite` on it, or set `MONGODB_TEST_DB_NAME` to a database the user may use). A skip is a real result, not a pass.
- **APK secret scan fails**: something backend-only was embedded in the app. Fix the build configuration — never weaken the scan.
- **Release steps skipped**: missing/partial signing secrets, or a pull-request event. The debug artifact is still produced.
- **OAuth `developer_error 10`**: package name, SHA-1 or web client mismatch — see [GOOGLE_OAUTH_SETUP.md](GOOGLE_OAUTH_SETUP.md). A CI debug APK is signed with the runner's ephemeral debug key, which is normally not registered in your Google project.
- **`403 Resource not accessible by integration`** when automation tries to list secrets/variables or cancel runs: the installation lacks administrative permission. Configure secrets through the web UI; a superseded run is cancelled by the concurrency group instead.
- **Actions disabled / billing / approval**: the repository owner must enable Actions and provide runner capacity.

## 8. Secret hygiene rules used here

- Never `echo` a secret, never print an environment value, never write one to a file that is uploaded.
- Never put a secret in workflow YAML, source code, `--dart-define`, `NEXT_PUBLIC_*`, or a committed `.env`.
- Never send a secret value through chat, an issue, a PR description or a screenshot. GitHub cannot show a stored value back; if a value was ever shared outside the secret store, **rotate it** — deleting a file from the latest commit does not remove it from Git history.
- Backend-only secrets stay in the backend job and on the backend host. The APK contains at most a public API origin and a public web client ID, and `scripts/scan_apk_secrets.py` verifies that on every build.
