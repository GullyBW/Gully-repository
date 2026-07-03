import 'dart:convert';
import 'dart:math';

import 'package:http/http.dart' as http;

import 'session.dart';

/// Motse API client — the gateway contract from the engineering doc §7.1:
///  * every mutation carries an Idempotency-Key (offline replay safety);
///  * tokens are device-bound (X-Device-Id on every call, §5.3);
///  * 401s trigger one rotating-refresh attempt, then sign-out;
///  * problem-details errors surface as typed [ApiException]s.
class ApiClient {
  ApiClient({required this.baseUrl, required this.session, http.Client? inner})
      : _inner = inner ?? http.Client();

  final String baseUrl;
  final Session session;
  final http.Client _inner;

  static String newIdempotencyKey() {
    final rand = Random.secure();
    final bytes = List<int>.generate(16, (_) => rand.nextInt(256));
    return base64UrlEncode(bytes).replaceAll('=', '');
  }

  Future<Map<String, String>> _headers({bool mutation = false}) async {
    final token = await session.accessToken();
    return {
      'Content-Type': 'application/json',
      'X-Device-Id': await session.deviceId(),
      if (token != null) 'Authorization': 'Bearer $token',
      if (mutation) 'Idempotency-Key': newIdempotencyKey(),
    };
  }

  Future<dynamic> get(String path) => _send('GET', path, null, retry: true);

  Future<dynamic> post(String path, Map<String, dynamic>? body) =>
      _send('POST', path, body, retry: true);

  Future<dynamic> put(String path, Map<String, dynamic>? body) =>
      _send('PUT', path, body, retry: true);

  Future<dynamic> _send(String method, String path, Map<String, dynamic>? body,
      {required bool retry}) async {
    final request = http.Request(method, Uri.parse('$baseUrl$path'));
    request.headers.addAll(await _headers(mutation: method != 'GET'));
    if (body != null) request.body = jsonEncode(body);
    final streamed = await _inner.send(request);
    final response = await http.Response.fromStream(streamed);

    if (response.statusCode == 401 && retry) {
      final refreshed = await session.refresh(this);
      if (refreshed) return _send(method, path, body, retry: false);
      await session.signOut();
    }
    final decoded = response.body.isEmpty ? null : jsonDecode(response.body);
    if (response.statusCode >= 400) {
      throw ApiException(
        code: decoded is Map ? decoded['code'] as String? ?? 'INTERNAL' : 'INTERNAL',
        message: decoded is Map
            ? (decoded['domain_reason'] as String?) ??
                (decoded['message'] as String?) ??
                'Request failed'
            : 'Request failed',
        retryable: decoded is Map && decoded['retryable'] == true,
        status: response.statusCode,
      );
    }
    return decoded;
  }
}

class ApiException implements Exception {
  ApiException(
      {required this.code, required this.message, required this.retryable, required this.status});

  final String code;
  final String message;
  final bool retryable;
  final int status;

  @override
  String toString() => '$code: $message';
}
