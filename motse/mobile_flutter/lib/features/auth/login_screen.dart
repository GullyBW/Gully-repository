import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../main.dart';

/// OTP login (§5.1 L1): phone number → SMS code → device-bound session.
/// The device id is minted once and sent on every call thereafter —
/// this screen also registers the device (WS1 "device registration").
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _msisdn = TextEditingController();
  final _code = TextEditingController();
  bool _codeSent = false;
  bool _busy = false;
  String? _hint;
  String? _error;

  Future<void> _run(Future<void> Function() fn) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await fn();
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _sendOtp() => _run(() async {
        final app = context.read<AppState>();
        final out = await app.api.post('/v1/identity/otp', {'msisdn': _msisdn.text.trim()}) as Map;
        setState(() {
          _codeSent = true;
          _hint = out['sandbox_code'] != null ? 'Sandbox code: ${out['sandbox_code']}' : null;
        });
      });

  Future<void> _verify() => _run(() async {
        final app = context.read<AppState>();
        final out = await app.api.post('/v1/identity/otp/verify', {
          'msisdn': _msisdn.text.trim(),
          'code': _code.text.trim(),
        }) as Map;
        await app.signIn(out.cast<String, dynamic>());
      });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 380),
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Text('Motse', style: TextStyle(fontSize: 28, fontWeight: FontWeight.w700)),
                const SizedBox(height: 4),
                const Text('Le kae! Sign in with your phone number.',
                    style: TextStyle(color: MotseTheme.dim)),
                const SizedBox(height: 20),
                if (!_codeSent) ...[
                  TextField(
                    controller: _msisdn,
                    keyboardType: TextInputType.phone,
                    decoration: const InputDecoration(hintText: '+267 7X XXX XXX'),
                  ),
                  const SizedBox(height: 12),
                  FilledButton(
                    onPressed: _busy ? null : _sendOtp,
                    child: const Text('Send code'),
                  ),
                ] else ...[
                  TextField(
                    controller: _code,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(hintText: '6-digit code'),
                  ),
                  const SizedBox(height: 12),
                  FilledButton(
                    onPressed: _busy ? null : _verify,
                    child: const Text('Sign in'),
                  ),
                  if (_hint != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Text(_hint!, style: const TextStyle(color: MotseTheme.dim)),
                    ),
                ],
                if (_error != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: Text(_error!, style: const TextStyle(color: MotseTheme.bad)),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
