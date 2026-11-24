// Material compatibility export retained for supported Flutter stable versions.
// ignore: deprecated_member_use
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../core/api.dart';
import 'screens.dart';

const notificationPreferences = <(String, String)>[
  ('pushEnabled', 'Push notification'),
  ('newMusic', 'Rilis musik baru'),
  ('newEpisodes', 'Episode baru'),
  ('artistUpdates', 'Update artis'),
  ('animeUpdates', 'Update anime'),
  ('playlistUpdates', 'Update playlist'),
  ('account', 'Akun'),
  ('premium', 'Premium & pembayaran'),
  ('security', 'Keamanan'),
];

class NotificationsScreen extends ConsumerWidget {
  const NotificationsScreen({super.key});

  Future<void> mutate(
    BuildContext context,
    WidgetRef ref,
    Future<dynamic> Function() work,
  ) async {
    await action(context, work);
    ref.invalidate(resourceProvider('/notifications'));
    ref.invalidate(resourceProvider('/notifications/preferences'));
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) => Frame(
    title: 'Notifikasi',
    actions: [
      IconButton(
        tooltip: 'Tandai semua dibaca',
        icon: const Icon(Icons.done_all),
        onPressed: () => mutate(
          context,
          ref,
          () => ref.read(apiProvider).send('/notifications/read-all', {}),
        ),
      ),
    ],
    child: ListView(
      children: [
        Remote(
          path: '/notifications',
          builder: (data) {
            final items = records(data);
            if (items.isEmpty) {
              return const Padding(
                padding: EdgeInsets.all(24),
                child: Text('Belum ada notifikasi.'),
              );
            }
            return Column(
              children: [
                for (final item in items)
                  if (entityId(item).isNotEmpty)
                    ListTile(
                      leading: Icon(
                        item['read'] == true
                            ? Icons.notifications_none
                            : Icons.notifications_active,
                      ),
                      title: Text(
                        (item['title'] ?? item['type'] ?? '').toString(),
                      ),
                      subtitle: Text(
                        (item['body'] ?? item['createdAt'] ?? '').toString(),
                      ),
                      trailing: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          if (item['read'] != true)
                            IconButton(
                              tooltip: 'Tandai dibaca',
                              icon: const Icon(
                                Icons.markunread_mailbox_outlined,
                              ),
                              onPressed: () => mutate(
                                context,
                                ref,
                                () => ref
                                    .read(apiProvider)
                                    .send(
                                      '/notifications/${entityId(item)}/read',
                                      {},
                                    ),
                              ),
                            ),
                          IconButton(
                            tooltip: 'Hapus',
                            icon: const Icon(Icons.delete_outline),
                            onPressed: () => mutate(
                              context,
                              ref,
                              () => ref
                                  .read(apiProvider)
                                  .send(
                                    '/notifications/${entityId(item)}',
                                    {},
                                    method: 'DELETE',
                                  ),
                            ),
                          ),
                        ],
                      ),
                    ),
              ],
            );
          },
        ),
        const Padding(
          padding: EdgeInsets.fromLTRB(16, 16, 16, 8),
          child: Text('Preferensi notifikasi'),
        ),
        Remote(
          path: '/notifications/preferences',
          builder: (data) {
            final prefs = data is Map ? data : const <String, dynamic>{};
            return Column(
              children: [
                for (final entry in notificationPreferences)
                  SwitchListTile(
                    title: Text(entry.$2),
                    value: prefs[entry.$1] != false,
                    onChanged: (value) => mutate(
                      context,
                      ref,
                      () => ref.read(apiProvider).send(
                        '/notifications/preferences',
                        {entry.$1: value},
                        method: 'PATCH',
                      ),
                    ),
                  ),
              ],
            );
          },
        ),
      ],
    ),
  );
}
