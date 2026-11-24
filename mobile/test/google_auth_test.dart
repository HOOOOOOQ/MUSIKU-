import 'package:flutter_test/flutter_test.dart';
import 'package:musiku_plus/core/api.dart';
import 'package:musiku_plus/core/google_auth.dart';

class FakeIdentity implements IdentityProvider {
  final String? token;
  FakeIdentity(this.token);
  @override
  Future<String?> idToken() async => token;
  @override
  Future<void> signOut() async {}
}

class FakeApi extends Api {
  String? exchanged;
  Map<String, dynamic>? saved;
  @override
  Future<String> deviceId() async => 'test-device';
  @override
  Future<dynamic> send(
    String path,
    dynamic data, {
    String method = 'POST',
  }) async {
    expect(path, '/auth/google');
    expect(data['deviceId'], 'test-device');
    exchanged = data['idToken'] as String;
    return {
      'tokens': {
        'accessToken': 'musiku-access',
        'refreshToken': 'musiku-refresh',
      },
    };
  }

  @override
  Future<void> saveTokens(Map<String, dynamic> tokens) async {
    saved = tokens;
  }
}

void main() {
  test('Google cancellation never calls backend', () async {
    final api = FakeApi();
    expect(await GoogleAuth(api, FakeIdentity(null)).signIn(), false);
    expect(api.exchanged, isNull);
  });
  test('Google ID token exchanged for MUSIKU tokens only', () async {
    final api = FakeApi();
    expect(
      await GoogleAuth(api, FakeIdentity('google-id-token')).signIn(),
      true,
    );
    expect(api.exchanged, 'google-id-token');
    expect(api.saved?['accessToken'], 'musiku-access');
  });
}
