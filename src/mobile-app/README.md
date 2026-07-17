# Fluent Audio Split Mobile

Flutter app for **running workflows that already exist in the web app**. It intentionally does not create,
edit, or delete workflows and does not include the React Flow canvas.

## Product scope

1. Sign in with the existing ASP.NET Identity bearer-token API.
2. List the signed-in user's workflows and their node counts.
3. Select a workflow, choose or drop an audio file, reuse an existing upload by SHA-256, and optionally trim it.
4. Start the workflow, reconcile live status over SSE, then show each output stem for download.
5. Keep prior executions available as a later read-only history view.

The first implementation targets Android. The Flutter project also generates iOS platform files, but iOS signing
and release builds require macOS tooling and are out of scope for the Linux Docker workflow.

## API contract

All endpoints require `Authorization: Bearer <access-token>` after sign-in.

| Mobile operation | Existing API |
| --- | --- |
| Sign in / refresh | `POST /api/auth/login`, `POST /api/auth/refresh` |
| List workflows | `GET /api/workflows` |
| Deduplicate an upload | `GET /api/files/by-hash/{sha256}` |
| Upload audio | `POST /api/files/upload` as multipart field `file` |
| Start an execution | `POST /api/workflows/{id}/execute` with `fileId`, optional trim seconds |
| Live updates | `GET /api/executions/{id}/stream` as authenticated SSE |
| Reconcile current state | `GET /api/executions/{id}` |
| Download a stem | `GET /api/files/download?path={relativePath}` |

Only root-node executions are returned at start. Downstream node executions appear lazily, so live state is
reconciled by stable `workflowNodeId` rather than only `nodeExecutionId`. A terminal event must trigger
`GET /api/executions/{id}` because the server's in-memory SSE bus does not replay missed events.

## Delivery plan

1. **Foundation:** Docker-only Flutter bootstrap, strict analysis, typed API client, secure token storage, and
   contract tests for JSON and SSE event parsing.
2. **Workflow browser:** sign-in and a read-only workflow list. Each item has a single Run action; no workflow
   management controls are present.
3. **Run sheet:** audio file picker, hash/reuse-or-upload flow, decoded duration, waveform-style trim selector,
   and playback of the selected region.
4. **Execution detail:** subscribe to SSE, upsert lazy/retried nodes by `workflowNodeId`, refetch terminal state,
   and offer downloads for every named output stem.
5. **Hardening:** offline/error states, token refresh, Android emulator/device testing, and a release APK build.

The design follows the supplied Dart skills: `dart-run-static-analysis` supplies strict analyzer settings and
`dart-add-unit-test` defines the mirrored `test/` layout and Flutter test workflow.

## Docker-only workflow

The host does not need Flutter, the Dart SDK, Android Studio, or Android SDK packages. Ignored project-local cache
directories retain Pub and Gradle downloads. The Flutter image runs with its required SDK privileges and its entrypoint
restores `/workspace` to `LOCAL_UID:LOCAL_GID` whenever it exits, so generated files remain owned by the current host user.

```bash
# Initial platform generation, dependency resolution, and Android licence approval.
ACCEPT_ANDROID_SDK_LICENSES=true \
LOCAL_UID=$(id -u) LOCAL_GID=$(id -g) \
MOBILE_APP_ORG=com.fluentaudiosplit \
MOBILE_APP_PROJECT_NAME=fluent_audio_split_mobile \
docker compose -f src/mobile-app/compose.yaml run --rm flutter bootstrap

# Static analysis and tests.
LOCAL_UID=$(id -u) LOCAL_GID=$(id -g) docker compose -f src/mobile-app/compose.yaml run --rm flutter flutter analyze
LOCAL_UID=$(id -u) LOCAL_GID=$(id -g) docker compose -f src/mobile-app/compose.yaml run --rm flutter flutter test

# Debug Android APK. API_BASE_URL must point to the reachable API/gateway for the target device.
LOCAL_UID=$(id -u) LOCAL_GID=$(id -g) docker compose -f src/mobile-app/compose.yaml run --rm flutter \
  flutter build apk --debug --dart-define=API_BASE_URL=http://10.0.2.2:8765
```

`ghcr.io/cirruslabs/flutter:stable` is a complete Flutter + Android SDK image. Its maintainers announced that
updates stop after May 2026, so pin a tested image digest before release and replace it with the team's approved,
maintained builder image when available.