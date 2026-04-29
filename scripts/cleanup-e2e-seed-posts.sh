#!/usr/bin/env bash
set -euo pipefail

HALO_BASE_URL="${HALO_BASE_URL:-http://localhost:8090}"
HALO_E2E_USERNAME="${HALO_E2E_USERNAME:-admin}"
HALO_E2E_PASSWORD="${HALO_E2E_PASSWORD:-Admin12345!}"
PAGE_SIZE="${PAGE_SIZE:-200}"

log() {
  printf '[cleanup-e2e-seeds] %s\n' "$*"
}

api_url() {
  printf '%s%s' "$HALO_BASE_URL" "$1"
}

curl_json() {
  curl -sf -u "${HALO_E2E_USERNAME}:${HALO_E2E_PASSWORD}" "$@"
}

patch_allow_comment_false() {
  local post_name="$1"
  local status

  status="$(curl -s -o /dev/null -w '%{http_code}' \
    -u "${HALO_E2E_USERNAME}:${HALO_E2E_PASSWORD}" \
    -X PATCH "$(api_url "/apis/content.halo.run/v1alpha1/posts/${post_name}")" \
    -H 'Content-Type: application/json-patch+json' \
    --data '[{"op":"replace","path":"/spec/allowComment","value":false}]')"

  [[ "$status" == "200" || "$status" == "404" ]]
}

delete_if_exists() {
  local url="$1"
  local status

  status="$(curl -s -o /dev/null -w '%{http_code}' \
    -u "${HALO_E2E_USERNAME}:${HALO_E2E_PASSWORD}" \
    -X DELETE "$url")"

  [[ "$status" == "200" || "$status" == "202" || "$status" == "204" || "$status" == "404" ]]
}

main() {
  local post_names
  mapfile -t post_names < <(
    curl_json "$(api_url "/apis/content.halo.run/v1alpha1/posts?page=0&size=${PAGE_SIZE}")" \
      | jq -r '.items[] | select(.spec.slug | startswith("e2e-private-post-")) | .metadata.name'
  )

  if [[ "${#post_names[@]}" -eq 0 ]]; then
    log "No leftover e2e seed posts found"
    return
  fi

  log "Cleaning ${#post_names[@]} leftover e2e seed post(s)"
  for post_name in "${post_names[@]}"; do
    log "Cleaning ${post_name}"
    patch_allow_comment_false "$post_name" || true
    delete_if_exists "$(api_url "/apis/content.halo.run/v1alpha1/posts/${post_name}")"
    delete_if_exists "$(api_url "/apis/privateposts.halo.run/v1alpha1/privateposts/${post_name}")" || true
  done
}

main "$@"
