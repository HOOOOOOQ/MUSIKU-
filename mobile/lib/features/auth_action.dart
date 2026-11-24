// Material compatibility export retained for supported Flutter stable versions.
// ignore: deprecated_member_use
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../core/api.dart';

class AuthActionScreen extends ConsumerStatefulWidget {
  const AuthActionScreen({super.key});
  @override
  ConsumerState<AuthActionScreen> createState() => _AuthActionState();
}

class _AuthActionState extends ConsumerState<AuthActionScreen> {
  final token = TextEditingController(), password = TextEditingController();
  bool reset = true, busy = false;
  String message = '';
  @override
  void dispose() {
    token.dispose();
    password.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Pemulihan akun')),
    body: ListView(
      padding: const EdgeInsets.all(24),
      children: [
        SwitchListTile(
          title: const Text(
            'Reset password (nonaktifkan untuk verifikasi email)',
          ),
          value: reset,
          onChanged: busy ? null : (value) => setState(() => reset = value),
        ),
        TextField(
          controller: token,
          decoration: const InputDecoration(labelText: 'Token dari email'),
        ),
        if (reset)
          TextField(
            controller: password,
            obscureText: true,
            decoration: const InputDecoration(
              labelText: 'Password baru (minimal 8 karakter)',
            ),
          ),
        FilledButton(
          onPressed: busy
              ? null
              : () async {
                  setState(() => busy = true);
                  try {
                    await ref.read(apiProvider).send(
                      reset ? '/auth/reset-password' : '/auth/verify-email',
                      {
                        'token': token.text.trim(),
                        if (reset) 'newPassword': password.text,
                      },
                    );
                    if (mounted) {
                      setState(() => message = 'Berhasil. Silakan masuk.');
                    }
                  } catch (e) {
                    if (mounted) setState(() => message = errorMessage(e));
                  } finally {
                    if (mounted) setState(() => busy = false);
                  }
                },
          child: const Text('Kirim'),
        ),
        Text(message),
      ],
    ),
  );
}
