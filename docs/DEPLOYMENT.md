# Deployment and secrets

Do not deploy as production until the open acceptance/security gaps in VERIFICATION.md are resolved.

## Atlas

1. Create an Atlas deployment supporting transactions (replica set), database `musiku_plus`.
2. Create a dedicated database user with only the required read/write privileges on that database. Use a separate provisioning identity if application index creation is not permitted.
3. Restrict Atlas network access to backend egress addresses/private endpoints. Do not permit 0.0.0.0/0 as a permanent configuration.
4. Use the Atlas `mongodb+srv://` TLS connection string in backend-only `MONGODB_URI`. Never ship this to admin/Flutter.
5. Set independent high-entropy JWT secrets, configure CORS origins, and configure reverse-proxy TLS. Review `trust proxy` against the actual proxy topology to prevent rate-limit bypass.
6. Run `npm run db:init` and `npm run seed` with an explicit strong `ADMIN_PASSWORD`. These operations do not prove end-user flows; run `npm run test:atlas` against an isolated test database first.
7. Configure backups, restore drills, alerts, credential rotation and Atlas metrics. Atlas account/network policies are infrastructure configuration, not something repository code can silently provision.

The Atlas probe writes a uniquely tagged document to `_integration_probes`, reads/updates it and deletes it in a finally block. Run against a test database, not a production deployment without approval. It initializes declared indexes but does not drop collections or run destructive migrations.

## Services

- Deploy backend as a long-running Node 22 service with network access to Atlas and approved provider endpoints. Health endpoint `/health` is process liveness, not proof of database availability. Admin dashboard's database health invokes a DB ping.
- Deploy `admin/` with `BACKEND_URL` pointing to the backend origin; `/api/:path*` proxies requests server-side. `NEXT_PUBLIC_API_URL` should normally be empty. Only deliberately public configuration belongs in `NEXT_PUBLIC_*` variables.
- Deploy with HTTPS and a restrictive proxy policy. Never cache authenticated/private API responses in public CDNs.
- Build mobile with the reachable HTTPS API origin ending in `/api` through `--dart-define=API_URL=...`, or set the `API_URL` GitHub repository variable so CI artifacts embed it. Artifacts built without that variable use the nonfunctional `https://api.example.invalid/api` default and cannot reach a backend. `GOOGLE_WEB_CLIENT_ID` (public web client ID) must also be provided at build time for the Google button to appear.
- `REDIS_URL` is reserved configuration; current provider cache uses bounded in-process memory, not an active Redis adapter, so provider rate budgets are per-instance only. Run multiple backend instances behind a load balancer only after adding distributed enforcement.
- Optional backend-only `GITHUB_BUILD_TOKEN` (fine-grained, Actions read, this repository) lets the admin integration page show sanitized Android workflow status for `main`; it is never returned to the browser and public repositories can omit it.

## Licensed media

No licensed provider is selected by this repository. Obtain API documentation, territorial rights, audio/video redistribution and offline rights first. Implement the concrete adapter against that contract, map provider IDs safely, enforce user entitlement and validate stream expiration/DRM. Metadata API access does not grant full-track audio or video distribution rights. Check commercial terms and attribution requirements for every public metadata/lyrics/preview provider as well.

## Signing

Store release signing material in a secure local file or CI secret store. Android reads the ignored `mobile/android/key.properties`:

```properties
storeFile=/absolute/path/to/release-keystore.jks
storePassword=
keyAlias=
keyPassword=
```

Do not fill secrets in documentation or commit a real signing properties file. Debug APKs are for testing only.

In CI, add the four repository secrets (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`) via GitHub Settings; `scripts/configure_signing.py` decodes the keystore into `$RUNNER_TEMP` with `0600` permissions, writes an escaped `mobile/android/key.properties`, and both files are deleted on success and failure. Release builds run only on non-PR events with all four secrets present and upload exactly `musiku-plus-release-apk`; the keystore is never an artifact and passwords are never printed. **Today no signing secrets are configured, so CI produces only the debug artifact** (`musiku-plus-debug-apk`, run 45340616795) and release publication is not configured. Without `storeFile`, `build.gradle.kts` falls back to the debug signing config so a local release build remains reproducible but obviously non-distributable.
