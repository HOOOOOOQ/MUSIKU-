// Material compatibility export retained for supported Flutter stable versions.
// ignore: deprecated_member_use
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:audio_service/audio_service.dart';
import '../core/api.dart';
import '../core/audio.dart';
import 'screens.dart';

/// Resolves the referenced music track document of a playlist entry.
Map<String, dynamic> trackOf(Map<String, dynamic> entry) {
  final track = entry['track'];
  if (track is Map) {
    return Map<String, dynamic>.from(track);
  }
  return <String, dynamic>{
    '_id': track?.toString() ?? '',
    'title': 'Track tidak tersedia',
  };
}

String trackIdOf(Map<String, dynamic> entry) =>
    (trackOf(entry)['_id'] ?? '').toString();

/// Pure helper used by the drag-and-drop reorder handler. `newIndex` follows
/// Flutter's ReorderableListView convention (the index before removal), so a
/// downward move has to be shifted by one to get the persisted order.
List<String> reorderedTrackIds(
  List<Map<String, dynamic>> entries,
  int oldIndex,
  int newIndex,
) {
  final ids = entries.map(trackIdOf).where((id) => id.isNotEmpty).toList();
  if (oldIndex < 0 || oldIndex >= ids.length) {
    return ids;
  }
  var target = newIndex > oldIndex ? newIndex - 1 : newIndex;
  if (target < 0) {
    target = 0;
  }
  if (target > ids.length - 1) {
    target = ids.length - 1;
  }
  final moved = ids.removeAt(oldIndex);
  ids.insert(target, moved);
  return ids;
}

String currentUserId(dynamic me) {
  if (me is! Map) {
    return '';
  }
  final user = me['user'];
  final source = user is Map ? user : me;
  return (source['_id'] ?? '').toString();
}

class PlaylistListScreen extends ConsumerWidget {
  const PlaylistListScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) => Frame(
    title: 'Playlist',
    actions: [
      IconButton(
        tooltip: 'Buat playlist',
        icon: const Icon(Icons.add),
        onPressed: () async {
          final name = await prompt(context, 'Nama playlist');
          if (name != null && name.isNotEmpty && context.mounted) {
            await action(context, () async {
              await ref.read(apiProvider).send('/playlists', {'name': name});
              ref.invalidate(resourceProvider('/playlists'));
            });
          }
        },
      ),
    ],
    child: Remote(
      path: '/playlists',
      builder: (data) {
        final owned = records(data is Map ? data['owned'] : data);
        final followed = records(data is Map ? data['followed'] : null);
        if (owned.isEmpty && followed.isEmpty) {
          return const Center(child: Text('Belum ada playlist.'));
        }
        Widget tile(Map<String, dynamic> playlist, String id) => ListTile(
          title: Text((playlist['name'] ?? '').toString()),
          subtitle: Text(
            '${playlist['trackCount'] ?? 0} track · ${playlist['visibility'] ?? 'private'}',
          ),
          trailing: const Icon(Icons.chevron_right),
          onTap: () => context.push('/playlist/$id'),
        );
        return ListView(
          children: [
            if (owned.isNotEmpty)
              const Padding(
                padding: EdgeInsets.fromLTRB(16, 16, 16, 4),
                child: Text('Playlist saya'),
              ),
            for (final playlist in owned)
              if (entityId(playlist).isNotEmpty)
                tile(playlist, entityId(playlist)),
            if (followed.isNotEmpty)
              const Padding(
                padding: EdgeInsets.fromLTRB(16, 16, 16, 4),
                child: Text('Diikuti'),
              ),
            for (final playlist in followed)
              if (entityId(playlist).isNotEmpty)
                tile(playlist, entityId(playlist)),
          ],
        );
      },
    ),
  );
}

class PlaylistDetailScreen extends ConsumerWidget {
  final String id;
  const PlaylistDetailScreen({super.key, required this.id});

  Future<void> mutate(
    BuildContext context,
    WidgetRef ref,
    Future<dynamic> Function() work,
  ) async {
    await action(context, work);
    ref.invalidate(resourceProvider('/playlists/$id'));
  }

  Future<void> share(BuildContext context, WidgetRef ref, String token) async {
    if (token.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Playlist ini tidak memiliki token berbagi.'),
        ),
      );
      return;
    }
    final base = ref.read(apiProvider).dio.options.baseUrl;
    await Clipboard.setData(
      ClipboardData(text: '$base/playlists/shared/$token'),
    );
    if (context.mounted) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Tautan berbagi disalin.')));
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) => Frame(
    title: 'Playlist',
    child: Remote(
      path: '/playlists/$id',
      builder: (data) => Remote(
        path: '/auth/me',
        builder: (me) {
          final playlist = data is Map
              ? Map<String, dynamic>.from(data)
              : <String, dynamic>{};
          final entries = records(playlist['tracks']);
          final owner = (playlist['owner'] ?? '').toString();
          final userId = currentUserId(me);
          final isOwner = userId.isNotEmpty && owner == userId;
          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      (playlist['name'] ?? 'Playlist').toString(),
                      style: Theme.of(context).textTheme.headlineSmall,
                    ),
                    Text((playlist['description'] ?? '').toString()),
                    Text(
                      '${entries.length} track · ${playlist['visibility'] ?? 'private'}'
                      '${playlist['collaborative'] == true ? ' · kolaboratif' : ''}',
                    ),
                  ],
                ),
              ),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 8),
                child: Wrap(
                  children: [
                    if (isOwner) ...[
                      TextButton.icon(
                        icon: const Icon(Icons.edit_outlined),
                        label: const Text('Ubah nama'),
                        onPressed: () async {
                          final name = await prompt(context, 'Nama playlist');
                          if (name != null &&
                              name.isNotEmpty &&
                              context.mounted) {
                            await mutate(
                              context,
                              ref,
                              () => ref.read(apiProvider).send(
                                '/playlists/$id',
                                {'name': name},
                                method: 'PATCH',
                              ),
                            );
                          }
                        },
                      ),
                      TextButton.icon(
                        icon: const Icon(Icons.visibility_outlined),
                        label: Text(
                          playlist['visibility'] == 'public'
                              ? 'Jadikan privat'
                              : 'Jadikan publik',
                        ),
                        onPressed: () => mutate(
                          context,
                          ref,
                          () => ref.read(apiProvider).send('/playlists/$id', {
                            'visibility': playlist['visibility'] == 'public'
                                ? 'private'
                                : 'public',
                          }, method: 'PATCH'),
                        ),
                      ),
                      TextButton.icon(
                        icon: const Icon(Icons.library_add_outlined),
                        label: const Text('Duplikat'),
                        onPressed: () => mutate(
                          context,
                          ref,
                          () => ref
                              .read(apiProvider)
                              .send('/playlists/$id/duplicate', {}),
                        ),
                      ),
                      TextButton.icon(
                        icon: const Icon(Icons.playlist_add),
                        label: const Text('Tambah track'),
                        onPressed: () async {
                          final trackId = await prompt(context, 'ID track');
                          if (trackId != null &&
                              trackId.isNotEmpty &&
                              context.mounted) {
                            await mutate(
                              context,
                              ref,
                              () => ref.read(apiProvider).send(
                                '/playlists/$id/tracks',
                                {
                                  'trackIds': [trackId],
                                },
                              ),
                            );
                          }
                        },
                      ),
                    ],
                    TextButton.icon(
                      icon: const Icon(Icons.share_outlined),
                      label: const Text('Bagikan'),
                      onPressed: () => share(
                        context,
                        ref,
                        (playlist['shareToken'] ?? '').toString(),
                      ),
                    ),
                    if (!isOwner)
                      TextButton.icon(
                        icon: const Icon(Icons.person_add_alt_1_outlined),
                        label: const Text('Ikuti'),
                        onPressed: () => mutate(
                          context,
                          ref,
                          () => ref
                              .read(apiProvider)
                              .send('/playlists/$id/follow', {}),
                        ),
                      ),
                    if (!isOwner)
                      TextButton.icon(
                        icon: const Icon(Icons.person_remove_alt_1_outlined),
                        label: const Text('Berhenti mengikuti'),
                        onPressed: () => mutate(
                          context,
                          ref,
                          () => ref
                              .read(apiProvider)
                              .send(
                                '/playlists/$id/follow',
                                {},
                                method: 'DELETE',
                              ),
                        ),
                      ),
                    if (isOwner)
                      TextButton.icon(
                        icon: const Icon(Icons.delete_outline),
                        label: const Text('Hapus playlist'),
                        onPressed: () async {
                          final confirmed = await showDialog<bool>(
                            context: context,
                            builder: (dialogContext) => AlertDialog(
                              title: const Text('Hapus playlist?'),
                              content: const Text(
                                'Playlist dan daftar tracknya dihapus dari library Anda.',
                              ),
                              actions: [
                                TextButton(
                                  onPressed: () =>
                                      Navigator.pop(dialogContext, false),
                                  child: const Text('Batal'),
                                ),
                                FilledButton(
                                  onPressed: () =>
                                      Navigator.pop(dialogContext, true),
                                  child: const Text('Hapus'),
                                ),
                              ],
                            ),
                          );
                          if (confirmed != true || !context.mounted) {
                            return;
                          }
                          await ref
                              .read(apiProvider)
                              .send('/playlists/$id', {}, method: 'DELETE');
                          ref.invalidate(resourceProvider('/playlists'));
                          if (context.mounted) {
                            context.go('/library');
                          }
                        },
                      ),
                  ],
                ),
              ),
              Expanded(
                child: entries.isEmpty
                    ? const Center(child: Text('Playlist kosong.'))
                    : ReorderableListView.builder(
                        itemCount: entries.length,
                        onReorder: (oldIndex, newIndex) => mutate(
                          context,
                          ref,
                          () => ref
                              .read(apiProvider)
                              .send('/playlists/$id/reorder', {
                                'orderedTrackIds': reorderedTrackIds(
                                  entries,
                                  oldIndex,
                                  newIndex,
                                ),
                              }),
                        ),
                        itemBuilder: (context, index) {
                          final entry = entries[index];
                          final track = trackOf(entry);
                          final trackId = trackIdOf(entry);
                          return ListTile(
                            key: ValueKey('track-$trackId-$index'),
                            leading: IconButton(
                              tooltip: 'Putar preview resmi',
                              icon: const Icon(Icons.play_arrow),
                              onPressed: () => action(context, () async {
                                final url = (track['previewUrl'] ?? '')
                                    .toString();
                                if (url.isEmpty) {
                                  throw Exception(
                                    'Preview tidak tersedia dari provider',
                                  );
                                }
                                await audio.load(
                                  MediaItem(
                                    id: url,
                                    title: (track['title'] ?? 'Track')
                                        .toString(),
                                    artist: track['artistName']?.toString(),
                                  ),
                                );
                                if (context.mounted) {
                                  context.push('/player');
                                }
                              }),
                            ),
                            title: Text((track['title'] ?? 'Track').toString()),
                            subtitle: Text(
                              (track['artistName'] ?? '').toString(),
                            ),
                            trailing: isOwner
                                ? IconButton(
                                    tooltip: 'Hapus dari playlist',
                                    icon: const Icon(Icons.close),
                                    onPressed: () => mutate(
                                      context,
                                      ref,
                                      () => ref
                                          .read(apiProvider)
                                          .send(
                                            '/playlists/$id/tracks/$trackId',
                                            {},
                                            method: 'DELETE',
                                          ),
                                    ),
                                  )
                                : const Icon(Icons.drag_handle),
                          );
                        },
                      ),
              ),
            ],
          );
        },
      ),
    ),
  );
}

/// Read-only view of a playlist opened through its share token
/// (`GET /playlists/shared/:token`).
class SharedPlaylistScreen extends ConsumerWidget {
  final String token;
  const SharedPlaylistScreen({super.key, required this.token});

  @override
  Widget build(BuildContext context, WidgetRef ref) => Frame(
    title: 'Playlist dibagikan',
    child: Remote(
      path: '/playlists/shared/$token',
      builder: (data) {
        final playlist = data is Map
            ? Map<String, dynamic>.from(data)
            : <String, dynamic>{};
        final entries = records(playlist['tracks']);
        final playlistId = entityId(playlist);
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    (playlist['name'] ?? 'Playlist').toString(),
                    style: Theme.of(context).textTheme.headlineSmall,
                  ),
                  Text((playlist['description'] ?? '').toString()),
                  Text('${entries.length} track · dibagikan'),
                ],
              ),
            ),
            if (playlistId.isNotEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: FilledButton.icon(
                  icon: const Icon(Icons.open_in_new),
                  label: const Text('Buka pengelola playlist'),
                  onPressed: () => context.push('/playlist/$playlistId'),
                ),
              ),
            Expanded(
              child: entries.isEmpty
                  ? const Center(child: Text('Playlist kosong.'))
                  : ListView(
                      children: [
                        for (final entry in entries)
                          ListTile(
                            title: Text(
                              (trackOf(entry)['title'] ?? 'Track').toString(),
                            ),
                            subtitle: Text(
                              (trackOf(entry)['artistName'] ?? '').toString(),
                            ),
                            trailing: const Icon(Icons.drag_handle),
                          ),
                      ],
                    ),
            ),
          ],
        );
      },
    ),
  );
}
