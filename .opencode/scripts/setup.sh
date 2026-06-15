#!/bin/bash
# setup.sh — Bootstrap script: run once after cloning to set up framework enforcement
# Usage: bash .opencode/scripts/setup.sh
set -euo pipefail

OPENCODE_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
echo "=== OpenCode Framework Setup ==="
echo ""

# Step 1: Set core.hooksPath
echo "[1/3] Setting core.hooksPath to .opencode/hooks..."
git config core.hooksPath .opencode/hooks
echo "  ✓ hooksPath set to: $(git config --get core.hooksPath)"

# Step 2: Ensure hook scripts are executable
echo "[2/3] Ensuring hook scripts are executable..."
if [ -f "$OPENCODE_ROOT/.opencode/hooks/pre-commit" ]; then
  chmod +x "$OPENCODE_ROOT/.opencode/hooks/pre-commit"
  echo "  ✓ pre-commit: executable"
fi
if [ -f "$OPENCODE_ROOT/.opencode/hooks/commit-msg" ]; then
  chmod +x "$OPENCODE_ROOT/.opencode/hooks/commit-msg"
  echo "  ✓ commit-msg: executable"
fi

# Step 3: Run install-hooks.ts for full verification
echo "[3/3] Running install-hooks.ts for full verification..."
if [ -f "$OPENCODE_ROOT/.opencode/scripts/install-hooks.ts" ]; then
  bun "$OPENCODE_ROOT/.opencode/scripts/install-hooks.ts" || {
    echo "  ⚠ install-hooks.ts completed with warnings (non-fatal)"
  }
  echo "  ✓ install-hooks.ts executed"
else
  echo "  ⚠ install-hooks.ts not found (non-fatal — hooksPath already set)"
fi

# Step 4: Verify rule registry (if available)
echo ""
echo "[Optional] Verifying rule registry..."
if [ -f "$OPENCODE_ROOT/.opencode/scripts/rule-registry-verify.ts" ]; then
  bun "$OPENCODE_ROOT/.opencode/scripts/rule-registry-verify.ts" --strict || {
    echo "  ⚠ Rule registry has issues — run with --repair to fix"
  }
  echo "  ✓ rule-registry-verify.ts executed"
else
  echo "  ⚠ rule-registry-verify.ts not found (skipped)"
fi

echo ""
echo "=== Setup complete ==="
echo "Framework enforcement is now active."
echo ""
echo "Quick verification:"
echo "  git config --get core.hooksPath  # should show: .opencode/hooks"
echo "  ls -la .opencode/hooks/          # should show: pre-commit, commit-msg"
