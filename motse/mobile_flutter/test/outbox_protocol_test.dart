import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:motse/core/api_client.dart';
import 'package:motse/core/session.dart';

/// Contract tests for the client half of the platform protocols:
/// idempotency keys on mutations, device binding, token refresh,
/// problem-details error mapping. Run with `flutter test`.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('ApiClient gateway contract (§7.1)', () {
    test('mutations carry a fresh Idempotency-Key; reads do not', () async {
      final captured = <http.Request>[];
      final client = MockClient((request) async {
        captured.add(request);
        return http.Response('{}', 200);
      });
      final api = ApiClient(baseUrl: 'https://x', session: _FakeSession(), inner: client);

      await api.get('/v1/heritage/search');
      await api.post('/v1/ledger/transfers', {'amount_minor': 1});
      await api.post('/v1/ledger/transfers', {'amount_minor': 1});

      expect(captured[0].headers.containsKey('Idempotency-Key'), isFalse);
      expect(captured[1].headers['Idempotency-Key'], isNotNull);
      expect(captured[2].headers['Idempotency-Key'],
          isNot(captured[1].headers['Idempotency-Key']));
      // Device binding on every call (§5.3).
      for (final request in captured) {
        expect(request.headers['X-Device-Id'], 'test-device');
      }
    });

    test('401 triggers one rotating refresh then replays the request', () async {
      var calls = 0;
      final client = MockClient((request) async {
        if (request.url.path == '/v1/identity/sessions/refresh') {
          return http.Response(
              jsonEncode({'access_token': 'new-access', 'refresh_token': 'new-refresh'}), 200);
        }
        calls += 1;
        if (calls == 1) return http.Response('{"code":"UNAUTHENTICATED"}', 401);
        return http.Response('{"ok":true}', 200);
      });
      final session = _FakeSession();
      final api = ApiClient(baseUrl: 'https://x', session: session, inner: client);
      final out = await api.get('/v1/notifications') as Map;
      expect(out['ok'], isTrue);
      expect(session.stored['access'], 'new-access');
      expect(session.stored['refresh'], 'new-refresh'); // rotation persisted
    });

    test('problem-details envelope maps to a typed exception', () async {
      final client = MockClient((request) async => http.Response(
          jsonEncode({
            'code': 'ESCROW_RELEASE_BLOCKED',
            'message': 'blocked',
            'domain_reason': 'campaign frozen',
            'retryable': false,
          }),
          409));
      final api = ApiClient(baseUrl: 'https://x', session: _FakeSession(), inner: client);
      expect(
        () => api.post('/v1/kgetsi/x', {}),
        throwsA(isA<ApiException>()
            .having((e) => e.code, 'code', 'ESCROW_RELEASE_BLOCKED')
            .having((e) => e.retryable, 'retryable', false)),
      );
    });
  });
}

class _FakeSession extends Session {
  final stored = <String, String>{};
  String? _access = 'old-access';
  String? _refresh = 'old-refresh';

  @override
  Future<String> deviceId() async => 'test-device';

  @override
  Future<String?> accessToken() async => _access;

  @override
  Future<bool> refresh(ApiClient api) async {
    final out = await api.post(
        '/v1/identity/sessions/refresh', {'refresh_token': _refresh}) as Map;
    _access = out['access_token'] as String;
    _refresh = out['refresh_token'] as String;
    stored['access'] = _access!;
    stored['refresh'] = _refresh!;
    return true;
  }

  @override
  Future<void> signOut() async {
    _access = null;
    _refresh = null;
  }
}
