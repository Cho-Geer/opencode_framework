#!/usr/bin/env bun

import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";

import { writeLog } from "../../lib/log-manager";
import { checkGateCompliance } from "../../service/gate/mcp-check";
import { runFullScan } from "../../service/file-guard/quality-batch";

type ProjectConfig = {
  project_root?: string;
  paths?: {
    backend_src?: string;
    frontend_src?: string;
  };
};

type GateSummary = {
  passed: boolean;
  session_id: string;
  warning_count: number;
  info_count: number;
};

const SRC = "script-quality-gate";

function resolveRoot(): string {
  return process.env.OPENCODE_ROOT
    ? path.resolve(process.env.OPENCODE_ROOT)
    : path.resolve(__dirname, "..", "..", "..");
}

function loadConfig(root: string): ProjectConfig {
  const configPath = path.join(root, ".opencode", "project.config.json");
  return JSON.parse(fs.readFileSync(configPath, "utf8")) as ProjectConfig;
}

function resolveProjectDir(root: string, config: ProjectConfig): string {
  return path.resolve(root, config.project_root || ".");
}

function resolveOptionalDir(baseDir: string, maybePath?: string): string {
  return maybePath ? path.resolve(baseDir, maybePath) : baseDir;
}

function ensureHooksPath(root: string): void {
  try {
    execSync("git config core.hooksPath .opencode/hooks", {
      cwd: root,
      stdio: "pipe",
      timeout: 5000,
    });
  } catch {
    // Best-effort only. checkGateCompliance will still emit its own warning if needed.
  }
}

function summarizeGate(): GateSummary {
  const gateResult = checkGateCompliance("CI quality gate validation");
  const warningCount = gateResult.failed_items.filter((item) => item.severity === "WARNING").length;
  const infoCount = gateResult.failed_items.filter((item) => item.severity === "INFO").length;

  return {
    passed: gateResult.passed,
    session_id: gateResult.session_id,
    warning_count: warningCount,
    info_count: infoCount,
  };
}

function main(): void {
  const root = resolveRoot();
  process.env.OPENCODE_ROOT = root;

  const config = loadConfig(root);
  const projectDir = resolveProjectDir(root, config);
  const backendDir = resolveOptionalDir(projectDir, config.paths?.backend_src);
  const frontendDir = resolveOptionalDir(projectDir, config.paths?.frontend_src);

  ensureHooksPath(root);

  const fullScan = runFullScan(projectDir, backendDir, frontendDir);
  const gate = summarizeGate();

  const failedChecks: string[] = [];
  if (fullScan.overall !== "pass") {
    failedChecks.push("code_quality_check.run_full_scan");
  }
  if (!gate.passed) {
    failedChecks.push("compliance_gate_check");
  }

  const summary = {
    overall: failedChecks.length === 0 ? "pass" : "fail",
    failed_checks: failedChecks,
    code_quality: fullScan,
    compliance_gate: gate,
  };

  console.log(JSON.stringify(summary, null, 2));

  writeLog(SRC, failedChecks.length === 0 ? "INFO" : "ERROR", {
    event: "QUALITY-GATE-RUN",
    overall: summary.overall,
    failedChecks,
    qualityViolations: fullScan.violations.length,
    gateWarnings: gate.warning_count,
    gateInfos: gate.info_count,
    gateSessionId: gate.session_id || "none",
  });

  process.exit(failedChecks.length === 0 ? 0 : 1);
}

main();
