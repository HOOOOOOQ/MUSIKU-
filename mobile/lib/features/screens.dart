import '../core/google_auth.dart';
import 'dart:async';
import 'package:dio/dio.dart';
// Material compatibility export retained for supported Flutter stable versions.
// ignore: deprecated_member_use
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:audio_service/audio_service.dart';
import 'package:video_player/video_player.dart';
import '../core/api.dart';
import '../core/audio.dart';

Future<void> action(
  BuildContext context,
  Future<dynamic> Function() work,
) async {
  try {
    await work();
    if (context.mounted) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Berhasil')));
    }
  } catch (e) {
    if (context.mounted) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(errorMessage(e))));
    }
  }
}

Future<String?> prompt(BuildContext context, String title) async {
  final controller = TextEditingController();
  final result = await showDialog<String>(
    context: context,
    builder: (c) => AlertDialog(
      title: Text(title),
      content: TextField(controller: controller, autofocus: true),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(c),
          child: const Text('Batal'),
        ),
        FilledButton(
          onPressed: () => Navigator.pop(c, controller.text.trim()),
          child: const Text('Simpan'),
        ),
      ],
    ),
  );
  controller.dispose();
  return result;
}

void resource(BuildContext context, String title, String path) => context.push(
  Uri(
    path: '/resource',
    queryParameters: {'title': title, 'path': path},
  ).toString(),
);

class Frame extends StatelessWidget {
  final String title;
  final Widget child;
  final List<Widget>? actions;
  const Frame({
    super.key,
    required this.title,
    required this.child,
    this.actions,
  });
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text(title), actions: actions),
    body: child,
    bottomNavigationBar: NavigationBar(
      selectedIndex: 0,
      onDestinationSelected: (i) => context.go(
        ['/', '/browse/music', '/browse/anime', '/library', '/profile'][i],
      ),
      destinations: const [
        NavigationDestination(icon: Icon(Icons.home_outlined), label: 'Home'),
        NavigationDestination(icon: Icon(Icons.music_note), label: 'Music'),
        NavigationDestination(icon: Icon(Icons.movie_outlined), label: 'Anime'),
        NavigationDestination(
          icon: Icon(Icons.library_music),
          label: 'Library',
        ),
        NavigationDestination(
          icon: Icon(Icons.person_outline),
          label: 'Profil',
        ),
      ],
    ),
  );
}

class Remote extends ConsumerWidget {
  final String path;
  final Widget Function(dynamic) builder;
  const Remote({super.key, required this.path, required this.builder});
  @override
  Widget build(BuildContext context, WidgetRef ref) => ref
      .watch(resourceProvider(path))
      .when(
        data: builder,
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(errorMessage(e)),
                const SizedBox(height: 16),
                FilledButton(
                  onPressed: () => ref.invalidate(resourceProvider(path)),
                  child: const Text('Coba lagi'),
                ),
                TextButton(
                  onPressed: () => context.go('/login'),
                  child: const Text('Masuk kembali'),
                ),
              ],
            ),
          ),
        ),
      );
}

class OnboardingScreen extends ConsumerWidget {
  const OnboardingScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) => Scaffold(
    body: SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Icon(Icons.graphic_eq, size: 80),
            const Text(
              'Your rhythm.\nYour universe.',
              style: TextStyle(fontSize: 44, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 24),
            const Text(
              'Temukan musik dan anime, simpan favorit, dan lanjutkan cerita Anda. Pemutaran penuh memerlukan penyedia berlisensi.',
            ),
            const SizedBox(height: 32),
            FilledButton(
              onPressed: () async {
                await ref
                    .read(apiProvider)
                    .storage
                    .write(key: 'onboarded', value: 'true');
                if (context.mounted) context.go('/login');
              },
              child: const Text('Mulai jelajah'),
            ),
          ],
        ),
      ),
    ),
  );
}

class AuthScreen extends ConsumerStatefulWidget {
  const AuthScreen({super.key});
  @override
  ConsumerState<AuthScreen> createState() => _AuthState();
}

class _AuthState extends ConsumerState<AuthScreen> {
  final email = TextEditingController(),
      password = TextEditingController(),
      username = TextEditingController();
  bool register = false, busy = false;
  String? error;
  @override
  void dispose() {
    email.dispose();
    password.dispose();
    username.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    body: Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(28),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text(
                'MUSIKU+',
                style: TextStyle(fontSize: 40, fontWeight: FontWeight.w900),
              ),
              Text(register ? 'Buat akun baru' : 'Selamat datang kembali'),
              const SizedBox(height: 32),
              TextField(
                controller: email,
                keyboardType: TextInputType.emailAddress,
                decoration: const InputDecoration(labelText: 'Email'),
              ),
              const SizedBox(height: 16),
              if (register) ...[
                TextField(
                  controller: username,
                  decoration: const InputDecoration(labelText: 'Username'),
                ),
                const SizedBox(height: 16),
              ],
              TextField(
                controller: password,
                obscureText: true,
                decoration: const InputDecoration(labelText: 'Password'),
              ),
              if (error != null)
                Padding(padding: const EdgeInsets.all(12), child: Text(error!)),
              const SizedBox(height: 24),
              FilledButton(
                onPressed: busy
                    ? null
                    : () async {
                        setState(() {
                          busy = true;
                          error = null;
                        });
                        try {
                          await ref
                              .read(apiProvider)
                              .login(
                                email.text.trim(),
                                password.text,
                                username: register
                                    ? username.text.trim()
                                    : null,
                              );
                          if (context.mounted) context.go('/');
                        } catch (e) {
                          if (mounted) setState(() => error = errorMessage(e));
                        } finally {
                          if (mounted) setState(() => busy = false);
                        }
                      },
                child: Text(
                  busy
                      ? 'Memproses…'
                      : register
                      ? 'Daftar'
                      : 'Masuk',
                ),
              ),
              if (googleWebClientId.isNotEmpty)
                OutlinedButton(
                  onPressed: busy
                      ? null
                      : () async {
                          setState(() => busy = true);
                          try {
                            final ok = await GoogleAuth(
                              ref.read(apiProvider),
                              GoogleIdentityProvider(),
                            ).signIn();
                            if (ok && context.mounted) context.go('/');
                          } catch (e) {
                            if (mounted) {
                              setState(() => error = errorMessage(e));
                            }
                          } finally {
                            if (mounted) setState(() => busy = false);
                          }
                        },
                  child: const Text('Lanjutkan dengan Google'),
                ),
              TextButton(
                onPressed: () => setState(() => register = !register),
                child: Text(register ? 'Sudah punya akun? Masuk' : 'Buat akun'),
              ),
              TextButton(
                onPressed: () => action(
                  context,
                  () => ref.read(apiProvider).send('/auth/forgot-password', {
                    'email': email.text.trim(),
                  }),
                ),
                child: const Text('Lupa password'),
              ),
              TextButton(
                onPressed: () => context.push('/auth-action'),
                child: const Text('Masukkan token reset / verifikasi'),
              ),
            ],
          ),
        ),
      ),
    ),
  );
}

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});
  @override
  Widget build(BuildContext context) => Frame(
    title: 'MUSIKU+',
    actions: [
      IconButton(
        tooltip: 'Cari',
        onPressed: () => context.push('/search'),
        icon: const Icon(Icons.search),
      ),
      IconButton(
        tooltip: 'Notifikasi',
        onPressed: () => resource(context, 'Notifikasi', '/notifications'),
        icon: const Icon(Icons.notifications_outlined),
      ),
    ],
    child: ListView(
      padding: const EdgeInsets.all(20),
      children: [
        const Text(
          'Temukan duniamu.',
          style: TextStyle(fontSize: 32, fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 24),
        for (final item in [
          ('Trending music', '/music/trending', 'music'),
          ('Anime pilihan', '/anime/trending', 'anime'),
          ('Untuk kamu', '/music/recommendations', 'music'),
        ]) ...[
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 16),
            child: Text(item.$1, style: Theme.of(context).textTheme.titleLarge),
          ),
          SizedBox(
            height: 310,
            child: Remote(
              path: item.$2,
              builder: (data) => MediaList(items: records(data), kind: item.$3),
            ),
          ),
        ],
      ],
    ),
  );
}

class MediaList extends StatelessWidget {
  final List<Map<String, dynamic>> items;
  final String kind;
  const MediaList({super.key, required this.items, required this.kind});
  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) return const Center(child: Text('Belum ada konten.'));
    return ListView.builder(
      itemCount: items.length,
      itemBuilder: (context, index) {
        final item = items[index];
        final image = (item['artworkUrl'] ?? item['posterUrl'] ?? '')
            .toString();
        return ListTile(
          leading: image.isEmpty
              ? const Icon(Icons.album)
              : ClipRRect(
                  borderRadius: BorderRadius.circular(8),
                  child: CachedNetworkImage(
                    imageUrl: image,
                    width: 52,
                    height: 56,
                    fit: BoxFit.cover,
                    errorWidget: (_, __, ___) => const Icon(Icons.broken_image),
                  ),
                ),
          title: Text(
            (item['title'] ?? item['name'] ?? '').toString(),
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
          ),
          subtitle: Text(
            (item['artistName'] ?? item['studio'] ?? item['source'] ?? '')
                .toString(),
          ),
          trailing: const Icon(Icons.chevron_right),
          onTap: () => context.push(
            '/detail/$kind/${Uri.encodeComponent(entityId(item))}',
          ),
        );
      },
    );
  }
}

class BrowseScreen extends StatelessWidget {
  final String kind;
  const BrowseScreen({super.key, required this.kind});
  @override
  Widget build(BuildContext context) => DefaultTabController(
    length: 3,
    child: Frame(
      title: kind == 'music' ? 'Music' : 'Anime',
      child: Column(
        children: [
          const TabBar(
            tabs: [
              Tab(text: 'Trending'),
              Tab(text: 'Terbaru'),
              Tab(text: 'Rekomendasi'),
            ],
          ),
          Expanded(
            child: TabBarView(
              children: [
                for (final path
                    in kind == 'music'
                        ? [
                            '/music/trending',
                            '/music/new-releases',
                            '/music/recommendations',
                          ]
                        : [
                            '/anime/trending',
                            '/anime/upcoming',
                            '/anime/recommendations',
                          ])
                  Remote(
                    path: path,
                    builder: (data) =>
                        MediaList(items: records(data), kind: kind),
                  ),
              ],
            ),
          ),
        ],
      ),
    ),
  );
}

class SearchScreen extends StatefulWidget {
  const SearchScreen({super.key});
  @override
  State<SearchScreen> createState() => _SearchState();
}

class _SearchState extends State<SearchScreen> {
  String query = '';
  Timer? timer;
  @override
  void dispose() {
    timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Frame(
    title: 'Cari',
    child: Column(
      children: [
        Padding(
          padding: const EdgeInsets.all(16),
          child: TextField(
            decoration: const InputDecoration(
              labelText: 'Musik, artis, anime',
              prefixIcon: Icon(Icons.search),
            ),
            onChanged: (value) {
              timer?.cancel();
              timer = Timer(const Duration(milliseconds: 400), () {
                if (mounted) setState(() => query = value.trim());
              });
            },
          ),
        ),
        Expanded(
          child: query.isEmpty
              ? const Center(child: Text('Temukan favorit baru Anda'))
              : Remote(
                  path: '/search?q=${Uri.encodeQueryComponent(query)}',
                  builder: (data) => ListView(
                    children: [
                      for (final kind in ['songs', 'anime'])
                        SizedBox(
                          height: 350,
                          child: MediaList(
                            items: records(data[kind]),
                            kind: kind == 'songs' ? 'music' : 'anime',
                          ),
                        ),
                    ],
                  ),
                ),
        ),
      ],
    ),
  );
}

class DetailScreen extends ConsumerWidget {
  final String kind, id;
  const DetailScreen({super.key, required this.kind, required this.id});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final path = kind == 'music' ? '/music/tracks/$id' : '/anime/$id';
    return Frame(
      title: kind == 'music' ? 'Track' : 'Anime',
      child: Remote(
        path: path,
        builder: (data) {
          if (data == null) {
            return const Center(child: Text('Konten tidak ditemukan'));
          }
          final item = Map<String, dynamic>.from(data);
          final image = (item['artworkUrl'] ?? item['posterUrl'] ?? '')
              .toString();
          return ListView(
            padding: const EdgeInsets.all(24),
            children: [
              if (image.isNotEmpty)
                CachedNetworkImage(
                  imageUrl: image,
                  height: 260,
                  errorWidget: (_, __, ___) => const Icon(Icons.broken_image),
                ),
              const SizedBox(height: 20),
              Text(
                item['title'].toString(),
                style: Theme.of(context).textTheme.headlineMedium,
              ),
              Text((item['artistName'] ?? item['synopsis'] ?? '').toString()),
              const SizedBox(height: 20),
              if (kind == 'music') ...[
                FilledButton.icon(
                  icon: const Icon(Icons.play_arrow),
                  label: const Text('Putar preview resmi'),
                  onPressed: () => action(context, () async {
                    final url = item['previewUrl']?.toString() ?? '';
                    if (url.isEmpty) {
                      throw Exception('Preview tidak tersedia dari provider');
                    }
                    await audio.load(
                      MediaItem(
                        id: url,
                        title: item['title'].toString(),
                        artist: item['artistName']?.toString(),
                        artUri: image.isEmpty ? null : Uri.parse(image),
                      ),
                    );
                    await ref.read(apiProvider).send('/history/music', {
                      'trackId': id,
                    });
                    if (context.mounted) context.push('/player');
                  }),
                ),
                TextButton(
                  onPressed: () => action(
                    context,
                    () => ref.read(apiProvider).get('/music/tracks/$id/stream'),
                  ),
                  child: const Text('Akses lagu penuh (berlisensi)'),
                ),
                TextButton(
                  onPressed: () => action(
                    context,
                    () => ref
                        .read(apiProvider)
                        .send('/library/liked-songs/$id', {}),
                  ),
                  child: const Text('Sukai lagu'),
                ),
                TextButton(
                  onPressed: () async {
                    final playlist = await prompt(
                      context,
                      'ID playlist tujuan',
                    );
                    if (playlist != null &&
                        playlist.isNotEmpty &&
                        context.mounted) {
                      await action(
                        context,
                        () => ref.read(apiProvider).send(
                          '/playlists/$playlist/tracks',
                          {
                            'trackIds': [id],
                          },
                        ),
                      );
                    }
                  },
                  child: const Text('Tambahkan ke playlist'),
                ),
                TextButton(
                  onPressed: () => resource(
                    context,
                    'Lirik',
                    '/music/lyrics?artist=${Uri.encodeQueryComponent(item['artistName']?.toString() ?? '')}&title=${Uri.encodeQueryComponent(item['title'].toString())}',
                  ),
                  child: const Text('Lirik'),
                ),
              ] else ...[
                FilledButton.icon(
                  onPressed: () => action(
                    context,
                    () => ref.read(apiProvider).send('/library/watchlist', {
                      'animeId': id,
                    }),
                  ),
                  icon: const Icon(Icons.bookmark_add),
                  label: const Text('Tambah watchlist'),
                ),
                TextButton(
                  onPressed: () => action(
                    context,
                    () => ref
                        .read(apiProvider)
                        .send('/library/anime-favorites/$id', {}),
                  ),
                  child: const Text('Favorit'),
                ),
                Remote(
                  path: '/anime/$id/episodes',
                  builder: (episodes) => Column(
                    children: [
                      for (final ep in records(episodes))
                        ListTile(
                          title: Text('${ep['number']}. ${ep['title']}'),
                          trailing: const Icon(Icons.play_circle_outline),
                          onTap: () => context.push(
                            '/video/${Uri.encodeComponent(id)}/${Uri.encodeComponent((ep['_id'] ?? ep['providerEpisodeId']).toString())}',
                          ),
                        ),
                    ],
                  ),
                ),
              ],
            ],
          );
        },
      ),
    );
  }
}

class LibraryScreen extends ConsumerWidget {
  const LibraryScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) => Frame(
    title: 'Library',
    actions: [
      IconButton(
        tooltip: 'Buat playlist',
        icon: const Icon(Icons.add),
        onPressed: () async {
          final name = await prompt(context, 'Nama playlist');
          if (name != null && name.isNotEmpty && context.mounted) {
            await action(
              context,
              () => ref.read(apiProvider).send('/playlists', {'name': name}),
            );
          }
        },
      ),
    ],
    child: ListView(
      children: [
        for (final entry in [
          ('Playlist', '/playlists'),
          ('Lagu disukai', '/library/liked-songs'),
          ('Watchlist', '/library/watchlist'),
          ('Anime favorit', '/library/anime-favorites'),
          ('Riwayat musik', '/history/music'),
          ('Lanjut menonton', '/history/anime/continue-watching'),
          ('Download', '/downloads'),
        ])
          ListTile(
            title: Text(entry.$1),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => resource(context, entry.$1, entry.$2),
          ),
      ],
    ),
  );
}

class ResourceScreen extends StatelessWidget {
  final String title, path;
  const ResourceScreen({super.key, required this.title, required this.path});
  @override
  Widget build(BuildContext context) => Frame(
    title: title,
    child: Remote(
      path: path,
      builder: (data) {
        if (data is Map && data.containsKey('plain')) {
          return SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: SelectableText(
              data['plain']?.toString() ?? 'Lirik tidak tersedia',
            ),
          );
        }
        final items = records(data);
        if (items.isEmpty) return const Center(child: Text('Belum ada data.'));
        return ListView(
          children: [
            for (final item in items)
              ListTile(
                title: Text(
                  (item['name'] ??
                          item['title'] ??
                          item['message'] ??
                          item['track']?['title'] ??
                          item['anime']?['title'] ??
                          item['status'] ??
                          '')
                      .toString(),
                ),
                subtitle: Text(
                  (item['description'] ??
                          item['body'] ??
                          item['createdAt'] ??
                          '')
                      .toString(),
                ),
              ),
          ],
        );
      },
    ),
  );
}

class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) => Frame(
    title: 'Profil & Pengaturan',
    child: ListView(
      children: [
        ListTile(
          title: const Text('Keamanan akun & sesi'),
          onTap: () => context.push('/account-security'),
        ),
        Remote(
          path: '/auth/me',
          builder: (data) => Padding(
            padding: const EdgeInsets.all(24),
            child: Text(
              (data['user']?['username'] ?? data['username'] ?? 'MUSIKU+')
                  .toString(),
              style: Theme.of(context).textTheme.headlineMedium,
            ),
          ),
        ),
        ListTile(
          title: const Text('Ubah nama tampilan'),
          onTap: () async {
            final name = await prompt(context, 'Nama tampilan');
            if (name != null && context.mounted) {
              await action(
                context,
                () => ref.read(apiProvider).send('/users/profile', {
                  'displayName': name,
                }, method: 'PATCH'),
              );
            }
          },
        ),
        for (final e in [
          ('Perangkat', '/users/devices'),
          ('Premium', '/premium/plans'),
          ('Pembayaran', '/premium/payments'),
          ('Provider status', '/providers/status'),
        ])
          ListTile(
            title: Text(e.$1),
            onTap: () => resource(context, e.$1, e.$2),
          ),
        ListTile(
          title: const Text('Keluar'),
          onTap: () => action(context, () async {
            await audio.stop();
            await ref.read(apiProvider).logout();
            if (context.mounted) context.go('/login');
          }),
        ),
      ],
    ),
  );
}

class PlayerScreen extends StatelessWidget {
  const PlayerScreen({super.key});
  @override
  Widget build(BuildContext context) => Frame(
    title: 'Now playing · Preview',
    child: Center(
      child: StreamBuilder<MediaItem?>(
        stream: audio.mediaItem,
        builder: (context, snapshot) {
          final item = snapshot.data;
          return Padding(
            padding: const EdgeInsets.all(32),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                if (item?.artUri != null)
                  CachedNetworkImage(
                    imageUrl: item!.artUri.toString(),
                    height: 240,
                  ),
                const SizedBox(height: 24),
                Text(
                  item?.title ?? 'Belum ada lagu',
                  style: Theme.of(context).textTheme.headlineSmall,
                ),
                StreamBuilder<Duration>(
                  stream: audio.player.positionStream,
                  builder: (_, s) {
                    final max = (audio.player.duration?.inMilliseconds ?? 1)
                        .toDouble()
                        .clamp(1.0, double.infinity);
                    return Slider(
                      value: (s.data?.inMilliseconds ?? 0).toDouble().clamp(
                        0.0,
                        max,
                      ),
                      max: max,
                      onChanged: (value) =>
                          audio.seek(Duration(milliseconds: value.round())),
                    );
                  },
                ),
                StreamBuilder<bool>(
                  stream: audio.player.playingStream,
                  builder: (_, s) => IconButton(
                    iconSize: 72,
                    tooltip: s.data == true ? 'Pause' : 'Play',
                    icon: Icon(
                      s.data == true ? Icons.pause_circle : Icons.play_circle,
                    ),
                    onPressed: () =>
                        s.data == true ? audio.pause() : audio.play(),
                  ),
                ),
                const Text('Preview resmi; bukan akses lagu penuh.'),
              ],
            ),
          );
        },
      ),
    ),
  );
}

class VideoScreen extends ConsumerStatefulWidget {
  final String animeId, episodeId;
  const VideoScreen({
    super.key,
    required this.animeId,
    required this.episodeId,
  });
  @override
  ConsumerState<VideoScreen> createState() => _VideoState();
}

class _VideoState extends ConsumerState<VideoScreen> {
  VideoPlayerController? controller;
  String? error;
  Timer? timer;
  List<Map<String, dynamic>> subtitles = [];
  String subtitleLanguage = 'off';
  @override
  void initState() {
    super.initState();
    init();
  }

  Future<void> init() async {
    try {
      final result = await ref
          .read(apiProvider)
          .get('/anime/${widget.animeId}/episodes/${widget.episodeId}/stream');
      final url = result['streamUrl']?.toString() ?? '';
      if (url.isEmpty) {
        throw Exception('Provider tidak mengembalikan stream berlisensi.');
      }
      subtitles = records(result['subtitles']);
      final player = VideoPlayerController.networkUrl(Uri.parse(url));
      controller = player;
      await player.initialize();
      final history = records(
        await ref
            .read(apiProvider)
            .get('/history/anime?animeId=${widget.animeId}'),
      );
      for (final entry in history) {
        if (entry['episodeId'] == widget.episodeId &&
            entry['completed'] != true) {
          await player.seekTo(
            Duration(seconds: (entry['positionSec'] as num? ?? 0).toInt()),
          );
          break;
        }
      }
      await player.play();
      timer = Timer.periodic(const Duration(seconds: 15), (_) => save());
      if (mounted) setState(() {});
    } catch (e) {
      if (mounted) setState(() => error = errorMessage(e));
    }
  }

  Future<void> selectSubtitle(String language) async {
    if (language == 'off') {
      controller?.setClosedCaptionFile(null);
      setState(() => subtitleLanguage = language);
      return;
    }
    final source = subtitles.firstWhere((s) => s['language'] == language);
    final url = Uri.parse(source['url'].toString());
    if (url.scheme != 'https') throw Exception('Subtitle memerlukan HTTPS');
    // A separate client intentionally never sends the MUSIKU bearer token to media hosts.
    final result = await Dio().get<String>(
      url.toString(),
      options: Options(responseType: ResponseType.plain),
    );
    final text = result.data ?? '';
    controller?.setClosedCaptionFile(
      Future<ClosedCaptionFile>.value(
        url.path.endsWith('.srt')
            ? SubRipCaptionFile(text)
            : WebVTTCaptionFile(text),
      ),
    );
    if (mounted) setState(() => subtitleLanguage = language);
  }

  Future<void> save() async {
    final value = controller?.value;
    if (value == null) return;
    try {
      await ref.read(apiProvider).send('/history/anime', {
        'animeId': widget.animeId,
        'episodeId': widget.episodeId,
        'positionSec': value.position.inSeconds,
        'durationSec': value.duration.inSeconds,
        'completed': value.position >= value.duration,
      });
    } catch (_) {
      /* next checkpoint retries while playback remains uninterrupted */
    }
  }

  @override
  void dispose() {
    timer?.cancel();
    controller?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Anime player')),
    body: error != null
        ? Center(child: Text(error!))
        : controller?.value.isInitialized != true
        ? const Center(child: CircularProgressIndicator())
        : Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                AspectRatio(
                  aspectRatio: controller!.value.aspectRatio,
                  child: VideoPlayer(controller!),
                ),
                ValueListenableBuilder<VideoPlayerValue>(
                  valueListenable: controller!,
                  builder: (_, value, __) =>
                      ClosedCaption(text: value.caption.text),
                ),
                VideoProgressIndicator(controller!, allowScrubbing: true),
                DropdownButton<String>(
                  value: subtitleLanguage,
                  items: [
                    const DropdownMenuItem(
                      value: 'off',
                      child: Text('Subtitle off'),
                    ),
                    for (final sub in subtitles)
                      DropdownMenuItem(
                        value: sub['language'].toString(),
                        child: Text(sub['language'].toString()),
                      ),
                  ],
                  onChanged: (value) {
                    if (value != null) {
                      action(context, () => selectSubtitle(value));
                    }
                  },
                ),
                PopupMenuButton<double>(
                  tooltip: 'Kecepatan playback',
                  onSelected: (speed) => controller!.setPlaybackSpeed(speed),
                  itemBuilder: (_) => [
                    for (final speed in [0.5, 1.0, 1.25, 1.5, 2.0])
                      PopupMenuItem(value: speed, child: Text('${speed}x')),
                  ],
                ),
                IconButton(
                  tooltip: 'Play / Pause',
                  onPressed: () {
                    setState(() {
                      controller!.value.isPlaying
                          ? controller!.pause()
                          : controller!.play();
                    });
                  },
                  icon: Icon(
                    controller!.value.isPlaying
                        ? Icons.pause
                        : Icons.play_arrow,
                  ),
                ),
              ],
            ),
          ),
  );
}
