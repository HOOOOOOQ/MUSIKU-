import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:musiku_plus/features/auth_action.dart';
import 'package:musiku_plus/features/screens.dart';

void main() {
  testWidgets(
    'email authentication controls and no unconfigured provider button',
    (tester) async {
      await tester.pumpWidget(
        const ProviderScope(child: MaterialApp(home: AuthScreen())),
      );
      expect(find.text('Email'), findsOneWidget);
      expect(find.text('Password'), findsOneWidget);
      expect(find.text('Lanjutkan dengan Google'), findsNothing);
      await tester.tap(find.text('Buat akun'));
      await tester.pump();
      expect(find.text('Username'), findsOneWidget);
    },
  );
  testWidgets('reset and verification modes change password field', (
    tester,
  ) async {
    await tester.pumpWidget(
      const ProviderScope(child: MaterialApp(home: AuthActionScreen())),
    );
    expect(find.text('Password baru (minimal 8 karakter)'), findsOneWidget);
    await tester.tap(find.byType(Switch));
    await tester.pump();
    expect(find.text('Password baru (minimal 8 karakter)'), findsNothing);
  });
  testWidgets('empty media list is explicit', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: MediaList(items: [], kind: 'music'),
        ),
      ),
    );
    expect(find.text('Belum ada konten.'), findsOneWidget);
  });
}
