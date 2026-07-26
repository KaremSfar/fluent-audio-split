import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import 'package:just_audio/just_audio.dart';
import 'package:path_provider/path_provider.dart';

const apiBaseUrl = String.fromEnvironment(
  'API_BASE_URL',
  defaultValue: 'http://10.0.2.2:8765',
);

void main() => runApp(const FluentAudioSplitApp());

class ApiException implements Exception {
  const ApiException(this.message);

  final String message;

  @override
  String toString() => message;
}

class AuthTokens {
  const AuthTokens({required this.accessToken, required this.refreshToken});

  factory AuthTokens.fromJson(Map<String, dynamic> json) {
    return AuthTokens(
      accessToken: json['accessToken'] as String,
      refreshToken: json['refreshToken'] as String,
    );
  }

  final String accessToken;
  final String refreshToken;
}

class Workflow {
  const Workflow({required this.id, required this.name, required this.nodeCount});

  factory Workflow.fromJson(Map<String, dynamic> json) {
    return Workflow(
      id: json['id'] as String,
      name: json['name'] as String,
      nodeCount: (json['nodes'] as List<dynamic>).length,
    );
  }

  final String id;
  final String name;
  final int nodeCount;
}

class UploadedFile {
  const UploadedFile({required this.id, required this.name});

  factory UploadedFile.fromJson(Map<String, dynamic> json) {
    return UploadedFile(
      id: json['id'] as String,
      name: json['originalFileName'] as String,
    );
  }

  final String id;
  final String name;
}

class NodeExecution {
  const NodeExecution({
    required this.id,
    required this.workflowNodeId,
    required this.status,
    required this.attempt,
    required this.outputPaths,
    this.label,
    this.modelName,
    this.startedAt,
    this.completedAt,
    this.errorMessage,
  });

  factory NodeExecution.fromJson(Map<String, dynamic> json) {
    return NodeExecution(
      id: json['id'] as String,
      workflowNodeId: json['workflowNodeId'] as String,
      status: json['status'] as String,
      attempt: json['attempt'] as int,
      outputPaths: Map<String, String>.from(
        json['outputArtifactPaths'] as Map? ?? const <String, String>{},
      ),
      label: json['nodeLabel'] as String?,
      modelName: json['modelName'] as String?,
      startedAt: _parseDate(json['startedAt']),
      completedAt: _parseDate(json['completedAt']),
      errorMessage: json['errorMessage'] as String?,
    );
  }

  final String id;
  final String workflowNodeId;
  final String status;
  final int attempt;
  final Map<String, String> outputPaths;
  final String? label;
  final String? modelName;
  final DateTime? startedAt;
  final DateTime? completedAt;
  final String? errorMessage;
}

class WorkflowExecution {
  const WorkflowExecution({
    required this.id,
    required this.workflowName,
    required this.inputFileName,
    required this.status,
    required this.nodes,
    required this.createdAt,
    this.completedAt,
    this.errorMessage,
  });

  factory WorkflowExecution.fromJson(Map<String, dynamic> json) {
    final inputFile = Map<String, dynamic>.from(json['inputFile'] as Map);
    return WorkflowExecution(
      id: json['id'] as String,
      workflowName: json['workflowName'] as String,
      inputFileName: inputFile['originalFileName'] as String,
      status: json['status'] as String,
      nodes: (json['nodeExecutions'] as List<dynamic>)
          .map((node) => NodeExecution.fromJson(Map<String, dynamic>.from(node as Map)))
          .toList(growable: false),
      createdAt: _parseDate(json['createdAt']) ?? DateTime.now(),
      completedAt: _parseDate(json['completedAt']),
      errorMessage: json['errorMessage'] as String?,
    );
  }

  WorkflowExecution copyWith({String? status, List<NodeExecution>? nodes}) {
    return WorkflowExecution(
      id: id,
      workflowName: workflowName,
      inputFileName: inputFileName,
      status: status ?? this.status,
      nodes: nodes ?? this.nodes,
      createdAt: createdAt,
      completedAt: completedAt,
      errorMessage: errorMessage,
    );
  }

  final String id;
  final String workflowName;
  final String inputFileName;
  final String status;
  final List<NodeExecution> nodes;
  final DateTime createdAt;
  final DateTime? completedAt;
  final String? errorMessage;
}

DateTime? _parseDate(dynamic value) => value is String ? DateTime.tryParse(value)?.toLocal() : null;

sealed class ExecutionEvent {
  const ExecutionEvent();

  factory ExecutionEvent.fromJson(Map<String, dynamic> json) {
    final type = json['type'] as String;
    if (type == 'NodeStarted' || type == 'NodeCompleted' || type == 'NodeFailed') {
      return NodeEvent(
        type: type,
        nodeExecutionId: json['nodeExecutionId'] as String,
        workflowNodeId: json['workflowNodeId'] as String?,
        attempt: json['attempt'] as int?,
        outputPaths: json['outputArtifactPaths'] == null
            ? null
            : Map<String, String>.from(json['outputArtifactPaths'] as Map),
        errorMessage: json['errorMessage'] as String?,
      );
    }
    return ExecutionStatusEvent(type);
  }
}

class NodeEvent extends ExecutionEvent {
  const NodeEvent({
    required this.type,
    required this.nodeExecutionId,
    this.workflowNodeId,
    this.attempt,
    this.outputPaths,
    this.errorMessage,
  });

  final String type;
  final String nodeExecutionId;
  final String? workflowNodeId;
  final int? attempt;
  final Map<String, String>? outputPaths;
  final String? errorMessage;
}

class ExecutionStatusEvent extends ExecutionEvent {
  const ExecutionStatusEvent(this.type);

  final String type;

  String get status => switch (type) {
    'ExecutionRunning' => 'Running',
    'ExecutionCompleted' => 'Completed',
    'ExecutionPartiallyFailed' => 'PartiallyFailed',
    'ExecutionFailed' => 'Failed',
    'ExecutionCancelled' => 'Cancelled',
    _ => throw ApiException('Unknown execution event: $type'),
  };

  bool get isTerminal => status != 'Running';
}

class SessionStore {
  final FlutterSecureStorage _storage = const FlutterSecureStorage();

  Future<void> write(AuthTokens tokens, String email) async {
    await _storage.write(key: 'access_token', value: tokens.accessToken);
    await _storage.write(key: 'refresh_token', value: tokens.refreshToken);
    await _storage.write(key: 'email', value: email);
  }

  Future<String?> accessToken() => _storage.read(key: 'access_token');
  Future<String?> refreshToken() => _storage.read(key: 'refresh_token');
  Future<String?> email() => _storage.read(key: 'email');
  Future<void> clear() => _storage.deleteAll();
}

class ApiClient {
  ApiClient({required this.baseUrl, required this.session, http.Client? client})
      : _client = client ?? http.Client();

  final String baseUrl;
  final SessionStore session;
  final http.Client _client;

  // Coalesces concurrent refreshes so a burst of 401s triggers only one refresh.
  Future<bool>? _refreshInFlight;

  Future<void> signIn({required String email, required String password}) async {
    final response = await _client.post(
      Uri.parse('$baseUrl/api/auth/login'),
      headers: const {'content-type': 'application/json'},
      body: jsonEncode({'email': email, 'password': password}),
    );
    _throwForResponse(response);
    await session.write(AuthTokens.fromJson(_jsonMap(response.body)), email);
  }

  Future<String?> restoreSession() async {
    final email = await session.email();
    if (email == null) return null;
    if (await _refreshTokens()) return email;
    await session.clear();
    return null;
  }

  /// Exchanges the stored refresh token for a fresh access/refresh pair. Returns
  /// false when there is no refresh token or the server rejects it. Concurrent
  /// callers share a single in-flight refresh.
  Future<bool> _refreshTokens() {
    return _refreshInFlight ??= _performRefresh().whenComplete(() => _refreshInFlight = null);
  }

  Future<bool> _performRefresh() async {
    final refreshToken = await session.refreshToken();
    final email = await session.email();
    if (refreshToken == null || email == null) return false;
    final response = await _client.post(
      Uri.parse('$baseUrl/api/auth/refresh'),
      headers: const {'content-type': 'application/json'},
      body: jsonEncode({'refreshToken': refreshToken}),
    );
    if (response.statusCode < 200 || response.statusCode >= 300) return false;
    await session.write(AuthTokens.fromJson(_jsonMap(response.body)), email);
    return true;
  }

  Future<void> signOut() => session.clear();

  Future<List<Workflow>> listWorkflows() async {
    final response = await _authorized('GET', '/api/workflows');
    return _jsonList(response.body).map(Workflow.fromJson).toList(growable: false);
  }

  Future<List<WorkflowExecution>> listExecutions() async {
    final response = await _authorized('GET', '/api/executions');
    return _jsonList(response.body)
        .map(WorkflowExecution.fromJson)
        .toList(growable: false);
  }

  Future<UploadedFile?> findByHash(String hash) async {
    final response = await _authorized(
      'GET',
      '/api/files/by-hash/$hash',
      allowNotFound: true,
    );
    return response.statusCode == 404 ? null : UploadedFile.fromJson(_jsonMap(response.body));
  }

  Future<UploadedFile> uploadAudio(File file) async {
    Future<http.Response> send() async {
      final request = http.MultipartRequest('POST', Uri.parse('$baseUrl/api/files/upload'));
      request.headers.addAll(await _authHeaders());
      request.files.add(await http.MultipartFile.fromPath('file', file.path));
      return http.Response.fromStream(await request.send());
    }

    var response = await send();
    if (response.statusCode == 401 && await _refreshTokens()) {
      response = await send();
    }
    _throwForResponse(response);
    return UploadedFile.fromJson(_jsonMap(response.body));
  }

  /// Imports a single YouTube video's audio server-side (yt-dlp + ffmpeg) and
  /// stores it as the signed-in user's normal input file. The API performs the
  /// download synchronously and can take a while, so callers should allow time.
  Future<UploadedFile> importYouTube(String url) async {
    final response = await _authorized(
      'POST',
      '/api/files/import-youtube',
      body: {'url': url},
    );
    return UploadedFile.fromJson(_jsonMap(response.body));
  }

  /// Downloads a stored input file's audio to a local temp file so it can be
  /// decoded/previewed/trimmed with the same path used for local uploads
  /// (e.g. a YouTube import). Returns the local file path.
  Future<String> downloadInputFile(UploadedFile file) async {
    final uri = Uri.parse('$baseUrl/api/files/${file.id}/content');
    final response = await _getWithAuth(uri);
    _throwForResponse(response);
    final directory = await getTemporaryDirectory();
    final localFile = File('${directory.path}/${file.id}_${file.name}');
    await localFile.writeAsBytes(response.bodyBytes);
    return localFile.path;
  }

  Future<WorkflowExecution> startExecution(
    String workflowId,
    String fileId, {
    double? trimStartSeconds,
    double? trimEndSeconds,
  }) async {
    final requestBody = <String, dynamic>{'fileId': fileId};
    if (trimStartSeconds != null) requestBody['trimStartSeconds'] = trimStartSeconds;
    if (trimEndSeconds != null) requestBody['trimEndSeconds'] = trimEndSeconds;
    final response = await _authorized(
      'POST',
      '/api/workflows/$workflowId/execute',
      body: requestBody,
    );
    return WorkflowExecution.fromJson(_jsonMap(response.body));
  }

  Future<WorkflowExecution> getExecution(String executionId) async {
    final response = await _authorized('GET', '/api/executions/$executionId');
    return WorkflowExecution.fromJson(_jsonMap(response.body));
  }

  Stream<ExecutionEvent> streamExecution(String executionId) async* {
    Future<http.StreamedResponse> open() async {
      final request = http.Request('GET', Uri.parse('$baseUrl/api/executions/$executionId/stream'));
      request.headers.addAll(await _authHeaders());
      return _client.send(request);
    }

    var response = await open();
    if (response.statusCode == 401 && await _refreshTokens()) {
      response = await open();
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw ApiException('Unable to open live execution stream (${response.statusCode}).');
    }

    await for (final line in response.stream.transform(utf8.decoder).transform(const LineSplitter())) {
      if (!line.startsWith('data:')) continue;
      final data = line.substring(5).trim();
      if (data.isNotEmpty) yield ExecutionEvent.fromJson(_jsonMap(data));
    }
  }

  Future<String> downloadStem(String path, {String? destinationDirectory}) async {
    final uri = Uri.parse('$baseUrl/api/files/download').replace(queryParameters: {'path': path});
    final response = await _getWithAuth(uri);
    _throwForResponse(response);
    final directory = destinationDirectory == null
        ? await getApplicationDocumentsDirectory()
        : Directory(destinationDirectory);
    final file = File('${directory.path}/${path.split('/').last}');
    await file.writeAsBytes(response.bodyBytes);
    return file.path;
  }

  Future<http.Response> _authorized(
    String method,
    String path, {
    Map<String, dynamic>? body,
    bool allowNotFound = false,
  }) async {
    var response = await _sendAuthorized(method, path, body);
    // Access tokens expire quickly (~5 min); on 401, refresh once and retry.
    if (response.statusCode == 401 && await _refreshTokens()) {
      response = await _sendAuthorized(method, path, body);
    }
    if (!(allowNotFound && response.statusCode == 404)) _throwForResponse(response);
    return response;
  }

  Future<http.Response> _sendAuthorized(String method, String path, Map<String, dynamic>? body) async {
    final request = http.Request(method, Uri.parse('$baseUrl$path'));
    request.headers.addAll(await _authHeaders());
    if (body != null) {
      request.headers['content-type'] = 'application/json';
      request.body = jsonEncode(body);
    }
    return http.Response.fromStream(await _client.send(request));
  }

  /// GET with a bearer token, refreshing once and retrying on a 401.
  Future<http.Response> _getWithAuth(Uri uri) async {
    var response = await _client.get(uri, headers: await _authHeaders());
    if (response.statusCode == 401 && await _refreshTokens()) {
      response = await _client.get(uri, headers: await _authHeaders());
    }
    return response;
  }

  Future<Map<String, String>> _authHeaders() async {
    final token = await session.accessToken();
    if (token == null) throw const ApiException('Your session has expired. Please sign in again.');
    return {'authorization': 'Bearer $token'};
  }

  void _throwForResponse(http.Response response) {
    if (response.statusCode >= 200 && response.statusCode < 300) return;
    final message = response.body.isEmpty ? 'Request failed (${response.statusCode}).' : response.body;
    throw ApiException(message);
  }
}

Map<String, dynamic> _jsonMap(String value) => Map<String, dynamic>.from(jsonDecode(value) as Map);

List<Map<String, dynamic>> _jsonList(String value) {
  return (jsonDecode(value) as List<dynamic>)
      .map((item) => Map<String, dynamic>.from(item as Map))
      .toList(growable: false);
}

// ── Design tokens mirrored from the web app (src/front: Tailwind + shadcn/ui) ──
// Web primary is hsl(262.1 83.3% 57.8%) = #7C3AED; neutrals are the zinc scale;
// destructive is #EF4444; the shared radius is 0.75rem = 12px.
const _kPrimary = Color(0xFF7C3AED); // violet-600
const _kForeground = Color(0xFF09090B); // zinc-950 text
const _kMutedForeground = Color(0xFF71717A); // zinc-500
const _kMuted = Color(0xFFF4F4F5); // zinc-100 subtle fill
const _kBorder = Color(0xFFE4E4E7); // zinc-200
const _kDestructive = Color(0xFFEF4444); // red-500
const _kSuccess = Color(0xFF16A34A); // green-600
const _kWarning = Color(0xFFF59E0B); // amber-500
const _kRadius = 12.0;

ThemeData buildFluentTheme() {
  final colorScheme = ColorScheme.fromSeed(
    seedColor: _kPrimary,
    brightness: Brightness.light,
  ).copyWith(
    primary: _kPrimary,
    onPrimary: Colors.white,
    secondary: _kMuted,
    onSecondary: _kForeground,
    surface: Colors.white,
    onSurface: _kForeground,
    onSurfaceVariant: _kMutedForeground,
    error: _kDestructive,
    onError: Colors.white,
    outline: _kBorder,
    outlineVariant: _kBorder,
  );

  final radius = BorderRadius.circular(_kRadius);
  OutlineInputBorder inputBorder(Color color, [double width = 1]) => OutlineInputBorder(
        borderRadius: radius,
        borderSide: BorderSide(color: color, width: width),
      );

  return ThemeData(
    colorScheme: colorScheme,
    useMaterial3: true,
    scaffoldBackgroundColor: Colors.white,
    dividerColor: _kBorder,
    appBarTheme: const AppBarTheme(
      centerTitle: false,
      elevation: 0,
      scrolledUnderElevation: 0,
      backgroundColor: Colors.white,
      foregroundColor: _kForeground,
      surfaceTintColor: Colors.transparent,
      titleTextStyle: TextStyle(
        color: _kForeground,
        fontSize: 18,
        fontWeight: FontWeight.w600,
      ),
    ),
    // shadcn cards are flat white with a subtle border and generous radius.
    cardTheme: CardThemeData(
      elevation: 0,
      color: Colors.white,
      surfaceTintColor: Colors.transparent,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: radius,
        side: const BorderSide(color: _kBorder),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: _kPrimary,
        foregroundColor: Colors.white,
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
        textStyle: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15),
        shape: RoundedRectangleBorder(borderRadius: radius),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: _kForeground,
        side: const BorderSide(color: _kBorder),
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
        textStyle: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15),
        shape: RoundedRectangleBorder(borderRadius: radius),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: _kPrimary,
        textStyle: const TextStyle(fontWeight: FontWeight.w600),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Colors.white,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
      border: inputBorder(_kBorder),
      enabledBorder: inputBorder(_kBorder),
      focusedBorder: inputBorder(_kPrimary, 1.5),
      errorBorder: inputBorder(_kDestructive),
      focusedErrorBorder: inputBorder(_kDestructive, 1.5),
      labelStyle: const TextStyle(color: _kMutedForeground),
      hintStyle: const TextStyle(color: _kMutedForeground),
    ),
    sliderTheme: const SliderThemeData(
      activeTrackColor: _kPrimary,
      thumbColor: _kPrimary,
      overlayColor: Color(0x1F7C3AED),
    ),
    progressIndicatorTheme: const ProgressIndicatorThemeData(color: _kPrimary),
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(borderRadius: radius),
    ),
  );
}

class FluentAudioSplitApp extends StatefulWidget {
  const FluentAudioSplitApp({super.key});

  @override
  State<FluentAudioSplitApp> createState() => _FluentAudioSplitAppState();
}

class _FluentAudioSplitAppState extends State<FluentAudioSplitApp> {
  final SessionStore _session = SessionStore();
  late final ApiClient _api = ApiClient(baseUrl: apiBaseUrl, session: _session);
  var _checkingSession = true;
  String? _email;

  @override
  void initState() {
    super.initState();
    _restoreSession();
  }

  Future<void> _restoreSession() async {
    final email = await _api.restoreSession();
    if (!mounted) return;
    setState(() {
      _email = email;
      _checkingSession = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Fluent Audio Split',
      debugShowCheckedModeBanner: false,
      theme: buildFluentTheme(),
      home: _checkingSession
          ? const Scaffold(body: Center(child: CircularProgressIndicator()))
          : _email == null
              ? SignInScreen(api: _api, onSignedIn: (email) => setState(() => _email = email))
              : WorkflowListScreen(
                  api: _api,
                  email: _email!,
                  onSignedOut: () async {
                    await _api.signOut();
                    if (mounted) setState(() => _email = null);
                  },
                ),
    );
  }
}

class SignInScreen extends StatefulWidget {
  const SignInScreen({super.key, required this.api, required this.onSignedIn});

  final ApiClient api;
  final ValueChanged<String> onSignedIn;

  @override
  State<SignInScreen> createState() => _SignInScreenState();
}

class _SignInScreenState extends State<SignInScreen> {
  final GlobalKey<FormState> _formKey = GlobalKey<FormState>();
  final TextEditingController _email = TextEditingController();
  final TextEditingController _password = TextEditingController();
  var _isSubmitting = false;
  String? _error;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _signIn() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _isSubmitting = true;
      _error = null;
    });
    try {
      final email = _email.text.trim();
      await widget.api.signIn(email: email, password: _password.text);
      widget.onSignedIn(email);
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Card(
                child: Padding(
                  padding: const EdgeInsets.all(28),
                  child: Form(
                    key: _formKey,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        const Icon(Icons.graphic_eq, size: 52, color: Color(0xff6e35d8)),
                        const SizedBox(height: 16),
                        Text(
                          'Fluent Audio Split',
                          style: Theme.of(context).textTheme.headlineSmall,
                          textAlign: TextAlign.center,
                        ),
                        const SizedBox(height: 8),
                        Text(
                          'Run the workflows you created on the web.',
                          style: Theme.of(context).textTheme.bodyLarge,
                          textAlign: TextAlign.center,
                        ),
                        const SizedBox(height: 28),
                        TextFormField(
                          controller: _email,
                          keyboardType: TextInputType.emailAddress,
                          autofillHints: const [AutofillHints.username],
                          decoration: const InputDecoration(
                            labelText: 'Email',
                            prefixIcon: Icon(Icons.alternate_email),
                          ),
                          validator: (value) {
                            return value == null || !value.contains('@')
                                ? 'Enter a valid email address.'
                                : null;
                          },
                        ),
                        const SizedBox(height: 16),
                        TextFormField(
                          controller: _password,
                          obscureText: true,
                          autofillHints: const [AutofillHints.password],
                          onFieldSubmitted: (_) => _signIn(),
                          decoration: const InputDecoration(
                            labelText: 'Password',
                            prefixIcon: Icon(Icons.lock_outline),
                          ),
                          validator: (value) => value == null || value.isEmpty
                              ? 'Enter your password.'
                              : null,
                        ),
                        if (_error != null) ...[
                          const SizedBox(height: 16),
                          Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                        ],
                        const SizedBox(height: 24),
                        FilledButton.icon(
                          onPressed: _isSubmitting ? null : _signIn,
                          icon: _isSubmitting
                              ? const SizedBox.square(
                                  dimension: 18,
                                  child: CircularProgressIndicator(strokeWidth: 2),
                                )
                              : const Icon(Icons.login),
                          label: const Text('Sign in'),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class WorkflowListScreen extends StatefulWidget {
  const WorkflowListScreen({
    super.key,
    required this.api,
    required this.email,
    required this.onSignedOut,
  });

  final ApiClient api;
  final String email;
  final Future<void> Function() onSignedOut;

  @override
  State<WorkflowListScreen> createState() => _WorkflowListScreenState();
}

class _WorkflowListScreenState extends State<WorkflowListScreen> {
  late Future<List<Workflow>> _workflows = widget.api.listWorkflows();

  Future<void> _refresh() async {
    setState(() => _workflows = widget.api.listWorkflows());
    await _workflows;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('My workflows'),
        actions: [
            IconButton(
              onPressed: () => Navigator.of(context).push<void>(
                MaterialPageRoute<void>(
                  builder: (_) => ExecutionsListScreen(api: widget.api),
                ),
              ),
              icon: const Icon(Icons.history_outlined),
              tooltip: 'Execution history',
            ),
          IconButton(
            onPressed: _refresh,
            icon: const Icon(Icons.refresh),
            tooltip: 'Refresh workflows',
          ),
          PopupMenuButton<String>(
            icon: const Icon(Icons.account_circle_outlined),
            onSelected: (value) {
              if (value == 'sign-out') widget.onSignedOut();
            },
            itemBuilder: (context) => [
              PopupMenuItem<String>(enabled: false, child: Text(widget.email)),
              const PopupMenuItem<String>(value: 'sign-out', child: Text('Sign out')),
            ],
          ),
        ],
      ),
      body: FutureBuilder<List<Workflow>>(
        future: _workflows,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.hasError) {
            return _LoadFailure(onRetry: _refresh, message: '${snapshot.error}');
          }
          final workflows = snapshot.requireData;
          if (workflows.isEmpty) {
            return const Center(
              child: Padding(
                padding: EdgeInsets.all(32),
                child: Text(
                  'No workflows yet. Create one in the web app, then return here to run it.',
                  textAlign: TextAlign.center,
                ),
              ),
            );
          }
          return RefreshIndicator(
            onRefresh: _refresh,
            child: ListView.separated(
              padding: const EdgeInsets.all(16),
              itemCount: workflows.length,
              separatorBuilder: (_, _) => const SizedBox(height: 12),
              itemBuilder: (context, index) {
                final workflow = workflows[index];
                return Card(
                  clipBehavior: Clip.antiAlias,
                  child: ListTile(
                    contentPadding: const EdgeInsets.fromLTRB(20, 16, 12, 16),
                    leading: const CircleAvatar(child: Icon(Icons.account_tree_outlined)),
                    title: Text(workflow.name, maxLines: 1, overflow: TextOverflow.ellipsis),
                    subtitle: Text(
                      '${workflow.nodeCount} ${workflow.nodeCount == 1 ? 'node' : 'nodes'}',
                    ),
                    trailing: FilledButton.icon(
                      onPressed: () async {
                        await Navigator.of(context).push<void>(
                          MaterialPageRoute<void>(
                            builder: (_) => RunWorkflowScreen(api: widget.api, workflow: workflow),
                          ),
                        );
                        if (mounted) _refresh();
                      },
                      icon: const Icon(Icons.play_arrow),
                      label: const Text('Run'),
                    ),
                  ),
                );
              },
            ),
          );
        },
      ),
    );
  }
}

class ExecutionsListScreen extends StatefulWidget {
  const ExecutionsListScreen({super.key, required this.api});

  final ApiClient api;

  @override
  State<ExecutionsListScreen> createState() => _ExecutionsListScreenState();
}

class _ExecutionsListScreenState extends State<ExecutionsListScreen> {
  late Future<List<WorkflowExecution>> _executions = widget.api.listExecutions();

  Future<void> _refresh() async {
    setState(() => _executions = widget.api.listExecutions());
    await _executions;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Execution history'),
        actions: [
          IconButton(
            onPressed: _refresh,
            icon: const Icon(Icons.refresh),
            tooltip: 'Refresh executions',
          ),
        ],
      ),
      body: FutureBuilder<List<WorkflowExecution>>(
        future: _executions,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.hasError) {
            return _LoadFailure(onRetry: _refresh, message: '${snapshot.error}');
          }
          final executions = snapshot.requireData;
          if (executions.isEmpty) {
            return const Center(
              child: Padding(
                padding: EdgeInsets.all(32),
                child: Text('No executions yet.', textAlign: TextAlign.center),
              ),
            );
          }
          return RefreshIndicator(
            onRefresh: _refresh,
            child: ListView.separated(
              padding: const EdgeInsets.all(16),
              itemCount: executions.length,
              separatorBuilder: (_, _) => const SizedBox(height: 12),
              itemBuilder: (context, index) {
                final execution = executions[index];
                return Card(
                  child: ListTile(
                    contentPadding: const EdgeInsets.fromLTRB(20, 14, 12, 14),
                    leading: Icon(
                      _statusIcon(execution.status),
                      color: _statusColor(execution.status),
                    ),
                    title: Text(
                      execution.workflowName,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    subtitle: Text(
                      '${execution.inputFileName}\n${_formatDateTime(execution.createdAt)}',
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    isThreeLine: true,
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () async {
                      await Navigator.of(context).push<void>(
                        MaterialPageRoute<void>(
                          builder: (_) => ExecutionScreen(
                            api: widget.api,
                            initialExecution: execution,
                          ),
                        ),
                      );
                      if (mounted) _refresh();
                    },
                  ),
                );
              },
            ),
          );
        },
      ),
    );
  }
}

class RunWorkflowScreen extends StatefulWidget {
  const RunWorkflowScreen({super.key, required this.api, required this.workflow});

  final ApiClient api;
  final Workflow workflow;

  @override
  State<RunWorkflowScreen> createState() => _RunWorkflowScreenState();
}

class _RunWorkflowScreenState extends State<RunWorkflowScreen> {
  final AudioPlayer _player = AudioPlayer();
  final TextEditingController _youtubeController = TextEditingController();
  PlatformFile? _selectedFile;
  UploadedFile? _uploadedFile;
  Duration? _duration;
  var _trimStart = 0.0;
  var _trimEnd = 0.0;
  var _isPreparing = false;
  var _isImporting = false;
  var _isRunning = false;
  var _reusedUpload = false;
  String? _error;

  @override
  void dispose() {
    _player.dispose();
    _youtubeController.dispose();
    super.dispose();
  }

  Future<void> _chooseAudio() async {
    final result = await FilePicker.platform.pickFiles(type: FileType.audio, withData: false);
    final picked = result?.files.single;
    if (picked?.path == null) return;

    try {
      final duration = await _player.setFilePath(picked!.path!);
      if (!mounted) return;
      setState(() {
        _selectedFile = picked;
        _uploadedFile = null;
        _reusedUpload = false;
        _duration = duration;
        _trimStart = 0;
        _trimEnd = duration == null ? 0 : duration.inMilliseconds / 1000;
        _error = null;
      });
    } on PlayerException {
      if (mounted) {
        setState(() {
          _selectedFile = picked;
          _uploadedFile = null;
          _duration = null;
          _trimStart = 0;
          _trimEnd = 0;
          _error = 'Preview is unavailable for this format. You can still upload and run it.';
        });
      }
    }
  }

  Future<void> _prepareFile() async {
    final path = _selectedFile?.path;
    if (path == null) return;
    setState(() {
      _isPreparing = true;
      _error = null;
    });
    try {
      final file = File(path);
      final digest = await sha256.bind(file.openRead()).first;
      final existing = await widget.api.findByHash(digest.toString());
      final uploaded = existing ?? await widget.api.uploadAudio(file);
      if (mounted) {
        setState(() {
          _uploadedFile = uploaded;
          _reusedUpload = existing != null;
        });
      }
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _isPreparing = false);
    }
  }

  Future<void> _importFromYouTube() async {
    final url = _youtubeController.text.trim();
    if (url.isEmpty) return;
    setState(() {
      _isImporting = true;
      _error = null;
    });
    try {
      final imported = await widget.api.importYouTube(url);
      if (!mounted) return;
      // Download the stored file and decode it locally so its duration drives the
      // same trim controls used for local uploads. Preview is best-effort: any
      // failure just leaves it runnable as the full file.
      Duration? duration;
      try {
        final localPath = await widget.api.downloadInputFile(imported);
        duration = await _player.setFilePath(localPath);
      } catch (_) {
        duration = null;
      }
      if (!mounted) return;
      setState(() {
        // The import is already stored server-side, so it is immediately runnable.
        _uploadedFile = imported;
        _reusedUpload = false;
        _selectedFile = null;
        _duration = duration;
        _trimStart = 0;
        _trimEnd = duration == null ? 0 : duration.inMilliseconds / 1000;
      });
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _isImporting = false);
    }
  }

  Future<void> _playSelection() async {
    if (_duration == null) return;
    await _player.setClip(
      start: Duration(milliseconds: (_trimStart * 1000).round()),
      end: Duration(milliseconds: (_trimEnd * 1000).round()),
    );
    await _player.seek(Duration(milliseconds: (_trimStart * 1000).round()));
    await _player.play();
  }

  Future<void> _runWorkflow() async {
    final uploaded = _uploadedFile;
    if (uploaded == null) return;
    setState(() {
      _isRunning = true;
      _error = null;
    });
    try {
      final fullFile = _duration == null || (_trimStart == 0 && _trimEnd == _duration!.inMilliseconds / 1000);
      final execution = await widget.api.startExecution(
        widget.workflow.id,
        uploaded.id,
        trimStartSeconds: fullFile ? null : _trimStart,
        trimEndSeconds: fullFile ? null : _trimEnd,
      );
      if (!mounted) return;
      await Navigator.of(context).push<void>(
        MaterialPageRoute<void>(
          builder: (_) => ExecutionScreen(api: widget.api, initialExecution: execution),
        ),
      );
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _isRunning = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final durationSeconds = _duration == null ? null : _duration!.inMilliseconds / 1000;
    final selectionIsValid = durationSeconds == null || _trimStart < _trimEnd;
    return Scaffold(
      appBar: AppBar(title: Text('Run ${widget.workflow.name}')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Icon(Icons.audio_file_outlined, size: 48),
                  const SizedBox(height: 12),
                  Text(
                    _selectedFile?.name ?? _uploadedFile?.name ?? 'Choose an audio file',
                    style: Theme.of(context).textTheme.titleMedium,
                    textAlign: TextAlign.center,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'A matching previous upload is reused automatically.',
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.bodyMedium,
                  ),
                  const SizedBox(height: 20),
                  OutlinedButton.icon(
                    onPressed: _isPreparing || _isImporting ? null : _chooseAudio,
                    icon: const Icon(Icons.folder_open),
                    label: Text(_selectedFile == null ? 'Choose audio' : 'Change file'),
                  ),
                  if (_selectedFile != null) ...[
                    const SizedBox(height: 12),
                    FilledButton.icon(
                      onPressed: _isPreparing || _uploadedFile != null ? null : _prepareFile,
                      icon: _isPreparing
                          ? const SizedBox.square(
                              dimension: 18,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.cloud_upload_outlined),
                      label: Text(_uploadedFile == null ? 'Prepare file' : 'File ready'),
                    ),
                  ],
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    children: [
                      const Icon(Icons.smart_display_outlined),
                      const SizedBox(width: 8),
                      Text('Import from YouTube', style: Theme.of(context).textTheme.titleMedium),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(
                    'Paste a video URL and the server extracts its audio. This can take a minute.',
                    style: Theme.of(context).textTheme.bodyMedium,
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _youtubeController,
                    enabled: !_isImporting && !_isRunning,
                    keyboardType: TextInputType.url,
                    autocorrect: false,
                    decoration: const InputDecoration(
                      labelText: 'YouTube URL',
                      hintText: 'https://www.youtube.com/watch?v=…',
                      border: OutlineInputBorder(),
                      prefixIcon: Icon(Icons.link),
                    ),
                    onChanged: (_) => setState(() {}),
                    onSubmitted: (_) => _importFromYouTube(),
                  ),
                  const SizedBox(height: 12),
                  FilledButton.icon(
                    onPressed: _isImporting || _isRunning || _isPreparing || _youtubeController.text.trim().isEmpty
                        ? null
                        : _importFromYouTube,
                    icon: _isImporting
                        ? const SizedBox.square(
                            dimension: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.download),
                    label: Text(_isImporting ? 'Importing…' : 'Import audio'),
                  ),
                ],
              ),
            ),
          ),
          if (durationSeconds != null) ...[
            const SizedBox(height: 16),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text('Trim selection', style: Theme.of(context).textTheme.titleMedium),
                    const SizedBox(height: 4),
                    Text('${formatTime(_trimStart)} to ${formatTime(_trimEnd)}'),
                    RangeSlider(
                      values: RangeValues(_trimStart, _trimEnd),
                      min: 0,
                      max: durationSeconds,
                      onChanged: (values) => setState(() {
                        _trimStart = values.start;
                        _trimEnd = values.end;
                      }),
                    ),
                    Row(
                      children: [
                        OutlinedButton.icon(
                          onPressed: _playSelection,
                          icon: const Icon(Icons.play_arrow),
                          label: const Text('Play selection'),
                        ),
                        const SizedBox(width: 12),
                        TextButton(
                          onPressed: () => setState(() {
                            _trimStart = 0;
                            _trimEnd = durationSeconds;
                          }),
                          child: const Text('Use full file'),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ],
          if (_uploadedFile != null) ...[
            const SizedBox(height: 12),
            StatusNote(
              icon: Icons.check_circle_outline,
              color: _kSuccess,
              text: _reusedUpload ? 'Ready. Reused a previous upload.' : 'Ready to run.',
            ),
          ],
          if (_error != null) ...[
            const SizedBox(height: 12),
            StatusNote(icon: Icons.error_outline, color: Theme.of(context).colorScheme.error, text: _error!),
          ],
          const SizedBox(height: 20),
          FilledButton.icon(
            onPressed: _uploadedFile == null || _isRunning || !selectionIsValid ? null : _runWorkflow,
            icon: _isRunning
                ? const SizedBox.square(dimension: 18, child: CircularProgressIndicator(strokeWidth: 2))
                : const Icon(Icons.bolt),
            label: const Text('Run workflow'),
          ),
        ],
      ),
    );
  }
}

class ExecutionScreen extends StatefulWidget {
  const ExecutionScreen({super.key, required this.api, required this.initialExecution});

  final ApiClient api;
  final WorkflowExecution initialExecution;

  @override
  State<ExecutionScreen> createState() => _ExecutionScreenState();
}

class _ExecutionScreenState extends State<ExecutionScreen> {
  late WorkflowExecution _execution = widget.initialExecution;
  StreamSubscription<ExecutionEvent>? _subscription;
  final AudioPlayer _stemPlayer = AudioPlayer();
  String? _error;

  @override
  void initState() {
    super.initState();
    _subscription = widget.api.streamExecution(_execution.id).listen(
      _applyEvent,
      onError: (Object error) {
        if (mounted) setState(() => _error = '$error');
      },
    );
  }

  Future<void> _applyEvent(ExecutionEvent event) async {
    if (event is NodeEvent) {
      final nodes = [..._execution.nodes];
      final index = nodes.indexWhere(
        (node) =>
            node.id == event.nodeExecutionId ||
            (event.workflowNodeId != null && node.workflowNodeId == event.workflowNodeId),
      );
      final prior = index >= 0 ? nodes[index] : null;
      final status = event.type == 'NodeStarted'
          ? 'Running'
          : event.type == 'NodeCompleted'
              ? 'Completed'
              : 'Failed';
      final updated = NodeExecution(
        id: event.nodeExecutionId,
        workflowNodeId: event.workflowNodeId ?? prior?.workflowNodeId ?? '',
        status: status,
        attempt: event.attempt ?? prior?.attempt ?? 0,
        outputPaths: event.outputPaths ?? prior?.outputPaths ?? const {},
        label: prior?.label,
          modelName: prior?.modelName,
          startedAt: prior?.startedAt,
          completedAt: event.type == 'NodeCompleted' || event.type == 'NodeFailed'
            ? DateTime.now()
            : prior?.completedAt,
        errorMessage: event.errorMessage ?? prior?.errorMessage,
      );
      if (index >= 0) {
        nodes[index] = updated;
      } else {
        nodes.add(updated);
      }
      if (mounted) setState(() => _execution = _execution.copyWith(nodes: nodes));
      return;
    }

    final statusEvent = event as ExecutionStatusEvent;
    if (mounted) setState(() => _execution = _execution.copyWith(status: statusEvent.status));
    if (statusEvent.isTerminal) await _refreshExecution();
  }

  Future<void> _refreshExecution() async {
    try {
      final execution = await widget.api.getExecution(_execution.id);
      if (mounted) setState(() => _execution = execution);
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
    }
  }

  @override
  void dispose() {
    _subscription?.cancel();
    _stemPlayer.dispose();
    super.dispose();
  }

  Future<void> _playStem(String stem, String path) async {
    try {
      final localPath = await widget.api.downloadStem(path);
      await _stemPlayer.setFilePath(localPath);
      await _stemPlayer.play();
    } on ApiException catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.message)));
      }
    }
  }

  Future<void> _downloadStem(String stem, String path) async {
    try {
      final directory = await FilePicker.platform.getDirectoryPath(dialogTitle: 'Save $stem stem');
      final saved = await widget.api.downloadStem(path, destinationDirectory: directory);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$stem saved to $saved')));
      }
    } on ApiException catch (error) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
          title: const Text('Execution'),
        actions: [
          IconButton(
            onPressed: _refreshExecution,
            icon: const Icon(Icons.refresh),
            tooltip: 'Refresh execution',
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              _execution.workflowName,
                              style: Theme.of(context).textTheme.headlineSmall,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                          const SizedBox(width: 10),
                          StatusPill(status: _execution.status),
                        ],
                      ),
                      const SizedBox(height: 6),
                      Text(
                        'File: ${_execution.inputFileName} · Started: ${_formatDateTime(_execution.createdAt)}${_execution.completedAt == null ? '' : ' · Completed: ${_formatDateTime(_execution.completedAt!)}'}',
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    ],
                  ),
                ),
              ],
            ),
          if (_error != null) ...[
            const SizedBox(height: 12),
            StatusNote(icon: Icons.error_outline, color: Theme.of(context).colorScheme.error, text: _error!),
          ],
          const SizedBox(height: 16),
            Text('Node executions', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          if (_execution.nodes.isEmpty)
            const Card(child: Padding(padding: EdgeInsets.all(20), child: Text('Waiting for workflow nodes...'))),
          ..._execution.nodes.map(
            (node) => Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: NodeExecutionCard(
                  node: node,
                  onPlay: _playStem,
                  onDownload: _downloadStem,
                ),
            ),
          ),
        ],
      ),
    );
  }
}

class StatusPill extends StatelessWidget {
  const StatusPill({super.key, required this.status});

  final String status;

  @override
  Widget build(BuildContext context) {
    final color = _statusColor(status);
    return DecoratedBox(
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
        child: Text(
          status,
          style: TextStyle(color: color, fontSize: 12, fontWeight: FontWeight.w600),
        ),
      ),
    );
  }
}

class NodeExecutionCard extends StatelessWidget {
  const NodeExecutionCard({
    super.key,
    required this.node,
    required this.onPlay,
    required this.onDownload,
  });

  final NodeExecution node;
  final Future<void> Function(String stem, String path) onPlay;
  final Future<void> Function(String stem, String path) onDownload;

  @override
  Widget build(BuildContext context) {
    final model = node.modelName == null || node.modelName!.isEmpty
        ? null
        : node.modelName!.replaceAll('.yaml', '');
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    node.label ?? 'Workflow node',
                    style: Theme.of(context).textTheme.titleMedium,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                const SizedBox(width: 8),
                StatusPill(status: node.status),
              ],
            ),
            if (model != null) ...[
              const SizedBox(height: 2),
              Text(model, style: Theme.of(context).textTheme.bodySmall),
            ],
            const SizedBox(height: 14),
            Row(
              children: [
                _NodeMetric(label: 'Started', value: _formatTime(node.startedAt)),
                _NodeMetric(label: 'Completed', value: _formatTime(node.completedAt)),
                _NodeMetric(label: 'Duration', value: _formatDuration(node.startedAt, node.completedAt)),
              ],
            ),
            if (node.errorMessage != null) ...[
              const SizedBox(height: 12),
              Text(node.errorMessage!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
            ],
            if (node.outputPaths.isNotEmpty) ...[
              const SizedBox(height: 16),
              Text('Output stems', style: Theme.of(context).textTheme.labelLarge),
              const SizedBox(height: 8),
              ...node.outputPaths.entries.map(
                (entry) => Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Row(
                    children: [
                      IconButton.filled(
                        onPressed: () => onPlay(entry.key, entry.value),
                        icon: const Icon(Icons.play_arrow),
                        tooltip: 'Play ${entry.key}',
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Text(entry.key, overflow: TextOverflow.ellipsis),
                      ),
                      IconButton(
                        onPressed: () => onDownload(entry.key, entry.value),
                        icon: const Icon(Icons.download_outlined),
                        tooltip: 'Download ${entry.key}',
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _NodeMetric extends StatelessWidget {
  const _NodeMetric({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: Theme.of(context).textTheme.labelSmall),
          const SizedBox(height: 2),
          Text(value, style: Theme.of(context).textTheme.bodySmall),
        ],
      ),
    );
  }
}

String _formatDateTime(DateTime value) {
  final local = value.toLocal();
  return '${local.year}-${local.month.toString().padLeft(2, '0')}-${local.day.toString().padLeft(2, '0')} ${_formatTime(local)}';
}

String _formatTime(DateTime? value) {
  if (value == null) return '—';
  final local = value.toLocal();
  final hour = local.hour % 12 == 0 ? 12 : local.hour % 12;
  return '$hour:${local.minute.toString().padLeft(2, '0')}:${local.second.toString().padLeft(2, '0')} ${local.hour < 12 ? 'AM' : 'PM'}';
}

String _formatDuration(DateTime? start, DateTime? end) {
  if (start == null || end == null) return '—';
  final duration = end.difference(start);
  if (duration.inMilliseconds < 1000) return '${duration.inMilliseconds}ms';
  return '${(duration.inMilliseconds / 1000).toStringAsFixed(1)}s';
}

class StatusNote extends StatelessWidget {
  const StatusNote({super.key, required this.icon, required this.color, required this.text});

  final IconData icon;
  final Color color;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(icon, color: color),
        const SizedBox(width: 8),
        Expanded(child: Text(text, style: TextStyle(color: color))),
      ],
    );
  }
}

class _LoadFailure extends StatelessWidget {
  const _LoadFailure({required this.onRetry, required this.message});

  final Future<void> Function() onRetry;
  final String message;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('Could not load workflows', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 8),
            Text(message, textAlign: TextAlign.center),
            const SizedBox(height: 16),
            OutlinedButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh),
              label: const Text('Try again'),
            ),
          ],
        ),
      ),
    );
  }
}

String formatTime(double seconds) {
  final duration = Duration(milliseconds: (seconds * 1000).round());
  final minutes = duration.inMinutes;
  final remainingSeconds = duration.inSeconds.remainder(60);
  return '$minutes:${remainingSeconds.toString().padLeft(2, '0')}';
}

Color _statusColor(String status) => switch (status) {
  'Completed' => _kSuccess,
  'Failed' || 'PartiallyFailed' => _kDestructive,
  'Running' => _kPrimary,
  _ => _kWarning,
};

IconData _statusIcon(String status) => switch (status) {
  'Completed' => Icons.check_circle,
  'Failed' || 'PartiallyFailed' => Icons.error,
  'Running' => Icons.sync,
  _ => Icons.schedule,
};
