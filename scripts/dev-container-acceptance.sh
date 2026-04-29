#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HALO_BASE_URL="${HALO_BASE_URL:-http://localhost:8090}"
HALO_E2E_USERNAME="${HALO_E2E_USERNAME:-admin}"
HALO_E2E_PASSWORD="${HALO_E2E_PASSWORD:-Admin12345!}"
RUN_UNINSTALL_SMOKE="${RUN_UNINSTALL_SMOKE:-1}"

log() {
  printf '[dev-acceptance] %s\n' "$*"
}

run_gradle() {
  (cd "$ROOT_DIR" && ./gradlew "$@")
}

main() {
  log "Workspace: ${ROOT_DIR}"
  log "Halo base URL: ${HALO_BASE_URL}"
  log "Halo e2e user: ${HALO_E2E_USERNAME}"

  log "Cleaning leftover e2e seed data"
  "${ROOT_DIR}/scripts/cleanup-e2e-seed-posts.sh"

  log "Running development-container smoke checks"
  "${ROOT_DIR}/scripts/dev-container-smoke.sh"

  log "Running authenticated e2e"
  run_gradle testE2eUi --no-daemon

  if [[ "$RUN_UNINSTALL_SMOKE" == "1" ]]; then
    log "Running uninstall smoke"
    "${ROOT_DIR}/scripts/dev-container-uninstall-smoke.sh"
  fi

  log "Acceptance checks passed"
}

main "$@"
