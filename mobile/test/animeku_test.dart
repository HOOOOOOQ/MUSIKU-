// Animeku tests.
//
// Two layers, both hermetic:
//  * pure helpers (payload normalization, schedule day picking, resume logic,
//    error classification, route building, duration formatting);
//  * widget tests over the real screens with a fake `Api`, so no HTTP request
//    ever leaves the test and no MongoDB/Animasu access is needed.
// Material compatibility export retained for supported Flutter stable versions.
// ignore: deprecated_member_use
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:dio/dio.dart';
import 'package:musiku_plus/core/api.dart';
import 'package:musiku_plus/features/animeku.dart';
import 'package:musiku_plus/features/animeku_detail.dart';
import 'package:musiku_plus/features/animeku_player.dart';
import 'package:video_player/video_player.dart';

/// Fake transport: serves canned payloads per path prefix and records calls.
class FakeApi extends Api {
  FakeApi(this.routes);

  final Map<String, dynamic> routes;
  final List<String> calls = <String>[];
  final List<Map<String, dynamic>> sent = <Map<String, dynamic>>[];

  DioException notFound(String path) => DioException(
    requestOptions: RequestOptions(path: path),
    response: Response<Map<String, dynamic>>(
      requestOptions: RequestOptions(path: path),
      statusCode: 404,
      data: <String, dynamic>{
        'error': <String, dynamic>{'code': 'NOT_FOUND', 'message': 'Tidak ada'},
      },
    ),
  );

  DioException unauthorizedStream(String path) => DioException(
    requestOptions: RequestOptions(path: path),
    response: Response<Map<String, dynamic>>(
      requestOptions: RequestOptions(path: path),
      statusCode: 403,
      data: <String, dynamic>{
        'error': <String, dynamic>{
          'code': 'STREAM_NOT_AUTHORIZED',
          'message': 'Animeku playback is not authorized on this deployment',
        },
      },
    ),
  );

  @override
  Future<dynamic> get(String path) async {
    calls.add(path);
    for (final entry in routes.entries) {
      if (path.startsWith(entry.key)) {
        final value = entry.value;
        if (value is DioException) throw value;
        return value;
      }
    }
    throw notFound(path);
  }

  @override
  Future<dynamic> send(
    String path,
    dynamic data, {
    String method = 'POST',
  }) async {
    calls.add('$method $path');
    sent.add(<String, dynamic>{
      'method': method,
      'path': path,
      'data': data is Map
          ? Map<String, dynamic>.from(data)
          : <String, dynamic>{},
    });
    return <String, dynamic>{'ok': true};
  }
}

Map<String, dynamic> anime(String title, String link, {String type = 'TV'}) =>
    <String, dynamic>{
      'id': 'id-$link',
      '_id': 'id-$link',
      'providerId': link,
      'title': title,
      'link': link,
      'posterUrl': '',
      'type': type,
      'status': 'Ongoing',
      'rating': 8.5,
      'source': 'animasu',
      'latestEpisode': <String, dynamic>{'text': 'Episode 12', 'number': 12},
    };

Map<String, dynamic> homePayload({
  String playback = 'not_authorized',
}) => <String, dynamic>{
  'status': <String, dynamic>{
    'provider': 'animasu',
    'displayName': 'Animeku',
    'enabled': true,
    'playback': playback,
    'types': <String>['TV', 'Movie'],
  },
  'featured': <Map<String, dynamic>>[anime('Frieren', '/anime/frieren')],
  'popular': <Map<String, dynamic>>[anime('One Piece', '/anime/one-piece')],
  'ongoing': <Map<String, dynamic>>[anime('Solo Leveling', '/anime/solo')],
  'completed': <Map<String, dynamic>>[anime('Naruto', '/anime/naruto')],
  'latestEpisodes': <Map<String, dynamic>>[
    <String, dynamic>{
      'anime': anime('Solo Leveling', '/anime/solo'),
      'label': 'Episode 4',
    },
  ],
  'schedule': <String, dynamic>{
    'shape': 'object',
    'totalDays': 7,
    'days': <Map<String, dynamic>>[
      <String, dynamic>{
        'key': 'all',
        'label': 'Semua',
        'items': <Map<String, dynamic>>[anime('All item', '/anime/all')],
      },
      <String, dynamic>{
        'key': todayScheduleKey(),
        'label': 'Hari ini',
        'items': <Map<String, dynamic>>[anime('Today item', '/anime/today')],
      },
    ],
  },
  'continueWatching': <Map<String, dynamic>>[
    <String, dynamic>{
      'anime': anime('Frieren', '/anime/frieren'),
      'episode': <String, dynamic>{
        '_id': 'ep-1',
        'providerEpisodeId': '/episode/frieren-3',
      },
      'episodeNumber': 3,
      'positionSec': 300,
      'durationSec': 1200,
      'completed': false,
    },
  ],
  'watchlist': <Map<String, dynamic>>[
    <String, dynamic>{
      '_id': 'wl-1',
      'anime': anime('Naruto', '/anime/naruto'),
      'status': 'plan_to_watch',
    },
  ],
  'history': <Map<String, dynamic>>[
    <String, dynamic>{
      'anime': anime('One Piece', '/anime/one-piece'),
      'episode': <String, dynamic>{'providerEpisodeId': '/episode/op-1'},
      'episodeNumber': 1,
      'positionSec': 60,
      'durationSec': 1200,
      'completed': true,
    },
  ],
  'favorites': <Map<String, dynamic>>[],
};

Widget wrap(Widget child, FakeApi api) => ProviderScope(
  overrides: [apiProvider.overrideWithValue(api)],
  child: MaterialApp(home: child),
);

/// Animeku screens are long scrolling lists; a tall test surface keeps every
/// rail in the tree so finders see the whole screen instead of the first fold.
Future<void> pumpScreen(WidgetTester tester, Widget child, FakeApi api) async {
  tester.view.physicalSize = const Size(1400, 7000);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(wrap(child, api));
  await settle(tester);
}

/// Lets pending futures and one frame settle without waiting for animations
/// that never end (progress indicators, snack bar timers).
Future<void> settle(WidgetTester tester, [int frames = 4]) async {
  for (var i = 0; i < frames; i++) {
    await tester.pump(const Duration(milliseconds: 60));
  }
}

void main() {
  group('payload helpers', () {
    test('asMap and asList normalize every envelope shape', () {
      expect(asMap(<String, dynamic>{'a': 1})['a'], 1);
      expect(asMap(null), <String, dynamic>{});
      expect(asMap('text'), <String, dynamic>{});
      expect(
        asList(<Map<String, dynamic>>[
          <String, dynamic>{'x': 1},
        ]),
        [
          <String, dynamic>{'x': 1},
        ],
      );
      expect(asList(<String, dynamic>{'items': <Map<String, dynamic>>[]}), []);
      expect(asList(<String, dynamic>{'days': <Map<String, dynamic>>[]}), []);
      expect(asList('junk'), []);
    });

    test('anime field readers are null-safe and fall back sensibly', () {
      expect(animeLinkOf(<String, dynamic>{'providerId': '/a'}), '/a');
      expect(animeLinkOf(<String, dynamic>{'link': '/b'}), '/b');
      expect(animeLinkOf(<String, dynamic>{}), '');
      expect(animeTitleOf(<String, dynamic>{}), 'Tanpa judul');
      expect(animeTitleOf(<String, dynamic>{'title': 'Frieren'}), 'Frieren');
      expect(animeIdOf(<String, dynamic>{'_id': 'x'}), 'x');
      expect(animePosterOf(<String, dynamic>{'image': 'i'}), 'i');
    });

    test('latestEpisode renders nothing for the provider "??" placeholder', () {
      expect(
        latestEpisodeOf(<String, dynamic>{
          'latestEpisode': <String, dynamic>{'text': '', 'number': null},
        }),
        '',
      );
      expect(
        latestEpisodeOf(<String, dynamic>{
          'latestEpisode': <String, dynamic>{
            'text': 'Episode 12',
            'number': 12,
          },
        }),
        'Episode 12',
      );
      expect(
        latestEpisodeOf(<String, dynamic>{
          'latestEpisode': <String, dynamic>{'text': '', 'number': 5},
        }),
        'Episode 5',
      );
      expect(
        latestEpisodeOf(<String, dynamic>{
          'latestEpisode': <String, dynamic>{'text': '', 'number': '5'},
        }),
        'Episode 5',
      );
      expect(latestEpisodeOf(<String, dynamic>{}), '');
    });

    test('subtitle lists only the metadata the provider actually sent', () {
      expect(
        animeSubtitleOf(<String, dynamic>{
          'type': 'TV',
          'status': 'Ongoing',
          'rating': 8.5,
        }),
        'TV · Ongoing · ★ 8.5',
      );
      expect(animeSubtitleOf(<String, dynamic>{'rating': 0}), '');
      expect(animeSubtitleOf(<String, dynamic>{'type': 'Movie'}), 'Movie');
    });

    test('episode readers prefer the normalized label', () {
      expect(
        episodeLabelOf(<String, dynamic>{'number': 4, 'label': '??'}),
        'Episode 4',
      );
      expect(
        episodeLabelOf(<String, dynamic>{
          'number': 4,
          'label': 'Episode 4 Sub',
        }),
        'Episode 4 Sub',
      );
      expect(episodeLabelOf(<String, dynamic>{}), 'Episode');
      expect(episodeNumberOf(<String, dynamic>{'number': '7'}), 7);
      expect(episodeNumberOf(<String, dynamic>{'number': 7}), 7);
      expect(episodeNumberOf(<String, dynamic>{'number': null}), 0);
      expect(episodeNumberOf(<String, dynamic>{}), 0);
      expect(
        episodeUrlOf(<String, dynamic>{'providerEpisodeId': '/ep/1'}),
        '/ep/1',
      );
    });

    test('history rows expose the populated anime and episode documents', () {
      final row = <String, dynamic>{
        'anime': <String, dynamic>{
          '_id': 'a1',
          'title': 'Frieren',
          'link': '/f',
        },
        'episode': <String, dynamic>{'providerEpisodeId': '/ep/3'},
        'positionSec': 300,
        'durationSec': 1200,
      };
      expect(historyAnimeOf(row)['title'], 'Frieren');
      expect(historyEpisodeOf(row)['providerEpisodeId'], '/ep/3');
      expect(progressOf(row), 0.25);
      expect(progressOf(<String, dynamic>{'positionSec': 5}), 0);
      expect(
        progressOf(<String, dynamic>{'positionSec': 900, 'durationSec': 100}),
        1.0,
      );
      // Unpopulated rows degrade to an id-only map instead of throwing.
      expect(historyAnimeOf(<String, dynamic>{'anime': 'a1'})['_id'], 'a1');
    });

    test('today maps to the Indonesian schedule key', () {
      expect(todayScheduleKey(DateTime(2026, 11, 23)), 'senin');
      expect(todayScheduleKey(DateTime(2026, 11, 24)), 'selasa');
      expect(todayScheduleKey(DateTime(2026, 11, 29)), 'minggu');
      expect(scheduleDayKeys, hasLength(7));
    });

    test('the schedule day falls back today → all → first non-empty', () {
      final days = <Map<String, dynamic>>[
        <String, dynamic>{
          'key': 'all',
          'label': 'Semua',
          'items': <Map<String, dynamic>>[],
        },
        <String, dynamic>{
          'key': 'rabu',
          'label': 'Rabu',
          'items': <Map<String, dynamic>>[
            <String, dynamic>{'title': 'x'},
          ],
        },
      ];
      expect(pickScheduleDay(days, 'rabu')['key'], 'rabu');
      expect(pickScheduleDay(days, 'senin')['key'], 'all');
      expect(
        pickScheduleDay(<Map<String, dynamic>>[
          <String, dynamic>{'key': 'all', 'items': <Map<String, dynamic>>[]},
          <String, dynamic>{
            'key': 'kamis',
            'items': <Map<String, dynamic>>[
              <String, dynamic>{'title': 'y'},
            ],
          },
        ], 'senin')['key'],
        'kamis',
      );
      expect(pickScheduleDay(<Map<String, dynamic>>[]), <String, dynamic>{});
    });

    test('type filter is case-insensitive and empty means "no filter"', () {
      final items = <Map<String, dynamic>>[
        <String, dynamic>{'title': 'a', 'type': 'TV'},
        <String, dynamic>{'title': 'b', 'type': 'Movie'},
        <String, dynamic>{'title': 'c'},
      ];
      expect(filterByType(items, ''), hasLength(3));
      expect(filterByType(items, 'movie').single['title'], 'b');
      expect(filterByType(items, 'OVA'), isEmpty);
    });

    test('resume position skips completed rows and matches number or url', () {
      final history = <Map<String, dynamic>>[
        <String, dynamic>{
          'episodeNumber': 3,
          'episode': <String, dynamic>{'providerEpisodeId': '/ep/3'},
          'positionSec': 400,
          'durationSec': 1200,
          'completed': true,
        },
        <String, dynamic>{
          'episodeNumber': 4,
          'episode': <String, dynamic>{'providerEpisodeId': '/ep/4'},
          'positionSec': 90,
          'durationSec': 1200,
          'completed': false,
        },
      ];
      expect(resumePositionSec(history, episodeNumber: 4, episodeUrl: ''), 90);
      expect(
        resumePositionSec(history, episodeNumber: 0, episodeUrl: '/ep/4'),
        90,
      );
      // A completed episode starts over instead of resuming at the end.
      expect(
        resumePositionSec(history, episodeNumber: 3, episodeUrl: '/ep/3'),
        0,
      );
      expect(
        resumePositionSec(
          <Map<String, dynamic>>[],
          episodeNumber: 1,
          episodeUrl: '',
        ),
        0,
      );
    });

    test('provider error codes are read from the API envelope', () {
      final api = FakeApi(<String, dynamic>{});
      final error = api.unauthorizedStream('/anime/stream');
      expect(errorCodeOf(error), 'STREAM_NOT_AUTHORIZED');
      expect(isPlaybackUnauthorized(error), isTrue);
      expect(isPlaybackUnauthorized(api.notFound('/anime/details')), isFalse);
      expect(errorCodeOf(StateError('boom')), '');
      expect(isPlaybackUnauthorized(StateError('boom')), isFalse);
    });

    test('routes encode provider links as query parameters', () {
      expect(
        animekuDetailRoute('/anime/jujutsu kaisen'),
        '/animeku/anime?link=%2Fanime%2Fjujutsu+kaisen',
      );
      expect(
        animekuWatchRoute(
          link: '/anime/a',
          episodeUrl: '/episode/a-1',
          number: 7,
        ),
        '/animeku/watch?link=%2Fanime%2Fa&episodeUrl=%2Fepisode%2Fa-1&number=7',
      );
      expect(animekuListRoute('ongoing'), '/animeku/list?kind=ongoing');
      expect(
        animekuListRoute('popular', title: 'Populer', type: 'TV'),
        '/animeku/list?kind=popular&title=Populer&type=TV',
      );
    });

    test('durations are formatted for the player labels', () {
      expect(formatDuration(const Duration(seconds: 65)), '01:05');
      expect(formatDuration(Duration.zero), '00:00');
      expect(
        formatDuration(const Duration(hours: 1, minutes: 2, seconds: 3)),
        '1:02:03',
      );
    });

    test('the episode ordering note states where numbers came from', () {
      expect(
        orderingNote(<String, dynamic>{
          'numberSource': 'title',
          'reversed': true,
        }),
        'Nomor episode dibaca dari teks judul episode dan urutan dibalik menjadi naik.',
      );
      expect(
        orderingNote(<String, dynamic>{
          'numberSource': 'index',
          'reversed': false,
        }),
        'Nomor episode dibaca dari urutan daftar.',
      );
      expect(
        orderingNote(<String, dynamic>{}),
        'Nomor episode dibaca dari provider.',
      );
    });
  });

  group('Animeku home', () {
    testWidgets('renders the real backend rails and the playback notice', (
      tester,
    ) async {
      final api = FakeApi(<String, dynamic>{
        '/anime/home': homePayload(),
        '/anime/status': homePayload()['status'],
      });
      await pumpScreen(tester, const AnimekuHomeScreen(), api);

      expect(find.text('Animeku'), findsWidgets);
      expect(find.text('Sorotan'), findsOneWidget);
      expect(find.text('Lanjut menonton'), findsOneWidget);
      expect(find.text('Sedang tayang'), findsOneWidget);
      expect(find.text('Episode terbaru'), findsOneWidget);
      expect(find.text('Jadwal tayang'), findsOneWidget);
      expect(find.text('Populer'), findsOneWidget);
      expect(find.text('Selesai tayang'), findsOneWidget);
      expect(find.text('Daftar tontonan'), findsOneWidget);
      expect(find.text('Riwayat tontonan'), findsOneWidget);
      expect(find.text('Frieren'), findsWidgets);
      // Metadata-only deployment: the notice must be visible.
      expect(find.text('Pemutaran video tidak diaktifkan'), findsOneWidget);
      expect(api.calls, contains('/anime/home'));
    });

    testWidgets('hides the playback notice when the server authorizes media', (
      tester,
    ) async {
      final api = FakeApi(<String, dynamic>{
        '/anime/home': homePayload(playback: 'authorized'),
      });
      await pumpScreen(tester, const AnimekuHomeScreen(), api);
      expect(find.text('Pemutaran video tidak diaktifkan'), findsNothing);
      expect(find.text('Sorotan'), findsOneWidget);
    });

    testWidgets('shows a retry action when the catalog request fails', (
      tester,
    ) async {
      final api = FakeApi(<String, dynamic>{'/anime/home': offlineError()});
      await pumpScreen(tester, const AnimekuHomeScreen(), api);
      expect(find.text('Coba lagi'), findsOneWidget);
      expect(find.text('Sorotan'), findsNothing);
    });

    testWidgets('the schedule rail switches day when a chip is tapped', (
      tester,
    ) async {
      final api = FakeApi(<String, dynamic>{'/anime/home': homePayload()});
      await pumpScreen(tester, const AnimekuHomeScreen(), api);
      expect(find.text('Today item'), findsOneWidget);
      await tester.tap(find.text('Semua'));
      await settle(tester, 2);
      expect(find.text('All item'), findsOneWidget);
    });
  });

  group('Animeku search', () {
    testWidgets('debounces the query and renders results', (tester) async {
      final api = FakeApi(<String, dynamic>{
        '/search/history': <Map<String, dynamic>>[
          <String, dynamic>{'query': 'frieren', 'category': 'anime'},
        ],
        '/anime/search': <String, dynamic>{
          'query': 'frieren',
          'page': 1,
          'total': 1,
          'items': <Map<String, dynamic>>[anime('Frieren', '/anime/frieren')],
        },
      });
      await pumpScreen(tester, const AnimekuSearchScreen(), api);
      // Empty query: recent searches instead of results.
      expect(find.text('Pencarian terakhir'), findsOneWidget);
      expect(find.text('frieren'), findsOneWidget);
      expect(
        api.calls.where((call) => call.startsWith('/anime/search')),
        isEmpty,
      );

      await tester.enterText(find.byType(TextField), 'frie');
      await tester.pump(const Duration(milliseconds: 100));
      // Still inside the debounce window: no request yet.
      expect(
        api.calls.where((call) => call.startsWith('/anime/search')),
        isEmpty,
      );
      await tester.pump(const Duration(milliseconds: 500));
      await settle(tester);
      expect(
        api.calls.where((call) => call.startsWith('/anime/search?q=frie')),
        isNotEmpty,
      );
      expect(find.text('Frieren'), findsOneWidget);
    });

    testWidgets('a history chip reuses the stored query', (tester) async {
      final api = FakeApi(<String, dynamic>{
        '/search/history': <Map<String, dynamic>>[
          <String, dynamic>{'query': 'naruto', 'category': 'anime'},
        ],
        '/anime/search': <String, dynamic>{
          'items': <Map<String, dynamic>>[anime('Naruto', '/anime/naruto')],
        },
      });
      await pumpScreen(tester, const AnimekuSearchScreen(), api);
      await tester.tap(find.text('naruto'));
      await tester.pump(const Duration(milliseconds: 600));
      await settle(tester);
      expect(
        api.calls.where((call) => call.startsWith('/anime/search?q=naruto')),
        isNotEmpty,
      );
      expect(find.text('Naruto'), findsOneWidget);
    });

    testWidgets('an empty result set is explicit', (tester) async {
      final api = FakeApi(<String, dynamic>{
        '/search/history': <Map<String, dynamic>>[],
        '/anime/search': <String, dynamic>{'items': <Map<String, dynamic>>[]},
      });
      await pumpScreen(tester, const AnimekuSearchScreen(), api);
      await tester.enterText(find.byType(TextField), 'zzz');
      await tester.pump(const Duration(milliseconds: 600));
      await settle(tester);
      expect(find.text('Tidak ada hasil untuk "zzz".'), findsOneWidget);
    });
  });

  group('Animeku detail', () {
    Map<String, dynamic> detailsPayload({
      String playback = 'not_authorized',
    }) => <String, dynamic>{
      'anime': <String, dynamic>{
        'id': 'a1',
        '_id': 'a1',
        'providerId': '/anime/jjk',
        'title': 'Jujutsu Kaisen',
        'link': '/anime/jjk',
        'posterUrl': '',
        'synopsis': 'Penyihir muda melawan kutukan.',
        'type': 'TV',
        'status': 'Ongoing',
        'studio': 'MAPPA',
        'rating': 8.6,
        'episodeCount': 2,
        'genres': <String>['Action', 'Supernatural'],
        'latestEpisode': <String, dynamic>{'text': 'Episode 2', 'number': 2},
      },
      'episodes': <Map<String, dynamic>>[
        <String, dynamic>{
          'number': 1,
          'label': 'Episode 1',
          'title': 'Ryoumen Sukuna',
          'date': '2026-01-05',
          'episodeUrl': '/episode/jjk-1',
          'id': 'e1',
        },
        <String, dynamic>{
          'number': 2,
          'label': 'Episode 2',
          'title': 'Fushiguro',
          'date': '2026-01-12',
          'episodeUrl': '/episode/jjk-2',
          'id': 'e2',
        },
      ],
      'episodeOrder': <String, dynamic>{
        'reversed': true,
        'numberSource': 'episode',
      },
      'playback': playback,
    };

    FakeApi detailsApi({String playback = 'not_authorized'}) =>
        FakeApi(<String, dynamic>{
          '/anime/details': detailsPayload(playback: playback),
          '/library/watchlist': <Map<String, dynamic>>[],
          '/library/anime-favorites': <Map<String, dynamic>>[],
          '/history/anime': <Map<String, dynamic>>[],
          '/anime/a1/related': <Map<String, dynamic>>[],
        });

    testWidgets('lists episodes in ascending order with the ordering note', (
      tester,
    ) async {
      await pumpScreen(
        tester,
        const AnimekuDetailScreen(link: '/anime/jjk'),
        detailsApi(),
      );
      expect(find.text('Jujutsu Kaisen'), findsOneWidget);
      expect(find.text('Episode 1'), findsOneWidget);
      // 'Episode 2' appears twice: as the latest-episode chip and as a tile.
      expect(find.text('Episode 2'), findsNWidgets(2));
      expect(
        find.text(
          'Nomor episode dibaca dari field episode provider dan urutan '
          'dibalik menjadi naik.',
        ),
        findsOneWidget,
      );
      expect(find.text('Action'), findsOneWidget);
      // Ascending order on screen (episode subtitles are unique).
      final first = tester
          .getTopLeft(find.text('Ryoumen Sukuna · 2026-01-05'))
          .dy;
      final second = tester.getTopLeft(find.text('Fushiguro · 2026-01-12')).dy;
      expect(first, lessThan(second));
    });

    testWidgets('playback stays disabled when the server is not authorized', (
      tester,
    ) async {
      final api = detailsApi();
      await pumpScreen(
        tester,
        const AnimekuDetailScreen(link: '/anime/jjk'),
        api,
      );
      expect(find.byIcon(Icons.lock_outline), findsWidgets);
      await tester.tap(find.text('Episode 1'));
      await settle(tester, 2);
      expect(
        find.textContaining('Pemutaran video tidak diaktifkan pada server ini'),
        findsOneWidget,
      );
      // No media was requested from the backend.
      expect(
        api.calls.where((call) => call.startsWith('/anime/stream')),
        isEmpty,
      );
    });

    testWidgets('the watchlist toggle posts the anime id', (tester) async {
      final api = detailsApi();
      await pumpScreen(
        tester,
        const AnimekuDetailScreen(link: '/anime/jjk'),
        api,
      );
      await tester.tap(find.text('Watchlist'));
      await settle(tester, 2);
      expect(api.sent, hasLength(1));
      expect(api.sent.single['method'], 'POST');
      expect(api.sent.single['path'], '/library/watchlist');
      expect(
        (api.sent.single['data'] as Map<String, dynamic>)['animeId'],
        'a1',
      );
    });

    testWidgets('a favorite toggle deletes when it is already a favorite', (
      tester,
    ) async {
      final api = detailsApi();
      api.routes['/library/anime-favorites'] = <Map<String, dynamic>>[
        <String, dynamic>{
          '_id': 'f1',
          'anime': <String, dynamic>{'_id': 'a1'},
        },
      ];
      await pumpScreen(
        tester,
        const AnimekuDetailScreen(link: '/anime/jjk'),
        api,
      );
      expect(find.text('Favorit'), findsOneWidget);
      await tester.tap(find.text('Favorit'));
      await settle(tester, 2);
      expect(api.sent.single['method'], 'DELETE');
      expect(api.sent.single['path'], '/library/anime-favorites/a1');
    });

    testWidgets('an invalid link is reported without calling the backend', (
      tester,
    ) async {
      final api = detailsApi();
      await pumpScreen(tester, const AnimekuDetailScreen(link: ''), api);
      expect(find.text('Tautan anime tidak valid.'), findsOneWidget);
      expect(api.calls, isEmpty);
    });
  });

  group('Animeku player', () {
    testWidgets('refuses to play when the backend denies authorization', (
      tester,
    ) async {
      final api = FakeApi(<String, dynamic>{
        '/anime/details': <String, dynamic>{
          'anime': <String, dynamic>{
            'id': 'a1',
            'title': 'Jujutsu Kaisen',
            'link': '/anime/jjk',
          },
          'episodes': <Map<String, dynamic>>[],
          'playback': 'not_authorized',
        },
        '/history/anime': <Map<String, dynamic>>[],
        '/anime/stream': DioException(
          requestOptions: RequestOptions(path: '/anime/stream'),
          response: Response<Map<String, dynamic>>(
            requestOptions: RequestOptions(path: '/anime/stream'),
            statusCode: 403,
            data: <String, dynamic>{
              'error': <String, dynamic>{
                'code': 'STREAM_NOT_AUTHORIZED',
                'message': 'Playback is not authorized on this deployment',
              },
            },
          ),
        ),
      });
      await pumpScreen(
        tester,
        const AnimekuPlayerScreen(
          link: '/anime/jjk',
          episodeUrl: '/episode/jjk-1',
          episodeNumber: 1,
        ),
        api,
      );
      await settle(tester, 4);
      expect(find.text('Pemutaran tidak diaktifkan'), findsOneWidget);
      expect(find.text('Kembali ke detail'), findsOneWidget);
      expect(find.byType(VideoPlayer), findsNothing);
      // The refusal came from the backend, and no progress was invented.
      expect(
        api.calls,
        contains('/anime/stream?episodeUrl=%2Fepisode%2Fjjk-1'),
      );
      expect(api.sent, isEmpty);
    });

    testWidgets('reports a media failure with a retry path', (tester) async {
      final api = FakeApi(<String, dynamic>{
        '/anime/details': <String, dynamic>{
          'anime': <String, dynamic>{'id': 'a1', 'title': 'A', 'link': '/a'},
          'episodes': <Map<String, dynamic>>[],
          'playback': 'authorized',
        },
        '/history/anime': <Map<String, dynamic>>[],
        // A 200-shaped response without a usable URL: not playable.
        '/anime/stream': <String, dynamic>{
          'streamUrl': '',
          'alternativeLinks': <String>[],
          'episodeTitle': 'Episode 1',
        },
      });
      await pumpScreen(
        tester,
        const AnimekuPlayerScreen(
          link: '/a',
          episodeUrl: '/episode/a-1',
          episodeNumber: 1,
        ),
        api,
      );
      await settle(tester, 4);
      expect(find.text('Video tidak dapat diputar'), findsOneWidget);
      expect(find.text('Coba lagi'), findsOneWidget);
      expect(
        find.textContaining('Provider tidak mengembalikan URL media.'),
        findsOneWidget,
      );
    });
  });
}

/// Helper kept separate so the map literal above stays readable.
DioException offlineError() => DioException(
  requestOptions: RequestOptions(path: '/anime/home'),
  error: StateError('offline'),
  type: DioExceptionType.connectionError,
);
