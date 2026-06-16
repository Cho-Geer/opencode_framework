#!/bin/bash
# ===========================================================================
# framework-health-check.sh — OpenCode Framework Health Check One-Liner Wrapper
# ===========================================================================
# Runs 4 framework integrity checks in sequence:
#   1. framework-doctor.ts --strict
#   2. framework-self-test.ts
#   3. state-reconciliation.ts --strict
#   4. Critical infrastructure file modification check (git diff)
#
# SA-FIX-HEALTH-CHECK-JS (@Super-Admin): All 4 scripts are TypeScript (.ts),
# not JavaScript (.js). Runner is `bun` (Bun executes TypeScript natively).
# Also removed || true masking so failures are visible.
#
# Usage:
#   bash .opencode/scripts/framework-health-check.sh
#
# Output:
#   Single line: HEALTHY ✅ or UNHEALTHY ❌ with failed step(s)
#
# Exit code:
#   0 — All checks passed
#   1 — One or more checks failed
# ===========================================================================

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo "$(cd "$(dirname "$0")/../.." && pwd)")"
cd "$ROOT"

FAILED_STEPS=""
STEP_NUM=0

run_step() {
  STEP_NUM=$((STEP_NUM + 1))
  local step_name="$1"
  shift
  local cmd=("$@")

  if "${cmd[@]}" >/dev/null 2>&1; then
    return 0
  else
    if [ -z "$FAILED_STEPS" ]; then
      FAILED_STEPS="$step_name"
    else
      FAILED_STEPS="$FAILED_STEPS, $step_name"
    fi
    return 1
  fi
}

# Step 1: framework-doctor --strict
run_step "framework-doctor" bun .opencode/scripts/framework-doctor.ts --strict || true

# Step 2: framework-self-test
run_step "framework-self-test" bun .opencode/scripts/framework-self-test.ts || true

# Step 3: state-reconciliation --strict
run_step "state-reconciliation" bun .opencode/scripts/state-reconciliation.ts --strict || true

# Step 4: critical infrastructure files (git diff)
CRITICAL_MODIFIED=$(git diff HEAD --name-only -- \
  ".opencode/rules/common-project.md" \
  ".opencode/rules/mcp-compliance-guide.md" \
  ".opencode/rules/skill-compliance-guide.md" \
  ".opencode/agents/"*.md \
  ".opencode/project.config.json" \
  ".opencode/lib/gate-core.ts" \
  ".opencode/lib/dag-policy.ts" \
  ".opencode/lib/permission-isolation-core.ts" \
  ".opencode/tools/dispatch_subagent.ts" \
  ".opencode/hooks/pre-commit" \
  ".opencode/hooks/commit-msg" \
  "opencode.json" \
  "AGENTS.md" \
  2>/dev/null || true)
if [ -n "$CRITICAL_MODIFIED" ]; then
  echo "CRITICAL: Modified infrastructure files: $(echo $CRITICAL_MODIFIED | tr '\n' ' ')"
  FAILED_STEPS="${FAILED_STEPS}critical-files "
else
  echo "OK: No critical infrastructure files modified"
fi

# ── Output ──────────────────────────────────────────────────────
if [ -z "$FAILED_STEPS" ]; then
  echo "HEALTHY ✅"
  exit 0
else
  echo "UNHEALTHY ❌ — failed: $FAILED_STEPS"
  exit 1
fi
