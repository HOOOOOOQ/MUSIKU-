# Animeku

Animeku is the anime section of MUSIKU+. The upstream catalog provider is
internally called **Animasu**: `providerId: animasu`, `type: animeku`,
adapter `AnimasuProvider` in `backend/src/providers/anime/animasu.ts`. The
provider name never appears in user-facing copy — only in backend diagnostics,
provider records and the admin dashboard.

Architecture, in one line: **Flutter → MUSIKU+ backend → Animasu**. The mobile
app never calls the provider, never sees a provider credential and never talks
to MongoDB; the backend normalizes, authorizes, caches and persists.

```
mobile/lib/features/animeku*.dart  ──▶  /api/anime/*  ──▶  animeService  ──▶  providerManager  ──▶  AnimasuProvider
                                                                                     │
                                                                              MongoDB (metadata only)
```

## 1. Configuration (backend environment only)

All variables are backend-only. None of them is exposed to the admin browser or
to the mobile build.

| Variable | Default | Validation and effect |
|---|---|---|
| `ANIMASU_BASE_URL` | `https://api.nexadev.my.id/animasu` | Must be an `https://` origin and must not embed credentials — startup validation rejects both. Trailing slashes are trimmed. A blocked host (localhost, link-local, cloud metadata, private ranges) is rejected at request time. |
| `ANIMASU_ENABLED` | `true` | `false` ⇒ every Animeku call fails with `503 PROVIDER_DISABLED`; `/anime/popular` and `/api/search?category=anime` then serve the AniList/Jikan metadata fallback. |
| `ANIMASU_STREAMING_AUTHORIZED` | `false` | **The distribution-rights switch.** See §2. |
| `ANIMASU_ALLOWED_STREAM_HOSTS` | *(empty)* | Comma-separated host allowlist for resolved media, e.g. `cdn.example.com,*.examplecdn.net`. Required to be non-empty when authorization is on — startup fails otherwise, because an allowlist-free deployment would resolve media from any host. The allowlist itself is never returned to a client; `/anime/status` reports only its length. |
| `ANIMASU_TIMEOUT_MS` | `10000` | 1000–60000. Per-request timeout for the adapter. |
| `ANIMASU_CACHE_TTL_SEC` | `900` | 0–86400. Metadata cache TTL (provider cache records carry a TTL index). |
| `ANIMASU_RATE_LIMIT_PER_MIN` | `60` | 1–600. Budget recorded on the provider record; enforcement is per-process (see the `REDIS_URL` note in [DEPLOYMENT.md](DEPLOYMENT.md)). |

The seeded provider record (`npm run seed`) mirrors these values into the
`animeku` document, which adds priority ordering, health tracking and per-call
logging on top of the environment configuration. The record exists even when
`ANIMASU_ENABLED=false` — it is then seeded disabled.

## 2. Playback authorization (read this before enabling video)

A provider that returns a video URL is **not** proof that MUSIKU+ may
redistribute it. Playback is therefore gated on an explicit operator assertion:

- `ANIMASU_STREAMING_AUTHORIZED=false` (default) ⇒ `/anime/status` reports
  `playback: "not_authorized"`, `details()`/`episodes()` repeat that verdict, and
  every media request answers `403 STREAM_NOT_AUTHORIZED` **before any network
  call is made**. Metadata, schedule, search, episode lists, watchlist,
  favorites and progress keep working.
- `ANIMASU_STREAMING_AUTHORIZED=true` **and** a non-empty
  `ANIMASU_ALLOWED_STREAM_HOSTS` ⇒ `stream()` resolves media, filters the primary
  URL and every alternative link through the allowlist and marks the answer
  `temporary: true`.

The mobile player mirrors the verdict honestly: instead of a black rectangle or
a broken control it renders a "playback unavailable on this deployment" panel
with the reason. The admin dashboard shows the same verdict and states that the
switch is environment configuration, deliberately **not** editable from a
dashboard session, so an admin login cannot grant itself distribution rights.

## 3. HTTP contract

Every route below is mounted under `/api` and the whole anime router requires a
valid MUSIKU+ access token (`requireAuth`), including `/anime/status`.

| Method and path | Purpose |
|---|---|
| `GET /anime/status` | Provider verdict: `enabled`, `metadataAvailable`, `playback`, `streamHostCount`, `cacheTtlSec`, `types`. |
| `GET /anime/home` | Aggregated home payload: `status`, `popular`, `ongoing`, `completed`, `schedule`, derived `featured` (top-5 popular by rating) and `latestEpisodes`; plus `continueWatching`, `watchlist`, `favorites` and `history` for the authenticated user. Each section fails independently (`.catch` per task) so one bad upstream bucket degrades the screen instead of blanking it. |
| `GET /anime/ongoing`, `/anime/completed`, `/anime/popular` | Paged catalog: `?page&limit&type`. Response `{kind, page, total, items}`. `/anime/popular` additionally falls back to the AniList/Jikan catalog and marks the payload `{fallback: true, source: "anime_metadata"}`. |
| `GET /anime/schedule` | `{days: [{key, label, items}], totalDays, shape}` with `shape: "object" | "array" | "empty"` and Indonesian day labels (`all → Semua`, `senin`, `selasa`, …). |
| `GET /anime/search` | `?q&page&limit&type` → `{query, page, total, items}`; upserts one search-history row per query. `GET /api/search?category=anime|all` uses the same service with a metadata fallback. |
| `GET /anime/details?link=` | `{anime, episodes, episodeOrder, playback}`. Provider links contain `/` and `?`, so they always travel as an **encoded query parameter**, never as a path segment. |
| `GET /anime/episodes?link=` | Same payload as details, for clients that only need the episode list. |
| `GET /anime/stream?episodeUrl=` | `{streamUrl, alternativeLinks, episodeTitle, heading, temporary: true}` or `403 STREAM_NOT_AUTHORIZED`. |
| `POST /anime/progress` | `{animeId | link, episodeUrl, episodeNumber, positionSec, durationSec, completed}`; `animeId` or `link` is required. |
| `GET /anime/:id`, `/anime/:id/episodes`, `/anime/:id/related` | Mongo-id views. |
| `GET /anime/:id/episodes/:episodeId/stream` | Resolves media for a persisted episode through its stored provider link (`providerEpisodeId`); falls back to the licensed-anime `needs_credentials` answer when the episode has no Animeku link. |
| `GET/POST/DELETE /library/watchlist`, `/library/anime-favorites/:id`, `GET /history/anime?animeId=`, `GET /search/history` | Library, favorites, watch progress and search history used by the Animeku screens. |

Animeku routes are registered **before** `/anime/:id` so a literal path such as
`/anime/status` can never be captured by the id parameter.

### Error codes

| Code | HTTP | Meaning |
|---|---|---|
| `BAD_TARGET` | 400 | The `link`/`episodeUrl` argument is not a provider-relative path: empty, control characters, backslashes, protocol-relative (`//`), containing `://`, absolute non-`https`, or pointing at a foreign host. |
| `PROVIDER_DISABLED` | 503 | `ANIMASU_ENABLED=false`, or the provider record is disabled. |
| `PROVIDER_UNAVAILABLE` | upstream status / 500 / 502 | Base URL invalid, blocked host, transport failure or a provider 4xx/5xx (a provider 4xx never escalates past `PROVIDER_UNAVAILABLE`). |
| `STREAM_UNAVAILABLE` | 502 | The provider answered without a usable media URL, or with a malformed one. |
| `STREAM_HOST_NOT_ALLOWED` | 403 | A resolved media URL is not `https`, embeds credentials, or its host is not allow-listed. |
| `STREAM_NOT_AUTHORIZED` | 403 | Playback is not authorized on this deployment (§2). |

Outbound URLs are redacted (`<url-redacted>`) in error messages and provider
logs, so an upstream target never reaches a client, a log aggregator or an
admin table.

## 4. Security invariants

1. **SSRF containment.** `assertRelativeTarget()` accepts only provider-relative
   paths against the configured origin; `isBlockedHostname()` rejects
   `localhost*`, `metadata.google.internal`, `169.254.169.254`, `0.0.0.0`, `::1`,
   `*.internal`, `*.local`, `*.localhost` and the private ranges
   (`127./10./192.168./169.254./172.16–31.`).
2. **Media allowlist.** `assertAllowedStreamUrl()` enforces `https`, forbids
   embedded credentials, strips `#fragment`, supports `*.domain` wildcards and
   rejects everything else with `403 STREAM_HOST_NOT_ALLOWED`. The primary URL
   and each alternative link are checked independently.
3. **No media URL is persisted, cached or logged.** Episode documents are always
   written with `streamUrl: ''`; the provider link is stored in
   `providerEpisodeId` and media is resolved per playback session. The admin
   dashboard has an audit that counts non-empty `streamUrl` values on stored
   episode documents and must always report `0`.
4. **No secret reaches the client.** `/anime/status` reports the allowlist
   *length*, never its contents; provider records are stripped of credential
   material; the admin playback probe reduces a resolved answer to a verdict and
   a source count, so a temporary URL cannot leak into a browser, a screenshot
   or a support ticket.
5. **Authorization before network.** `assertPlaybackAuthorized()` runs before any
   outbound request, so an unauthorized deployment cannot be used as an open
   resolver even by an authenticated user.

## 5. Normalization (why the UI can trust the payload)

The provider's shape is not stable, so the adapter normalizes and the backend
never forwards a field it has not parsed:

- **Episode numbers** are derived in priority order: the provider `episode`
  field → number text inside the episode title → list index. The source that
  supplied ≥60 % of a list wins and is reported as `episodeOrder.numberSource`
  (`episode`, `title`, `index` or `synthesized`). Duplicates are dropped by
  `episodeUrl`, missing numbers are synthesized as `Episode N`, and a strictly
  descending payload is reversed and reported as `episodeOrder.reversed: true`.
  `parseEpisodeNumber` understands `12`, `Episode 12`, `Ep 12`, `Eps 4`,
  `第12話`, `12.5` and returns `null` for placeholders such as `??`.
- **Lists** are accepted as `animeList`, `results`, a bare array or an
  index-keyed object, then deduplicated by `link`.
- **Schedules** are accepted as an object of days, an array of days, or empty,
  and are labelled in Indonesian; the client picks today's bucket, then a
  populated `Semua` bucket, then the first day that has items.
- **Types** are canonicalized to `TV`, `Movie` (`Film`), `Special`, `OVA`
  (`OAV`), `ONA`, `Other`, keeping the provider's wording in `rawType`.
- **Ratings** accept `8.5`, `"8,5"` and `"Rating: 7.2"`; unparsable or missing
  values become `0` rather than `NaN`.
- **Latest episode text** such as `"??"` (a provider placeholder) is normalized
  to an empty string so the UI shows nothing instead of a fake number.

## 6. Persistence

| Collection | Written by Animeku | Notes |
|---|---|---|
| `Anime` | One document per title, keyed by `{providerId: link, source: 'animasu'}` | Metadata only; refreshed on catalog/detail calls. |
| `AnimeEpisode` | `{anime, number, title, providerEpisodeId: episodeUrl, streamUrl: ''}` | Re-synced only when the stored count differs from the provider's, so a 500-episode title is not rewritten per request. **`streamUrl` is always empty.** |
| `Watchlist` | `{user, anime}` | Unique per user/title. |
| `SearchHistory` | One row per user/query, `category: 'anime'`, refreshed on repeat | Mirrors the music search history. |
| Provider cache | Keyed by `cacheKey` with a TTL index | Metadata responses only. |

Watch progress is written by `POST /anime/progress` and read back by
`GET /history/anime`, which powers "continue watching" on the Animeku home.

## 7. Mobile client

`mobile/lib/features/animeku.dart` (helpers, Riverpod providers, shared
widgets), `animeku_detail.dart` and `animeku_player.dart`, routed from
`main.dart` as `/animeku`, `/animeku/search`, `/animeku/list`,
`/animeku/anime` and `/animeku/watch`, with Animeku as the fifth bottom-nav tab
in `screens.dart`.

Behaviours worth knowing when debugging:

- Provider links are always sent as encoded query parameters
  (`animekuDetailRoute('/anime/a b')` → `/animeku/anime?link=%2Fanime%2Fa+b`).
- Numeric fields are read through `numberOf()`, which accepts numbers, numeric
  strings and `null`, because provider payloads mix types.
- Watch progress is checkpointed every 15 s, on lifecycle loss and on exit; the
  player never autoplays after a resume, and media is `https` only with
  background playback disabled.
- `orderingNote()` surfaces the backend's `numberSource`/`reversed` in
  Indonesian, so an operator can see that numbering was derived rather than
  asserted.
- Errors are rendered from the API envelope's `error.code`, including
  `STREAM_NOT_AUTHORIZED`, `PROVIDER_DISABLED` and offline transport failures —
  never as a silent empty list.

## 8. Admin dashboard

`admin/app/animeku/page.tsx` (sidebar entry **Animeku**) provides:

1. the asserted status (metadata availability, playback authorization,
   allow-listed host count, cache TTL);
2. upstream health via `POST /api/providers/health-check`, which probes Animeku
   through its adapter (`{reachable, latencyMs, items, scheduleShape}` →
   `healthy` / `degraded` / `down`) instead of hitting a base URL;
3. the provider record: enable/disable plus priority, timeout, retries, cache
   TTL and rate limit;
4. a live catalog inspector (popular/ongoing/completed with paging, AniList/Jikan
   fallback surfaced) and a detail view showing derived numbering and a playback
   authorization probe;
5. the persistence audit described in §4.3.

`GET /api/admin/catalog/anime` and `/api/admin/catalog/anime/:id/episodes`
remain available on the generic Catalog page.

## 9. Verification status

Executed and reproducible:

- Backend: `npx jest --runInBand` in `backend/` — 18 suites / 268 tests,
  including `unit/animasuNormalization` (29), `unit/animasuSecurity` (34),
  `integration/animeku` (26), `unit/envValidation` (24) and
  `unit/providerManager` (11). `npx tsc -p tsconfig.json --noEmit` clean.
- Mobile: `flutter analyze` reports no issues and `flutter test` runs the
  Animeku helper and widget suites against a fake transport (no HTTP leaves the
  test).
- Admin: `npm test` (11 `node:test` cases, including probe redaction and link
  encoding) and `npm run build`.
- CI: `.github/workflows/verify.yml` (backend, Atlas, admin) and
  `android-build.yml` (format, analyze, test, debug APK, APK secret scan).

Not verified — and not claimed:

- **No live upstream call is exercised by CI.** Every adapter test uses a fake
  fetcher, so provider availability, real payload shape drift and media
  playability are unverified.
- No playback session has been completed against real media, on a device or
  otherwise; no DRM, no entitlement check, no subtitle licence handling.
- No load testing of the provider budget, and rate limiting is per-process.
- **Rights are unestablished.** Metadata access does not grant redistribution
  rights for video. Until the operator holds them, keep
  `ANIMASU_STREAMING_AUTHORIZED=false`; the code treats that as the default and
  the honest state.

See [VERIFICATION.md](VERIFICATION.md) for the acceptance gaps that credentials
alone do not fix and [PROVIDER_CONFIGURATION.md](PROVIDER_CONFIGURATION.md) for
the full provider inventory.
