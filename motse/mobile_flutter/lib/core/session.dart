import 'dart:math';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:local_auth/local_auth.dart';

import 'api_client.dart';

/// Session lifecycle (§5.3): OTP → device-bound access token + rotating
/// refresh token, both in encrypted storage. Biometric re-auth guards
/// privileged actions (payments, custodian, trustee signatures) — the
/// shared-device reality of family phones.
class Session {
  Session({FlutterSecureStorage? storage, LocalAuthentication? localAuth})
      : _storage = storage ?? const FlutterSecureStorage(),
        _localAuth = localAuth ?? LocalAuthentication();

  final FlutterSecureStorage _storage;
  final LocalAuthentication _localAuth;

  static const _kAccess = 'motse_access';
  static const _kRefresh = 'motse_refresh';
  static const _kDevice = 'motse_device';
  static const _kUser = 'motse_user';

  Future<String> deviceId() async {
    var device = await _storage.read(key: _kDevice);
    if (device == null) {
      final rand = Random.secure();
      device = 'flutter-${List.generate(12, (_) => rand.nextInt(16).toRadixString(16)).join()}';
      await _storage.write(key: _kDevice, value: device);
    }
    return device;
  }

  Future<String?> accessToken() => _storage.read(key: _kAccess);
  Future<String?> userId() => _storage.read(key: _kUser);
  Future<bool> get signedIn async => await accessToken() != null;

  Future<void> store({
    required String access,
    required String refresh,
    required String userId,
  }) async {
    await _storage.write(key: _kAccess, value: access);
    await _storage.write(key: _kRefresh, value: refresh);
    await _storage.write(key: _kUser, value: userId);
  }

  /// Rotating refresh (§5.3): the old refresh token dies server-side.
  Future<bool> refresh(ApiClient api) async {
    final refreshToken = await _storage.read(key: _kRefresh);
    if (refreshToken == null) return false;
    try {
      final out = await api.post(
          '/v1/identity/sessions/refresh', {'refresh_token': refreshToken}) as Map;
      await _storage.write(key: _kAccess, value: out['access_token'] as String);
      await _storage.write(key: _kRefresh, value: out['refresh_token'] as String);
      return true;
    } catch (_) {
      return false;
    }
  }

  Future<void> signOut() async {
    await _storage.delete(key: _kAccess);
    await _storage.delete(key: _kRefresh);
    await _storage.delete(key: _kUser);
  }

  /// Privileged actions always re-authenticate (§5.3). Falls back to
  /// true only where the platform reports no biometric hardware.
  Future<bool> reauthenticate(String reason) async {
    try {
      if (!await _localAuth.canCheckBiometrics && !await _localAuth.isDeviceSupported()) {
        return true;
      }
      return await _localAuth.authenticate(
        localizedReason: reason,
        options: const AuthenticationOptions(stickyAuth: true),
      );
    } catch (_) {
      return false;
    }
  }
}
