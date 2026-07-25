// service/knowledge/after-track.ts — UC7KS post-execution tracking
// Source: uc7ks-after.ts plugin
// Handles: Layer C tool audit, cache read tracking, post-write verification.

import * as fs from "node:fs";
import * as path from "node:path";
import { writeLog } from "../../lib/log-manager";
import {
  resolveAgent,
  resolveTaskId,
  resolveDomainId,
} from "../../lib/agent-resolver";
import { getModifyPath } from "../../lib/tool-scope";
import { normalizeAgentKey } from "../../lib/uc7ks-schema";
import { atomicWriteSubState } from "../../lib/state-utils";
import { incrementAuditCounter } from "../../lib/knowledge-audit";
import { shouldBlock } from "../enforcement/rule-disposition";

const SRC = "service-knowledge-after-track";

const WRITE_TOOLS = new Set(["write", "edit", "safe_edit"]);

const TRACKED_TOOLS = new Set([
  "webfetch", "websearch", "context7",
  "context7_resolve-library-id", "context7_query-docs",
  "github_get_file_contents", "github_search_code",
  "github_search_repositories", "github_search_issues",
]);

/**
 * Infer domain_id from file path under docs/official_docs/.
 */
function inferDomainFromPath(filePath: string): string | null {
  try {
    const root = process.env.OPENCODE_ROOT || process.cwd();
    const configPath = path.join(root, ".opencode", "project.config.json");
    if (fs.existsSync(configPath)) {
      const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
      const domains = cfg.knowledge_semantic_map?.domains || [];
      for (const d of domains) {
        if (d.save_path && filePath.includes(`docs/official_docs/${d.save_path}`)) {
          return d.domain_id;
        }
      }
    }
  } catch {}
  return null;
}

/**
 * Track knowledge pipeline compliance after tool execution.
 * Called by uc7ks-after plugin.
 *
 * Three paths:
 *   1. Layer C tool audit (webfetch/websearch/context7/github_*)
 *   2. Cache read tracking (read on docs/official_docs/)
 *   3. Post-write verification (write to docs/official_docs/)
 */
export function trackKnowledgeAfter(params: {
  sessionID: string;
  callID: string;
  tool: string;
  args: Record<string, unknown>;
  output: any;
}): void {
  const filePath = getModifyPath(params.args || {});
  const rawAgent = resolveAgent(params.sessionID);
  const agent = normalizeAgentKey(rawAgent);

  // ── Path 1: Layer C Tool Call Audit ──
  if (TRACKED_TOOLS.has(params.tool)) {
    const outcome = params.output?.error || params.output?.failed ? "FAILURE" : "SUCCESS";
    const errorMsg = (params.output?.error || params.output?.failed || "").toString().substring(0, 300);

    writeLog("uc7ks-after", "runtime", {
      sessionID: params.sessionID, callID: params.callID, agent,
      event: "TOOL-AUDIT-RECORDED",
      level: outcome === "FAILURE" ? "WARN" : "INFO",
      detail: `tool=${params.tool} | outcome=${outcome} | agent=${agent}` +
        (outcome === "FAILURE" ? ` | error=${errorMsg}` : ""),
    });

    if (outcome === "FAILURE") {
      writeLog("uc7ks-after", "runtime", {
        sessionID: params.sessionID, callID: params.callID, agent,
        level: "ERROR", event: "TOOL-AUDIT-FAILURE",
        detail: `tool=${params.tool} | error=${errorMsg} | agent=${agent}`,
      });
    }

    try {
      atomicWriteSubState("tool_audit_state", (state: any) => {
        state.sessions = state.sessions || {};
        state.sessions[params.sessionID] = state.sessions[params.sessionID] || {
          agent: agent, tool_calls: [],
        };
        state.sessions[params.sessionID].tool_calls.push({
          tool: params.tool, outcome, timestamp: new Date().toISOString(),
          callID: params.callID, error: outcome === "FAILURE" ? errorMsg : undefined,
        });
        if (state.sessions[params.sessionID].tool_calls.length > 200) {
          state.sessions[params.sessionID].tool_calls =
            state.sessions[params.sessionID].tool_calls.slice(-200);
        }
      });
    } catch (err: any) {
      writeLog("uc7ks-after", "runtime", {
        sessionID: params.sessionID, callID: params.callID,
        level: "ERROR", event: "TOOL-AUDIT-STATE-FAIL",
        detail: `tool_audit_state write failed: ${err.message}`,
      });
    }
  }

  // ── Path 2: Cache Read Tracking ──
  if (params.tool === "read" && filePath && filePath.includes("docs/official_docs/")) {
    const taskId = resolveTaskId(params.sessionID);
    const domainId = resolveDomainId(params.sessionID) || inferDomainFromPath(filePath);

    writeLog("uc7ks-after", "runtime", {
      sessionID: params.sessionID, callID: params.callID,
      event: "TOOL-AFTER",
      detail: `cache-read | agent=${agent} | file=${filePath} | taskId=${taskId || "none"} | domainId=${domainId || "none"}`,
    });

    try {
      atomicWriteSubState("knowledge_cache_state", (state: any) => {
        state.session_access = state.session_access || {};
        state.session_access[agent] = state.session_access[agent] || {};
        state.session_access[agent].last_read_at = new Date().toISOString();
        state.session_access[agent].last_file_read = filePath;
        state.session_access[agent].total_cache_reads =
          (state.session_access[agent].total_cache_reads || 0) + 1;
        try { incrementAuditCounter("total_cache_hits"); } catch {}
      });
    } catch (err: any) {
      writeLog("uc7ks-after", "runtime", {
        sessionID: params.sessionID, callID: params.callID,
        level: "ERROR", event: "TOOL-AFTER",
        detail: "cache-state update failed: " + err.message,
      });
    }
  }

  // ── Path 3: Post-Write Verification (UC7-003) ──
  if (!WRITE_TOOLS.has(params.tool)) return;
  const targetPath = getModifyPath(params.args || {});
  if (!targetPath || !targetPath.includes("docs/official_docs/")) return;

  if (agent !== "knowledge-curator") {
    writeLog("uc7ks-after", "runtime", {
      sessionID: params.sessionID, callID: params.callID,
      level: "WARN", event: "UC7-003-NON-KC-WRITE",
      detail: `Non-KC agent "${agent}" wrote to ${targetPath}. UC7-008 should have blocked this.`,
    });
    return;
  }

  const root = process.env.OPENCODE_ROOT || process.cwd();
  const absPath = path.resolve(root, targetPath);
  try {
    if (fs.existsSync(absPath)) {
      const stat = fs.statSync(absPath);
      const sizeKB = (stat.size / 1024).toFixed(1);

      writeLog("uc7ks-after", "runtime", {
        sessionID: params.sessionID, callID: params.callID, agent,
        event: "UC7-003-VERIFIED",
        detail: `post-write verified | file=${targetPath} | size=${sizeKB}KB`,
      });

      try {
        const cwp = require("../../lib/checklist-hooks");
        const taskId = (params.args as any)?.taskId || null;
        cwp.checklistWirePassed(
          params.sessionID, agent, taskId,
          "knowledge_post_write_verified",
          `file=${targetPath} size=${sizeKB}KB`,
        );
      } catch {}

      try {
        atomicWriteSubState("knowledge_cache_state", (state: any) => {
          state.post_write_verifications = state.post_write_verifications || [];
          state.post_write_verifications.push({
            file: targetPath, size_bytes: stat.size,
            verified_at: new Date().toISOString(),
            agent, session_id: params.sessionID,
          });
          if (state.post_write_verifications.length > 100) {
            state.post_write_verifications = state.post_write_verifications.slice(-100);
          }
        });
      } catch (stateErr: any) {
        writeLog("uc7ks-after", "runtime", {
          sessionID: params.sessionID, callID: params.callID, agent,
          level: "ERROR", event: "UC7-003-STATE-FAIL",
          detail: `state update failed: ${stateErr.message} | file=${targetPath}`,
        });
      }
    } else {
      writeLog("uc7ks-after", "runtime", {
        sessionID: params.sessionID, callID: params.callID, agent,
        level: "ERROR", event: "UC7-003-MISSING",
        detail: `post-write MISSING | file=${targetPath} | policy=uc7ks-tracking`,
      });

      if (shouldBlock("uc7ks-tracking")) {
        throw new Error(
          `\n  UC7-003 POST-WRITE SAVE-OR-FAIL -- ACTIVE POLICY\n` +
          `  File:    ${targetPath}\n  Agent:   ${agent}\n` +
          `  Status:  WRITE REPORTED SUCCESS, FILE NOT FOUND ON DISK\n` +
          `  REMEDIATION: Retry the write. Verify disk space and permissions.\n`,
        );
      }
    }
  } catch (err: any) {
    if (err.message?.includes("UC7-003")) throw err;
    writeLog("uc7ks-after", "runtime", {
      sessionID: params.sessionID, callID: params.callID, agent,
      level: "ERROR", event: "UC7-003-FS-ERROR",
      detail: `verification error: ${err.message} | file=${targetPath}`,
    });
  }
}
