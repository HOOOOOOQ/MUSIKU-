// Material compatibility export retained for supported Flutter stable versions.
// ignore: deprecated_member_use
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../core/api.dart';
import '../core/audio.dart';
import 'screens.dart';

class AccountSecurityScreen extends ConsumerWidget {
  const AccountSecurityScreen({super.key});
  Future<void> clearSession(WidgetRef ref) async {
    await ref.read(apiProvider).storage.delete(key: 'accessToken');
    await ref.read(apiProvider).storage.delete(key: 'refreshToken');
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return DefaultTabController(
      length: 3,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Keamanan akun'),
          bottom: const TabBar(
            tabs: [
              Tab(text: 'Sesi'),
              Tab(text: 'Perangkat'),
              Tab(text: 'Login'),
            ],
          ),
        ),
        body: Column(
          children: [
            Wrap(
              children: [
                TextButton(
                  onPressed: () => action(
                    context,
                    () => ref
                        .read(apiProvider)
                        .send('/auth/resend-verification', {}),
                  ),
                  child: const Text('Kirim ulang verifikasi'),
                ),
                TextButton(
                  onPressed: () => context.push('/auth-action'),
                  child: const Text('Masukkan token'),
                ),
                TextButton(
                  onPressed: () => action(context, () async {
                    await ref.read(apiProvider).send('/auth/revoke-all', {});
                    await clearSession(ref);
                    if (context.mounted) {
                      context.go('/login');
                    }
                  }),
                  child: const Text('Keluar semua sesi'),
                ),
              ],
            ),
            Expanded(
              child: TabBarView(
                children: [
                  for (final entry in [
                    ('/auth/sessions', 'session'),
                    ('/users/devices', 'device'),
                    ('/users/login-history', 'history'),
                  ])
                    Remote(
                      path: entry.$1,
                      builder: (data) => ListView(
                        children: [
                          for (final item in records(data))
                            ListTile(
                              title: Text(
                                (item['deviceId'] ??
                                        item['method'] ??
                                        'Android')
                                    .toString(),
                              ),
                              subtitle: Text(
                                (item['userAgent'] ?? item['createdAt'] ?? '')
                                    .toString(),
                              ),
                              trailing: entry.$2 == 'history'
                                  ? Icon(
                                      item['success'] == true
                                          ? Icons.check_circle
                                          : Icons.error_outline,
                                    )
                                  : IconButton(
                                      tooltip: 'Cabut akses',
                                      icon: const Icon(Icons.logout),
                                      onPressed: () => action(context, () async {
                                        final path = entry.$2 == 'session'
                                            ? '/auth/sessions/${item['_id']}'
                                            : '/users/devices/${item['deviceId']}';
                                        await ref
                                            .read(apiProvider)
                                            .send(path, {}, method: 'DELETE');
                                        ref.invalidate(
                                          resourceProvider(entry.$1),
                                        );
                                      }),
                                    ),
                            ),
                        ],
                      ),
                    ),
                ],
              ),
            ),
            TextButton(
              onPressed: () async {
                final confirmed = await showDialog<bool>(
                  context: context,
                  builder: (c) => AlertDialog(
                    title: const Text('Hapus akun?'),
                    content: const Text(
                      'Akun dinonaktifkan dan seluruh sesi dicabut. Tindakan ini tidak dapat dibatalkan dari aplikasi.',
                    ),
                    actions: [
                      TextButton(
                        onPressed: () => Navigator.pop(c, false),
                        child: const Text('Batal'),
                      ),
                      FilledButton(
                        onPressed: () => Navigator.pop(c, true),
                        child: const Text('Hapus'),
                      ),
                    ],
                  ),
                );
                if (confirmed == true && context.mounted) {
                  await action(context, () async {
                    await ref
                        .read(apiProvider)
                        .send('/auth/account', {}, method: 'DELETE');
                    await audio.stop();
                    await clearSession(ref);
                    if (context.mounted) {
                      context.go('/login');
                    }
                  });
                }
              },
              child: const Text('Hapus akun'),
            ),
          ],
        ),
      ),
    );
  }
}
