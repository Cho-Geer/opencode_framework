#!/usr/bin/env bash
# ==============================================================================
# state-machine-reset.sh — State Machine Bootstrap / Reset Script
# ==============================================================================
# Purpose: Resets .opencode/state/machine.json to a clean baseline while
#          preserving the meta section, contracts array, and keystone_hashes.
#          Useful for workspace migrations, fresh project setups, and
#          recovering from cross-workspace state contamination.
#
# Usage:   .opencode/scripts/state-machine-reset.sh [--force] [--dry-run]
#
# Options:
#   --force     Non-interactive mode: skip confirmation prompt
#   --dry-run   Preview changes without writing to disk
#
# Exit:    0 — reset successful or no changes needed
#          1 — error (missing jq, unreadable machine.json, user abort)
# ==============================================================================

set -euo pipefail

# ──────────────────────────────────────────────
# 0. Resolve paths
# ──────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
OPENCODE_ROOT="${OPENCODE_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
STATE_DIR="${OPENCODE_ROOT}/.opencode/state"
MACHINE_FILE="${STATE_DIR}/machine.json"
BACKUP_FILE="${MACHINE_FILE}.bak"
TIMESTAMP="$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")"

FORCE=false
DRY_RUN=false

for arg in "$@"; do
  case "$arg" in
    --force)  FORCE=true ;;
    --dry-run) DRY_RUN=true ;;
    *)        echo "❌ [state-machine-reset] Unknown option: $arg" >&2
              echo "   Usage: $0 [--force] [--dry-run]" >&2
              exit 1 ;;
  esac
done

# ──────────────────────────────────────────────
# 1. Pre-flight checks
# ──────────────────────────────────────────────
if ! command -v jq &> /dev/null; then
  echo "❌ [state-machine-reset] jq is required but not installed." >&2
  echo "   Install: apt-get install jq / brew install jq" >&2
  exit 1
fi

echo "[state-machine-reset] OPENCODE_ROOT: ${OPENCODE_ROOT}" >&2
echo "[state-machine-reset] Target: ${MACHINE_FILE}" >&2

# ──────────────────────────────────────────────
# 2. Handle missing machine.json (fresh bootstrap)
# ──────────────────────────────────────────────
if [ ! -f "$MACHINE_FILE" ]; then
  echo "[state-machine-reset] machine.json not found. Bootstrapping fresh baseline..." >&2

  # Build a brand-new machine.json from scratch
  FRESH_STATE=$(jq -n --arg ts "$TIMESTAMP" '{
    meta: {
      version: "1.0.0",
      createdAt: $ts,
      lastUpdated: $ts,
      project: "booking-system",
      framework: "opencode-v3"
    },
    eslint_state: {
      last_full_scan: null,
      modules: {},
      aggregate: {
        total_violations: 0,
        dirty_modules: [],
        waived_modules: []
      }
    },
    # diagnostic_state (replaces type_check_state, 2026-06-26)
    diagnostic_state: {
      files: {},
      last_updated: ""
    },
    dependency_state: {
      last_check: null,
      violations: [],
      forbidden_rules_applied: 0,
      status: "clean"
    },
    format_state: {
      status: "clean",
      unformatted_files: [],
      last_run: null,
      last_check: null,
      auto_fix_count: 0
    },
    write_audit_state: {
      enabled: true,
      current_session: null,
      history: []
    },
    compliance_records: {
      role_violations: [],
      gate_violations: [],
      tdd_violations: []
    },
    tdd_enforcement_state: {
      enabled: true,
      current_session: null,
      violations: [],
      history: []
    },
    contracts: ["contract.yaml"],
    keystone_hashes: {}
  }')

  if [ "$DRY_RUN" = true ]; then
    echo "[state-machine-reset] [DRY RUN] Would create fresh machine.json:" >&2
    echo "$FRESH_STATE" | jq '.'
  else
    mkdir -p "$STATE_DIR"
    echo "$FRESH_STATE" > "$MACHINE_FILE"
    echo "[state-machine-reset] ✅ Created fresh machine.json" >&2
  fi
  exit 0
fi

# ──────────────────────────────────────────────
# 3. Read and snapshot current state
# ──────────────────────────────────────────────
if ! CURRENT_STATE=$(jq '.' "$MACHINE_FILE" 2>/dev/null); then
  echo "❌ [state-machine-reset] ERROR: Cannot parse machine.json" >&2
  exit 1
fi

# Extract sections to preserve
META_SECTION=$(echo "$CURRENT_STATE" | jq '.meta')
CONTRACTS=$(echo "$CURRENT_STATE" | jq '.contracts')
KEYSTONE_HASHES=$(echo "$CURRENT_STATE" | jq '.keystone_hashes')

echo "[state-machine-reset] === BEFORE STATE ===" >&2
echo "$CURRENT_STATE" | jq '{
  meta,
  eslint_state: { modules: (.eslint_state.modules | keys | length), aggregate: .eslint_state.aggregate },
  diagnostic_state: { files_count: (.diagnostic_state.files | keys | length), last_updated },
  dependency_state: { status, violations_count: (.dependency_state.violations | length) },
  format_state: { status, unformatted_count: (.format_state.unformatted_files | length) },
  write_audit_state: { current_session: (if .write_audit_state.current_session then "active" else "none" end), history_count: (.write_audit_state.history | length) },
  compliance_records: { role: (.compliance_records.role_violations | length), gate: (.compliance_records.gate_violations | length), tdd: (.compliance_records.tdd_violations | length) },
  tdd_enforcement_state: { current_session: (if .tdd_enforcement_state.current_session then "active" else "none" end), violations_count: (.tdd_enforcement_state.violations | length) },
  contracts,
  keystone_hashes
}' >&2

# ──────────────────────────────────────────────
# 4. Build clean baseline (preserving meta, contracts, keystone_hashes)
# ──────────────────────────────────────────────
CLEAN_STATE=$(jq -n \
  --argjson meta "$META_SECTION" \
  --argjson contracts "$CONTRACTS" \
  --argjson keystone_hashes "$KEYSTONE_HASHES" \
  --arg ts "$TIMESTAMP" '
  $meta
  | .lastUpdated = $ts
  | {
      meta: .,
      eslint_state: {
        last_full_scan: null,
        modules: {},
        aggregate: {
          total_violations: 0,
          dirty_modules: [],
          waived_modules: []
        }
      },
      # diagnostic_state (replaces type_check_state, 2026-06-26)
      diagnostic_state: {
        files: {},
        last_updated: ""
      },
      dependency_state: {
        last_check: null,
        violations: [],
        forbidden_rules_applied: 0,
        status: "clean"
      },
      format_state: {
        status: "clean",
        unformatted_files: [],
        last_run: null,
        last_check: null,
        auto_fix_count: 0
      },
      write_audit_state: {
        enabled: true,
        current_session: null,
        history: []
      },
      compliance_records: {
        role_violations: [],
        gate_violations: [],
        tdd_violations: []
      },
      tdd_enforcement_state: {
        enabled: true,
        current_session: null,
        violations: [],
        history: []
      },
      contracts: $contracts,
      keystone_hashes: $keystone_hashes
    }'
)

# ──────────────────────────────────────────────
# 5. Compute and display diff
# ──────────────────────────────────────────────
echo "[state-machine-reset] === AFTER STATE (projected) ===" >&2
echo "$CLEAN_STATE" | jq '{
  meta,
  eslint_state: { modules: { count: (.eslint_state.modules | length) }, aggregate: .eslint_state.aggregate },
  diagnostic_state: { files_count: (.diagnostic_state.files | keys | length), last_updated },
  dependency_state: { status, violations_count: (.dependency_state.violations | length) },
  format_state: { status, unformatted_count: (.format_state.unformatted_files | length) },
  write_audit_state: { current_session: (if .write_audit_state.current_session then "active" else "none" end), history_count: (.write_audit_state.history | length) },
  compliance_records: { role: (.compliance_records.role_violations | length), gate: (.compliance_records.gate_violations | length), tdd: (.compliance_records.tdd_violations | length) },
  tdd_enforcement_state: { current_session: (if .tdd_enforcement_state.current_session then "active" else "none" end), violations_count: (.tdd_enforcement_state.violations | length) },
  contracts,
  keystone_hashes
}' >&2

# Calculate which top-level sections changed
BEFORE_KEYS=$(echo "$CURRENT_STATE" | jq -r 'keys[]')
AFTER_KEYS=$(echo "$CLEAN_STATE" | jq -r 'keys[]')
CHANGED_SECTIONS=()

for key in $BEFORE_KEYS; do
  before_val=$(echo "$CURRENT_STATE" | jq -c ".$key")
  after_val=$(echo "$CLEAN_STATE" | jq -c ".$key")
  if [ "$before_val" != "$after_val" ]; then
    CHANGED_SECTIONS+=("$key")
  fi
done

echo "[state-machine-reset] === SECTIONS TO RESET ===" >&2
if [ ${#CHANGED_SECTIONS[@]} -eq 0 ]; then
  echo "  ✅ No changes needed — state is already clean." >&2
  exit 0
fi
for section in "${CHANGED_SECTIONS[@]}"; do
  echo "  🔄 $section" >&2
done
echo "  🔒 PRESERVED: meta, contracts, keystone_hashes" >&2

# ──────────────────────────────────────────────
# 6. Confirmation (skip if --force)
# ──────────────────────────────────────────────
if [ "$FORCE" != true ]; then
  echo "" >&2
  read -r -p "[state-machine-reset] Proceed with reset? [y/N]: " answer
  if [ "${answer,,}" != "y" ] && [ "${answer,,}" != "yes" ]; then
    echo "[state-machine-reset] ❌ Aborted by user." >&2
    exit 1
  fi
fi

# ──────────────────────────────────────────────
# 7. Apply reset
# ──────────────────────────────────────────────
if [ "$DRY_RUN" = true ]; then
  echo "[state-machine-reset] [DRY RUN] Would reset the following sections:" >&2
  printf '  %s\n' "${CHANGED_SECTIONS[@]}" >&2
  echo "[state-machine-reset] [DRY RUN] Proposed state written to stdout:" >&2
  echo "$CLEAN_STATE" | jq '.'
  exit 0
fi

# Create backup
cp "$MACHINE_FILE" "$BACKUP_FILE"
echo "[state-machine-reset] 💾 Backup saved to: ${BACKUP_FILE}" >&2

# Write clean state
echo "$CLEAN_STATE" > "$MACHINE_FILE"

echo "[state-machine-reset] === RESULT ===" >&2
echo "  ✅ Sections reset: ${CHANGED_SECTIONS[*]}" >&2
echo "  ✅ machine.json reset to clean baseline." >&2
echo "  ✅ Meta section preserved: version=$(echo "$META_SECTION" | jq -r '.version'), project=$(echo "$META_SECTION" | jq -r '.project')" >&2
echo "  ✅ keystone_hashes preserved: $(echo "$KEYSTONE_HASHES" | jq -c '.')" >&2
echo "  ℹ️  To repopulate keystone hashes, run: bun .opencode/scripts/mcp-tools/keystone-validate.ts --hash contract.yaml" >&2

exit 0
