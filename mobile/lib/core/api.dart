import 'dart:math';
import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

final apiProvider = Provider((ref) => Api());
final resourceProvider = FutureProvider.autoDispose.family<dynamic, String>(
  (ref, path) => ref.watch(apiProvider).get(path),
);

/// Public, build-time configuration. These values are compiled into the APK and
/// can be extracted by anyone who has the file, so only non-sensitive settings
/// belong here. `MONGODB_URI`, `JWT_SECRET`, `JWT_REFRESH_SECRET` and any OAuth
/// client secret are backend-only and are never passed to `--dart-define`.
const apiBaseUrl = String.fromEnvironment('API_BASE_URL');

/// Legacy name kept so existing build commands and CI variables keep working.
const legacyApiUrl = String.fromEnvironment('API_URL');

/// Deliberately non-functional placeholder: a build without configuration must
/// fail to reach a backend instead of silently talking to a fake one.
const fallbackApiBaseUrl = 'https://api.example.invalid/api';

/// Resolves the backend origin from build-time configuration.
///
/// `API_BASE_URL` wins, `API_URL` is accepted for backwards compatibility, and a
/// trailing slash is normalised so `'$baseUrl/auth/login'` is always correct.
String resolveApiBaseUrl({
  String primary = apiBaseUrl,
  String legacy = legacyApiUrl,
  String fallback = fallbackApiBaseUrl,
}) {
  final configured = primary.trim().isNotEmpty ? primary.trim() : legacy.trim();
  final value = configured.isNotEmpty ? configured : fallback;
  return value.endsWith('/') ? value.substring(0, value.length - 1) : value;
}

class Api {
  final storage = const FlutterSecureStorage();
  final Dio dio;
  Future<void>? _refreshing;
  Api({Dio? client, String? baseUrl})
    : dio =
          client ??
          Dio(
            BaseOptions(
              baseUrl: baseUrl ?? resolveApiBaseUrl(),
              connectTimeout: const Duration(seconds: 20),
              receiveTimeout: const Duration(seconds: 30),
            ),
          ) {
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          final token = await storage.read(key: 'accessToken');
          if (token != null) options.headers['Authorization'] = 'Bearer $token';
          handler.next(options);
        },
        onError: (error, handler) async {
          final options = error.requestOptions;
          if (error.response?.statusCode == 401 &&
              options.extra['retried'] != true &&
              ![
                '/auth/login',
                '/auth/register',
                '/auth/google',
                '/auth/refresh',
                '/auth/logout',
              ].contains(options.path)) {
            try {
              await (_refreshing ??= _refresh());
              options.extra['retried'] = true;
              options.headers['Authorization'] =
                  'Bearer ${await storage.read(key: 'accessToken')}';
              return handler.resolve(await dio.fetch<dynamic>(options));
            } catch (_) {
              await storage.delete(key: 'accessToken');
              await storage.delete(key: 'refreshToken');
            } finally {
              _refreshing = null;
            }
          }
          handler.next(error);
        },
      ),
    );
  }
  Future<void> _refresh() async {
    final token = await storage.read(key: 'refreshToken');
    final result = await send('/auth/refresh', {'refreshToken': token});
    await saveTokens(Map<String, dynamic>.from(result));
  }

  Future<void> saveTokens(Map<String, dynamic> tokens) async {
    for (final key in ['accessToken', 'refreshToken']) {
      if (tokens[key] is String) {
        await storage.write(key: key, value: tokens[key] as String);
      }
    }
  }

  Future<dynamic> get(String path) async =>
      (await dio.get<dynamic>(path)).data['data'];
  Future<dynamic> send(
    String path,
    dynamic data, {
    String method = 'POST',
  }) async => (await dio.request<dynamic>(
    path,
    data: data,
    options: Options(method: method),
  )).data['data'];
  Future<String> deviceId() async {
    final existing = await storage.read(key: 'deviceId');
    if (existing != null) return existing;
    final random = Random.secure();
    final value = List.generate(
      24,
      (_) => random.nextInt(256).toRadixString(16).padLeft(2, '0'),
    ).join();
    await storage.write(key: 'deviceId', value: value);
    return value;
  }

  Future<void> login(String email, String password, {String? username}) async {
    final result =
        await send(username == null ? '/auth/login' : '/auth/register', {
          'email': email,
          'password': password,
          if (username == null) 'deviceId': await deviceId(),
          if (username != null) 'username': username,
        });
    await saveTokens(Map<String, dynamic>.from(result['tokens']));
  }

  Future<void> logout() async {
    try {
      await send('/auth/logout', {
        'refreshToken': await storage.read(key: 'refreshToken'),
      });
    } finally {
      await storage.delete(key: 'accessToken');
      await storage.delete(key: 'refreshToken');
    }
  }
}

String errorMessage(Object error) {
  if (error is DioException) {
    final data = error.response?.data;
    if (data is Map) {
      return data['error']?['message']?.toString() ?? 'Request failed';
    }
    return 'Tidak dapat terhubung. Periksa koneksi lalu coba lagi.';
  }
  return error.toString();
}

List<Map<String, dynamic>> records(dynamic data) {
  if (data is List) {
    return data
        .whereType<Map>()
        .map((v) => Map<String, dynamic>.from(v))
        .toList();
  }
  if (data is Map) {
    return records(data['items'] ?? data['tracks'] ?? data['trending'] ?? []);
  }
  return [];
}

String entityId(Map<String, dynamic> item) =>
    (item['_id'] ?? '${item['source']}:${item['providerId']}').toString();
