#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HALO_BASE_URL="${HALO_BASE_URL:-http://localhost:8090}"
HALO_CONTAINER_NAME="${HALO_CONTAINER_NAME:-halo-for-plugin-development}"
PLUGIN_MANIFEST_PATH="${PLUGIN_MANIFEST_PATH:-${ROOT_DIR}/src/main/resources/plugin.yaml}"
HALO_PLUGIN_NAME="${HALO_PLUGIN_NAME:-$(awk '/^  name:/ {print $2; exit}' "$PLUGIN_MANIFEST_PATH" 2>/dev/null || printf 'halo-private-posts')}"

RESTORE_ATTEMPTED=0
LOG_SINCE=""

log() {
  printf '[dev-uninstall-smoke] %s\n' "$*"
}

run_gradle() {
  (cd "$ROOT_DIR" && ./gradlew "$@")
}

restore_plugin() {
  if [[ "$RESTORE_ATTEMPTED" == "1" ]]; then
    return
  fi

  RESTORE_ATTEMPTED=1
  log "Restarting Halo development container to restore plugin ${HALO_PLUGIN_NAME}"
  docker restart "$HALO_CONTAINER_NAME" >/dev/null
  "${ROOT_DIR}/scripts/cleanup-e2e-seed-posts.sh"

  log "Verifying restored plugin routes"
  RUN_BUILD_SMOKE=0 RELOAD_PLUGIN=0 "${ROOT_DIR}/scripts/dev-container-smoke.sh"
}

check_uninstall_logs() {
  local logs
  logs="$(docker logs --since "$LOG_SINCE" "$HALO_CONTAINER_NAME" 2>&1 || true)"

  if [[ "$logs" == *"Completed uninstall cleanup for plugin ${HALO_PLUGIN_NAME} with failures"* ]]; then
    log "Uninstall cleanup reported failures for ${HALO_PLUGIN_NAME}"
    return 1
  fi

  if [[ "$logs" == *"Failed uninstall cleanup for plugin ${HALO_PLUGIN_NAME}"* ]]; then
    log "Uninstall cleanup crashed for ${HALO_PLUGIN_NAME}"
    return 1
  fi

  if [[ "$logs" == *"Scheme not found for privateposts.halo.run/v1alpha1/PrivatePost"* ]]; then
    log "Detected PrivatePost scheme GC errors after uninstall"
    return 1
  fi

  if [[ "$logs" != *"Completed uninstall cleanup for plugin ${HALO_PLUGIN_NAME}."* ]]; then
    log "Did not find successful uninstall cleanup summary for ${HALO_PLUGIN_NAME}"
    return 1
  fi
}

main() {
  trap restore_plugin EXIT

  log "Workspace: ${ROOT_DIR}"
  log "Halo base URL: ${HALO_BASE_URL}"
  log "Halo container: ${HALO_CONTAINER_NAME}"
  log "Halo plugin: ${HALO_PLUGIN_NAME}"

  log "Reloading latest plugin build into Halo development container"
  RUN_BUILD_SMOKE=0 "${ROOT_DIR}/scripts/dev-container-smoke.sh"

  log "Cleaning leftover e2e seed data"
  "${ROOT_DIR}/scripts/cleanup-e2e-seed-posts.sh"

  LOG_SINCE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  log "Running destructive uninstall smoke e2e"
  run_gradle testE2eUiUninstallSmoke --no-daemon

  log "Checking uninstall cleanup logs"
  check_uninstall_logs

  log "Uninstall smoke passed"
}

main "$@"
