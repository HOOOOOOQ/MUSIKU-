import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:audio_service/audio_service.dart';
import 'core/api.dart';
import 'core/audio.dart';
import 'features/screens.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  audio = await AudioService.init(builder: MusikuAudio.new, config: const AudioServiceConfig(androidNotificationChannelId: 'com.musikuplus.app.audio', androidNotificationChannelName: 'MUSIKU+ Playback', androidNotificationOngoing: true));
  runApp(const ProviderScope(child: MusikuApp()));
}
final router = GoRouter(initialLocation: '/splash', routes: [
  GoRoute(path: '/splash', builder: (_, __) => const SplashScreen()),
  GoRoute(path: '/onboarding', builder: (_, __) => const OnboardingScreen()),
  GoRoute(path: '/login', builder: (_, __) => const AuthScreen()),
  GoRoute(path: '/', builder: (_, __) => const HomeScreen()),
  GoRoute(path: '/browse/:kind', builder: (_, state) => BrowseScreen(kind: state.pathParameters['kind']!)),
  GoRoute(path: '/detail/:kind/:id', builder: (_, state) => DetailScreen(kind: state.pathParameters['kind']!, id: state.pathParameters['id']!)),
  GoRoute(path: '/search', builder: (_, __) => const SearchScreen()),
  GoRoute(path: '/library', builder: (_, __) => const LibraryScreen()),
  GoRoute(path: '/profile', builder: (_, __) => const ProfileScreen()),
  GoRoute(path: '/player', builder: (_, __) => const PlayerScreen()),
  GoRoute(path: '/video/:anime/:episode', builder: (_, state) => VideoScreen(animeId: state.pathParameters['anime']!, episodeId: state.pathParameters['episode']!)),
  GoRoute(path: '/resource', builder: (_, state) => ResourceScreen(title: state.uri.queryParameters['title'] ?? 'MUSIKU+', path: state.uri.queryParameters['path'] ?? '/notifications')),
]);
class MusikuApp extends StatelessWidget {
  const MusikuApp({super.key});
  @override Widget build(BuildContext context) => MaterialApp.router(title: 'MUSIKU+', debugShowCheckedModeBanner: false, themeMode: ThemeMode.dark, darkTheme: ThemeData(useMaterial3: true, brightness: Brightness.dark, colorSchemeSeed: const Color(0xffa78bfa), scaffoldBackgroundColor: const Color(0xff101018), inputDecorationTheme: const InputDecorationTheme(border: OutlineInputBorder())), routerConfig: router);
}
class SplashScreen extends ConsumerStatefulWidget {
  const SplashScreen({super.key});
  @override ConsumerState<SplashScreen> createState() => _SplashState();
}
class _SplashState extends ConsumerState<SplashScreen> {
  @override void initState() { super.initState(); _start(); }
  Future<void> _start() async {
    final storage = ref.read(apiProvider).storage;
    final onboarded = await storage.read(key: 'onboarded');
    final token = await storage.read(key: 'accessToken');
    if (mounted) context.go(onboarded == null ? '/onboarding' : token == null ? '/login' : '/');
  }
  @override Widget build(BuildContext context) => const Scaffold(body: Center(child: Text('MUSIKU+', style: TextStyle(fontSize: 40, fontWeight: FontWeight.w900))));
}
