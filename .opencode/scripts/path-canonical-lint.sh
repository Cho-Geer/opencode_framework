#!/usr/bin/env bash
#
# path-canonical-lint.sh — Absolute Path Leakage Scanner
# =====================================================
# Scans all .md, .yaml/.yml, .json, .sh, .js, .ts files
# in .opencode/ and project root for absolute paths that
# leak machine-specific or environment-specific information.
#
# Usage:
#   .opencode/scripts/path-canonical-lint.sh              # Scan .opencode/ + root
#   .opencode/scripts/path-canonical-lint.sh --json       # JSON output to stdout
#   .opencode/scripts/path-canonical-lint.sh --json --out report.json  # JSON to file
#   .opencode/scripts/path-canonical-lint.sh --ci         # CI mode: exit 1 on violations
#
# Exit codes:
#   0 — PASS (no violations, or violations found but not --ci)
#   1 — FAILED (violations detected in --ci mode)
#   2 — USAGE ERROR (invalid arguments)
#
# Configuration: reads scan_roots, file_extensions, leak_patterns,
# whitelist, and suggestion_templates from project.config.json
# if available; falls back to built-in defaults.

set -euo pipefail

# ──────────────────────────────────────────────
# 0. Determine script and project root
# ──────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# ──────────────────────────────────────────────
# 1. Parse arguments
# ──────────────────────────────────────────────
OUTPUT_MODE="text"       # text | json
OUTPUT_FILE=""           # optional output file path
CI_MODE=false            # --ci flag
EXIT_ON_VIOLATION=false
SCAN_TARGET=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --json)
      OUTPUT_MODE="json"
      shift
      ;;
    --ci)
      CI_MODE=true
      EXIT_ON_VIOLATION=true
      shift
      ;;
    --out)
      OUTPUT_FILE="$2"
      shift 2
      ;;
    *)
      # Optional: scan a specific target directory/file
      SCAN_TARGET="$1"
      shift
      ;;
  esac
done

# ──────────────────────────────────────────────
# 2. Configuration — default patterns
# ──────────────────────────────────────────────

# Scan roots: directories to recursively scan
SCAN_ROOTS=(".opencode" ".")

# File extensions to scan (without leading dot)
FILE_EXTS=("md" "yaml" "yml" "json" "sh" "js" "ts")

# Absolute path leak patterns (name → grep-compatible regex)
declare -A LEAK_PATTERNS
LEAK_PATTERNS["Linux home (/home/...)"]="/home/"
LEAK_PATTERNS["macOS home (/Users/...)"]="/Users/"
LEAK_PATTERNS["root user (/root/...)"]="/root/"
LEAK_PATTERNS["Windows absolute (C:\\...)"]="[A-Za-z]:\\\\"
LEAK_PATTERNS["/tmp (not opencode)"]="/tmp/"

# Skip directories entirely
SKIP_DIRS=(".opencode/state" ".task_temp" "node_modules" ".git" "dist" "build" "coverage")

# ──────────────────────────────────────────────
# 3. Load project.config.json overrides if available
# ──────────────────────────────────────────────
CONFIG_FILE="${PROJECT_ROOT}/.opencode/project.config.json"
if [[ -f "$CONFIG_FILE" ]]; then
  # Try to extract path_lint config using python3 or node
  if command -v python3 &>/dev/null; then
    # python3 is preferred for JSON parsing in bash
    _PL_JSON="$(python3 -c "
import json, sys
try:
    with open('$CONFIG_FILE') as f:
        cfg = json.load(f)
    pl = cfg.get('path_lint', {})
    print(json.dumps(pl))
except: pass
" 2>/dev/null || echo "{}")"
  elif command -v node &>/dev/null; then
    _PL_JSON="$(node -e "
try {
    const cfg=require('${PROJECT_ROOT}/.opencode/project.config.json');
    console.log(JSON.stringify(cfg.path_lint||{}));
} catch(e) { console.log('{}'); }
" 2>/dev/null || echo "{}")"
  else
    _PL_JSON="{}"
  fi

  # Parse scan_roots from config if present
  if [[ "$_PL_JSON" != "{}" ]] && [[ "$_PL_JSON" != "" ]]; then
    _SR="$(echo "$_PL_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); print(' '.join(d.get('scan_roots', [])))" 2>/dev/null || true)"
    if [[ -n "$_SR" ]]; then
      IFS=' ' read -r -a SCAN_ROOTS <<< "$_SR"
    fi
  fi
fi

# If a specific scan target was provided, use it instead of SCAN_ROOTS
if [[ -n "$SCAN_TARGET" ]]; then
  SCAN_ROOTS=("$SCAN_TARGET")
fi

# ──────────────────────────────────────────────
# 4. Whitelist function — determine if a matched
#    path is acceptable in context
# ──────────────────────────────────────────────
is_whitelisted() {
  line="$1"
  matched_path="$2"

  # URLs: http://, https://, ftp://
  if echo "$line" | grep -qE 'https?://|ftp://'; then
    return 0
  fi

  # Template/environment variable patterns: ${...} or {placeholder}
  if echo "$line" | grep -qE '\$\{[^}]+\}|\{[A-Za-z_]+\}'; then
    return 0
  fi

  # GitHub Actions CI runner paths (standard, not machine-specific leaks)
  if echo "$matched_path" | grep -qE '^/home/runner/work/'; then
    return 0
  fi

  # Approved temp dir: /tmp/opencode (exactly)
  if echo "$line" | grep -qE '/tmp/opencode([/"'"'"'\s]|$)'; then
    return 0
  fi

  # System tool references: /usr/bin/
  if echo "$line" | grep -qE '/usr/bin/'; then
    return 0
  fi

  # Project-root-aware placeholders
  if echo "$line" | grep -qE '\{project_root\}|\{placeholder\}|\{project\.'; then
    return 0
  fi

  return 1
}

# ──────────────────────────────────────────────
# 5. Suggestion generator — produce a human-readable
#    replacement recommendation for a leaked path
# ──────────────────────────────────────────────
generate_suggestion() {
  abs_path="$1"

  # If path starts with the project root
  if [[ "$abs_path" == "$PROJECT_ROOT"* ]]; then
    rel="${abs_path#$PROJECT_ROOT}"
    rel="${rel#/}"
    echo "{project_root}/${rel}  OR  ./${rel}"
    return
  fi

  # GitHub Actions runner paths
  if [[ "$abs_path" == /home/runner/work/* ]]; then
    after_runner="${abs_path#/home/runner/work/}"
    IFS='/' read -r -a parts <<< "$after_runner"
    if [[ ${#parts[@]} -ge 2 ]]; then
      sub_path="${parts[@]:1}"
      sub_path="${sub_path// /\/}"
      echo "\${GITHUB_WORKSPACE}/${sub_path}  OR  ./${sub_path}"
      return
    fi
  fi

  # Generic /home/<user>/... path
  if [[ "$abs_path" =~ ^/home/[^/]+/ ]]; then
    echo "Consider replacing with {project_root}/... or a repo-relative path"
    return
  fi

  # Generic /Users/<user>/... path
  if [[ "$abs_path" =~ ^/Users/[^/]+/ ]]; then
    echo "Consider replacing with {project_root}/... or a repo-relative path"
    return
  fi

  # Windows absolute paths
  if [[ "$abs_path" =~ ^[A-Za-z]:\\ ]]; then
    echo "Consider replacing with a repo-relative path (./...)"
    return
  fi

  # /tmp paths not /tmp/opencode
  if [[ "$abs_path" == /tmp/* ]] && [[ "$abs_path" != /tmp/opencode* ]]; then
    echo "Consider using /tmp/opencode/ (approved) or \$TMPDIR"
    return
  fi

  # /root/ paths
  if [[ "$abs_path" == /root/* ]]; then
    echo "Consider replacing with {project_root}/... or a repo-relative path"
    return
  fi

  # Fallback
  echo "Consider replacing with a repo-relative path or {placeholder}"
}

# ──────────────────────────────────────────────
# 6. Core scanning logic
# ──────────────────────────────────────────────
declare -a VIOLATIONS=()  # Array of "file:line | pattern_name | offending_path → suggestion"
TOTAL_FILES=0

# Build extension pattern for find
EXT_PATTERN=""
for ext in "${FILE_EXTS[@]}"; do
  if [[ -z "$EXT_PATTERN" ]]; then
    EXT_PATTERN="-name \"*.$ext\""
  else
    EXT_PATTERN="${EXT_PATTERN} -o -name \"*.$ext\""
  fi
done

# Build skip-dir prune expressions for find
PRUNE_EXPR=""
for skip in "${SKIP_DIRS[@]}"; do
  PRUNE_EXPR="${PRUNE_EXPR} -path \"*/$skip\" -prune -o"
done

for root_dir in "${SCAN_ROOTS[@]}"; do
  target="${PROJECT_ROOT}/${root_dir#./}"
  if [[ ! -d "$target" ]]; then
    continue
  fi

  # Collect files to scan
  while IFS= read -r -d '' file; do
    TOTAL_FILES=$((TOTAL_FILES + 1))
    rel_file="${file#$PROJECT_ROOT/}"
    line_num=0
    file_has_violation=false

    while IFS= read -r line || [[ -n "$line" ]]; do
      line_num=$((line_num + 1))

      # Skip empty lines and comment-only lines (heuristic for config files)
      [[ -z "${line//[[:space:]]/}" ]] && continue

      # Check each leak pattern
      for pattern_name in "${!LEAK_PATTERNS[@]}"; do
        pattern="${LEAK_PATTERNS[$pattern_name]}"

        # Use grep to test if this line contains the pattern
        if echo "$line" | grep -qE "$pattern" 2>/dev/null; then
          # Extract all matching absolute paths from the line
          matches="$(echo "$line" | grep -oE '[A-Za-z]:\\\\[^[:space:]"'"'"')\]}>]*|/(home|Users|root|tmp)/[^[:space:]"'"'"')\]}>]*' 2>/dev/null || true)"

          if [[ -z "$matches" ]]; then
            # Try broader matching for non-standard patterns
            matches=
          fi

          if [[ -n "$matches" ]]; then
            while IFS= read -r abs_path; do
              [[ -z "$abs_path" ]] && continue

              # Whitelist check
              if is_whitelisted "$line" "$abs_path"; then
                continue
              fi

              # Generate suggestion
              suggestion="$(generate_suggestion "$abs_path")"

              VIOLATIONS+=("${rel_file}:${line_num} | ${pattern_name} | \"${abs_path}\" → ${suggestion}")
              file_has_violation=true
            done <<< "$matches"
          fi
        fi
      done
    done < "$file"
  done < <(eval "find \"$target\" $PRUNE_EXPR -type f \( $EXT_PATTERN \) -print0 2>/dev/null" || true)
done

# ──────────────────────────────────────────────
# 7. Output results
# ──────────────────────────────────────────────
VIOLATION_COUNT="${#VIOLATIONS[@]}"

if [[ "$OUTPUT_MODE" == "json" ]]; then
  # Build JSON output
  NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  JSON_OUTPUT=$(cat <<JSONEOF
{
  "tool": "path-canonical-lint.sh",
  "version": "1.0.0",
  "timestamp": "${NOW}",
  "project_root": "${PROJECT_ROOT}",
  "scan_summary": {
    "total_files_scanned": ${TOTAL_FILES},
    "total_violations": ${VIOLATION_COUNT},
    "scan_roots": [$(printf '"%s",' "${SCAN_ROOTS[@]}" | sed 's/,$//')],
    "file_extensions": [$(printf '"%s",' "${FILE_EXTS[@]}" | sed 's/,$//')]
  },
  "violations": [
JSONEOF
)

  for i in "${!VIOLATIONS[@]}"; do
    v="${VIOLATIONS[$i]}"
    # Parse: "file:line | pattern_name | "path" → suggestion"
    fpart="${v%% | *}"
    rest="${v#* | }"
    pname="${rest%% | *}"
    path_sugg="${rest#* | }"
    opath="${path_sugg%%\" → *}"
    opath="${opath#\"}"
    sugg="${path_sugg#*\" → }"

    file="${fpart%%:*}"
    line="${fpart##*:}"

    comma=""
    if [[ $i -lt $((VIOLATION_COUNT - 1)) ]]; then
      comma=","
    fi

    JSON_OUTPUT+=$(cat <<VIOLATIONEOF
    {
      "file": "${file}",
      "line": ${line},
      "pattern": "${pname}",
      "offending_path": "${opath}",
      "suggestion": "${sugg}"
    }${comma}
VIOLATIONEOF
)
  done

  JSON_OUTPUT+=$'\n  ]\n}\n'

  if [[ -n "$OUTPUT_FILE" ]]; then
    echo "$JSON_OUTPUT" > "$OUTPUT_FILE"
    echo "JSON report written to: $OUTPUT_FILE" >&2
  else
    echo "$JSON_OUTPUT"
  fi
else
  # Text output
  echo "═══════════════════════════════════════════════════════════════"
  echo "  🔍 Path Canonical Lint — Absolute Path Leakage Scanner"
  echo "═══════════════════════════════════════════════════════════════"
  echo ""
  echo "  Project Root : ${PROJECT_ROOT}"
  echo "  Scan Roots   : ${SCAN_ROOTS[*]}"
  echo "  File Exts    : ${FILE_EXTS[*]}"
  echo "  Files Scanned: ${TOTAL_FILES}"
  echo ""

  if [[ $VIOLATION_COUNT -eq 0 ]]; then
    echo "  ✅ PASS — No absolute path leakage detected."
    echo ""
  else
    echo "  ❌ FAIL — ${VIOLATION_COUNT} violation(s) detected:"
    echo ""
    count=1
    for v in "${VIOLATIONS[@]}"; do
      printf "  %3d. %s\n" "$count" "$v"
      count=$((count + 1))
    done
    echo ""
    echo "  ─────────────────────────────────────────────────────────"
    echo "  Summary: ${VIOLATION_COUNT} absolute path leak(s) across"
    echo "  ${TOTAL_FILES} scanned files."
    echo ""
    echo "  💡 Tip: Replace absolute paths with {project_root}/..."
    echo "     or repo-relative paths (./...). Use \${GITHUB_WORKSPACE}"
    echo "     for CI runner paths. Approved: /tmp/opencode, /usr/bin/."
    echo ""
  fi

  echo "═══════════════════════════════════════════════════════════════"
fi

# ──────────────────────────────────────────────
# 8. Exit code
# ──────────────────────────────────────────────
if [[ "$EXIT_ON_VIOLATION" == "true" ]] && [[ $VIOLATION_COUNT -gt 0 ]]; then
  exit 1
fi

exit 0
