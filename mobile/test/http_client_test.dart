import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:musiku_plus/core/api.dart';

class TestAdapter implements HttpClientAdapter {
  final List<RequestOptions> requests = [];
  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests.add(options);
    if (options.path == '/auth/refresh') {
      return ResponseBody.fromString(
        '{"success":true,"data":{"accessToken":"new","refreshToken":"rotated"}}',
        200,
        headers: {
          Headers.contentTypeHeader: ['application/json'],
        },
      );
    }
    if (options.extra['retried'] != true) {
      return ResponseBody.fromString(
        '{"success":false}',
        401,
        headers: {
          Headers.contentTypeHeader: ['application/json'],
        },
      );
    }
    return ResponseBody.fromString(
      '{"success":true,"data":{"ok":true}}',
      200,
      headers: {
        Headers.contentTypeHeader: ['application/json'],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test(
    '401 refresh rotates secure tokens and retries authorized request',
    () async {
      FlutterSecureStorage.setMockInitialValues({
        'accessToken': 'expired',
        'refreshToken': 'old',
      });
      final adapter = TestAdapter();
      final dio = Dio(BaseOptions(baseUrl: 'https://example.invalid/api'));
      dio.httpClientAdapter = adapter;
      final api = Api(client: dio);
      expect((await api.get('/users/profile'))['ok'], true);
      expect(await api.storage.read(key: 'refreshToken'), 'rotated');
      expect(
        adapter.requests.where((r) => r.path == '/auth/refresh').length,
        1,
      );
      expect(adapter.requests.last.headers['Authorization'], 'Bearer new');
    },
  );
}
