import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'api.dart';

/// Web application OAuth client ID. It is the `serverClientId` for
/// google_sign_in, which makes Google issue an ID token whose audience is this
/// web client — exactly the audience the backend verifies with
/// google-auth-library. This is a public identifier, not a secret; the OAuth
/// client **secret** never belongs in a Flutter build.
///
/// The Android OAuth client ID (`GOOGLE_CLIENT_ID` in the backend environment)
/// is registered in Google Cloud Console against package `com.musikuplus.app`
/// plus the signing-certificate SHA-1. google_sign_in 6.x resolves it
/// automatically from that registration, so it is not needed in Dart code and is
/// deliberately not embedded here.
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
  Future<void> signOut() async {
    await client.signOut();
  }
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

/// True only when the backend explicitly reports Google as enabled, so the UI
/// never renders a sign-in button whose token exchange would be rejected.
/// An unreachable backend is treated as "not available" rather than assumed on.
final googleAvailableProvider = FutureProvider<bool>((ref) async {
  try {
    final data = await ref.watch(apiProvider).get('/auth/providers');
    return records(data).any(
      (provider) => provider['id'] == 'google' && provider['enabled'] == true,
    );
  } catch (_) {
    return false;
  }
});
