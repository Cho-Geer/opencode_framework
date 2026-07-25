/**
 * eslint-runner.ts — ESLint audit business logic
 * ═══════════════════════════════════════════════════════════
 * Extracted from scripts/mcp-tools/eslint-audit.ts (B-4C refactoring).
 *
 * Responsibilities:
 *   1. Read project.config.json → resolve project root & state dir
 *   2. Parse contract.yaml x-eslint-policy → generate tier-rules.json
 *   3. Run ESLint with opencode-mock-audit plugin
 *   4. Update eslint_state sub-state via atomicWriteSubState
 *
 * @since 2026-06-29 (B-4C extraction)
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { atomicWriteSubState } from "../../lib/state-utils";

// ─── Constants ──────────────────────────────────────────────
const OPENCODE_ROOT = path.resolve(__dirname, "..", "..", "..");
const PROJECT_CONFIG = path.join(
  OPENCODE_ROOT,
  ".opencode",
  "project.config.json",
);

// ─── Types ──────────────────────────────────────────────────
export interface TierRules {
  tier1: string[];
  tier2: string[];
  tier3: string[];
}

export interface EslintViolation {
  file: string;
  line: number;
  column: number;
  rule: string;
  message: string;
  severity: number;
}

export interface EslintRunResult {
  violations: EslintViolation[];
  exitCode: number;
  error?: string;
}

export interface StateUpdateResult {
  updated: boolean;
  status?: string;
  reason?: string;
}

// ─── Project Root Resolution ────────────────────────────────

/**
 * Read project.config.json and resolve the project root directory.
 */
export function getProjectRoot(): string {
  let cfg: any;
  try {
    cfg = JSON.parse(fs.readFileSync(PROJECT_CONFIG, "utf-8"));
  } catch (readErr: any) {
    throw new Error(
      `[eslint-audit] Cannot read or parse project.config.json at ${PROJECT_CONFIG}: ${readErr.message}`,
    );
  }
  if (!cfg.project_root) {
    throw new Error(
      `[eslint-audit] 'project_root' is not defined in project.config.json (${PROJECT_CONFIG}). ` +
        'Add "project_root": "<subdirectory>" to the config file.',
    );
  }
  return path.resolve(OPENCODE_ROOT, cfg.project_root);
}

/**
 * Resolve the state directory (project-level or fallback to framework-level).
 */
export function getStateDir(): string {
  const pr = getProjectRoot();
  const stateDir = path.join(pr, ".opencode", "state");
  if (fs.existsSync(stateDir)) return stateDir;
  return path.join(OPENCODE_ROOT, ".opencode", "state");
}

// ─── Module Extraction ──────────────────────────────────────

/**
 * Extract module name from a file path (e.g. "modules/auth/..." → "auth").
 */
export function extractModule(filePath: string): string {
  const match = filePath.match(/modules\/([^/]+)/);
  return match ? match[1] : "unknown";
}

// ─── Tier Rules Generation ──────────────────────────────────

/**
 * Parse contract.yaml x-eslint-policy and generate tier-rules.json.
 * Falls back to default tier definitions if js-yaml is unavailable
 * or contract.yaml is malformed.
 */
export function generateTierRules(projectRoot: string): TierRules {
  const contractPath = path.join(projectRoot, "contract.yaml");
  const outputDir = path.join(OPENCODE_ROOT, ".opencode", "generated");
  const outputPath = path.join(outputDir, "tier-rules.json");

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  try {
    const yaml = require("js-yaml");
    const contract = yaml.load(fs.readFileSync(contractPath, "utf-8")) as any;
    const policy = contract["x-eslint-policy"];

    if (!policy || !policy.tier_definition) {
      throw new Error("x-eslint-policy not found in contract.yaml");
    }

    const tierRules: TierRules = {
      tier1: policy.tier_definition.tier1_real_only?.services || [],
      tier2: policy.tier_definition.tier2_fake_ok?.services || [],
      tier3: policy.tier_definition.tier3_boundary_mock?.services || [],
    };

    fs.writeFileSync(outputPath, JSON.stringify(tierRules, null, 2));
    return tierRules;
  } catch {
    // Fallback if js-yaml not available or contract malformed
    const fallback: TierRules = {
      tier1: ["PrismaService", "RedisService", "ConfigService"],
      tier2: [
        "JwtService",
        "QueueService",
        "NotificationGateway",
        "RateLimiterService",
      ],
      tier3: ["EmailService", "SMSService"],
    };
    fs.writeFileSync(outputPath, JSON.stringify(fallback, null, 2));
    return fallback;
  }
}

// ─── ESLint Execution ───────────────────────────────────────

/**
 * Run ESLint with opencode-mock-audit plugin on target files.
 *
 * @param projectRoot - project root directory
 * @param targetFiles - specific files to lint (empty = all spec files)
 * @param scanBusinessCode - also scan service/controller/dto files
 */
export function runESLint(
  projectRoot: string,
  targetFiles: string[],
  scanBusinessCode: boolean,
): EslintRunResult {
  const pluginDir = path.join(
    OPENCODE_ROOT,
    ".opencode",
    "eslint-plugin",
    "eslint-plugin-opencode-mock-audit",
  );

  if (!fs.existsSync(pluginDir)) {
    return { violations: [], exitCode: 0, error: "ESLint plugin not found" };
  }

  const rules = [
    "no-tier1-mock: error",
    "no-skipped-tests: error",
    "no-skipped-audit: error",
    "no-console-log: error",
    "no-empty-assertions: error",
    "no-only-left: error",
    "no-any-in-spec: error",
    "max-complexity-enforce: warn",
    "tier3-verify: warn",
    "no-uncovered-switch: warn",
    "no-deep-import: warn",
  ];

  try {
    let filesArg =
      targetFiles.length > 0
        ? targetFiles.join(" ")
        : `${projectRoot}/src/modules/**/*.spec.ts ${projectRoot}/test/**/*.spec.ts`;

    if (scanBusinessCode) {
      filesArg += ` ${projectRoot}/src/modules/**/*.service.ts ${projectRoot}/src/modules/**/*.controller.ts ${projectRoot}/src/modules/**/*.dto.ts`;
    }

    const ruleArgs = rules.map((r) => `--rule '${r}'`).join(" ");

    execSync(
      `npx eslint --no-eslintrc ` +
        `--rulesdir "${pluginDir}/rules" ` +
        ruleArgs +
        ` --format json ` +
        filesArg,
      {
        cwd: projectRoot,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 30000,
      },
    );
    return { violations: [], exitCode: 0 };
  } catch (err: any) {
    // ESLint exits with code 1 when there are errors
    try {
      const results = JSON.parse(err.stdout?.toString() || "[]");
      const violations: EslintViolation[] = results
        .filter((f: any) => f.messages?.length > 0)
        .flatMap((f: any) =>
          f.messages.map((m: any) => ({
            file: f.filePath,
            line: m.line,
            column: m.column,
            rule: m.ruleId,
            message: m.message
              .replace("CAT1.0: ", "")
              .replace("CAT1.1: ", "")
              .replace("CAT3.1: ", "")
              .replace("CAT3.3: ", "")
              .replace("CAT3.4: ", "")
              .replace("CAT3.6: ", "")
              .replace("CAT4.5: ", ""),
            severity: m.severity,
          })),
        );
      return { violations, exitCode: 1 };
    } catch {
      return { violations: [], exitCode: 1, error: err.message };
    }
  }
}

// ─── State Update ───────────────────────────────────────────

/**
 * Update eslint_state sub-state with audit results.
 * Uses atomicWriteSubState for safe concurrent writes.
 *
 * @param moduleName - module identifier (e.g. "auth", "all_modules")
 * @param violations - array of ESLint violations
 * @param waivers - optional waiver IDs
 * @param _taskId - unused, kept for API compatibility
 */
export function updateEslintState(
  moduleName: string,
  violations: EslintViolation[],
  waivers: string[],
  _taskId?: string,
): StateUpdateResult {
  const hasWaiver = waivers && waivers.length > 0;
  const status =
    violations.length === 0 ? "clean" : hasWaiver ? "waived" : "dirty";

  const ok = atomicWriteSubState("eslint_state", (eslint_state: any) => {
    if (!eslint_state) {
      eslint_state = {
        last_full_scan: null,
        modules: {},
        aggregate: {
          total_violations: 0,
          dirty_modules: [],
          waived_modules: [],
        },
      };
    }

    eslint_state.modules[moduleName] = {
      status,
      violations: violations.map((v) => ({
        ...v,
        waiver: hasWaiver ? waivers[0] : null,
      })),
      last_check: new Date().toISOString(),
      waivers_applied: waivers || [],
    };

    // Recalculate aggregate
    const allModules: any[] = Object.values(eslint_state.modules);
    eslint_state.aggregate = {
      total_violations: allModules.reduce(
        (sum: number, m: any) => sum + (m.violations?.length || 0),
        0,
      ),
      dirty_modules: Object.entries(eslint_state.modules)
        .filter(([, m]: [string, any]) => m.status === "dirty")
        .map(([k]) => k),
      waived_modules: Object.entries(eslint_state.modules)
        .filter(([, m]: [string, any]) => m.status === "waived")
        .map(([k]) => k),
    };
    eslint_state.last_full_scan = new Date().toISOString();
  });

  if (!ok) {
    return { updated: false, reason: "Sub-state write failed after 3 retries" };
  }

  return { updated: true, status };
}
