// Material compatibility export retained for supported Flutter stable versions.
// ignore: deprecated_member_use
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:musiku_plus/core/api.dart';
import 'package:musiku_plus/features/playlists.dart';

class FakeApi extends Api {
  final calls = <String>[];
  @override
  Future<dynamic> get(String path) async {
    switch (path) {
      case '/playlists':
        return {
          'owned': [
            {
              '_id': 'p1',
              'name': 'Road trip',
              'trackCount': 2,
              'visibility': 'private',
            },
          ],
          'followed': [
            {
              '_id': 'p2',
              'name': 'Chill bersama',
              'trackCount': 5,
              'visibility': 'public',
            },
          ],
        };
      case '/playlists/p1':
        return {
          '_id': 'p1',
          'name': 'Road trip',
          'description': 'Perjalanan',
          'visibility': 'private',
          'owner': 'u1',
          'shareToken': 'token123',
          'tracks': [
            {
              '_id': 'pt1',
              'position': 0,
              'track': {
                '_id': 't1',
                'title': 'Song one',
                'artistName': 'Artist A',
                'previewUrl': 'https://example.invalid/1.mp3',
              },
            },
            {
              '_id': 'pt2',
              'position': 1,
              'track': {
                '_id': 't2',
                'title': 'Song two',
                'artistName': 'Artist B',
                'previewUrl': '',
              },
            },
          ],
        };
      case '/playlists/shared/token123':
        return {
          '_id': 'p1',
          'name': 'Road trip',
          'description': 'Dibagikan teman',
          'tracks': [
            {
              '_id': 'pt1',
              'position': 0,
              'track': {
                '_id': 't1',
                'title': 'Song one',
                'artistName': 'Artist A',
              },
            },
          ],
        };
      case '/auth/me':
        return {
          'user': {'_id': 'u1', 'username': 'owner'},
        };
    }
    return null;
  }

  @override
  Future<dynamic> send(
    String path,
    dynamic data, {
    String method = 'POST',
  }) async {
    calls.add('$method $path $data');
    return {};
  }
}

Widget harness(FakeApi api, Widget child) => ProviderScope(
  overrides: [apiProvider.overrideWithValue(api)],
  child: MaterialApp(home: child),
);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
          SystemChannels.platform,
          (call) async => null,
        );
  });

  test(
    'reorder helper converts Flutter indices into persisted track order',
    () {
      final entries = [
        {
          'track': {'_id': 't1'},
        },
        {
          'track': {'_id': 't2'},
        },
        {
          'track': {'_id': 't3'},
        },
      ];
      expect(reorderedTrackIds(entries, 0, 2), ['t2', 't1', 't3']);
      expect(reorderedTrackIds(entries, 2, 0), ['t3', 't1', 't2']);
      expect(reorderedTrackIds(entries, 0, 3), ['t2', 't3', 't1']);
      expect(reorderedTrackIds(entries, 5, 0), ['t1', 't2', 't3']);
      expect(reorderedTrackIds([], 0, 1), isEmpty);
    },
  );

  test('playlist identity helpers tolerate unpopulated references', () {
    expect(
      trackIdOf({
        'track': {'_id': 't9'},
      }),
      't9',
    );
    expect(trackIdOf({'track': 't9'}), 't9');
    expect(trackOf({'track': 't9'})['title'], 'Track tidak tersedia');
    expect(
      currentUserId({
        'user': {'_id': 'u7'},
      }),
      'u7',
    );
    expect(currentUserId({'_id': 'u8'}), 'u8');
    expect(currentUserId(null), '');
  });

  testWidgets('playlist list shows owned and followed sections', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1200, 2600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(harness(FakeApi(), const PlaylistListScreen()));
    await tester.pumpAndSettle();
    expect(find.text('Playlist saya'), findsOneWidget);
    expect(find.text('Road trip'), findsOneWidget);
    expect(find.text('Diikuti'), findsOneWidget);
    expect(find.text('Chill bersama'), findsOneWidget);
  });

  testWidgets('owner management actions call the playlist API', (tester) async {
    tester.view.physicalSize = const Size(1200, 2600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final api = FakeApi();
    await tester.pumpWidget(harness(api, const PlaylistDetailScreen(id: 'p1')));
    await tester.pumpAndSettle();
    expect(find.text('Song one'), findsOneWidget);
    expect(find.text('Song two'), findsOneWidget);
    expect(find.text('Berhenti mengikuti'), findsNothing);

    await tester.tap(find.byTooltip('Hapus dari playlist').first);
    await tester.pumpAndSettle();
    expect(
      api.calls.any((c) => c == 'DELETE /playlists/p1/tracks/t1 {}'),
      isTrue,
    );

    await tester.tap(find.text('Jadikan publik'));
    await tester.pumpAndSettle();
    expect(
      api.calls.any((c) => c == 'PATCH /playlists/p1 {visibility: public}'),
      isTrue,
    );

    await tester.tap(find.text('Duplikat'));
    await tester.pumpAndSettle();
    expect(
      api.calls.any((c) => c == 'POST /playlists/p1/duplicate {}'),
      isTrue,
    );

    // Sharing copies the real backend share URL through the platform clipboard.
    await tester.tap(find.text('Bagikan'));
    await tester.pumpAndSettle();
    expect(
      platformCalls.any(
        (call) =>
            call.method == 'Clipboard.setData' &&
            (call.arguments as Map)['text'].toString().endsWith(
              '/playlists/shared/token123',
            ),
      ),
      isTrue,
    );
  });

  testWidgets('shared playlist opens read-only through its token', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1200, 2600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      harness(FakeApi(), const SharedPlaylistScreen(token: 'token123')),
    );
    await tester.pumpAndSettle();
    expect(find.text('Road trip'), findsOneWidget);
    expect(find.text('Dibagikan teman'), findsOneWidget);
    expect(find.text('Song one'), findsOneWidget);
    expect(find.byTooltip('Hapus dari playlist'), findsNothing);
    expect(find.text('Buka pengelola playlist'), findsOneWidget);
  });
}
