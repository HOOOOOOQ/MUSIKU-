# Provider configuration inventory

Secrets belong only in backend environment or write-only protected provider credential endpoints. Admin/browser responses show booleans/status, never credential values. Public client IDs/API origins are not secrets. `GET /api/admin/integration-status` is admin-only and differentiates configuration from successful live testing.

| Provider | Setup and actual implementation |
|---|---|
| Deezer | Public metadata/preview adapter, seed `deezer`, no fabricated key. Confirm current API access and preview usage terms for your app. |
| iTunes | Public Search API, seed `itunes`, metadata and previews only. Observe Apple attribution/preview restrictions. |
| MusicBrainz | Public metadata adapter with identifying User-Agent; respect API rate policies. No audio. |
| LRCLIB | Public lyrics adapter; check lyric usage/redistribution permissions. |
| AniList | Public GraphQL metadata, not anime streaming. |
| Jikan | Public REST metadata/schedule fallback, not licensed video. |
| Animeku (provider `animasu`) | Catalog adapter for the Animeku section: popular/ongoing/completed, schedule, search, details, episode lists. Seeded as `providerId: animasu`, `type: animeku`, `authMethod: none`; no API key. Backend-only `ANIMASU_BASE_URL` (https origin enforced at startup, credentials in the URL rejected), `ANIMASU_ENABLED`, `ANIMASU_TIMEOUT_MS`, `ANIMASU_CACHE_TTL_SEC`, `ANIMASU_RATE_LIMIT_PER_MIN`. **Video playback is gated on `ANIMASU_STREAMING_AUTHORIZED=true` plus a non-empty `ANIMASU_ALLOWED_STREAM_HOSTS`** — a provider that returns a video URL is not proof of distribution rights, and startup refuses the switch with an empty allowlist. Unauthorized deployments answer `403 STREAM_NOT_AUTHORIZED` for media before any network call while metadata keeps working. Resolved media must be https and allow-listed (`403 STREAM_HOST_NOT_ALLOWED`), media URLs are never persisted/cached/logged (episodes store `streamUrl: ''`), provider links are validated as provider-relative paths against SSRF, and upstream URLs are redacted in errors and logs. No live provider request is exercised by CI; adapters are tested against a fake fetcher. See [ANIMEKU.md](ANIMEKU.md). |
| Licensed music/video/subtitles | No vendor contract supplied. LICENSED_MUSIC_API_KEY/BASE_URL and LICENSED_ANIME_API_KEY/BASE_URL are paired config slots; concrete adapters remain incomplete. They must not be represented as working simply because keys are present. Subtitle playback consumes authorized SRT/WebVTT URLs from a future licensed provider, with no MUSIKU bearer token sent to the subtitle host. |
| Google | GOOGLE_CLIENT_ID is the Web OAuth audience; google-auth-library verifies ID-token signatures/claims. GOOGLE_CLIENT_SECRET is not needed for this flow. See GOOGLE_OAUTH_SETUP.md. |
| SMTP | SMTP_HOST, SMTP_PORT (587), SMTP_USER, SMTP_PASSWORD, SMTP_SECURE=false uses mandatory STARTTLS. For implicit TLS port 465 set SMTP_SECURE=true. Set verified EMAIL_FROM and EMAIL_ACTION_URL. The mobile reset/verification screen accepts tokens from the email; automatic App Link routing/hosted action page is not implemented, so customize the URL only if your own handler exists. |
| Stripe | PAYMENT_PROVIDER=stripe, PAYMENT_SECRET_KEY, PAYMENT_WEBHOOK_SECRET, PAYMENT_SUCCESS_URL, PAYMENT_CANCEL_URL. Checkout grants one-time monthly/yearly access, not automatically renewed billing. Configure Stripe webhook URL `https://YOUR_API/api/premium/webhook`, events checkout.session.completed and checkout.session.async_payment_succeeded. Raw body is verified by Stripe SDK before processing. Amount/currency/payment metadata checked; activation transaction is idempotent by existing paid state under MongoDB transaction write-conflict retry. Requires a replica-set Atlas deployment. Test mode first. |

Partial SMTP/licensed/payment credential groups are rejected at startup. Environment presence is not proof of successful authentication, account eligibility, regional availability, license or network access.

## Provider Manager

Seed creates configuration records. Admin can set enabled, priority, timeout, retry count, TTL and health settings and write encrypted provider keys. Execution selects enabled providers in priority order, uses fallback, caches results in MongoDB/memory and records health/logs. Health checks are provider-aware: Animeku is probed through its own adapter (schedule + catalog shape, `{reachable, latencyMs, items, scheduleShape}` → `healthy`/`degraded`/`down`) instead of a bare `GET` on the base URL, which would not prove the catalog works. Adapter HTTP defaults inherit manager timeout/retry settings via AsyncLocalStorage. Memory cache is bounded. Adapters for public services intentionally use their known official endpoints rather than arbitrary admin URLs; adding a new record alone does not add a working adapter. Distributed provider rate-budget enforcement and a full credential-driven commercial registry are still open work.

## SMTP testing

Use an owned sandbox inbox/SMTP service. Register a test account, verify the delivered token, request reset, reset once, then confirm token reuse is rejected and old sessions no longer work. In test NODE_ENV only, reset token is returned to the automated suite. Development/production do not return it. Production requests fail explicitly if SMTP is absent. Delivery is synchronous; a durable mail outbox/retry queue is not implemented.

## Stripe testing

Use Stripe test credentials and CLI/test webhook tooling against a reachable backend. Create checkout from an authenticated MUSIKU account. A browser redirect never activates premium; only a verified successful webhook does. Test duplicate delivery, altered signatures/body, pending async payments, mismatched amount, account deletion, and transaction rollback. Tests in this repository validate signature handling locally with SDK-generated test headers, not a live charge. Refunds, chargebacks, tax/renewal and production reconciliation need additional implementation and owner policy before real-money launch.

## Startup and infrastructure

Configure Atlas least-privilege account/network/TLS, unique JWT secrets, CORS origins and admin seed password. Run db:init before traffic. googleId now has a unique sparse index; audit existing duplicates before changing the index on a populated deployment. Secrets/keys must never be pasted into chat. Set them through hosting/Google/Stripe/GitHub secret UIs.

Admin integration health also fetches sanitized status for this repository's Android workflow on **main** from GitHub's API, with a 60-second server cache and 4-second timeout. Public repos need no token if rate budget permits. Private repos may set backend-only `GITHUB_BUILD_TOKEN` (fine-grained, Actions read only, scoped to this repo). The token, raw response and arbitrary caller-selected URLs are never exposed. Unavailable status is explicitly reported; the display does not claim the current PR build matches main.
