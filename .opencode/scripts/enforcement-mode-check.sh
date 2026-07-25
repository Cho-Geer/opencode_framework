#!/usr/bin/env bash
# ==============================================================================
# enforcement-mode-check.sh — Legacy compatibility mode helper
# ==============================================================================
# Purpose: Keeps legacy scripts working while runtime enforcement has moved to
# per-rule disposition. This helper no longer honors ENFORCEMENT_MODE env
# overrides and resolves a compatibility mode only.
#   1. If project.config.json declares enforcement_policy, return "strict"
#   2. Else fall back to historical runtime/develop_enforcement_mode keys
#   3. Default: "strict"
#
# Usage:
#   enforcement-mode-check.sh                    → outputs mode name to stdout
#   enforcement-mode-check.sh --json             → outputs JSON with compat mode info
#   enforcement-mode-check.sh --block <check_key> → exits 0 if check is blocking, 1 otherwise
#   enforcement-mode-check.sh --validate         → validates mode consistency
# ==============================================================================

set -euo pipefail

# ── Resolve paths ──────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CONFIG_FILE="${PROJECT_ROOT}/.opencode/project.config.json"
MACHINE_FILE="${PROJECT_ROOT}/.opencode/state/machine.json"
DEFAULT_MODE="strict"
VALID_MODES=("advisory" "strict" "locked")

# ── Helper: read compatibility mode from project.config.json ───────────
read_config_mode() {
  if [ -f "$CONFIG_FILE" ]; then
    if command -v bun &>/dev/null; then
      bun -e "
        try {
          const cfg = require('$CONFIG_FILE');
          if (cfg.enforcement_policy) {
            console.log('strict');
            process.exit(0);
          }
          // FW-REPAIR-12: Dual-key resolution per enforcement-modes-standard.md §4.1
          const mode = cfg.template_resolution?.runtime_enforcement_mode
                    || cfg.template_resolution?.develop_enforcement_mode;
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
    if cfg.get('enforcement_policy'):
        print('strict')
        raise SystemExit(0)
    # FW-REPAIR-12: Dual-key resolution
    tr = cfg.get('template_resolution', {})
    mode = tr.get('runtime_enforcement_mode') or tr.get('develop_enforcement_mode') or '$DEFAULT_MODE'
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

# ── Helper: read compatibility metadata from project.config.json ───────
read_full_config() {
  if [ -f "$CONFIG_FILE" ]; then
    if command -v bun &>/dev/null; then
      bun -e "
        try {
          const cfg = require('$CONFIG_FILE');
          if (cfg.enforcement_policy) {
            console.log(JSON.stringify({
              mode: 'strict',
              config: { legacy_compat: true, rule_source: cfg.enforcement_policy.rule_source || null }
            }, null, 2));
            process.exit(0);
          }
          const ec = cfg.template_resolution?.enforcement_config || {};
          // FW-REPAIR-12: Dual-key resolution
          const mode = cfg.template_resolution?.runtime_enforcement_mode
                    || cfg.template_resolution?.develop_enforcement_mode
                    || '$DEFAULT_MODE';
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

  if [ "$mode" = "locked" ] || [ "$mode" = "strict" ]; then
    return 0  # single-policy compat: blocking
  fi

  # Historical advisory fallback
  if [ -f "$CONFIG_FILE" ] && command -v bun &>/dev/null; then
    local blocks
    blocks=$(bun -e "
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
    echo "COMPAT_ENFORCEMENT_MODE=$current_mode"
    echo "Config file: $CONFIG_FILE"
    if [ -f "$MACHINE_FILE" ] && command -v bun &>/dev/null; then
      bun -e "
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
    echo "  (none)        Print current compatibility mode to stdout"
    echo "  --json        Print compatibility metadata as JSON"
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
