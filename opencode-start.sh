#!/bin/bash
# opencode-start.sh — Always recompile framework-enforcer.ts before starting.
# Usage: ./opencode-start.sh [opencode args...]

PLUGIN_FILE=".opencode/plugins/framework-enforcer.ts"

if [ -f "$PLUGIN_FILE" ]; then
  TIMESTAMP="$(date +%Y-%m-%d-%H:%M:%S)"
  sed -i "s|^// BUN-CACHE-VERSION: .*|// BUN-CACHE-VERSION: ${TIMESTAMP} — auto-refreshed on start|" "$PLUGIN_FILE"
  echo "[opencode-start] BUN-CACHE-VERSION updated to ${TIMESTAMP}"
fi

exec opencode "$@"
