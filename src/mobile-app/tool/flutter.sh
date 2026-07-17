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