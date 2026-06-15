#!/bin/bash
# ──────────────────────────────────────────────────────────────────
# integrity-chain-bundle.sh — Keystone Integrity Chain Bundler
# ──────────────────────────────────────────────────────────────────
# Computes SHA-256 for all critical framework docs and updates
# machine.json.keystone_hashes with the complete integrity chain.
#
# Critical docs covered:
#   1. contract.yaml
#   2. All 6 mandatory requirement docs (.opencode/context/requirements/)
#   3. All .opencode/rules/*.md
#   4. All .opencode/agents/*.md
#   5. AGENTS.md + PROJECT_REFERENCE.md
#
# Usage:
#   .opencode/scripts/integrity-chain-bundle.sh            (update machine.json)
#   .opencode/scripts/integrity-chain-bundle.sh --verify   (dry-run only)
# ──────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
VALIDATOR="$ROOT/.opencode/scripts/mcp-tools/keystone-validate.ts"
MACHINE="$ROOT/.opencode/state/machine.json"
VERIFY_ONLY=false

if [ "${1:-}" = "--verify" ] || [ "${1:-}" = "--dry-run" ]; then
    VERIFY_ONLY=true
    echo "[integrity-chain-bundle] VERIFY mode — no files will be modified"
fi

if [ ! -f "$VALIDATOR" ]; then
    echo "[integrity-chain-bundle] ERROR: keystone-validate.ts not found at $VALIDATOR" >&2
    exit 1
fi

echo "═══════════════════════════════════════════════════════════════"
echo "  🔐 Keystone Integrity Chain Bundler"
echo "═══════════════════════════════════════════════════════════════"

# ── Export env vars for Node.js inline script ──────────────────
export VERIFY_ONLY="$VERIFY_ONLY"
export ROOT="$ROOT"
export MACHINE_PATH="$MACHINE"
export VALIDATOR="$VALIDATOR"

# ── Delegate all heavy lifting to Bun ──────────────────────
bun -e '
import { readFileSync, writeFileSync, readdirSync, existsSync } from "fs";
import { resolve } from "path";
import { execSync } from "child_process";

const VERIFY_ONLY = process.env.VERIFY_ONLY === "true";
const ROOT = process.env.ROOT;
const MACHINE_PATH = process.env.MACHINE_PATH;
const VALIDATOR = process.env.VALIDATOR;

function computeHash(relPath) {
  const absPath = resolve(ROOT, relPath);
  if (!existsSync(absPath)) {
    process.stderr.write("  MISSING: " + relPath + "\n");
    return "MISSING";
  }
  try {
    const out = execSync("bun " + JSON.stringify(VALIDATOR) + " --hash " + JSON.stringify(relPath), {
      cwd: ROOT, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
    });
    const h = out.trim();
    process.stderr.write("  " + h + "  " + relPath + "\n");
    return h;
  } catch (e) {
    process.stderr.write("  ERROR: " + relPath + " — " + (e.stderr || e.message) + "\n");
    return "ERROR";
  }
}

// Build hash map
const hashes = {};

// 1. contract.yaml
console.log("[1/5] contract.yaml");
hashes["contract.yaml"] = computeHash("contract.yaml");

// 2. The 6 core requirement docs
console.log("[2/5] Requirement docs");
const coreReqs = [
  "系统架构设计文档（SAD）.md",
  "接口设计规范文档.md",
  "数据架构设计文档.md",
  "安全架构设计文档.md",
  "测试策略与计划.md",
  "运维与部署设计文档.md",
];
for (const doc of coreReqs) {
  const rel = ".opencode/context/requirements/" + doc;
  hashes[rel] = computeHash(rel);
}

// 3. All .opencode/rules/*.md
console.log("[3/5] Rule docs");
const rulesDir = resolve(ROOT, ".opencode", "rules");
if (existsSync(rulesDir)) {
  const files = readdirSync(rulesDir).filter(f => f.endsWith(".md")).sort();
  for (const f of files) {
    const rel = ".opencode/rules/" + f;
    hashes[rel] = computeHash(rel);
  }
}

// 4. All .opencode/agents/*.md
console.log("[4/5] Agent configs");
const agentsDir = resolve(ROOT, ".opencode", "agents");
if (existsSync(agentsDir)) {
  const files = readdirSync(agentsDir).filter(f => f.endsWith(".md")).sort();
  for (const f of files) {
    const rel = ".opencode/agents/" + f;
    hashes[rel] = computeHash(rel);
  }
}

// 5. AGENTS.md and PROJECT_REFERENCE.md
console.log("[5/5] Project-level configs");
hashes["AGENTS.md"] = computeHash("AGENTS.md");
hashes["PROJECT_REFERENCE.md"] = computeHash("PROJECT_REFERENCE.md");

// Report
const total = Object.keys(hashes).length;
const missing = Object.entries(hashes).filter(([,v]) => v === "MISSING" || v === "ERROR");
console.log("");
console.log("───────────────────────────────────────────────────────────────");
console.log("  Total files:      " + total);
console.log("  Hashed:           " + (total - missing.length));
if (missing.length > 0) {
  console.log("  ⚠️  Issues:         " + missing.length);
  missing.forEach(([k]) => console.log("    - " + k));
}

if (VERIFY_ONLY) {
  console.log("");
  console.log("  [VERIFY] Dry-run complete. No files modified.");
  process.exit(0);
}

// Update machine.json
const machine = JSON.parse(readFileSync(MACHINE_PATH, "utf8"));
machine.keystone_hashes = hashes;
machine.meta.lastUpdated = new Date().toISOString();
machine.meta.revision = (machine.meta.revision || 0) + 1;

writeFileSync(MACHINE_PATH, JSON.stringify(machine, null, 2) + "\n", "utf8");

console.log("");
console.log("═══════════════════════════════════════════════════════════════");
console.log("  ✅  machine.json.keystone_hashes updated");
console.log("  Revision: " + machine.meta.revision);
console.log("  Entries:  " + total);
console.log("");
console.log("  Next: bun .opencode/scripts/mcp-tools/keystone-validate.ts --bundle");
console.log("═══════════════════════════════════════════════════════════════");
' 2>&1

echo ""
echo "[integrity-chain-bundle] Done."
