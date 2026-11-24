/// Animeku — the anime section of MUSIKU+.
///
/// Branding: the app is MUSIKU+, the section is **Animeku**, and the upstream
/// catalog provider is internally called **Animasu**. The provider name never
/// reaches the UI copy; it only appears in diagnostics.
///
/// Everything on these screens is served by the backend (`/anime/*`). Flutter
/// never talks to MongoDB Atlas and never calls the provider directly.
///
/// Playback is conditional: the backend answers `playback: 'not_authorized'`
/// (and 403 `STREAM_NOT_AUTHORIZED` for media) on deployments that have not
/// asserted distribution rights. The UI mirrors that honestly — metadata stays
/// browsable, the play affordance is disabled and the reason is shown.
// Material compatibility export retained for supported Flutter stable versions.
// ignore: deprecated_member_use
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:dio/dio.dart';
import '../core/api.dart';
import 'screens.dart' show Frame, action;

/* ─────────────────────────── pure helpers ─────────────────────────── */

/// Normalizes any decoded JSON value into a string-keyed map.
Map<String, dynamic> asMap(dynamic value) =>
    value is Map ? Map<String, dynamic>.from(value) : <String, dynamic>{};

/// Normalizes any decoded JSON value into a list of maps.
///
/// Accepts a bare list or the usual envelope keys (`items`, `days`, `results`)
/// so a payload shape change degrades into an empty list instead of an error.
List<Map<String, dynamic>> asList(dynamic value) {
  if (value is List) {
    return value
        .whereType<Map>()
        .map((entry) => Map<String, dynamic>.from(entry))
        .toList();
  }
  if (value is Map) {
    final nested = value['items'] ?? value['days'] ?? value['results'];
    if (nested != null) return asList(nested);
  }
  return <Map<String, dynamic>>[];
}

String textOf(dynamic value) => value?.toString() ?? '';

/// Reads a numeric field that may arrive as a number, a numeric string or null.
/// Provider payloads and Mongo documents both reach the client, so a string
/// must never turn into a cast error.
double numberOf(dynamic value) {
  if (value is num) return value.toDouble();
  return double.tryParse(textOf(value)) ?? 0;
}

/// Provider-relative link of an anime, falling back to the raw provider id.
String animeLinkOf(Map<String, dynamic> anime) {
  final link = textOf(anime['link']);
  return link.isNotEmpty ? link : textOf(anime['providerId']);
}

String animeTitleOf(Map<String, dynamic> anime) {
  final title = textOf(anime['title']);
  return title.isNotEmpty ? title : 'Tanpa judul';
}

String animePosterOf(Map<String, dynamic> anime) =>
    textOf(anime['posterUrl'] ?? anime['image']);

String animeIdOf(Map<String, dynamic> anime) =>
    textOf(anime['id'] ?? anime['_id']);

/// Short metadata line: type, status and rating when the provider sent them.
String animeSubtitleOf(Map<String, dynamic> anime) {
  final parts = <String>[
    for (final key in ['type', 'status'])
      if (textOf(anime[key]).isNotEmpty) textOf(anime[key]),
  ];
  final rating = numberOf(anime['rating']);
  if (rating > 0) parts.add('★ ${rating.toStringAsFixed(1)}');
  return parts.join(' · ');
}

/// `latestEpisode` is normalized server-side into `{text, number}`; `"??"`
/// arrives as an empty text so the UI shows nothing instead of a placeholder.
String latestEpisodeOf(Map<String, dynamic> anime) {
  final latest = asMap(anime['latestEpisode']);
  final text = textOf(latest['text']);
  if (text.isNotEmpty) return text;
  final number = numberOf(latest['number']);
  if (number > 0) {
    return number == number.roundToDouble()
        ? 'Episode ${number.toInt()}'
        : 'Episode $number';
  }
  return '';
}

int episodeNumberOf(Map<String, dynamic> episode) =>
    numberOf(episode['number']).toInt();

String episodeLabelOf(Map<String, dynamic> episode) {
  final label = textOf(episode['label']);
  if (label.isNotEmpty && label != '??') return label;
  final number = episodeNumberOf(episode);
  return number > 0 ? 'Episode $number' : 'Episode';
}

String episodeUrlOf(Map<String, dynamic> episode) =>
    textOf(episode['episodeUrl'] ?? episode['providerEpisodeId']);

/// The anime document of a watch-history row (populated server-side).
Map<String, dynamic> historyAnimeOf(Map<String, dynamic> row) {
  final anime = row['anime'];
  if (anime is Map) return Map<String, dynamic>.from(anime);
  return <String, dynamic>{'_id': textOf(row['anime'])};
}

Map<String, dynamic> historyEpisodeOf(Map<String, dynamic> row) {
  final episode = row['episode'];
  if (episode is Map) return Map<String, dynamic>.from(episode);
  return <String, dynamic>{'_id': textOf(row['episode'])};
}

/// 0..1 playback progress of a history row, or 0 when the duration is unknown.
double progressOf(Map<String, dynamic> row) {
  final position = numberOf(row['positionSec']);
  final duration = numberOf(row['durationSec']);
  if (duration <= 0 || position <= 0) return 0;
  return (position / duration).clamp(0.0, 1.0);
}

/// Backend error code (`STREAM_NOT_AUTHORIZED`, `BAD_TARGET`, …) or `''`.
String errorCodeOf(Object error) {
  if (error is DioException) {
    final data = error.response?.data;
    if (data is Map) return textOf((data['error'] as Map?)?['code']);
  }
  return '';
}

/// True when the backend refused to serve media because the deployment has not
/// asserted distribution rights. Playback must stay disabled in that case.
bool isPlaybackUnauthorized(Object error) =>
    errorCodeOf(error) == 'STREAM_NOT_AUTHORIZED';

/// Indonesian day keys used by the schedule payload, Monday first.
const List<String> scheduleDayKeys = [
  'senin',
  'selasa',
  'rabu',
  'kamis',
  'jumat',
  'sabtu',
  'minggu',
];

/// Schedule bucket key for "today" (`DateTime.weekday`: 1 = Monday).
String todayScheduleKey([DateTime? now]) =>
    scheduleDayKeys[((now ?? DateTime.now()).weekday - 1) % 7];

/// Picks the day bucket to show first: today when present, else the provider's
/// `all` bucket, else the first non-empty day.
Map<String, dynamic> pickScheduleDay(
  List<Map<String, dynamic>> days, [
  String? preferredKey,
]) {
  if (days.isEmpty) return <String, dynamic>{};
  final wanted = preferredKey ?? todayScheduleKey();
  for (final day in days) {
    if (textOf(day['key']) == wanted) return day;
  }
  for (final day in days) {
    if (textOf(day['key']) == 'all') return day;
  }
  for (final day in days) {
    if (asList(day['items']).isNotEmpty) return day;
  }
  return days.first;
}

/// Client-side type filter for already-fetched items (`''` means no filter).
List<Map<String, dynamic>> filterByType(
  List<Map<String, dynamic>> items,
  String type,
) {
  if (type.isEmpty) return items;
  return items
      .where((item) => textOf(item['type']).toLowerCase() == type.toLowerCase())
      .toList();
}

/// Resumed position in seconds for one episode, or 0 when there is none.
int resumePositionSec(
  List<Map<String, dynamic>> history, {
  required int episodeNumber,
  required String episodeUrl,
}) {
  for (final row in history) {
    if (row['completed'] == true) continue;
    final episode = historyEpisodeOf(row);
    final matchesNumber =
        episodeNumber > 0 &&
        numberOf(row['episodeNumber']).toInt() == episodeNumber;
    final matchesUrl =
        episodeUrl.isNotEmpty && episodeUrlOf(episode) == episodeUrl;
    if (matchesNumber || matchesUrl) {
      return numberOf(row['positionSec']).round();
    }
  }
  return 0;
}

/// Route builders — links are query parameters, never path segments, because a
/// provider link contains slashes.
String animekuDetailRoute(String link) =>
    '/animeku/anime?link=${Uri.encodeQueryComponent(link)}';

String animekuWatchRoute({
  required String link,
  required String episodeUrl,
  required int number,
}) =>
    '/animeku/watch?'
    'link=${Uri.encodeQueryComponent(link)}'
    '&episodeUrl=${Uri.encodeQueryComponent(episodeUrl)}'
    '&number=$number';

String animekuListRoute(String kind, {String title = '', String type = ''}) {
  final uri = Uri(
    path: '/animeku/list',
    queryParameters: {
      'kind': kind,
      if (title.isNotEmpty) 'title': title,
      if (type.isNotEmpty) 'type': type,
    },
  );
  return uri.toString();
}

/* ─────────────────────────── providers ─────────────────────────── */

final animekuStatusProvider = FutureProvider.autoDispose<Map<String, dynamic>>(
  (ref) async => asMap(await ref.watch(apiProvider).get('/anime/status')),
);

final animekuHomeProvider = FutureProvider.autoDispose<Map<String, dynamic>>(
  (ref) async => asMap(await ref.watch(apiProvider).get('/anime/home')),
);

/// `key` is `'<kind>:<page>[:<type>]'` with kind = ongoing | completed | popular.
final animekuListProvider = FutureProvider.autoDispose
    .family<Map<String, dynamic>, String>((ref, key) async {
      final parts = key.split(':');
      final kind = parts.isNotEmpty ? parts[0] : 'ongoing';
      final page = parts.length > 1 ? int.tryParse(parts[1]) ?? 1 : 1;
      final type = parts.length > 2 ? parts[2] : '';
      final query = Uri(
        path: '/anime/$kind',
        queryParameters: {
          'page': '$page',
          'limit': '20',
          if (type.isNotEmpty) 'type': type,
        },
      ).toString();
      return asMap(await ref.watch(apiProvider).get(query));
    });

final animekuSearchProvider = FutureProvider.autoDispose
    .family<Map<String, dynamic>, ({String query, String type, int page})>((
      ref,
      key,
    ) async {
      if (key.query.trim().isEmpty) return <String, dynamic>{};
      final path = Uri(
        path: '/anime/search',
        queryParameters: {
          'q': key.query.trim(),
          'page': '${key.page}',
          'limit': '20',
          if (key.type.isNotEmpty) 'type': key.type,
        },
      ).toString();
      return asMap(await ref.watch(apiProvider).get(path));
    });

final animekuDetailsProvider = FutureProvider.autoDispose
    .family<Map<String, dynamic>, String>((ref, link) async {
      if (link.isEmpty) return <String, dynamic>{};
      final path = '/anime/details?link=${Uri.encodeQueryComponent(link)}';
      return asMap(await ref.watch(apiProvider).get(path));
    });

final animekuRecommendationsProvider = FutureProvider.autoDispose
    .family<List<Map<String, dynamic>>, String>((ref, animeId) async {
      if (animeId.isEmpty) return <Map<String, dynamic>>[];
      try {
        return asList(
          await ref.watch(apiProvider).get('/anime/$animeId/related'),
        );
      } catch (_) {
        // Recommendations are decorative: never fail the detail screen for them.
        return <Map<String, dynamic>>[];
      }
    });

final animekuWatchlistProvider = FutureProvider.autoDispose
    .family<List<Map<String, dynamic>>, String>((ref, animeId) async {
      if (animeId.isEmpty) return <Map<String, dynamic>>[];
      try {
        final entries = asList(
          await ref.watch(apiProvider).get('/library/watchlist'),
        );
        return entries
            .where(
              (entry) =>
                  animeIdOf(historyAnimeOf(entry)) == animeId ||
                  textOf(entry['anime']) == animeId,
            )
            .toList();
      } catch (_) {
        return <Map<String, dynamic>>[];
      }
    });

final animekuFavoritesProvider = FutureProvider.autoDispose
    .family<List<Map<String, dynamic>>, String>((ref, animeId) async {
      if (animeId.isEmpty) return <Map<String, dynamic>>[];
      try {
        final entries = asList(
          await ref.watch(apiProvider).get('/library/anime-favorites'),
        );
        return entries
            .where(
              (entry) =>
                  animeIdOf(historyAnimeOf(entry)) == animeId ||
                  textOf(entry['anime']) == animeId,
            )
            .toList();
      } catch (_) {
        return <Map<String, dynamic>>[];
      }
    });

final animekuHistoryProvider = FutureProvider.autoDispose
    .family<List<Map<String, dynamic>>, String>((ref, animeId) async {
      if (animeId.isEmpty) return <Map<String, dynamic>>[];
      try {
        return asList(
          await ref
              .watch(apiProvider)
              .get(
                '/history/anime?animeId=${Uri.encodeQueryComponent(animeId)}',
              ),
        );
      } catch (_) {
        return <Map<String, dynamic>>[];
      }
    });

final animekuSearchHistoryProvider =
    FutureProvider.autoDispose<List<Map<String, dynamic>>>((ref) async {
      try {
        return asList(await ref.watch(apiProvider).get('/search/history'));
      } catch (_) {
        return <Map<String, dynamic>>[];
      }
    });

/* ─────────────────────────── shared widgets ─────────────────────────── */

/// Placeholder block used while images or rails load. Deliberately static:
/// shimmer animations are expensive on low-end Android devices.
class AnimekuSkeleton extends StatelessWidget {
  final double width, height;
  final BorderRadius? borderRadius;
  const AnimekuSkeleton({
    super.key,
    this.width = double.infinity,
    this.height = 16,
    this.borderRadius,
  });

  @override
  Widget build(BuildContext context) => Container(
    width: width,
    height: height,
    decoration: BoxDecoration(
      color: Theme.of(context).colorScheme.surfaceContainerHighest,
      borderRadius: borderRadius ?? BorderRadius.circular(10),
    ),
  );
}

/// Poster card. Presentational: the caller owns the tap target.
class AnimekuPoster extends StatelessWidget {
  final Map<String, dynamic> anime;
  final double width;
  final String? subtitle;
  const AnimekuPoster({
    super.key,
    required this.anime,
    this.width = 128,
    this.subtitle,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final poster = animePosterOf(anime);
    final caption = subtitle ?? animeSubtitleOf(anime);
    return SizedBox(
      width: width,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: ClipRRect(
              borderRadius: BorderRadius.circular(14),
              child: poster.isEmpty
                  ? ColoredBox(
                      color: theme.colorScheme.surfaceContainerHighest,
                      child: const Center(child: Icon(Icons.movie_outlined)),
                    )
                  : CachedNetworkImage(
                      imageUrl: poster,
                      fit: BoxFit.cover,
                      placeholder: (_, __) =>
                          const AnimekuSkeleton(height: double.infinity),
                      errorWidget: (_, __, ___) => ColoredBox(
                        color: theme.colorScheme.surfaceContainerHighest,
                        child: const Center(
                          child: Icon(Icons.broken_image_outlined),
                        ),
                      ),
                    ),
            ),
          ),
          const SizedBox(height: 8),
          Text(
            animeTitleOf(anime),
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: theme.textTheme.bodyMedium,
          ),
          if (caption.isNotEmpty)
            Text(
              caption,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
        ],
      ),
    );
  }
}

/// Horizontal rail of poster cards; hidden when there is nothing to show.
class AnimekuPosterRail extends StatelessWidget {
  final String title;
  final List<Map<String, dynamic>> items;
  final VoidCallback? onSeeAll;
  final double cardWidth;
  const AnimekuPosterRail({
    super.key,
    required this.title,
    required this.items,
    this.onSeeAll,
    this.cardWidth = 128,
  });

  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) return const SizedBox.shrink();
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 20, 8, 8),
          child: Row(
            children: [
              Expanded(child: Text(title, style: theme.textTheme.titleMedium)),
              if (onSeeAll != null)
                TextButton(
                  onPressed: onSeeAll,
                  child: const Text('Lihat semua'),
                ),
            ],
          ),
        ),
        SizedBox(
          height: 268,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 20),
            itemCount: items.length,
            separatorBuilder: (_, __) => const SizedBox(width: 12),
            itemBuilder: (context, index) {
              final anime = items[index];
              final link = animeLinkOf(anime);
              return InkWell(
                borderRadius: BorderRadius.circular(14),
                onTap: link.isEmpty
                    ? null
                    : () => context.push(animekuDetailRoute(link)),
                child: AnimekuPoster(anime: anime, width: cardWidth),
              );
            },
          ),
        ),
      ],
    );
  }
}

/// Row card used for "continue watching", "latest episodes" and history rails.
class AnimekuEpisodeCard extends StatelessWidget {
  final Map<String, dynamic> anime;
  final String label;
  final double progress;
  final VoidCallback? onTap;
  const AnimekuEpisodeCard({
    super.key,
    required this.anime,
    required this.label,
    this.progress = 0,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final poster = animePosterOf(anime);
    return SizedBox(
      width: 220,
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: onTap,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: ClipRRect(
                borderRadius: BorderRadius.circular(14),
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    if (poster.isEmpty)
                      ColoredBox(
                        color: theme.colorScheme.surfaceContainerHighest,
                        child: const Center(child: Icon(Icons.movie_outlined)),
                      )
                    else
                      CachedNetworkImage(
                        imageUrl: poster,
                        fit: BoxFit.cover,
                        placeholder: (_, __) =>
                            const AnimekuSkeleton(height: double.infinity),
                        errorWidget: (_, __, ___) => ColoredBox(
                          color: theme.colorScheme.surfaceContainerHighest,
                        ),
                      ),
                    Positioned(
                      left: 0,
                      right: 0,
                      bottom: 0,
                      child: EpisodeProgressBar(progress: progress),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 8),
            Text(
              animeTitleOf(anime),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: theme.textTheme.bodyMedium,
            ),
            Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Thin progress bar drawn at the bottom of an episode card.
class EpisodeProgressBar extends StatelessWidget {
  final double progress;
  const EpisodeProgressBar({super.key, required this.progress});

  @override
  Widget build(BuildContext context) {
    if (progress <= 0) return const SizedBox.shrink();
    final theme = Theme.of(context);
    return SizedBox(
      height: 4,
      child: LinearProgressIndicator(
        value: progress.clamp(0.0, 1.0),
        backgroundColor: theme.colorScheme.surface,
        color: theme.colorScheme.primary,
      ),
    );
  }
}

/// Horizontal rail of episode cards built from watch-history rows.
class AnimekuHistoryRail extends StatelessWidget {
  final String title;
  final List<Map<String, dynamic>> rows;
  const AnimekuHistoryRail({
    super.key,
    required this.title,
    required this.rows,
  });

  @override
  Widget build(BuildContext context) {
    if (rows.isEmpty) return const SizedBox.shrink();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 20, 20, 8),
          child: Text(title, style: Theme.of(context).textTheme.titleMedium),
        ),
        SizedBox(
          height: 190,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 20),
            itemCount: rows.length,
            separatorBuilder: (_, __) => const SizedBox(width: 12),
            itemBuilder: (context, index) {
              final row = rows[index];
              final anime = historyAnimeOf(row);
              final episode = historyEpisodeOf(row);
              final episodeUrl = episodeUrlOf(episode);
              final number = numberOf(row['episodeNumber']).toInt();
              final link = animeLinkOf(anime);
              final label = row['completed'] == true
                  ? 'Selesai'
                  : number > 0
                  ? 'Episode $number'
                  : 'Terakhir ditonton';
              return AnimekuEpisodeCard(
                anime: anime,
                label: label,
                progress: progressOf(row),
                onTap: () {
                  if (link.isEmpty) return;
                  if (episodeUrl.isNotEmpty) {
                    context.push(
                      animekuWatchRoute(
                        link: link,
                        episodeUrl: episodeUrl,
                        number: number,
                      ),
                    );
                    return;
                  }
                  context.push(animekuDetailRoute(link));
                },
              );
            },
          ),
        ),
      ],
    );
  }
}

/// Explains why playback is unavailable. Shown whenever the backend reports
/// `playback != 'authorized'` — a URL from a provider is not proof of rights.
class PlaybackNotice extends StatelessWidget {
  final Map<String, dynamic> status;
  const PlaybackNotice({super.key, required this.status});

  @override
  Widget build(BuildContext context) {
    if (textOf(status['playback']) == 'authorized') {
      return const SizedBox.shrink();
    }
    final theme = Theme.of(context);
    return Container(
      margin: const EdgeInsets.fromLTRB(20, 16, 20, 0),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: theme.colorScheme.outlineVariant),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.info_outline, size: 20, color: theme.colorScheme.primary),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Pemutaran video tidak diaktifkan',
                  style: theme.textTheme.titleSmall,
                ),
                const SizedBox(height: 4),
                Text(
                  'Katalog, jadwal, dan detail episode tetap tersedia. '
                  'Streaming hanya aktif bila server menyatakan punya izin '
                  'menayangkan media ini.',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Shared loading / empty / error surface for every Animeku list.
class AnimekuAsyncBody extends StatelessWidget {
  final AsyncValue<dynamic> value;
  final Widget Function(dynamic data) builder;
  final VoidCallback onRetry;
  final String emptyMessage;
  final bool Function(dynamic data)? isEmpty;
  const AnimekuAsyncBody({
    super.key,
    required this.value,
    required this.builder,
    required this.onRetry,
    this.emptyMessage = 'Belum ada konten.',
    this.isEmpty,
  });

  @override
  Widget build(BuildContext context) => value.when(
    loading: () => const AnimekuLoadingList(),
    error: (error, _) => AnimekuErrorState(error: error, onRetry: onRetry),
    data: (data) {
      if (isEmpty != null && isEmpty!(data)) {
        return AnimekuEmptyState(message: emptyMessage);
      }
      return builder(data);
    },
  );
}

class AnimekuLoadingList extends StatelessWidget {
  const AnimekuLoadingList({super.key});

  @override
  Widget build(BuildContext context) => ListView(
    padding: const EdgeInsets.all(20),
    children: const [
      AnimekuSkeleton(height: 24, width: 180),
      SizedBox(height: 16),
      AnimekuSkeleton(height: 190),
      SizedBox(height: 12),
      AnimekuSkeleton(height: 190),
      SizedBox(height: 12),
      AnimekuSkeleton(height: 190),
    ],
  );
}

class AnimekuEmptyState extends StatelessWidget {
  final String message;
  final IconData icon;
  const AnimekuEmptyState({
    super.key,
    required this.message,
    this.icon = Icons.movie_outlined,
  });

  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(32),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 48, color: Theme.of(context).colorScheme.outline),
          const SizedBox(height: 12),
          Text(
            message,
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.bodyMedium,
          ),
        ],
      ),
    ),
  );
}

class AnimekuErrorState extends StatelessWidget {
  final Object error;
  final VoidCallback onRetry;
  const AnimekuErrorState({
    super.key,
    required this.error,
    required this.onRetry,
  });

  @override
  Widget build(BuildContext context) {
    final offline =
        error is DioException &&
        (error as DioException).type == DioExceptionType.connectionError;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              offline ? Icons.wifi_off : Icons.error_outline,
              size: 44,
              color: Theme.of(context).colorScheme.error,
            ),
            const SizedBox(height: 12),
            Text(
              offline
                  ? 'Tidak ada koneksi. Periksa jaringan Anda lalu coba lagi.'
                  : errorMessage(error),
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodyMedium,
            ),
            const SizedBox(height: 16),
            FilledButton.tonalIcon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh),
              label: const Text('Coba lagi'),
            ),
          ],
        ),
      ),
    );
  }
}

/* ─────────────────────────── home ─────────────────────────── */

class AnimekuHomeScreen extends ConsumerWidget {
  const AnimekuHomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final home = ref.watch(animekuHomeProvider);
    return Frame(
      title: 'Animeku',
      index: 2,
      actions: [
        IconButton(
          tooltip: 'Cari anime',
          icon: const Icon(Icons.search),
          onPressed: () => context.push('/animeku/search'),
        ),
        IconButton(
          tooltip: 'Muat ulang',
          icon: const Icon(Icons.refresh),
          onPressed: () => ref.invalidate(animekuHomeProvider),
        ),
      ],
      child: AnimekuAsyncBody(
        value: home,
        onRetry: () => ref.invalidate(animekuHomeProvider),
        builder: (data) {
          final payload = asMap(data);
          final status = asMap(payload['status']);
          final schedule = asMap(payload['schedule']);
          final days = asList(schedule['days']);
          final today = pickScheduleDay(days);
          return RefreshIndicator(
            onRefresh: () async {
              await ref.refresh(animekuHomeProvider.future);
            },
            child: ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.only(bottom: 24),
              children: [
                PlaybackNotice(status: status),
                AnimekuPosterRail(
                  title: 'Sorotan',
                  items: asList(payload['featured']),
                  cardWidth: 150,
                ),
                AnimekuHistoryRail(
                  title: 'Lanjut menonton',
                  rows: asList(payload['continueWatching']),
                ),
                AnimekuPosterRail(
                  title: 'Sedang tayang',
                  items: asList(payload['ongoing']),
                  onSeeAll: () => context.push(
                    animekuListRoute('ongoing', title: 'Sedang tayang'),
                  ),
                ),
                AnimekuEpisodeRail(
                  title: 'Episode terbaru',
                  entries: asList(payload['latestEpisodes']),
                ),
                if (days.isNotEmpty)
                  ScheduleSection(days: days, initialDay: today),
                AnimekuPosterRail(
                  title: 'Populer',
                  items: asList(payload['popular']),
                  onSeeAll: () => context.push(
                    animekuListRoute('popular', title: 'Populer'),
                  ),
                ),
                AnimekuPosterRail(
                  title: 'Selesai tayang',
                  items: asList(payload['completed']),
                  onSeeAll: () => context.push(
                    animekuListRoute('completed', title: 'Selesai tayang'),
                  ),
                ),
                AnimekuPosterRail(
                  title: 'Daftar tontonan',
                  items: asList(payload['watchlist'])
                      .map(historyAnimeOf)
                      .where((anime) => animeLinkOf(anime).isNotEmpty)
                      .toList(),
                ),
                AnimekuHistoryRail(
                  title: 'Riwayat tontonan',
                  rows: asList(payload['history']),
                ),
                AnimekuPosterRail(
                  title: 'Anime favorit',
                  items: asList(payload['favorites'])
                      .map(historyAnimeOf)
                      .where((anime) => animeLinkOf(anime).isNotEmpty)
                      .toList(),
                ),
                if (asList(payload['featured']).isEmpty &&
                    asList(payload['ongoing']).isEmpty &&
                    asList(payload['popular']).isEmpty)
                  const AnimekuEmptyState(
                    message:
                        'Katalog Animeku belum tersedia. Periksa koneksi atau '
                        'coba beberapa saat lagi.',
                  ),
              ],
            ),
          );
        },
      ),
    );
  }
}

/// Rail over `{anime, label}` entries (latest episodes).
class AnimekuEpisodeRail extends StatelessWidget {
  final String title;
  final List<Map<String, dynamic>> entries;
  const AnimekuEpisodeRail({
    super.key,
    required this.title,
    required this.entries,
  });

  @override
  Widget build(BuildContext context) {
    if (entries.isEmpty) return const SizedBox.shrink();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 20, 20, 8),
          child: Text(title, style: Theme.of(context).textTheme.titleMedium),
        ),
        SizedBox(
          height: 190,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 20),
            itemCount: entries.length,
            separatorBuilder: (_, __) => const SizedBox(width: 12),
            itemBuilder: (context, index) {
              final entry = entries[index];
              final anime = asMap(entry['anime']);
              final link = animeLinkOf(anime);
              return AnimekuEpisodeCard(
                anime: anime,
                label: textOf(entry['label']),
                onTap: link.isEmpty
                    ? null
                    : () => context.push(animekuDetailRoute(link)),
              );
            },
          ),
        ),
      ],
    );
  }
}

/// Today's schedule with day chips. The payload may be an object keyed by day
/// (including an `All` bucket) or a flat list; both arrive normalized.
class ScheduleSection extends StatefulWidget {
  final List<Map<String, dynamic>> days;
  final Map<String, dynamic> initialDay;
  const ScheduleSection({
    super.key,
    required this.days,
    required this.initialDay,
  });

  @override
  State<ScheduleSection> createState() => _ScheduleSectionState();
}

class _ScheduleSectionState extends State<ScheduleSection> {
  late String selectedKey = textOf(widget.initialDay['key']);

  @override
  Widget build(BuildContext context) {
    final day = pickScheduleDay(widget.days, selectedKey);
    final items = asList(day['items']);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 20, 20, 8),
          child: Text(
            'Jadwal tayang',
            style: Theme.of(context).textTheme.titleMedium,
          ),
        ),
        SizedBox(
          height: 44,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 20),
            itemCount: widget.days.length,
            separatorBuilder: (_, __) => const SizedBox(width: 8),
            itemBuilder: (context, index) {
              final entry = widget.days[index];
              final key = textOf(entry['key']);
              return ChoiceChip(
                label: Text(
                  textOf(entry['label']).isEmpty ? key : textOf(entry['label']),
                ),
                selected: key == textOf(day['key']),
                onSelected: (_) => setState(() => selectedKey = key),
              );
            },
          ),
        ),
        const SizedBox(height: 8),
        if (items.isEmpty)
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: 20, vertical: 8),
            child: Text('Tidak ada judul pada hari ini.'),
          )
        else
          SizedBox(
            height: 268,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 20),
              itemCount: items.length,
              separatorBuilder: (_, __) => const SizedBox(width: 12),
              itemBuilder: (context, index) {
                final anime = items[index];
                final link = animeLinkOf(anime);
                return InkWell(
                  borderRadius: BorderRadius.circular(14),
                  onTap: link.isEmpty
                      ? null
                      : () => context.push(animekuDetailRoute(link)),
                  child: AnimekuPoster(
                    anime: anime,
                    subtitle: latestEpisodeOf(anime),
                  ),
                );
              },
            ),
          ),
      ],
    );
  }
}

/* ─────────────────────────── paginated list ─────────────────────────── */

class AnimekuListScreen extends ConsumerStatefulWidget {
  final String kind, title, type;
  const AnimekuListScreen({
    super.key,
    required this.kind,
    this.title = '',
    this.type = '',
  });

  @override
  ConsumerState<AnimekuListScreen> createState() => _AnimekuListState();
}

class _AnimekuListState extends ConsumerState<AnimekuListScreen> {
  int page = 1;
  String type = '';
  final List<Map<String, dynamic>> items = [];
  bool loadingMore = false;

  @override
  void initState() {
    super.initState();
    type = widget.type;
  }

  String key(int pageNumber) => '${widget.kind}:$pageNumber:$type';

  Future<void> loadMore() async {
    if (loadingMore) return;
    setState(() => loadingMore = true);
    try {
      final next = asMap(
        await ref.read(animekuListProvider(key(page + 1)).future),
      );
      final more = asList(next['items']);
      if (mounted) {
        setState(() {
          items.addAll(more);
          page += 1;
        });
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Gagal memuat lebih banyak')),
        );
      }
    } finally {
      if (mounted) setState(() => loadingMore = false);
    }
  }

  void changeType(String value) {
    setState(() {
      type = value;
      page = 1;
      items.clear();
    });
    ref.invalidate(animekuListProvider);
  }

  @override
  Widget build(BuildContext context) {
    final first = ref.watch(animekuListProvider(key(page)));
    return Frame(
      title: widget.title.isEmpty ? 'Animeku' : widget.title,
      index: 2,
      child: Column(
        children: [
          SizedBox(
            height: 52,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              children: [
                for (final option in const [
                  '',
                  'TV',
                  'Movie',
                  'Special',
                  'OVA',
                  'ONA',
                  'Other',
                ])
                  Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: ChoiceChip(
                      label: Text(option.isEmpty ? 'Semua' : option),
                      selected: option == type,
                      onSelected: (_) => changeType(option),
                    ),
                  ),
              ],
            ),
          ),
          Expanded(
            child: AnimekuAsyncBody(
              value: first,
              onRetry: () => ref.invalidate(animekuListProvider),
              emptyMessage: 'Belum ada judul pada daftar ini.',
              isEmpty: (data) => asList(asMap(data)['items']).isEmpty,
              builder: (data) {
                final payload = asMap(data);
                final rows = [...asList(payload['items']), ...items];
                return ListView(
                  padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
                  children: [
                    GridView.count(
                      crossAxisCount: 3,
                      shrinkWrap: true,
                      physics: const NeverScrollableScrollPhysics(),
                      mainAxisSpacing: 12,
                      crossAxisSpacing: 12,
                      childAspectRatio: 0.52,
                      children: [
                        for (final anime in rows)
                          InkWell(
                            borderRadius: BorderRadius.circular(14),
                            onTap: () {
                              final link = animeLinkOf(anime);
                              if (link.isNotEmpty) {
                                context.push(animekuDetailRoute(link));
                              }
                            },
                            child: AnimekuPoster(
                              anime: anime,
                              width: double.infinity,
                              subtitle: latestEpisodeOf(anime),
                            ),
                          ),
                      ],
                    ),
                    const SizedBox(height: 16),
                    if (loadingMore)
                      const Center(child: CircularProgressIndicator())
                    else
                      Center(
                        child: OutlinedButton.icon(
                          onPressed: loadMore,
                          icon: const Icon(Icons.expand_more),
                          label: const Text('Muat lebih banyak'),
                        ),
                      ),
                  ],
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

/* ─────────────────────────── search ─────────────────────────── */

class AnimekuSearchScreen extends ConsumerStatefulWidget {
  const AnimekuSearchScreen({super.key});

  @override
  ConsumerState<AnimekuSearchScreen> createState() => _AnimekuSearchState();
}

class _AnimekuSearchState extends ConsumerState<AnimekuSearchScreen> {
  final controller = TextEditingController();
  Timer? debounce;
  String query = '';
  String type = '';
  int page = 1;
  final List<Map<String, dynamic>> extra = [];
  bool loadingMore = false;

  @override
  void dispose() {
    debounce?.cancel();
    controller.dispose();
    super.dispose();
  }

  ({String query, String type, int page}) get searchKey =>
      (query: query, type: type, page: page);

  void onQueryChanged(String value) {
    debounce?.cancel();
    debounce = Timer(const Duration(milliseconds: 450), () {
      if (!mounted) return;
      setState(() {
        query = value.trim();
        page = 1;
        extra.clear();
      });
    });
  }

  void onTypeChanged(String value) {
    setState(() {
      type = value;
      page = 1;
      extra.clear();
    });
  }

  Future<void> loadMore() async {
    if (loadingMore || query.isEmpty) return;
    setState(() => loadingMore = true);
    try {
      final next = asMap(
        await ref.read(
          animekuSearchProvider((
            query: query,
            type: type,
            page: page + 1,
          )).future,
        ),
      );
      if (mounted) {
        setState(() {
          extra.addAll(asList(next['items']));
          page += 1;
        });
      }
    } catch (_) {
      /* the retry button on the list itself covers a failed page */
    } finally {
      if (mounted) setState(() => loadingMore = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final history = ref.watch(animekuSearchHistoryProvider);
    final results = query.isEmpty
        ? null
        : ref.watch(animekuSearchProvider(searchKey));
    return Frame(
      title: 'Cari anime',
      index: 2,
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(16),
            child: TextField(
              controller: controller,
              autofocus: false,
              textInputAction: TextInputAction.search,
              decoration: InputDecoration(
                labelText: 'Judul anime',
                prefixIcon: const Icon(Icons.search),
                suffixIcon: query.isEmpty
                    ? null
                    : IconButton(
                        tooltip: 'Hapus',
                        icon: const Icon(Icons.close),
                        onPressed: () {
                          controller.clear();
                          onQueryChanged('');
                        },
                      ),
              ),
              onChanged: onQueryChanged,
              onSubmitted: (value) {
                debounce?.cancel();
                setState(() {
                  query = value.trim();
                  page = 1;
                  extra.clear();
                });
              },
            ),
          ),
          SizedBox(
            height: 52,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              children: [
                for (final option in const [
                  '',
                  'TV',
                  'Movie',
                  'Special',
                  'OVA',
                  'ONA',
                  'Other',
                ])
                  Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: ChoiceChip(
                      label: Text(option.isEmpty ? 'Semua' : option),
                      selected: option == type,
                      onSelected: (_) => onTypeChanged(option),
                    ),
                  ),
              ],
            ),
          ),
          Expanded(
            child: query.isEmpty
                ? SearchHistoryPanel(
                    entries: history.value ?? const [],
                    onPick: (value) {
                      controller.text = value;
                      onQueryChanged(value);
                    },
                    onClear: () => action(context, () async {
                      await ref
                          .read(apiProvider)
                          .send('/search/history', {}, method: 'DELETE');
                      ref.invalidate(animekuSearchHistoryProvider);
                    }),
                  )
                : results == null
                ? const AnimekuEmptyState(message: 'Ketik judul untuk mencari.')
                : AnimekuAsyncBody(
                    value: results,
                    onRetry: () => ref.invalidate(animekuSearchProvider),
                    emptyMessage: 'Tidak ada hasil untuk "$query".',
                    isEmpty: (data) => asList(asMap(data)['items']).isEmpty,
                    builder: (data) {
                      final rows = [...asList(asMap(data)['items']), ...extra];
                      return ListView(
                        padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
                        children: [
                          GridView.count(
                            crossAxisCount: 3,
                            shrinkWrap: true,
                            physics: const NeverScrollableScrollPhysics(),
                            mainAxisSpacing: 12,
                            crossAxisSpacing: 12,
                            childAspectRatio: 0.52,
                            children: [
                              for (final anime in rows)
                                InkWell(
                                  borderRadius: BorderRadius.circular(14),
                                  onTap: () {
                                    final link = animeLinkOf(anime);
                                    if (link.isNotEmpty) {
                                      context.push(animekuDetailRoute(link));
                                    }
                                  },
                                  child: AnimekuPoster(
                                    anime: anime,
                                    width: double.infinity,
                                    subtitle: latestEpisodeOf(anime),
                                  ),
                                ),
                            ],
                          ),
                          const SizedBox(height: 16),
                          if (loadingMore)
                            const Center(child: CircularProgressIndicator())
                          else
                            Center(
                              child: OutlinedButton.icon(
                                onPressed: loadMore,
                                icon: const Icon(Icons.expand_more),
                                label: const Text('Muat hasil lain'),
                              ),
                            ),
                        ],
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }
}

/// Recent anime queries. Tapping reuses the query; the trailing action clears
/// the stored history on the backend.
class SearchHistoryPanel extends StatelessWidget {
  final List<Map<String, dynamic>> entries;
  final ValueChanged<String> onPick;
  final VoidCallback onClear;
  const SearchHistoryPanel({
    super.key,
    required this.entries,
    required this.onPick,
    required this.onClear,
  });

  @override
  Widget build(BuildContext context) {
    final recent = entries
        .where((entry) => textOf(entry['query']).isNotEmpty)
        .take(12)
        .toList();
    if (recent.isEmpty) {
      return const AnimekuEmptyState(
        message: 'Cari judul anime untuk memulai.',
        icon: Icons.search,
      );
    }
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                'Pencarian terakhir',
                style: Theme.of(context).textTheme.titleMedium,
              ),
            ),
            TextButton.icon(
              onPressed: onClear,
              icon: const Icon(Icons.delete_outline, size: 18),
              label: const Text('Hapus'),
            ),
          ],
        ),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final entry in recent)
              ActionChip(
                avatar: const Icon(Icons.history, size: 16),
                label: Text(textOf(entry['query'])),
                onPressed: () => onPick(textOf(entry['query'])),
              ),
          ],
        ),
      ],
    );
  }
}
