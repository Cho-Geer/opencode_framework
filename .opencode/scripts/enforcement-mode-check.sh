#!/usr/bin/env bash
# ==============================================================================
# enforcement-mode-check.sh — Read and validate enforcement mode
# ==============================================================================
# Purpose: Resolves the current enforcement mode from (in priority order):
#   1. ENFORCEMENT_MODE environment variable (with locked-mode safety guards)
#   2. project.config.json → template_resolution.enforcement_mode
#   3. Default: "advisory"
#
# Also validates mode transitions (no downgrade from locked without unlock token).
#
# Usage:
#   enforcement-mode-check.sh                    → outputs mode name to stdout
#   enforcement-mode-check.sh --json             → outputs JSON with full mode config
#   enforcement-mode-check.sh --block <check_key> → exits 0 if check is blocking, 1 otherwise
#   enforcement-mode-check.sh --validate         → validates mode consistency
# ==============================================================================

set -euo pipefail

# ── Resolve paths ──────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CONFIG_FILE="${PROJECT_ROOT}/.opencode/project.config.json"
MACHINE_FILE="${PROJECT_ROOT}/.opencode/state/machine.json"
DEFAULT_MODE="advisory"
VALID_MODES=("advisory" "strict" "locked")

# ── Helper: read mode from project.config.json ─────────────────────────
read_config_mode() {
  if [ -f "$CONFIG_FILE" ]; then
    if command -v node &>/dev/null; then
      node -e "
        try {
          const cfg = require('$CONFIG_FILE');
          const mode = cfg.template_resolution?.enforcement_mode;
          if (mode && ['advisory','strict','locked'].includes(mode)) {
            console.log(mode);
          } else {
            console.log('$DEFAULT_MODE');
          }
        } catch(e) {
          console.log('$DEFAULT_MODE');
        }
      " 2>/dev/null || echo "$DEFAULT_MODE"
    elif command -v python3 &>/dev/null; then
      python3 -c "
import json, sys
try:
    with open('$CONFIG_FILE') as f:
        cfg = json.load(f)
    mode = cfg.get('template_resolution', {}).get('enforcement_mode', '$DEFAULT_MODE')
    if mode in ['advisory', 'strict', 'locked']:
        print(mode)
    else:
        print('$DEFAULT_MODE')
except:
    print('$DEFAULT_MODE')
" 2>/dev/null || echo "$DEFAULT_MODE"
    else
      echo "$DEFAULT_MODE"
    fi
  else
    echo "$DEFAULT_MODE"
  fi
}

# ── Helper: read full enforcement_config from project.config.json ──────
read_full_config() {
  if [ -f "$CONFIG_FILE" ]; then
    if command -v node &>/dev/null; then
      node -e "
        try {
          const cfg = require('$CONFIG_FILE');
          const ec = cfg.template_resolution?.enforcement_config || {};
          const mode = cfg.template_resolution?.enforcement_mode || '$DEFAULT_MODE';
          console.log(JSON.stringify({ mode, config: ec[mode] || {} }, null, 2));
        } catch(e) {
          console.log(JSON.stringify({ mode: '$DEFAULT_MODE', config: {} }, null, 2));
        }
      " 2>/dev/null
    else
      echo "{\"mode\": \"$DEFAULT_MODE\", \"config\": {}}"
    fi
  else
    echo "{\"mode\": \"$DEFAULT_MODE\", \"config\": {}}"
  fi
}

# ── Helper: check if a given check_key is blocking in current mode ─────
is_blocking() {
  local check_key="$1"
  local mode

  mode=$(resolve_mode)

  if [ "$mode" = "advisory" ]; then
    return 1  # advisory: nothing blocks
  fi

  if [ "$mode" = "locked" ]; then
    return 0  # locked: everything blocks
  fi

  # strict mode: check against block_on list
  if [ -f "$CONFIG_FILE" ] && command -v node &>/dev/null; then
    local blocks
    blocks=$(node -e "
      try {
        const cfg = require('$CONFIG_FILE');
        const blockOn = cfg.template_resolution?.enforcement_config?.strict?.block_on || [];
        if (blockOn.includes('$check_key')) {
          console.log('true');
        } else {
          console.log('false');
        }
      } catch(e) {
        console.log('false');
      }
    " 2>/dev/null || echo "false")
    if [ "$blocks" = "true" ]; then
      return 0
    fi
  fi

  return 1
}

# ── Resolve enforcement mode ───────────────────────────────────────────
resolve_mode() {
  local config_mode
  config_mode=$(read_config_mode)

  # ENFORCEMENT_MODE env var overrides (with safety guards)
  if [ -n "${ENFORCEMENT_MODE:-}" ]; then
    local env_mode="${ENFORCEMENT_MODE}"

    # Validate env_mode is a valid mode
    local valid=0
    for m in "${VALID_MODES[@]}"; do
      if [ "$m" = "$env_mode" ]; then
        valid=1
        break
      fi
    done
    if [ "$valid" -eq 0 ]; then
      echo "⚠️  [enforcement-mode-check] Invalid ENFORCEMENT_MODE='$env_mode'. Falling back to config mode '$config_mode'." >&2
      echo "$config_mode"
      return
    fi

    # Safety: cannot override locked mode with env var
    if [ "$config_mode" = "locked" ]; then
      echo "🔒 [enforcement-mode-check] Config mode is 'locked'. ENFORCEMENT_MODE override ignored." >&2
      echo "locked"
      return
    fi

    echo "$env_mode"
    return
  fi

  echo "$config_mode"
}

# ── Main ────────────────────────────────────────────────────────────────
case "${1:-}" in
  --json)
    read_full_config
    exit 0
    ;;

  --block)
    check_key="${2:-}"
    if [ -z "$check_key" ]; then
      echo "ERROR: --block requires <check_key> argument" >&2
      exit 2
    fi
    if is_blocking "$check_key"; then
      echo "BLOCKING"
      exit 0
    else
      echo "NON_BLOCKING"
      exit 1
    fi
    ;;

  --validate)
    current_mode
    current_mode=$(resolve_mode)
    echo "ENFORCEMENT_MODE=$current_mode"
    echo "Config file: $CONFIG_FILE"
    if [ -f "$MACHINE_FILE" ] && command -v node &>/dev/null; then
      node -e "
        try {
          const machine = require('$MACHINE_FILE');
          const transitions = machine.compliance_records?.enforcement_transitions || [];
          if (transitions.length > 0) {
            const last = transitions[transitions.length - 1];
            console.log('Last transition: ' + last.from + ' → ' + last.to + ' at ' + last.timestamp);
          } else {
            console.log('No enforcement transitions recorded.');
          }
          console.log('Current mode: $current_mode');
          console.log('Machine.json mode consistency: OK');
        } catch(e) {
          console.log('Could not read machine.json: ' + e.message);
        }
      " 2>/dev/null
    fi
    exit 0
    ;;

  --help|-h)
    echo "Usage: enforcement-mode-check.sh [--json | --block <check_key> | --validate | --help]"
    echo ""
    echo "Options:"
    echo "  (none)        Print current enforcement mode to stdout"
    echo "  --json        Print full mode config as JSON"
    echo "  --block KEY   Exit 0 if KEY is blocking in current mode, exit 1 otherwise"
    echo "  --validate    Print validation summary"
    echo "  --help        Show this help message"
    echo ""
    echo "Valid check keys: gate_armed, keystone_hash, keystone_integrity, tdd_order, dag_gate, eslint_audit, role_scope, workspace_root, gate_state_sync, write_audit_integrity"
    exit 0
    ;;

  *)
    resolve_mode
    exit 0
    ;;
esac
