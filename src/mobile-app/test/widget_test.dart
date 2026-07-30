import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fluent_audio_split_mobile/main.dart';

void main() {
  testWidgets('shows the sign-in screen', (WidgetTester tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: SignInScreen(
          api: ApiClient(baseUrl: 'http://example.test', session: SessionStore()),
          onSignedIn: (_) {},
        ),
      ),
    );

    expect(find.text('Fluent Audio Split'), findsOneWidget);
    expect(find.text('Sign in'), findsOneWidget);
  });
}
