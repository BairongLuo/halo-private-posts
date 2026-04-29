#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HALO_BASE_URL="${HALO_BASE_URL:-http://localhost:8090}"
HALO_CONTAINER_NAME="${HALO_CONTAINER_NAME:-halo-for-plugin-development}"
HALO_WAIT_SECONDS="${HALO_WAIT_SECONDS:-120}"
GRADLE_SETTINGS_PATH="${GRADLE_SETTINGS_PATH:-${ROOT_DIR}/settings.gradle}"
PLUGIN_MANIFEST_PATH="${PLUGIN_MANIFEST_PATH:-${ROOT_DIR}/src/main/resources/plugin.yaml}"
PLUGIN_DIR_NAME="${PLUGIN_DIR_NAME:-$(awk -F"'" '/^rootProject.name *=/ {print $2; exit}' "$GRADLE_SETTINGS_PATH" 2>/dev/null || basename "$ROOT_DIR")}"
PLUGIN_NAME="${PLUGIN_NAME:-$(awk '/^  name:/ {print $2; exit}' "$PLUGIN_MANIFEST_PATH" 2>/dev/null || printf '%s' "$PLUGIN_DIR_NAME")}"
ENSURE_CONTAINER="${ENSURE_CONTAINER:-1}"
RELOAD_PLUGIN="${RELOAD_PLUGIN:-1}"
RUN_BUILD_SMOKE="${RUN_BUILD_SMOKE:-1}"
RECREATE_CONTAINER_ON_STALE_MOUNT="${RECREATE_CONTAINER_ON_STALE_MOUNT:-0}"

log() {
  printf '[dev-smoke] %s\n' "$*"
}

run_gradle() {
  (cd "$ROOT_DIR" && ./gradlew "$@")
}

container_exists() {
  docker ps -a --format '{{.Names}}' | grep -Fxq "$HALO_CONTAINER_NAME"
}

container_running() {
  [[ "$(docker inspect -f '{{.State.Running}}' "$HALO_CONTAINER_NAME" 2>/dev/null || true)" == "true" ]]
}

ensure_container_running() {
  if container_running; then
    return 0
  fi

  log "Starting Halo development container ${HALO_CONTAINER_NAME}"
  docker start "$HALO_CONTAINER_NAME" >/dev/null
}

dev_mount_ready() {
  docker exec "$HALO_CONTAINER_NAME" test -f "/data/plugins/${PLUGIN_DIR_NAME}/build/resources/main/plugin.yaml"
}

recreate_container() {
  log "Removing stale Halo development container ${HALO_CONTAINER_NAME}"
  docker rm -f "$HALO_CONTAINER_NAME" >/dev/null
  log "Recreating Halo development container ${HALO_CONTAINER_NAME}"
  run_gradle -PhaloContainerName="${HALO_CONTAINER_NAME}" createHaloContainer
}

wait_for_url() {
  local url="$1"
  local expected_status="$2"
  local attempts remaining status

  attempts=$(( HALO_WAIT_SECONDS / 2 ))
  if (( attempts < 1 )); then
    attempts=1
  fi

  remaining="$attempts"
  while (( remaining > 0 )); do
    status="$(curl -sS -o /dev/null -w '%{http_code}' "$url" || true)"
    if [[ "$status" == "$expected_status" ]]; then
      return 0
    fi
    sleep 2
    remaining=$(( remaining - 1 ))
  done

  log "Expected HTTP ${expected_status} from ${url}, got ${status:-<none>}"
  return 1
}

assert_url_status() {
  local url="$1"
  local expected_status="$2"
  local status

  status="$(curl -sS -o /dev/null -w '%{http_code}' "$url" || true)"
  if [[ "$status" != "$expected_status" ]]; then
    log "Unexpected HTTP status for ${url}: expected ${expected_status}, got ${status:-<none>}"
    return 1
  fi
}

assert_cache_control_contains() {
  local url="$1"
  local expected_fragment="$2"
  local headers cache_control

  headers="$(curl -sS -D - -o /dev/null "$url" || true)"
  cache_control="$(
    printf '%s' "$headers" \
      | awk 'BEGIN {IGNORECASE=1} /^Cache-Control:/ {sub(/\r$/, "", $0); print substr($0, index($0, ":") + 2); exit}'
  )"

  if [[ -z "$cache_control" || "$cache_control" != *"$expected_fragment"* ]]; then
    log "Unexpected Cache-Control for ${url}: expected to contain ${expected_fragment}, got ${cache_control:-<missing>}"
    return 1
  fi
}

main() {
  log "Workspace: ${ROOT_DIR}"
  log "Halo base URL: ${HALO_BASE_URL}"
  log "Halo container: ${HALO_CONTAINER_NAME}"
  log "Plugin dir: ${PLUGIN_DIR_NAME}"
  log "Plugin name: ${PLUGIN_NAME}"

  if [[ "$RUN_BUILD_SMOKE" == "1" ]]; then
    log "Running Gradle smokeCheck"
    run_gradle smokeCheck
  fi

  if [[ "$ENSURE_CONTAINER" == "1" ]]; then
    if container_exists; then
      if container_running; then
        log "Reusing existing Halo development container"
      else
        ensure_container_running
      fi
    else
      log "Creating Halo development container"
      run_gradle -PhaloContainerName="${HALO_CONTAINER_NAME}" createHaloContainer
      ensure_container_running
    fi
  fi

  log "Waiting for Halo to answer on ${HALO_BASE_URL}"
  wait_for_url "${HALO_BASE_URL}" "200"

  if [[ "$RELOAD_PLUGIN" == "1" ]]; then
    if ! dev_mount_ready; then
      if [[ "$RECREATE_CONTAINER_ON_STALE_MOUNT" == "1" ]]; then
        recreate_container
        ensure_container_running
        log "Waiting for Halo to answer on ${HALO_BASE_URL} after container recreation"
        wait_for_url "${HALO_BASE_URL}" "200"
      else
        log "Halo dev container build mount is stale."
        log "Fix it with:"
        log "  docker rm -f ${HALO_CONTAINER_NAME}"
        log "  ./gradlew -PhaloContainerName=${HALO_CONTAINER_NAME} createHaloContainer"
        log "Then rerun this script, or set RECREATE_CONTAINER_ON_STALE_MOUNT=1 to let the script recreate it."
        exit 1
      fi
    fi

    log "Reloading plugin into Halo container"
    run_gradle -PhaloContainerName="${HALO_CONTAINER_NAME}" reloadPlugin
  fi

  log "Waiting for public reader assets"
  wait_for_url "${HALO_BASE_URL}/plugins/${PLUGIN_NAME}/assets/reader/reader.js" "200"
  wait_for_url "${HALO_BASE_URL}/plugins/${PLUGIN_NAME}/assets/reader/reader.css" "200"

  log "Checking private post routes are mounted"
  assert_url_status "${HALO_BASE_URL}/private-posts?slug=missing-slug" "404"
  assert_url_status "${HALO_BASE_URL}/private-posts/data?slug=missing-slug" "404"
  assert_cache_control_contains "${HALO_BASE_URL}/private-posts?slug=missing-slug" "no-store"
  assert_cache_control_contains "${HALO_BASE_URL}/private-posts/data?slug=missing-slug" "no-store"

  log "Smoke checks passed"
}

main "$@"
