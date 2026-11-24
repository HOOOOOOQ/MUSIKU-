// Material compatibility export retained for supported Flutter stable versions.
// ignore: deprecated_member_use
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:musiku_plus/core/api.dart';
import 'package:musiku_plus/features/notifications.dart';
import 'package:musiku_plus/features/premium.dart';

class FakeApi extends Api {
  final calls = <String>[];
  @override
  Future<dynamic> get(String path) async {
    switch (path) {
      case '/premium/status':
        return {'premium': false, 'paymentsConfigured': false};
      case '/premium/plans':
        return [
          {'id': 'free', 'name': 'Free', 'priceIdr': 0, 'features': []},
          {
            'id': 'premium_monthly',
            'name': 'Premium Monthly',
            'priceIdr': 49000,
            'features': ['Ad-free experience'],
          },
        ];
      case '/premium/payments':
        return [];
      case '/notifications':
        return {
          'items': [
            {
              '_id': 'n1',
              'title': 'Episode tersedia',
              'body': 'One Piece 1100',
              'read': false,
            },
          ],
          'total': 1,
          'unread': 1,
        };
      case '/notifications/preferences':
        return {'pushEnabled': true, 'newEpisodes': false};
    }
    return null;
  }

  @override
  Future<dynamic> send(
    String path,
    dynamic data, {
    String method = 'POST',
  }) async {
    calls.add('$method $path ${data is Map ? data.keys.join(",") : ""}'.trim());
    return {};
  }
}

Widget harness(FakeApi api, Widget child) => ProviderScope(
  overrides: [apiProvider.overrideWithValue(api)],
  child: MaterialApp(home: child),
);

void main() {
  testWidgets('premium checkout reports unconfigured payment honestly', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1200, 2600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final api = FakeApi();
    await tester.pumpWidget(harness(api, const PremiumScreen()));
    await tester.pumpAndSettle();
    expect(find.text('Premium Monthly'), findsOneWidget);
    expect(find.text('Rp 49.000'), findsOneWidget);
    expect(find.text('Paket Free'), findsOneWidget);
    await tester.tap(find.text('Beli'));
    await tester.pumpAndSettle();
    expect(api.calls.any((c) => c.contains('/premium/checkout')), isTrue);
    expect(
      find.textContaining('tidak mengembalikan URL pembayaran'),
      findsOneWidget,
    );
  });

  testWidgets(
    'notification read, delete and preference controls call the API',
    (tester) async {
      tester.view.physicalSize = const Size(1200, 2600);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final api = FakeApi();
      await tester.pumpWidget(harness(api, const NotificationsScreen()));
      await tester.pumpAndSettle();
      expect(find.text('Episode tersedia'), findsOneWidget);

      await tester.tap(find.byTooltip('Tandai dibaca'));
      await tester.pumpAndSettle();
      expect(api.calls.any((c) => c == 'POST /notifications/n1/read'), isTrue);

      await tester.tap(find.byTooltip('Hapus'));
      await tester.pumpAndSettle();
      expect(api.calls.any((c) => c == 'DELETE /notifications/n1'), isTrue);

      await tester.tap(find.byTooltip('Tandai semua dibaca'));
      await tester.pumpAndSettle();
      expect(api.calls.any((c) => c == 'POST /notifications/read-all'), isTrue);

      await tester.tap(find.byType(Switch).first);
      await tester.pumpAndSettle();
      expect(
        api.calls.any(
          (c) => c == 'PATCH /notifications/preferences pushEnabled',
        ),
        isTrue,
      );
    },
  );
}
