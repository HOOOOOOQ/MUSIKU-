import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:musiku_plus/main.dart';

void main() {
  testWidgets('protected navigation redirects anonymous user to login', (
    tester,
  ) async {
    FlutterSecureStorage.setMockInitialValues({'onboarded': 'true'});
    router.go('/library');
    await tester.pumpWidget(const ProviderScope(child: MusikuApp()));
    await tester.pumpAndSettle();
    expect(find.text('Selamat datang kembali'), findsOneWidget);
    router.go('/auth-action');
    await tester.pumpAndSettle();
    expect(find.text('Pemulihan akun'), findsOneWidget);
  });
}
