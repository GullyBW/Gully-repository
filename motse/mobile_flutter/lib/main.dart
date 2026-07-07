import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'core/api_client.dart';
import 'core/outbox.dart';
import 'core/session.dart';
import 'features/auth/login_screen.dart';
import 'shell.dart';

/// Motse — Android-first, offline-first (P1), Setswana-first.
/// Design tokens mirror the PWA/portal so all three clients read as one
/// product (Phase 2, WS2 "shared design language").
class MotseTheme {
  static const bg = Color(0xFF0F1419);
  static const panel = Color(0xFF1A2129);
  static const line = Color(0xFF2B3540);
  static const text = Color(0xFFE6EDF3);
  static const dim = Color(0xFF8B98A5);
  static const accent = Color(0xFF4F9CF9);
  static const ok = Color(0xFF3FB950);
  static const warn = Color(0xFFD29922);
  static const bad = Color(0xFFF85149);

  static ThemeData dark() => ThemeData(
        brightness: Brightness.dark,
        scaffoldBackgroundColor: bg,
        colorScheme: const ColorScheme.dark(
          primary: accent,
          surface: panel,
          error: bad,
        ),
        cardTheme: const CardThemeData(color: panel, elevation: 0, margin: EdgeInsets.only(bottom: 12)),
        appBarTheme: const AppBarTheme(backgroundColor: panel, elevation: 0),
        useMaterial3: true,
      );
}

class AppState extends ChangeNotifier {
  AppState({required this.api, required this.session, this.outbox});

  final ApiClient api;
  final Session session;
  Outbox? outbox;
  Map<String, dynamic>? user;
  bool offline = false;

  Future<void> signIn(Map<String, dynamic> verified) async {
    final sessionMap = verified['session'] as Map;
    user = (verified['user'] as Map).cast<String, dynamic>();
    await session.store(
      access: sessionMap['access_token'] as String,
      refresh: sessionMap['refresh_token'] as String,
      userId: user!['id'] as String,
    );
    outbox ??= await Outbox.open(api);
    await outbox!.flush(); // replay anything queued from a previous session
    notifyListeners();
  }

  Future<void> signOut() async {
    await session.signOut();
    user = null;
    notifyListeners();
  }
}

void main() {
  const baseUrl = String.fromEnvironment('MOTSE_API', defaultValue: 'https://api.motse.bw');
  final session = Session();
  final api = ApiClient(baseUrl: baseUrl, session: session);
  runApp(
    ChangeNotifierProvider(
      create: (_) => AppState(api: api, session: session),
      child: const MotseApp(),
    ),
  );
}

class MotseApp extends StatelessWidget {
  const MotseApp({super.key});

  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    return MaterialApp(
      title: 'Motse',
      theme: MotseTheme.dark(),
      home: app.user == null ? const LoginScreen() : const Shell(),
    );
  }
}
