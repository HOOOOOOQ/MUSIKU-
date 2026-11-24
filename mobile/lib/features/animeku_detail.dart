// Animeku detail screen: metadata, episode list and library actions.
//
// The screen is deliberately null-safe: the provider may omit the synopsis,
// the studio, the rating, the genres or the whole episode list, and every one
// of those is rendered as "not available" instead of crashing or inventing
// data. Episode numbering and ordering come from the backend, which does not
// trust the provider's `episode` field.
// Material compatibility export retained for supported Flutter stable versions.
// ignore: deprecated_member_use
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:cached_network_image/cached_network_image.dart';
import '../core/api.dart';
import 'animeku.dart';
import 'screens.dart' show Frame, MediaList, action;

class AnimekuDetailScreen extends ConsumerWidget {
  final String link;
  const AnimekuDetailScreen({super.key, required this.link});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final details = ref.watch(animekuDetailsProvider(link));
    return Frame(
      title: 'Detail anime',
      index: 2,
      actions: [
        IconButton(
          tooltip: 'Muat ulang',
          icon: const Icon(Icons.refresh),
          onPressed: () => ref.invalidate(animekuDetailsProvider(link)),
        ),
      ],
      child: link.isEmpty
          ? const AnimekuEmptyState(message: 'Tautan anime tidak valid.')
          : AnimekuAsyncBody(
              value: details,
              onRetry: () => ref.invalidate(animekuDetailsProvider(link)),
              emptyMessage: 'Detail tidak tersedia untuk judul ini.',
              isEmpty: (data) => asMap(data).isEmpty,
              builder: (data) => _DetailBody(payload: asMap(data)),
            ),
    );
  }
}

class _DetailBody extends ConsumerStatefulWidget {
  final Map<String, dynamic> payload;
  const _DetailBody({required this.payload});

  @override
  ConsumerState<_DetailBody> createState() => _DetailBodyState();
}

class _DetailBodyState extends ConsumerState<_DetailBody> {
  bool synopsisExpanded = false;

  Map<String, dynamic> get anime => asMap(widget.payload['anime']);
  List<Map<String, dynamic>> get episodes => asList(widget.payload['episodes']);
  Map<String, dynamic> get order => asMap(widget.payload['episodeOrder']);
  bool get playbackAuthorized =>
      textOf(widget.payload['playback']) == 'authorized';

  /// Episode to resume from, or the first one when nothing was watched yet.
  Map<String, dynamic> resumeEpisode(List<Map<String, dynamic>> history) {
    for (final row in history) {
      if (row['completed'] == true) continue;
      final number = numberOf(row['episodeNumber']).toInt();
      for (final episode in episodes) {
        if (number > 0 && episodeNumberOf(episode) == number) return episode;
        final url = episodeUrlOf(historyEpisodeOf(row));
        if (url.isNotEmpty && episodeUrlOf(episode) == url) return episode;
      }
    }
    return episodes.isNotEmpty ? episodes.first : <String, dynamic>{};
  }

  Future<void> toggleWatchlist(
    String animeId,
    bool inWatchlist,
    String entryId,
  ) => action(context, () async {
    final api = ref.read(apiProvider);
    if (inWatchlist && entryId.isNotEmpty) {
      await api.send('/library/watchlist/$entryId', {}, method: 'DELETE');
    } else {
      await api.send('/library/watchlist', {
        'animeId': animeId,
        'status': 'plan_to_watch',
      });
    }
    ref.invalidate(animekuWatchlistProvider(animeId));
    ref.invalidate(animekuHomeProvider);
  });

  Future<void> toggleFavorite(String animeId, bool favorite) =>
      action(context, () async {
        final api = ref.read(apiProvider);
        await api.send(
          '/library/anime-favorites/$animeId',
          {},
          method: favorite ? 'DELETE' : 'POST',
        );
        ref.invalidate(animekuFavoritesProvider(animeId));
        ref.invalidate(animekuHomeProvider);
      });

  void explainPlayback() {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text(
          'Pemutaran video tidak diaktifkan pada server ini. '
          'Katalog dan detail episode tetap tersedia.',
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final animeId = animeIdOf(anime);
    final watchlist = ref.watch(animekuWatchlistProvider(animeId));
    final favorites = ref.watch(animekuFavoritesProvider(animeId));
    final history = ref.watch(animekuHistoryProvider(animeId));
    final related = ref.watch(animekuRecommendationsProvider(animeId));
    final inWatchlist = (watchlist.value ?? const []).isNotEmpty;
    final entryId = inWatchlist
        ? textOf((watchlist.value ?? const []).first['_id'])
        : '';
    final isFavorite = (favorites.value ?? const []).isNotEmpty;
    final poster = animePosterOf(anime);
    final synopsis = textOf(anime['synopsis']);
    final genres = (anime['genres'] is List)
        ? (anime['genres'] as List)
              .map(textOf)
              .where((g) => g.isNotEmpty)
              .toList()
        : const <String>[];
    final resume = resumeEpisode(history.value ?? const []);
    final resumeNumber = episodeNumberOf(resume);
    final watchedNumbers = (history.value ?? const [])
        .map((row) => numberOf(row['episodeNumber']).toInt())
        .where((number) => number > 0)
        .toSet();

    return ListView(
      padding: const EdgeInsets.only(bottom: 32),
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 20, 20, 0),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(14),
                child: SizedBox(
                  width: 118,
                  height: 168,
                  child: poster.isEmpty
                      ? ColoredBox(
                          color: theme.colorScheme.surfaceContainerHighest,
                          child: const Center(
                            child: Icon(Icons.movie_outlined),
                          ),
                        )
                      : CachedNetworkImage(
                          imageUrl: poster,
                          fit: BoxFit.cover,
                          placeholder: (_, __) =>
                              const AnimekuSkeleton(width: 118, height: 168),
                          errorWidget: (_, __, ___) => ColoredBox(
                            color: theme.colorScheme.surfaceContainerHighest,
                            child: const Center(
                              child: Icon(Icons.broken_image_outlined),
                            ),
                          ),
                        ),
                ),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      animeTitleOf(anime),
                      style: theme.textTheme.titleLarge,
                    ),
                    const SizedBox(height: 6),
                    if (animeSubtitleOf(anime).isNotEmpty)
                      Text(
                        animeSubtitleOf(anime),
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: theme.colorScheme.onSurfaceVariant,
                        ),
                      ),
                    const SizedBox(height: 10),
                    Wrap(
                      spacing: 6,
                      runSpacing: 6,
                      children: [
                        for (final chip in [
                          if (textOf(anime['type']).isNotEmpty)
                            textOf(anime['type']),
                          if (textOf(anime['status']).isNotEmpty)
                            textOf(anime['status']),
                          if (numberOf(anime['episodeCount']).toInt() > 0)
                            '${numberOf(anime['episodeCount']).toInt()} episode',
                          if (latestEpisodeOf(anime).isNotEmpty)
                            latestEpisodeOf(anime),
                        ])
                          Chip(
                            label: Text(chip),
                            visualDensity: VisualDensity.compact,
                            materialTapTargetSize:
                                MaterialTapTargetSize.shrinkWrap,
                          ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        if (genres.isNotEmpty)
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 14, 20, 0),
            child: Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final genre in genres)
                  Chip(
                    label: Text(genre),
                    visualDensity: VisualDensity.compact,
                    side: BorderSide(color: theme.colorScheme.outlineVariant),
                    materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  ),
              ],
            ),
          ),
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Sinopsis', style: theme.textTheme.titleSmall),
              const SizedBox(height: 6),
              if (synopsis.isEmpty)
                Text(
                  'Sinopsis tidak tersedia dari provider.',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                )
              else
                Text(
                  synopsis,
                  maxLines: synopsisExpanded ? null : 4,
                  overflow: synopsisExpanded ? null : TextOverflow.ellipsis,
                  style: theme.textTheme.bodyMedium,
                ),
              if (synopsis.length > 180)
                TextButton(
                  onPressed: () =>
                      setState(() => synopsisExpanded = !synopsisExpanded),
                  child: Text(
                    synopsisExpanded
                        ? 'Tampilkan lebih sedikit'
                        : 'Selengkapnya',
                  ),
                ),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 0),
          child: Wrap(
            spacing: 10,
            runSpacing: 10,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              FilledButton.icon(
                onPressed: episodes.isEmpty || episodeUrlOf(resume).isEmpty
                    ? null
                    : () {
                        if (!playbackAuthorized) {
                          explainPlayback();
                          return;
                        }
                        context.push(
                          animekuWatchRoute(
                            link: animeLinkOf(anime),
                            episodeUrl: episodeUrlOf(resume),
                            number: resumeNumber,
                          ),
                        );
                      },
                icon: Icon(
                  watchedNumbers.contains(resumeNumber)
                      ? Icons.play_arrow
                      : Icons.play_circle_outline,
                ),
                label: Text(
                  episodes.isEmpty
                      ? 'Episode belum tersedia'
                      : resumeNumber > 0
                      ? 'Tonton episode $resumeNumber'
                      : 'Tonton',
                ),
              ),
              OutlinedButton.icon(
                onPressed: animeId.isEmpty
                    ? null
                    : () => toggleWatchlist(animeId, inWatchlist, entryId),
                icon: Icon(
                  inWatchlist ? Icons.bookmark_remove : Icons.bookmark_add,
                ),
                label: Text(inWatchlist ? 'Hapus watchlist' : 'Watchlist'),
              ),
              OutlinedButton.icon(
                onPressed: animeId.isEmpty
                    ? null
                    : () => toggleFavorite(animeId, isFavorite),
                icon: Icon(isFavorite ? Icons.favorite : Icons.favorite_border),
                label: Text(isFavorite ? 'Favorit' : 'Favoritkan'),
              ),
            ],
          ),
        ),
        if (!playbackAuthorized)
          const PlaybackNotice(status: {'playback': 'not_authorized'}),
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 24, 20, 8),
          child: Row(
            children: [
              Expanded(
                child: Text('Episode', style: theme.textTheme.titleMedium),
              ),
              Text(
                '${episodes.length} tersinkron',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ],
          ),
        ),
        if (order.isNotEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 20),
            child: Text(
              orderingNote(order),
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ),
        if (episodes.isEmpty)
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: 20, vertical: 12),
            child: Text('Daftar episode belum tersedia dari provider.'),
          )
        else
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8),
            child: Column(
              children: [
                for (final episode in episodes)
                  ListTile(
                    leading: CircleAvatar(
                      radius: 18,
                      child: Text('${episodeNumberOf(episode)}'),
                    ),
                    title: Text(
                      episodeLabelOf(episode),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    subtitle: Text(
                      [
                        if (textOf(episode['title']).isNotEmpty &&
                            textOf(episode['title']) != episodeLabelOf(episode))
                          textOf(episode['title']),
                        if (textOf(episode['date']).isNotEmpty)
                          textOf(episode['date']),
                      ].join(' · '),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    trailing: Icon(
                      playbackAuthorized
                          ? Icons.play_circle_outline
                          : Icons.lock_outline,
                      color: playbackAuthorized
                          ? theme.colorScheme.primary
                          : theme.colorScheme.outline,
                    ),
                    onTap: () {
                      if (!playbackAuthorized) {
                        explainPlayback();
                        return;
                      }
                      final url = episodeUrlOf(episode);
                      if (url.isEmpty) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(
                            content: Text(
                              'Episode ini tidak punya sumber video.',
                            ),
                          ),
                        );
                        return;
                      }
                      context.push(
                        animekuWatchRoute(
                          link: animeLinkOf(anime),
                          episodeUrl: url,
                          number: episodeNumberOf(episode),
                        ),
                      );
                    },
                  ),
              ],
            ),
          ),
        if ((related.value ?? const []).isNotEmpty)
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 24, 20, 0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Mirip dengan ini', style: theme.textTheme.titleMedium),
                const SizedBox(height: 8),
                SizedBox(
                  height: 340,
                  child: MediaList(
                    items: related.value ?? const [],
                    kind: 'anime',
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }
}

/// Explains how the episode numbers were derived — the provider's `episode`
/// field is not authoritative, so the source is surfaced instead of hidden.
String orderingNote(Map<String, dynamic> order) {
  final source = textOf(order['numberSource']);
  final reversed = order['reversed'] == true;
  final sourceLabel = switch (source) {
    'episode' => 'field episode provider',
    'title' => 'teks judul episode',
    'index' => 'urutan daftar',
    _ => 'provider',
  };
  return 'Nomor episode dibaca dari $sourceLabel'
      '${reversed ? ' dan urutan dibalik menjadi naik' : ''}.';
}
