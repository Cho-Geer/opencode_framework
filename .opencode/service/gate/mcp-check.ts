// service/gate/mcp-check.ts — Gate compliance check logic
// ═══════════════════════════════════════════════════════════════
// Extracted from scripts/mcp-tools/compliance-gate.ts (runGateCheck L828-1460)
// Orchestrates dispatch integrity, rule/skill checks, UC7KS validation,
// SA/Orch bypass, and session creation.
// ═══════════════════════════════════════════════════════════════

import * as fs from "node:fs";
import * as path from "node:path";
import { writeLog } from "../../lib/log-manager";
import { readSubState } from "../../lib/substate-manager";
import {
  getProjectRoot,
  loadGateStore,
  saveGateStore,
  generateGateSessionId,
  fileExists,
} from "./store-crud";
import { getEnforcementMode } from "./enforcement";
import { drainStaleSessions } from "./drain";
import {
  validateDispatchTaskIntegrity,
  checkTaskIdConflict,
} from "./dispatch-integrity";

const SRC = "service-gate-mcp-check";

// ── Rule/Skill file paths ──
const SKILL_INV_STD =
  process.env.SKILL_INV_STD_PATH ||
  path.join(getProjectRoot(), ".opencode", "rules", "rule_detail", "skill-invocation-standard.md");
const MCP_INVENTORY =
  process.env.MCP_INVENTORY_PATH ||
  path.join(getProjectRoot(), ".opencode", "rules", "rule_detail", "mcp-tool-inventory.md");
const COMMON_RULES =
  process.env.COMMON_RULES_PATH ||
  path.join(getProjectRoot(), ".opencode", "rules", "common-project.md");
const SKILL_FILE =
  process.env.SKILL_FILE_PATH ||
  path.join(getProjectRoot(), ".opencode", "skills", "execution-preflight-check", "SKILL.md");

export interface GateCheckFailedItem {
  id: string;
  desc: string;
  severity: "HIGH" | "WARNING" | "INFO";
}

export interface GateCheckResult {
  passed: boolean;
  gate_session_id: string;
  enforcement_mode: string;
  failed_items: GateCheckFailedItem[];
  rule_status: Record<string, string>;
}

// ── Helper: purge stale sessions ──
function purgeStaleSessions(): { purged: number; remaining_total: number; remaining_active: number } {
  const store = loadGateStore();
  const nowTs = Date.now();
  const ARMED_STALE_MS = 24 * 60 * 60 * 1000;
  const CHECKED_STALE_MS = 48 * 60 * 60 * 1000;
  let purged = 0;
  const sessionIds = Object.keys(store.sessions);

  for (const sid of sessionIds) {
    const ses = store.sessions[sid];
    if (!ses) continue;

    let shouldDrain = false;
    let reason = "";
    let drainType = "";

    if (ses.gate_status === "armed" && !ses.consumed_at) {
      const refTime = ses.confirmed_at || ses.created_at;
      const age = nowTs - new Date(refTime).getTime();
      if (age > ARMED_STALE_MS) {
        shouldDrain = true;
        drainType = "STALE_ARMED";
        reason = `armed for ${Math.floor(age / 3600000)}h without completion`;
      }
    }

    if (ses.gate_status === "checked" && !ses.confirmed_at) {
      const age = nowTs - new Date(ses.created_at).getTime();
      if (age > CHECKED_STALE_MS) {
        shouldDrain = true;
        drainType = "STALE_CHECKED";
        reason = `checked for ${Math.floor(age / 3600000)}h without confirmation`;
      }
    }

    if (shouldDrain) {
      try {
        const { dbArchiveDrainedSession } = require("../../lib/db-state-manager");
        const archived = dbArchiveDrainedSession(sid, ses.task_description || "", reason, drainType, JSON.stringify(ses));
        if (!archived) continue;
        delete store.sessions[sid];
        store.active_sessions = store.active_sessions.filter((a) => a !== sid);
        purged++;
      } catch { /* DB error, skip */ }
    }
  }

  if (purged > 0) {
    store.last_updated = new Date().toISOString();
    saveGateStore(store);
  }

  return {
    purged,
    remaining_total: Object.keys(store.sessions).length,
    remaining_active: store.active_sessions.length,
  };
}

// ── Helper: verify rule registry (critical files check) ──
function verifyRuleRegistry(): {
  passed: boolean;
  results: GateCheckFailedItem[];
  registry_available: boolean;
  summary: string;
} {
  const results: GateCheckFailedItem[] = [];
  try {
    const { getModifiedCriticalFiles, CRITICAL_FILES, isInfrastructureFile } = require("../../lib/critical-files");
    const modified = getModifiedCriticalFiles();
    const allInfra = modified.length > 0 && modified.every((f: string) => isInfrastructureFile(f));

    if (modified.length === 0) {
      return { passed: true, results: [], registry_available: true, summary: `[Gate Preflight v2] ${CRITICAL_FILES.length} critical files tracked, 0 modified since HEAD` };
    }

    if (allInfra) {
      for (const filePath of modified) {
        results.push({ id: "critical_file_modified_" + filePath.replace(/[^a-zA-Z0-9]/g, "_"), desc: `[Gate Preflight v2] ${filePath}: infra file modified — [INFRA] commit pending (allowed)`, severity: "WARNING" });
      }
      return { passed: true, results, registry_available: true, summary: `[Gate Preflight v2] ${modified.length} infra file(s) modified — gate allowed` };
    }

    for (const filePath of modified) {
      results.push({ id: "critical_file_modified_" + filePath.replace(/[^a-zA-Z0-9]/g, "_"), desc: `[Gate Preflight v2] ${filePath}: business-critical file modified — blocked until commit`, severity: "HIGH" });
    }
    return { passed: false, results, registry_available: true, summary: `[Gate Preflight v2] ${modified.length} critical infrastructure file(s) modified since HEAD` };
  } catch {
    return { passed: true, results: [], registry_available: false, summary: "[Gate Preflight v2] critical-files module unavailable — skipped" };
  }
}

// ── Helper: check if skill is loaded ──
function isSkillLoadedInSession(): boolean {
  return fileExists(SKILL_FILE);
}

// ── Helper: check if rules were consulted ──
function wasRuleConsulted(): Record<string, string> {
  const results: Record<string, string> = {};
  [COMMON_RULES, SKILL_INV_STD, MCP_INVENTORY].forEach((f) => {
    results[path.basename(f)] = fileExists(f) ? "found" : "missing";
  });
  return results;
}

// ── Helper: resolve project state directory ──
function resolveProjectState(): string {
  const cfgPath = path.join(getProjectRoot(), ".opencode", "project.config.json");
  try {
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    const pr = cfg.project_root;
    if (pr && pr !== ".") {
      const stateDir = path.join(getProjectRoot(), pr, ".opencode", "state");
      if (fs.existsSync(stateDir)) return stateDir;
    }
  } catch { /* use default */ }
  return path.join(getProjectRoot(), ".opencode", "state");
}

/**
 * Main gate compliance check.
 * Validates dispatch integrity, rule/skill availability, UC7KS knowledge cache,
 * critical file modifications, and creates a gate session.
 */
export function checkGateCompliance(
  taskDescription: string,
  taskId?: string | null,
): GateCheckResult {
  // ── Dispatch integrity validation ──
  const integrity = validateDispatchTaskIntegrity(taskId);
  if (integrity.integrityViolation) {
    return {
      passed: false,
      gate_session_id: "",
      enforcement_mode: getEnforcementMode(),
      failed_items: [{ id: "dispatch_integrity", desc: integrity.violationReason!, severity: "HIGH" }],
      rule_status: {},
    };
  }

  // Use resolved taskId if none provided
  const effectiveTaskId = integrity.resolvedTaskId || taskId || null;

  // ── Task ID conflict check ──
  const conflict = checkTaskIdConflict(effectiveTaskId);
  if (conflict) {
    return {
      passed: false,
      gate_session_id: "",
      enforcement_mode: getEnforcementMode(),
      failed_items: [{ id: "task_id_conflict", desc: conflict.reason, severity: "HIGH" }],
      rule_status: {},
    };
  }

  // ── Bootstrap: hooks path check ──
  try {
    const { execSync } = require("node:child_process");
    const hooksPath = execSync("git config --local core.hooksPath", { stdio: "pipe", encoding: "utf-8", timeout: 5000 }).trim();
    if (hooksPath !== ".opencode/hooks") {
      writeLog(SRC, "WARN", { event: "bootstrap_hooks_path_mismatch", found: hooksPath, expected: ".opencode/hooks" });
    }
  } catch { /* ignore */ }

  // ── Auto-purge stale sessions ──
  const enforcementMode = getEnforcementMode();
  const purgeResult = purgeStaleSessions();
  if (purgeResult.purged > 0) {
    writeLog(SRC, "INFO", { event: "purge_stale_sessions", purged: purgeResult.purged, remaining_total: purgeResult.remaining_total, remaining_active: purgeResult.remaining_active });
  }
  const drainResult = drainStaleSessions(24, 48);
  if (drainResult.purged > 0) {
    writeLog(SRC, "INFO", { event: "drain_stale_sessions", purged: drainResult.purged, drained_armed: drainResult.drained_armed, drained_checked: drainResult.drained_checked });
  }

  const store = loadGateStore();
  const gateSessionId = generateGateSessionId();
  const ruleStatus = wasRuleConsulted();
  const skillAvailable = isSkillLoadedInSession();
  const failed: GateCheckFailedItem[] = [];

  if (!skillAvailable) {
    failed.push({ id: "skill_execution_preflight_check", desc: `execution-preflight-check SKILL.md not found at ${SKILL_FILE}`, severity: "HIGH" });
  }
  if (ruleStatus[path.basename(COMMON_RULES)] !== "found") {
    failed.push({ id: "rule_common_project", desc: `common-project.md not found at ${COMMON_RULES}`, severity: "HIGH" });
  }
  if (ruleStatus[path.basename(SKILL_INV_STD)] !== "found") {
    failed.push({ id: "rule_skill_invocation_standard", desc: `skill-invocation-standard.md not found at ${SKILL_INV_STD}`, severity: "HIGH" });
  }
  if (ruleStatus[path.basename(MCP_INVENTORY)] !== "found") {
    failed.push({ id: "rule_mcp_inventory", desc: `mcp-tool-inventory.md not found at ${MCP_INVENTORY}`, severity: "HIGH" });
  }

  // ── Role violation check ──
  try {
    const complianceRecords = readSubState("compliance_records");
    const violations = complianceRecords.role_violations || [];
    const unresolved = violations.filter((v: any) => v.status === "unresolved");
    if (unresolved.length > 0) {
      failed.push({ id: "agent_role_violation", desc: `CAT4.1: ${unresolved.length} unresolved role violations found. Last: ${unresolved[unresolved.length - 1].agent} wrote ${unresolved[unresolved.length - 1].violation_file}`, severity: "HIGH" });
    }
  } catch { /* non-blocking */ }

  // ── Rule registry verification ──
  const registryResult = verifyRuleRegistry();
  if (registryResult.registry_available) {
    failed.push(...registryResult.results);
    failed.push({ id: "rule_registry_summary", desc: registryResult.summary, severity: registryResult.passed ? "INFO" : "HIGH" });
  }

  // ── SA/Orch bypass for critical files ──
  try {
    const { resolveLatestDispatchAgent } = require("../../lib/agent-resolver");
    const bypassAgent = resolveLatestDispatchAgent(effectiveTaskId);
    const bypassNorm = (bypassAgent || "").replace(/^@/, "").toLowerCase();
    if ((bypassNorm === "super-admin" || bypassNorm === "orchestrator") && enforcementMode !== "locked") {
      let bypassedCount = 0;
      for (const item of failed) {
        if (item.id?.startsWith("critical_file_modified_")) {
          writeLog(SRC, "runtime", { event: "CRITICAL-FILE-MODIFIED-BYPASS", agent: bypassAgent, sessionID: gateSessionId });
          item.severity = "WARNING";
          item.desc = "[SA-BYPASS] " + item.desc;
          bypassedCount++;
        }
      }
      if (bypassedCount > 0) {
        for (const item of failed) {
          if (item.id === "rule_registry_summary") {
            item.severity = "INFO";
            item.desc = "[SA-BYPASS] " + item.desc;
          }
        }
      }
    }
  } catch { /* bypass unavailable */ }

  // ── Determine pass/fail ──
  const hasHighSeverityItems = failed.some((f) => f.severity === "HIGH");
  if (enforcementMode === "advisory") {
    for (const item of failed) {
      if (item.severity === "HIGH") {
        item.severity = "WARNING";
        item.desc = "[ADVISORY] " + item.desc;
      }
    }
  }
  const passed = enforcementMode === "advisory" ? true : !hasHighSeverityItems;

  // ── UC7KS: Knowledge cache check ──
  const uc7ksStateDir = resolveProjectState();
  const indexPath = path.resolve(uc7ksStateDir, "..", "..", "docs", "official_docs", "index.json");
  let knowledgeCacheStatus = "not_found";
  try {
    if (fs.existsSync(indexPath)) {
      const manifest = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
      if (manifest.manifest_version && Array.isArray(manifest.entries)) {
        knowledgeCacheStatus = `v${manifest.manifest_version} (${manifest.entries.length} entries)`;
      } else {
        knowledgeCacheStatus = "malformed";
      }
    }
  } catch { knowledgeCacheStatus = "error"; }
  failed.push({
    id: "uc7ks_knowledge_cache",
    desc: `[Gate Preflight v2] UC7KS Knowledge Cache: ${knowledgeCacheStatus}`,
    severity: knowledgeCacheStatus === "not_found" || knowledgeCacheStatus === "malformed" ? "WARNING" : "INFO",
  });

  // ── UC7KS: Pipeline task-ID chain check ──
  try {
    const knowledgeCacheState = readSubState("knowledge_cache_state");
    const sessionAccess = knowledgeCacheState?.session_access || {};
    const agents = Object.keys(sessionAccess);
    const currentTaskId = effectiveTaskId || "";

    let matchedAgent: string | null = null;
    let matchedAgentFoundInNested = false;
    if (currentTaskId) {
      for (const a of agents) {
        const saEntry = sessionAccess[a];
        if (saEntry.tasks?.[currentTaskId]) {
          const taskDomains = saEntry.tasks[currentTaskId].domains || {};
          for (const d of Object.keys(taskDomains)) {
            if (taskDomains[d].pipeline_status === "completed") {
              matchedAgent = a;
              matchedAgentFoundInNested = true;
              break;
            }
          }
          if (matchedAgent) break;
        }
      }
      if (!matchedAgent) {
        matchedAgent = agents.find((a) => sessionAccess[a]?.pipeline_task_id === currentTaskId) || null;
      }
    }

    if (currentTaskId && !matchedAgent) {
      const severity = enforcementMode === "advisory" ? "WARNING" : "HIGH";
      failed.push({ id: "uc7ks_pipeline_not_started", desc: `[UC7KS] No agent has started the knowledge pipeline for task "${currentTaskId}".`, severity });
    } else if (matchedAgent) {
      const sa = sessionAccess[matchedAgent];
      let suff = null;
      let pipelineCompleted = false;
      let pipelineInsufficient = false;

      if (matchedAgentFoundInNested && sa.tasks?.[currentTaskId]) {
        const taskDomains = sa.tasks[currentTaskId].domains || {};
        const domainKeys = Object.keys(taskDomains);
        let allCompleted = domainKeys.length > 0;
        let anySufficient = false;
        let anyInsufficient = false;
        for (const d of domainKeys) {
          const de = taskDomains[d];
          if (de.pipeline_status !== "completed") allCompleted = false;
          if (de.cache_sufficiency?.status === "sufficient") anySufficient = true;
          if (de.cache_sufficiency?.status === "insufficient") anyInsufficient = true;
          if (de.cache_sufficiency?.status === "sufficient" || de.cache_sufficiency?.status === "insufficient") suff = de.cache_sufficiency;
        }
        pipelineCompleted = allCompleted;
        pipelineInsufficient = anyInsufficient && !anySufficient;
      } else {
        pipelineCompleted = sa.pipeline_status === "completed";
        pipelineInsufficient = sa.cache_sufficiency?.status === "insufficient" && !sa.kc_dispatched;
        suff = sa.cache_sufficiency || null;
      }

      if (!pipelineCompleted) {
        const severity = enforcementMode === "advisory" ? "WARNING" : "HIGH";
        failed.push({ id: "uc7ks_pipeline_not_completed", desc: `[UC7KS] Pipeline for "${currentTaskId}" has not completed.`, severity });
      } else if (pipelineInsufficient && !sa.kc_dispatched) {
        const severity = enforcementMode === "advisory" ? "WARNING" : "HIGH";
        failed.push({ id: "uc7ks_cache_insufficient_no_kc", desc: `[UC7KS] Cache is insufficient for task "${currentTaskId}" and @Knowledge-Curator has not been dispatched.`, severity });
      }

      if (suff) {
        const evidenceMissing = [];
        if (!suff.reason) evidenceMissing.push("reason");
        if (!suff.files_read) evidenceMissing.push("files_read");
        if (!suff.content_summary) evidenceMissing.push("content_summary");
        if (evidenceMissing.length > 0) {
          failed.push({ id: "uc7ks_sufficiency_evidence_incomplete", desc: `[UC7KS] Cache sufficiency evidence incomplete: missing ${evidenceMissing.join(", ")}.`, severity: enforcementMode === "advisory" ? "WARNING" : "HIGH" });
        }
      }
    } else if (!currentTaskId) {
      let anyDone = agents.some((a) => sessionAccess[a]?.pipeline_status === "completed");
      if (!anyDone) {
        for (const a of agents) {
          const tasks = sessionAccess[a]?.tasks || {};
          for (const tid of Object.keys(tasks)) {
            for (const d of Object.keys(tasks[tid].domains || {})) {
              if (tasks[tid].domains[d].pipeline_status === "completed") { anyDone = true; break; }
            }
            if (anyDone) break;
          }
          if (anyDone) break;
        }
      }
      if (!anyDone) {
        const severity = enforcementMode === "advisory" ? "WARNING" : "HIGH";
        failed.push({ id: "uc7ks_no_pipeline_ever", desc: `[UC7KS] No agent has ever completed the knowledge pipeline.`, severity });
      }
    }
  } catch { /* non-fatal */ }

  // ── Create gate session ──
  store.sessions[gateSessionId] = {
    gate_session_id: gateSessionId,
    created_at: new Date().toISOString(),
    task_description: taskDescription || "",
    task_id: effectiveTaskId,
    enforcement_mode: enforcementMode,
    gate_status: "checked",
    last_check_passed: !hasHighSeverityItems,
    last_check_failed_items: failed,
    plan_summary: null,
    confirmed_at: null,
    consumed_at: null,
    audit: null,
    opencode_session_id: process.env.OPENCODE_SESSION_ID || null,
  };
  store.last_updated = new Date().toISOString();
  saveGateStore(store);

  return { passed, gate_session_id: gateSessionId, enforcement_mode: enforcementMode, failed_items: failed, rule_status: ruleStatus };
}
