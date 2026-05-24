#!/usr/bin/env node
// rule-registry-verify.js — P6-001
// Validates rule_registry.json entries against actual file contents.
// For each entry: verifies semver, digest (SHA-256), change_reason, actor, timestamp exist.
// Computes SHA-256 of each registered file and compares with registry digest.
// If mismatch: checks semver bump (WARNING = intentional) vs no bump (HIGH = unauthorized).
// --repair flag: auto-bumps semver and recomputes digest on mismatch.
//
// CLI flags:
//   --json    Force JSON-only output to stdout (default when --json is present)
//   --repair  Auto-bump semver and recompute digest on mismatch
//   --strict  Exit code 1 on any HIGH violation

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
// Primary registry location (under .opencode/state/)
const PRIMARY_REGISTRY_PATH = path.join(
  PROJECT_ROOT,
  ".opencode",
  "state",
  "rule_registry.json",
);
// Fallback: some projects have it directly under .opencode/
const FALLBACK_REGISTRY_PATH = path.join(
  PROJECT_ROOT,
  ".opencode",
  "rule_registry.json",
);

function findRegistryPath() {
  if (fs.existsSync(PRIMARY_REGISTRY_PATH)) return PRIMARY_REGISTRY_PATH;
  if (fs.existsSync(FALLBACK_REGISTRY_PATH)) return FALLBACK_REGISTRY_PATH;
  return PRIMARY_REGISTRY_PATH; // default for error reporting
}

const REGISTRY_PATH = findRegistryPath();

function computeSHA256(filepath) {
  try {
    const content = fs.readFileSync(filepath);
    return crypto.createHash("sha256").update(content).digest("hex");
  } catch (e) {
    return null;
  }
}

function extractSemver(filepath) {
  try {
    const content = fs.readFileSync(filepath, "utf8");
    // Pattern: semver "X.Y.Z" or version: "X.Y.Z" or vX.Y.Z
    const matches = [
      content.match(/semver["']?\s*[:=]\s*["'](\d+\.\d+\.\d+)["']/),
      content.match(/version["']?\s*[:=]\s*["'](\d+\.\d+\.\d+)["']/),
      content.match(/\bv(\d+\.\d+\.\d+)\b/),
      content.match(/##?\s*(?:Version|v)\s*(\d+\.\d+\.\d+)/i),
    ];
    for (const m of matches) {
      if (m) return m[1];
    }
    return null;
  } catch (e) {
    return null;
  }
}

function bumpSemver(semver) {
  const parts = semver.split(".").map(Number);
  parts[2] = (parts[2] || 0) + 1; // bump patch
  return parts.join(".");
}

function main() {
  const args = process.argv.slice(2);
  const jsonOutput = args.includes("--json");
  const shouldRepair = args.includes("--repair");
  const strictMode = args.includes("--strict");

  const violations = [];
  let validCount = 0;
  let modified = false;

  if (!fs.existsSync(REGISTRY_PATH)) {
    const errMsg = "rule_registry.json not found";
    if (!jsonOutput) {
      console.error(`[FAIL] ${errMsg}`);
      console.error(`  Searched: ${PRIMARY_REGISTRY_PATH}`);
      console.error(`  Fallback: ${FALLBACK_REGISTRY_PATH}`);
    }
    console.log(
      JSON.stringify(
        {
          total: 0,
          valid: 0,
          violations: [
            { severity: "HIGH", issue: "registry_missing", detail: errMsg },
          ],
          summary: errMsg,
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  let registry;
  try {
    registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8"));
  } catch (e) {
    const errMsg = `rule_registry.json is not valid JSON: ${e.message}`;
    if (!jsonOutput) {
      console.error(`[FAIL] ${errMsg}`);
    }
    console.log(
      JSON.stringify(
        {
          total: 0,
          valid: 0,
          violations: [
            {
              severity: "HIGH",
              issue: "registry_invalid_json",
              detail: e.message,
            },
          ],
          summary: errMsg,
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  const entries = registry.entries || {};
  const entryKeys = Object.keys(entries);
  const total = entryKeys.length;

  if (!jsonOutput) {
    console.log(`\n  Rule Registry Verification — ${REGISTRY_PATH}`);
    console.log(`  ${total} entries registered\n`);
  }

  for (const key of entryKeys) {
    const entry = entries[key];
    if (!entry || typeof entry !== "object") {
      violations.push({
        severity: "HIGH",
        key,
        file: key,
        issue: "invalid_entry",
        detail: "Entry is not a valid object",
      });
      continue;
    }

    // ── Required field check ──
    const requiredFields = ["path", "semver", "sha256", "category"];
    const missingFields = requiredFields.filter((f) => !entry[f]);
    if (missingFields.length > 0) {
      violations.push({
        severity: "WARNING",
        key,
        file: key,
        issue: "missing_fields",
        detail: `Missing required fields: ${missingFields.join(", ")}`,
      });
    }

    // change_reason, actor, timestamp are optional but recommended
    const recommendedFields = ["change_reason", "actor", "timestamp"];
    const missingRec = recommendedFields.filter(
      (f) => !entry[f] && !entry.digest_history,
    );
    if (missingRec.length > 0 && missingFields.length === 0) {
      // Only warn if entry is otherwise well-formed
      // (skip for entries that use digest_history array instead)
      if (!entry.digest_history || entry.digest_history.length === 0) {
        violations.push({
          severity: "INFO",
          key,
          file: key,
          issue: "missing_recommended_fields",
          detail: `Missing recommended fields: ${missingRec.join(", ")} (use digest_history array as alternative)`,
        });
      }
    }

    // ── File existence check ──
    const filepath = path.join(PROJECT_ROOT, entry.path || key);
    if (!fs.existsSync(filepath)) {
      violations.push({
        severity: "HIGH",
        key,
        file: key,
        filepath: entry.path || key,
        issue: "file_missing",
        detail: `Registered file '${entry.path || key}' not found on disk`,
      });
      continue;
    }

    // ── SHA-256 comparison ──
    const actualHash = computeSHA256(filepath);
    if (!actualHash) {
      violations.push({
        severity: "HIGH",
        key,
        file: key,
        filepath: entry.path || key,
        issue: "hash_compute_error",
        detail: "Cannot compute SHA-256 for file",
      });
      continue;
    }

    const storedHash = entry.sha256 || "";
    if (actualHash !== storedHash) {
      // Check if semver was bumped (acceptable) or not (violation)
      const currentSemver = extractSemver(filepath);
      const storedSemver = entry.semver || "";

      if (currentSemver && storedSemver && currentSemver !== storedSemver) {
        // Version bump detected → intentional update
        violations.push({
          severity: "WARNING",
          key,
          file: key,
          filepath: entry.path || key,
          issue: "digest_version_bump",
          detail: `Digest mismatch but semver bumped (${storedSemver} → ${currentSemver}) — likely intentional update`,
        });
        if (!jsonOutput) {
          console.log(
            `  ⚠️  [WARNING] ${key}: digest changed, semver bumped (${storedSemver} → ${currentSemver})`,
          );
        }
      } else {
        // No version change → possible unauthorized modification
        violations.push({
          severity: "HIGH",
          key,
          file: key,
          filepath: entry.path || key,
          issue: "digest_mismatch_no_bump",
          detail: `Digest mismatch without semver change. stored=${storedHash.substring(0, 12)}..., actual=${actualHash.substring(0, 12)}...`,
        });
        if (!jsonOutput) {
          console.log(
            `  ❌ [HIGH] ${key}: digest mismatch without semver change`,
          );
          console.log(`         stored: ${storedHash.substring(0, 12)}...`);
          console.log(`         actual: ${actualHash.substring(0, 12)}...`);
        }
      }

      // ── Repair: auto-bump semver and recompute digest ──
      if (shouldRepair) {
        const newSemver =
          currentSemver && storedSemver && currentSemver !== storedSemver
            ? currentSemver // keep the already-bumped version
            : bumpSemver(storedSemver || "0.0.0");
        entry.semver = newSemver;
        entry.sha256 = actualHash;
        entry.last_modified = new Date().toISOString();
        if (!entry.digest_history) entry.digest_history = [];
        entry.digest_history.push({
          sha256: actualHash,
          timestamp: new Date().toISOString(),
          semver: newSemver,
          change: "auto-repaired by rule-registry-verify.js --repair",
        });
        modified = true;
        violations.push({
          severity: "INFO",
          key,
          file: key,
          issue: "auto_repaired",
          detail: `Semver bumped to ${newSemver}, digest recomputed`,
        });
        if (!jsonOutput) {
          console.log(
            `  🔧 Repaired: ${key} → semver ${newSemver}, digest recomputed`,
          );
        }
      }
    } else {
      validCount++;
      if (!jsonOutput) {
        console.log(`  ✅ ${key}: digest OK (semver ${entry.semver || "?"})`);
      }
    }
  }

  // ── Persist repairs ──
  if (modified) {
    registry.meta.last_regenerated = new Date().toISOString().split("T")[0];
    registry.meta.last_updated = new Date().toISOString();
    fs.writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2));
    if (!jsonOutput) {
      console.log(`\n  💾 Repairs written to ${REGISTRY_PATH}`);
    }
  }

  // ── Output ──
  const highViolations = violations.filter((v) => v.severity === "HIGH");
  const allValid = highViolations.length === 0;

  if (!jsonOutput) {
    const warnCount = violations.filter((v) => v.severity === "WARNING").length;
    const infoCount = violations.filter((v) => v.severity === "INFO").length;
    console.log(`\n  ── Summary ──`);
    console.log(`  ${validCount}/${total} entries valid`);
    if (violations.length > 0) {
      console.log(
        `  ${highViolations.length} HIGH, ${warnCount} WARNING, ${infoCount} INFO`,
      );
    }
    if (modified) console.log(`  Repaired: yes`);
    console.log(``);
  }

  // Always output JSON to stdout for programmatic consumption
  console.log(
    JSON.stringify(
      {
        total,
        valid: validCount,
        violations,
        repaired: modified,
        summary: `${validCount}/${total} entries valid, ${violations.length} issues (${highViolations.length} HIGH)${modified ? ", repaired" : ""}`,
      },
      null,
      2,
    ),
  );

  if (strictMode && !allValid) {
    process.exit(1);
  }
  process.exit(allValid ? 0 : 1);
}

main();
