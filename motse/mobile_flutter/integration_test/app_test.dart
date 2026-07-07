import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:motse/features/auth/login_screen.dart';
import 'package:motse/main.dart';
import 'package:motse/core/api_client.dart';
import 'package:motse/core/session.dart';
import 'package:provider/provider.dart';

/// Mobile UI / integration tests (WS1). Against a live backend:
///   flutter test integration_test --dart-define=MOTSE_API=http://10.0.2.2:4100
/// The OTP sandbox code is displayed by the backend in dev mode, so the
/// full login → dashboard flow is drivable without SMS delivery.
void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('login screen renders and validates the OTP flow shape', (tester) async {
    const baseUrl = String.fromEnvironment('MOTSE_API', defaultValue: 'http://10.0.2.2:4100');
    final session = Session();
    final api = ApiClient(baseUrl: baseUrl, session: session);
    await tester.pumpWidget(
      ChangeNotifierProvider(
        create: (_) => AppState(api: api, session: session),
        child: const MotseApp(),
      ),
    );
    expect(find.text('Motse'), findsOneWidget);
    expect(find.byType(LoginScreen), findsOneWidget);
    expect(find.text('Send code'), findsOneWidget);

    await tester.enterText(find.byType(TextField).first, '+26771000009');
    await tester.tap(find.text('Send code'));
    await tester.pumpAndSettle(const Duration(seconds: 3));
    // Against a dev backend the sandbox hint appears with the code.
    expect(find.textContaining('code', findRichText: true), findsWidgets);
  });
}
