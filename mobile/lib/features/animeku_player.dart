// Animeku video player.
//
// Contract with the backend:
//  * media is resolved per playback session from `/anime/stream?episodeUrl=…`;
//    the URL is temporary and is never written to local storage;
//  * a 403 `STREAM_NOT_AUTHORIZED` means the deployment has not asserted
//    distribution rights — the player shows that honestly and offers no media;
//  * HTTP 200 is not proof of playable media: the controller must initialize
//    and stay error-free, otherwise the retry / alternative-source path is
//    offered instead of a black rectangle;
//  * progress is checkpointed every 15 s, on lifecycle loss and on exit, so
//    "continue watching" survives a killed app.
import 'dart:async';
// Material compatibility export retained for supported Flutter stable versions.
// ignore: deprecated_member_use
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:video_player/video_player.dart';
import 'package:dio/dio.dart';
import '../core/api.dart';
import 'animeku.dart';

class AnimekuPlayerScreen extends ConsumerStatefulWidget {
  final String link, episodeUrl;
  final int episodeNumber;
  const AnimekuPlayerScreen({
    super.key,
    required this.link,
    required this.episodeUrl,
    this.episodeNumber = 0,
  });

  @override
  ConsumerState<AnimekuPlayerScreen> createState() => _AnimekuPlayerState();
}

class _AnimekuPlayerState extends ConsumerState<AnimekuPlayerScreen>
    with WidgetsBindingObserver {
  VideoPlayerController? controller;
  Timer? checkpoint;
  Map<String, dynamic> details = <String, dynamic>{};
  List<String> alternatives = const [];
  String? error;
  bool unauthorized = false;
  bool loading = true;
  bool fullscreen = false;
  bool completedReported = false;
  double speed = 1.0;
  int resumeSeconds = 0;

  Map<String, dynamic> get anime => asMap(details['anime']);
  List<Map<String, dynamic>> get episodes => asList(details['episodes']);

  int get currentIndex => episodes.indexWhere(
    (episode) => episodeUrlOf(episode) == widget.episodeUrl,
  );

  String get episodeTitle {
    final index = currentIndex;
    if (index >= 0) return episodeLabelOf(episodes[index]);
    return widget.episodeNumber > 0
        ? 'Episode ${widget.episodeNumber}'
        : 'Episode';
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    unawaited(load());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    checkpoint?.cancel();
    unawaited(saveProgress());
    controller?.removeListener(onPlayerEvent);
    controller?.dispose();
    unawaited(restoreSystemUi());
    super.dispose();
  }

  /* ───────────────────────── loading ───────────────────────── */

  String streamPath(String episodeUrl) =>
      '/anime/stream?episodeUrl=${Uri.encodeQueryComponent(episodeUrl)}';

  Future<void> load([String? sourceOverride]) async {
    checkpoint?.cancel();
    controller?.removeListener(onPlayerEvent);
    await controller?.dispose();
    controller = null;
    if (mounted) {
      setState(() {
        loading = true;
        error = null;
        unauthorized = false;
        completedReported = false;
      });
    }
    try {
      details = asMap(
        await ref.read(animekuDetailsProvider(widget.link).future),
      );
      final animeId = animeIdOf(anime);
      final history = animeId.isEmpty
          ? const <Map<String, dynamic>>[]
          : await ref.read(animekuHistoryProvider(animeId).future);
      resumeSeconds = resumePositionSec(
        history,
        episodeNumber: widget.episodeNumber,
        episodeUrl: widget.episodeUrl,
      );

      final stream = asMap(
        await ref
            .read(apiProvider)
            .get(streamPath(sourceOverride ?? widget.episodeUrl)),
      );
      final url = textOf(stream['streamUrl']);
      final rawAlternatives = stream['alternativeLinks'];
      alternatives = rawAlternatives is List
          ? rawAlternatives
                .map(textOf)
                .where((value) => value.isNotEmpty)
                .toList()
          : const <String>[];
      if (url.isEmpty) {
        throw Exception('Provider tidak mengembalikan URL media.');
      }
      await startPlayback(url);
    } on DioException catch (e) {
      unauthorized = isPlaybackUnauthorized(e);
      error = errorMessage(e);
    } catch (e) {
      error = errorMessage(e);
    }
    if (mounted) setState(() => loading = false);
  }

  Future<void> startPlayback(String url) async {
    final parsed = Uri.parse(url);
    if (parsed.scheme != 'https') {
      throw Exception('Media harus disajikan melalui HTTPS.');
    }
    final player = VideoPlayerController.networkUrl(
      parsed,
      videoPlayerOptions: VideoPlayerOptions(
        // Background playback is deliberately off: audio focus belongs to the
        // music player, and a video keeps rendering when it is not visible.
        allowBackgroundPlayback: false,
        mixWithOthers: false,
      ),
    );
    await player.initialize();
    if (!player.value.isInitialized) {
      await player.dispose();
      throw Exception('Video tidak dapat diputar (format tidak didukung).');
    }
    player.addListener(onPlayerEvent);
    controller = player;
    await player.setPlaybackSpeed(speed);
    if (resumeSeconds > 0) {
      await player.seekTo(Duration(seconds: resumeSeconds));
    }
    await player.play();
    checkpoint = Timer.periodic(
      const Duration(seconds: 15),
      (_) => unawaited(saveProgress()),
    );
  }

  void onPlayerEvent() {
    final value = controller?.value;
    if (value == null || !mounted) return;
    if (value.hasError) {
      if (error == null) {
        checkpoint?.cancel();
        controller?.pause();
        setState(() {
          error =
              'Media tidak dapat diputar pada perangkat ini '
              '(codec atau format tidak didukung).';
          loading = false;
        });
      }
      return;
    }
    if (!completedReported &&
        value.duration > Duration.zero &&
        value.position >= value.duration) {
      completedReported = true;
      unawaited(saveProgress(completed: true));
    }
  }

  /* ───────────────────────── progress ───────────────────────── */

  Future<void> saveProgress({bool completed = false}) async {
    final value = controller?.value;
    final animeId = animeIdOf(anime);
    if (animeId.isEmpty && widget.link.isEmpty) return;
    final position = value?.position.inSeconds ?? 0;
    final duration = value?.duration.inSeconds ?? 0;
    try {
      await ref.read(apiProvider).send('/anime/progress', {
        if (animeId.isNotEmpty) 'animeId': animeId,
        if (widget.link.isNotEmpty) 'link': widget.link,
        'episodeUrl': widget.episodeUrl,
        'episodeNumber': widget.episodeNumber,
        'positionSec': position,
        'durationSec': duration,
        'completed': completed || (duration > 0 && position >= duration - 5),
      });
      ref.invalidate(animekuHomeProvider);
      ref.invalidate(animekuHistoryProvider(animeId));
    } catch (_) {
      /* the next checkpoint retries while playback stays uninterrupted */
    }
  }

  Future<void> goEpisode(int delta) async {
    if (episodes.isEmpty) return;
    final index = currentIndex;
    final target = index < 0
        ? (delta > 0 ? 0 : episodes.length - 1)
        : index + delta;
    if (target < 0 || target >= episodes.length) return;
    final url = episodeUrlOf(episodes[target]);
    if (url.isEmpty) return;
    await saveProgress(completed: true);
    if (!mounted) return;
    context.pushReplacement(
      animekuWatchRoute(
        link: widget.link,
        episodeUrl: url,
        number: episodeNumberOf(episodes[target]),
      ),
    );
  }

  /* ───────────────────────── lifecycle / orientation ───────────────────────── */

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      // No autoplay: audio focus may belong to another app after a call or a
      // headphone unplug, so the user presses play again.
      if (mounted) setState(() {});
      return;
    }
    controller?.pause();
    unawaited(saveProgress());
  }

  /// Restores portrait orientation and the system UI. Platform channels can be
  /// unavailable (headless tests, some embedders), so failures are swallowed:
  /// losing an orientation preference must never crash the player.
  Future<void> restoreSystemUi() async {
    try {
      await SystemChrome.setPreferredOrientations(<DeviceOrientation>[
        DeviceOrientation.portraitUp,
        DeviceOrientation.portraitDown,
      ]);
      await SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
    } catch (_) {
      /* orientation is a preference, not a hard requirement */
    }
  }

  Future<void> setFullscreen(bool value) async {
    if (fullscreen == value) return;
    setState(() => fullscreen = value);
    if (!value) {
      await restoreSystemUi();
      return;
    }
    try {
      await SystemChrome.setPreferredOrientations(<DeviceOrientation>[
        DeviceOrientation.landscapeLeft,
        DeviceOrientation.landscapeRight,
      ]);
      await SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);
    } catch (_) {
      if (mounted) setState(() => fullscreen = false);
    }
  }

  /* ───────────────────────── ui ───────────────────────── */

  @override
  Widget build(BuildContext context) {
    final player = controller;
    final ready = player != null && player.value.isInitialized;
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: fullscreen
          ? null
          : AppBar(
              title: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    animeTitleOf(anime),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.titleSmall,
                  ),
                  Text(
                    episodeTitle,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ],
              ),
              actions: [
                PopupMenuButton<double>(
                  tooltip: 'Kecepatan pemutaran',
                  initialValue: speed,
                  onSelected: (value) {
                    setState(() => speed = value);
                    controller?.setPlaybackSpeed(value);
                  },
                  itemBuilder: (_) => [
                    for (final option in const [0.5, 0.75, 1.0, 1.25, 1.5, 2.0])
                      PopupMenuItem(value: option, child: Text('${option}x')),
                  ],
                ),
                IconButton(
                  tooltip: 'Layar penuh',
                  icon: const Icon(Icons.fullscreen),
                  onPressed: () => unawaited(setFullscreen(true)),
                ),
              ],
            ),
      body: SafeArea(
        child: unauthorized
            ? _MessagePanel(
                icon: Icons.lock_outline,
                title: 'Pemutaran tidak diaktifkan',
                message:
                    error ??
                    'Server tidak mengizinkan penayangan video untuk '
                        'deployment ini. Metadata anime tetap tersedia.',
                primaryLabel: 'Kembali ke detail',
                primaryIcon: Icons.arrow_back,
                onPrimary: () => backToDetails(),
                secondaryLabel: 'Periksa lagi',
                onSecondary: () => unawaited(load()),
              )
            : error != null
            ? _MessagePanel(
                icon: Icons.error_outline,
                title: 'Video tidak dapat diputar',
                message: error!,
                primaryLabel: 'Coba lagi',
                onPrimary: () => unawaited(load()),
                secondaryLabel: widget.link.isNotEmpty ? 'Buka detail' : null,
                onSecondary: widget.link.isNotEmpty
                    ? () => context.pushReplacement(
                        animekuDetailRoute(widget.link),
                      )
                    : null,
                extra: alternatives.isEmpty
                    ? null
                    : Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: [
                          for (var i = 0; i < alternatives.length; i++)
                            OutlinedButton(
                              onPressed: () => unawaited(load(alternatives[i])),
                              child: Text('Sumber alternatif ${i + 1}'),
                            ),
                        ],
                      ),
              )
            : !ready || loading
            ? const Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    CircularProgressIndicator(),
                    SizedBox(height: 16),
                    Text('Menyiapkan video…'),
                  ],
                ),
              )
            : Column(
                children: [
                  Expanded(
                    child: GestureDetector(
                      onTap: () => togglePlayback(player),
                      child: Center(
                        child: AspectRatio(
                          aspectRatio: player.value.aspectRatio == 0
                              ? 16 / 9
                              : player.value.aspectRatio,
                          child: Stack(
                            alignment: Alignment.center,
                            children: [
                              VideoPlayer(player),
                              if (player.value.isBuffering)
                                const CircularProgressIndicator(),
                              if (!player.value.isPlaying &&
                                  !player.value.isBuffering)
                                const Icon(
                                  Icons.play_circle_fill,
                                  size: 64,
                                  color: Colors.white70,
                                ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),
                  PlayerControls(
                    player: player,
                    fullscreen: fullscreen,
                    hasPrevious: currentIndex > 0,
                    hasNext:
                        currentIndex >= 0 && currentIndex < episodes.length - 1,
                    onToggleFullscreen: () =>
                        unawaited(setFullscreen(!fullscreen)),
                    onSkip: (seconds) => skip(player, seconds),
                    onTogglePlayback: () => togglePlayback(player),
                    onPrevious: () => unawaited(goEpisode(-1)),
                    onNext: () => unawaited(goEpisode(1)),
                    onExit: () {
                      unawaited(saveProgress());
                      backToDetails();
                    },
                  ),
                  if (!fullscreen)
                    Expanded(
                      child: EpisodeStrip(
                        episodes: episodes,
                        currentUrl: widget.episodeUrl,
                        playbackAuthorized: true,
                        onPick: (episode) {
                          final url = episodeUrlOf(episode);
                          if (url.isEmpty || url == widget.episodeUrl) return;
                          unawaited(saveProgress(completed: true));
                          context.pushReplacement(
                            animekuWatchRoute(
                              link: widget.link,
                              episodeUrl: url,
                              number: episodeNumberOf(episode),
                            ),
                          );
                        },
                      ),
                    ),
                ],
              ),
      ),
    );
  }

  /// Leaves the player without assuming there is a route to pop.
  void backToDetails() {
    if (widget.link.isNotEmpty) {
      context.pushReplacement(animekuDetailRoute(widget.link));
      return;
    }
    if (context.canPop()) {
      context.pop();
      return;
    }
    context.go('/animeku');
  }

  void togglePlayback(VideoPlayerController player) {
    setState(() {
      if (player.value.isPlaying) {
        unawaited(player.pause());
        unawaited(saveProgress());
      } else {
        unawaited(player.play());
      }
    });
  }

  void skip(VideoPlayerController player, int seconds) {
    final target = player.value.position + Duration(seconds: seconds);
    final clamped = target < Duration.zero
        ? Duration.zero
        : (player.value.duration > Duration.zero &&
                  target > player.value.duration
              ? player.value.duration
              : target);
    unawaited(player.seekTo(clamped));
  }
}

/// `mm:ss` (or `h:mm:ss`) for the position/duration labels.
String formatDuration(Duration value) {
  final hours = value.inHours;
  final minutes = value.inMinutes.remainder(60);
  final seconds = value.inSeconds.remainder(60);
  String two(int input) => input.toString().padLeft(2, '0');
  return hours > 0
      ? '$hours:${two(minutes)}:${two(seconds)}'
      : '${two(minutes)}:${two(seconds)}';
}

class PlayerControls extends StatelessWidget {
  final VideoPlayerController player;
  final bool fullscreen, hasPrevious, hasNext;
  final VoidCallback onToggleFullscreen, onTogglePlayback, onExit;
  final ValueChanged<int> onSkip;
  final VoidCallback? onPrevious, onNext;
  const PlayerControls({
    super.key,
    required this.player,
    required this.fullscreen,
    required this.hasPrevious,
    required this.hasNext,
    required this.onToggleFullscreen,
    required this.onTogglePlayback,
    required this.onSkip,
    required this.onPrevious,
    required this.onNext,
    required this.onExit,
  });

  @override
  Widget build(
    BuildContext context,
  ) => ValueListenableBuilder<VideoPlayerValue>(
    valueListenable: player,
    builder: (context, value, _) {
      final duration = value.duration.inSeconds;
      final position = value.position.inSeconds;
      return Container(
        color: Colors.black,
        padding: const EdgeInsets.fromLTRB(12, 4, 12, 12),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (value.isBuffering) const LinearProgressIndicator(minHeight: 2),
            Slider(
              value: duration > 0 ? position.clamp(0, duration).toDouble() : 0,
              max: duration > 0 ? duration.toDouble() : 1,
              onChanged: duration > 0
                  ? (next) => player.seekTo(Duration(seconds: next.toInt()))
                  : null,
            ),
            Row(
              children: [
                Text(
                  formatDuration(value.position),
                  style: Theme.of(context).textTheme.bodySmall,
                ),
                const Spacer(),
                Text(
                  duration > 0 ? formatDuration(value.duration) : '--:--',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ],
            ),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: [
                IconButton(
                  tooltip: 'Kembali ke detail',
                  icon: const Icon(Icons.playlist_play),
                  onPressed: onExit,
                ),
                IconButton(
                  tooltip: 'Episode sebelumnya',
                  icon: const Icon(Icons.skip_previous),
                  onPressed: hasPrevious ? onPrevious : null,
                ),
                IconButton(
                  tooltip: 'Mundur 10 detik',
                  icon: const Icon(Icons.replay_10),
                  onPressed: () => onSkip(-10),
                ),
                IconButton.filled(
                  tooltip: value.isPlaying ? 'Jeda' : 'Putar',
                  iconSize: 36,
                  icon: Icon(value.isPlaying ? Icons.pause : Icons.play_arrow),
                  onPressed: onTogglePlayback,
                ),
                IconButton(
                  tooltip: 'Maju 10 detik',
                  icon: const Icon(Icons.forward_10),
                  onPressed: () => onSkip(10),
                ),
                IconButton(
                  tooltip: 'Episode berikutnya',
                  icon: const Icon(Icons.skip_next),
                  onPressed: hasNext ? onNext : null,
                ),
                IconButton(
                  tooltip: fullscreen ? 'Keluar layar penuh' : 'Layar penuh',
                  icon: Icon(
                    fullscreen ? Icons.fullscreen_exit : Icons.fullscreen,
                  ),
                  onPressed: onToggleFullscreen,
                ),
              ],
            ),
          ],
        ),
      );
    },
  );
}

/// Horizontal episode chooser shown under the player in portrait mode.
class EpisodeStrip extends StatelessWidget {
  final List<Map<String, dynamic>> episodes;
  final String currentUrl;
  final bool playbackAuthorized;
  final ValueChanged<Map<String, dynamic>> onPick;
  const EpisodeStrip({
    super.key,
    required this.episodes,
    required this.currentUrl,
    required this.playbackAuthorized,
    required this.onPick,
  });

  @override
  Widget build(BuildContext context) {
    if (episodes.isEmpty) {
      return const AnimekuEmptyState(message: 'Daftar episode tidak tersedia.');
    }
    return ListView.builder(
      padding: const EdgeInsets.symmetric(vertical: 8),
      itemCount: episodes.length,
      itemBuilder: (context, index) {
        final episode = episodes[index];
        final selected = episodeUrlOf(episode) == currentUrl;
        return ListTile(
          dense: true,
          selected: selected,
          leading: CircleAvatar(
            radius: 16,
            child: Text('${episodeNumberOf(episode)}'),
          ),
          title: Text(
            episodeLabelOf(episode),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
          trailing: Icon(
            playbackAuthorized ? Icons.play_arrow : Icons.lock_outline,
          ),
          onTap: playbackAuthorized ? () => onPick(episode) : null,
        );
      },
    );
  }
}

/// Shared full-screen message surface (authorization refusal, media failure).
class _MessagePanel extends StatelessWidget {
  final IconData icon, primaryIcon;
  final String title, message, primaryLabel;
  final VoidCallback onPrimary;
  final String? secondaryLabel;
  final VoidCallback? onSecondary;
  final Widget? extra;
  const _MessagePanel({
    required this.icon,
    this.primaryIcon = Icons.refresh,
    required this.title,
    required this.message,
    required this.primaryLabel,
    required this.onPrimary,
    this.secondaryLabel,
    this.onSecondary,
    this.extra,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 46, color: theme.colorScheme.primary),
            const SizedBox(height: 14),
            Text(
              title,
              textAlign: TextAlign.center,
              style: theme.textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            Text(
              message,
              textAlign: TextAlign.center,
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: 20),
            FilledButton.icon(
              onPressed: onPrimary,
              icon: Icon(primaryIcon),
              label: Text(primaryLabel),
            ),
            if (secondaryLabel != null && onSecondary != null) ...[
              const SizedBox(height: 8),
              TextButton(onPressed: onSecondary, child: Text(secondaryLabel!)),
            ],
            if (extra != null) ...[const SizedBox(height: 16), extra!],
          ],
        ),
      ),
    );
  }
}
