import 'package:google_sign_in/google_sign_in.dart';
import 'api.dart';

const googleWebClientId = String.fromEnvironment('GOOGLE_WEB_CLIENT_ID');

abstract class IdentityProvider {
  Future<String?> idToken();
  Future<void> signOut();
}

class GoogleIdentityProvider implements IdentityProvider {
  final GoogleSignIn client;
  GoogleIdentityProvider()
    : client = GoogleSignIn(
        scopes: ['email', 'profile'],
        serverClientId: googleWebClientId,
      );
  @override
  Future<String?> idToken() async {
    final account = await client.signIn();
    if (account == null) return null;
    return (await account.authentication).idToken;
  }

  @override
  Future<void> signOut() => client.signOut();
}

class GoogleAuth {
  final Api api;
  final IdentityProvider identity;
  GoogleAuth(this.api, this.identity);
  Future<bool> signIn() async {
    final token = await identity.idToken();
    if (token == null) return false;
    final result = await api.send('/auth/google', {
      'idToken': token,
      'deviceId': await api.deviceId(),
    });
    await api.saveTokens(Map<String, dynamic>.from(result['tokens']));
    return true;
  }
}
