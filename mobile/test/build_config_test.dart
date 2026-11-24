import 'package:flutter_test/flutter_test.dart';
import 'package:musiku_plus/core/api.dart';
import 'package:musiku_plus/core/google_auth.dart';

/// Build-time configuration contract: the APK may only ever carry public
/// values. `MONGODB_URI`, `JWT_SECRET`, `JWT_REFRESH_SECRET` and any OAuth
/// client secret must stay on the backend, so there are deliberately no
/// `String.fromEnvironment` reads for them anywhere in `lib/`.
void main() {
  test(
    'API_BASE_URL takes precedence and the trailing slash is normalised',
    () {
      expect(
        resolveApiBaseUrl(
          primary: 'https://api.musikuplus.app/api/',
          legacy: 'https://legacy.invalid/api',
        ),
        'https://api.musikuplus.app/api',
      );
    },
  );

  test('legacy API_URL is still honoured for existing build commands', () {
    expect(
      resolveApiBaseUrl(primary: '', legacy: 'https://legacy.invalid/api/'),
      'https://legacy.invalid/api',
    );
  });

  test('an unconfigured build falls back to a non-functional placeholder', () {
    // The fallback must not resolve to a working backend: a misconfigured build
    // should fail visibly instead of silently talking to the wrong service.
    expect(
      resolveApiBaseUrl(primary: '', legacy: '', fallback: fallbackApiBaseUrl),
      'https://api.example.invalid/api',
    );
    expect(fallbackApiBaseUrl, contains('example.invalid'));
  });

  test('whitespace-only configuration is treated as unset', () {
    expect(resolveApiBaseUrl(primary: '   ', legacy: ' '), fallbackApiBaseUrl);
  });

  test('the default client uses the resolved public base URL', () {
    final api = Api();
    expect(api.dio.options.baseUrl, resolveApiBaseUrl());
    expect(api.dio.options.baseUrl, isNot(contains('mongodb')));
  });

  test('an explicit base URL can be injected for tests and previews', () {
    final api = Api(baseUrl: 'https://preview.invalid/api');
    expect(api.dio.options.baseUrl, 'https://preview.invalid/api');
  });

  test(
    'no OAuth client secret or database credential is read at build time',
    () {
      // google_sign_in only needs the public web client ID as serverClientId.
      expect(googleWebClientId, isNot(contains('GOCSPX')));
      expect(apiBaseUrl, isNot(contains('mongodb')));
      expect(legacyApiUrl, isNot(contains('mongodb')));
    },
  );
}
