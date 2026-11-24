// Material compatibility export retained for supported Flutter stable versions.
// ignore: deprecated_member_use
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';
import '../core/api.dart';
import 'screens.dart';

/// Formats an integer rupiah amount without adding an intl dependency.
String rupiah(num value) {
  final digits = value.toInt().toString();
  final groups = <String>[];
  for (var end = digits.length; end > 0; end -= 3) {
    groups.insert(0, digits.substring(end - 3 < 0 ? 0 : end - 3, end));
  }
  return 'Rp ${groups.join('.')}';
}

class PremiumScreen extends ConsumerWidget {
  const PremiumScreen({super.key});

  /// Starts a real backend checkout and opens the provider-hosted payment page.
  /// No fake success state is produced: a missing checkout URL or an
  /// unconfigured payment provider is surfaced to the user as an error.
  Future<void> checkout(
    BuildContext context,
    WidgetRef ref,
    String planId,
  ) async {
    try {
      final result = await ref.read(apiProvider).send('/premium/checkout', {
        'planId': planId,
      });
      final url = result is Map ? result['checkoutUrl']?.toString() : null;
      if (url == null || url.isEmpty) {
        throw Exception(
          'Backend tidak mengembalikan URL pembayaran. Pembayaran belum dikonfigurasi.',
        );
      }
      final opened = await launchUrl(
        Uri.parse(url),
        mode: LaunchMode.externalApplication,
      );
      if (!opened) {
        throw Exception('Tidak dapat membuka halaman pembayaran: $url');
      }
      ref.invalidate(resourceProvider('/premium/status'));
      ref.invalidate(resourceProvider('/premium/payments'));
    } catch (error) {
      if (context.mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(errorMessage(error))));
      }
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) => Frame(
    title: 'Premium',
    child: ListView(
      children: [
        Remote(
          path: '/premium/status',
          builder: (data) {
            final status = data is Map ? data : const <String, dynamic>{};
            final premium = status['premium'] == true;
            return Card(
              margin: const EdgeInsets.all(16),
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      premium ? 'Premium aktif' : 'Paket Free',
                      style: Theme.of(context).textTheme.titleLarge,
                    ),
                    const SizedBox(height: 4),
                    Text(
                      premium && status['premiumExpiresAt'] != null
                          ? 'Berlaku sampai ${status['premiumExpiresAt']}'
                          : 'Aktifkan premium untuk fitur penuh.',
                    ),
                    if (status['paymentsConfigured'] != true)
                      const Padding(
                        padding: EdgeInsets.only(top: 8),
                        child: Text(
                          'Payment gateway belum dikonfigurasi di backend.',
                        ),
                      ),
                    if (premium)
                      TextButton(
                        onPressed: () => action(context, () async {
                          await ref
                              .read(apiProvider)
                              .send('/premium/cancel', {});
                          ref.invalidate(resourceProvider('/premium/status'));
                        }),
                        child: const Text('Batalkan langganan'),
                      ),
                  ],
                ),
              ),
            );
          },
        ),
        Remote(
          path: '/premium/plans',
          builder: (data) {
            final plans = records(data);
            if (plans.isEmpty) {
              return const Padding(
                padding: EdgeInsets.all(24),
                child: Text('Paket tidak tersedia.'),
              );
            }
            return Column(
              children: [
                for (final plan in plans)
                  Card(
                    margin: const EdgeInsets.symmetric(
                      horizontal: 16,
                      vertical: 6,
                    ),
                    child: ListTile(
                      title: Text(
                        (plan['name'] ?? plan['id'] ?? '').toString(),
                      ),
                      subtitle: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(rupiah((plan['priceIdr'] ?? 0) as num)),
                          for (final feature
                              in (plan['features'] as List? ?? []))
                            Text('• ${feature.toString()}'),
                        ],
                      ),
                      trailing: (plan['priceIdr'] as num? ?? 0) > 0
                          ? FilledButton(
                              onPressed: () =>
                                  checkout(context, ref, plan['id'].toString()),
                              child: const Text('Beli'),
                            )
                          : const Chip(label: Text('Aktif')),
                    ),
                  ),
              ],
            );
          },
        ),
        const Padding(
          padding: EdgeInsets.fromLTRB(16, 16, 16, 8),
          child: Text('Riwayat pembayaran'),
        ),
        Remote(
          path: '/premium/payments',
          builder: (data) {
            final payments = records(data);
            if (payments.isEmpty) {
              return const Padding(
                padding: EdgeInsets.all(16),
                child: Text('Belum ada pembayaran.'),
              );
            }
            return Column(
              children: [
                for (final payment in payments)
                  ListTile(
                    title: Text(
                      '${payment['plan'] ?? payment['provider'] ?? 'Pembayaran'} — ${payment['status'] ?? ''}',
                    ),
                    subtitle: Text(
                      '${rupiah((payment['amount'] ?? 0) as num)} · ${payment['createdAt'] ?? ''}',
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
