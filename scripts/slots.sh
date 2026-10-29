#!/bin/sh
# ---------------------------------------------------------------------------
# Slot and port allocation for worktree-isolated stacks
# ---------------------------------------------------------------------------
# The only place that turns a worktree into port numbers. dev-env.sh,
# test-e2e.sh, the Makefile, and tools run through with-slots.sh all use it,
# so they always agree.
#
# Sourcing this file only defines functions, and the functions only set and
# export variables. Nothing is written, deleted, started, or printed (apart
# from a warning on stderr for a bad HDX_SLOT_FROM), so it is safe to use while
# a dev stack is running.
#
#   . scripts/slots.sh && hdx_dev_ports    # dev stack (yarn dev)
#   . scripts/slots.sh && hdx_ci_ports     # integration tests (make dev-int)
#   . scripts/slots.sh && hdx_e2e_ports    # E2E tests (make e2e)
#
# Each function takes an optional directory inside the worktree (default: the
# current directory).
#
# The slot (0-99) is the cksum of the worktree's folder name, mod 100, and each
# service's port is its base plus the slot. Override the slot per stack with
# HDX_DEV_SLOT, HDX_CI_SLOT, or HDX_E2E_SLOT, e.g. `HDX_DEV_SLOT=5 yarn dev`.
#
# If your worktrees share a folder name (a/hyperdx, b/hyperdx), set
# HDX_SLOT_FROM=path, e.g. in your shell profile, to hash the worktree's full
# path instead. The default, HDX_SLOT_FROM=name, keeps existing slots and the
# .volumes/*_<slot> data folders that go with them.
#
# The ranges stay clear of each other, of the default dev ports (4317-4320,
# 8000, 8080, 8123, 8888, 9000, 13133, 14318, 27017), and of the OS ephemeral
# range (32768+ on Linux, 49152+ on macOS).
# ---------------------------------------------------------------------------

# Slot of the worktree containing $1 (default: the current directory).
_hdx_default_slot() {
  _hdx_dir="${1:-.}"
  _hdx_root="$(git -C "$_hdx_dir" rev-parse --show-toplevel 2>/dev/null ||
    (cd "$_hdx_dir" && pwd))"
  case "${HDX_SLOT_FROM:-name}" in
    path) _hdx_key="$(cd "$_hdx_root" && pwd -P)" ;;
    name) _hdx_key="$(basename "$_hdx_root")" ;;
    *)
      echo "slots.sh: HDX_SLOT_FROM must be 'name' or 'path', got '$HDX_SLOT_FROM'; using 'name'" >&2
      _hdx_key="$(basename "$_hdx_root")"
      ;;
  esac
  printf '%s' "$_hdx_key" | cksum | awk '{print $1 % 100}'
}

# Dev stack (yarn dev): 30100-31199.
hdx_dev_ports() {
  HDX_DEV_SLOT="${HDX_DEV_SLOT:-$(_hdx_default_slot "$1")}"
  HYPERDX_API_PORT=$((30100 + HDX_DEV_SLOT))
  HYPERDX_APP_PORT=$((30200 + HDX_DEV_SLOT))
  HYPERDX_OPAMP_PORT=$((30300 + HDX_DEV_SLOT))
  HDX_DEV_MONGO_PORT=$((30400 + HDX_DEV_SLOT))
  HDX_DEV_CH_HTTP_PORT=$((30500 + HDX_DEV_SLOT))
  HDX_DEV_CH_NATIVE_PORT=$((30600 + HDX_DEV_SLOT))
  HDX_DEV_OTEL_HEALTH_PORT=$((30700 + HDX_DEV_SLOT))
  HDX_DEV_OTEL_GRPC_PORT=$((30800 + HDX_DEV_SLOT))
  HDX_DEV_OTEL_HTTP_PORT=$((30900 + HDX_DEV_SLOT))
  HDX_DEV_OTEL_METRICS_PORT=$((31000 + HDX_DEV_SLOT))
  HDX_DEV_OTEL_JSON_HTTP_PORT=$((31100 + HDX_DEV_SLOT))
  HDX_DEV_PROJECT="hdx-dev-${HDX_DEV_SLOT}"
  export HDX_DEV_SLOT HYPERDX_API_PORT HYPERDX_APP_PORT HYPERDX_OPAMP_PORT \
    HDX_DEV_MONGO_PORT HDX_DEV_CH_HTTP_PORT HDX_DEV_CH_NATIVE_PORT \
    HDX_DEV_OTEL_HEALTH_PORT HDX_DEV_OTEL_GRPC_PORT HDX_DEV_OTEL_HTTP_PORT \
    HDX_DEV_OTEL_METRICS_PORT HDX_DEV_OTEL_JSON_HTTP_PORT HDX_DEV_PROJECT
}

# Integration tests (make dev-int): ClickHouse 18123+, MongoDB 39999+,
# API 19000+, OpAMP 14320+.
hdx_ci_ports() {
  HDX_CI_SLOT="${HDX_CI_SLOT:-$(_hdx_default_slot "$1")}"
  HDX_CI_CH_PORT=$((18123 + HDX_CI_SLOT))
  HDX_CI_MONGO_PORT=$((39999 + HDX_CI_SLOT))
  HDX_CI_API_PORT=$((19000 + HDX_CI_SLOT))
  HDX_CI_OPAMP_PORT=$((14320 + HDX_CI_SLOT))
  HDX_CI_PROJECT="int-${HDX_CI_SLOT}"
  export HDX_CI_SLOT HDX_CI_CH_PORT HDX_CI_MONGO_PORT HDX_CI_API_PORT \
    HDX_CI_OPAMP_PORT HDX_CI_PROJECT
}

# E2E tests (make e2e): 20320-21399, plus the Playwright report server at
# 9323+. Ports that are already set are kept, because CI pins them in
# .github/actions/e2e-setup.
hdx_e2e_ports() {
  HDX_E2E_SLOT="${HDX_E2E_SLOT:-$(_hdx_default_slot "$1")}"
  HDX_E2E_OPAMP_PORT="${HDX_E2E_OPAMP_PORT:-$((20320 + HDX_E2E_SLOT))}"
  HDX_E2E_CH_PORT="${HDX_E2E_CH_PORT:-$((20500 + HDX_E2E_SLOT))}"
  HDX_E2E_CH_NATIVE_PORT="${HDX_E2E_CH_NATIVE_PORT:-$((20600 + HDX_E2E_SLOT))}"
  HDX_E2E_API_PORT="${HDX_E2E_API_PORT:-$((21000 + HDX_E2E_SLOT))}"
  HDX_E2E_MONGO_PORT="${HDX_E2E_MONGO_PORT:-$((21100 + HDX_E2E_SLOT))}"
  HDX_E2E_APP_LOCAL_PORT="${HDX_E2E_APP_LOCAL_PORT:-$((21200 + HDX_E2E_SLOT))}"
  HDX_E2E_APP_PORT="${HDX_E2E_APP_PORT:-$((21300 + HDX_E2E_SLOT))}"
  HDX_E2E_REPORT_PORT=$((9323 + HDX_E2E_SLOT))
  E2E_PROJECT="e2e-${HDX_E2E_SLOT}"
  export HDX_E2E_SLOT HDX_E2E_OPAMP_PORT HDX_E2E_CH_PORT \
    HDX_E2E_CH_NATIVE_PORT HDX_E2E_API_PORT HDX_E2E_MONGO_PORT \
    HDX_E2E_APP_LOCAL_PORT HDX_E2E_APP_PORT HDX_E2E_REPORT_PORT E2E_PROJECT
}
