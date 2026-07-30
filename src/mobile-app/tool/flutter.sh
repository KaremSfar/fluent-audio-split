#!/usr/bin/env bash
set -euo pipefail

restore_workspace_ownership() {
  chown -R "${LOCAL_UID}:${LOCAL_GID}" /workspace
}

trap restore_workspace_ownership EXIT

if [[ "${ACCEPT_ANDROID_SDK_LICENSES:-false}" == "true" ]]; then
  set +o pipefail
  yes | flutter doctor --android-licenses
  license_status=$?
  set -o pipefail
  if [[ "$license_status" -ne 0 ]]; then
    exit "$license_status"
  fi
fi

if [[ "${1:-}" == "build-apk" ]]; then
  shift
  # Bake the API base URL (from .env / the environment) into the APK. Defaults to
  # the local-emulator host alias when unset. Extra args are forwarded to flutter,
  # e.g. `build-apk --release` or `build-apk --debug`.
  api_base_url="${API_BASE_URL:-http://10.0.2.2:8765}"
  echo "Building APK with API_BASE_URL=${api_base_url}"
  build_args=("$@")
  if [[ ${#build_args[@]} -eq 0 ]]; then
    build_args=(--debug)
  fi
  flutter build apk "${build_args[@]}" --dart-define=API_BASE_URL="${api_base_url}"
  exit 0
fi

if [[ "${1:-}" == "bootstrap" ]]; then
  if [[ ! -d android ]]; then
    flutter create \
      --no-pub \
      --platforms=android,ios \
      --org "${MOBILE_APP_ORG}" \
      --project-name "${MOBILE_APP_PROJECT_NAME}" \
      .
  fi

  flutter pub get
  exit 0
fi

"$@"