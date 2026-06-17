// uc7ks-after.ts — "tool.execute.after" plugin: knowledge pipeline compliance
import { writeLog } from "../lib/log-manager";
import { withPluginLifecycle } from "../lib/hook-lifecycle";
import { resolveAgent, resolveTaskId, resolveDomainId } from "../lib/agent-resolver";
import { getModifyPath } from "../lib/tool-scope";
import { normalizeAgentKey, getDomainEntry } from "../lib/uc7ks-schema";
import { atomicWriteSubState } from "../lib/state-utils";
import * as path from "node:path";
import * as fs from "node:fs";

export default withPluginLifecycle("uc7ks-after", { "tool.execute.after": toolExecuteAfter });

/**
 * FW-UC7KS-DOMAIN-001: Infer domain_id from a file path under docs/official_docs/.
 * Matches the file's subdirectory against knowledge_semantic_map.domains[].save_path.
 * Returns null if no match found.
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
  } catch {
    /* best-effort */
  }
  return null;
}

/**
 * after-hook: validate knowledge pipeline compliance
 * - Track cache access for UC7-001 (read on docs/official_docs/)
 * - FW-UC7KS-DOMAIN-001: Write per-domain cache_sufficiency when taskId+domainId available
 * - Validate index.json after cache writes
 */
async function toolExecuteAfter(input: any, output: any): Promise<void> {
  // after-hook: args live in input.args
  const filePath = getModifyPath(input.args || {});

  // Track knowledge cache reads — update knowledge-cache-state.json (P1-B split)
  if (input.tool === "read" && filePath && filePath.includes("docs/official_docs/")) {
    const rawAgent = resolveAgent(input.sessionID);
    const agent = normalizeAgentKey(rawAgent);
    const taskId = resolveTaskId(input.sessionID);
    const domainId = resolveDomainId(input.sessionID) || inferDomainFromPath(filePath);

    writeLog("uc7ks-after", "runtime", {
      sessionID: input.sessionID, callID: input.callID,
      event: "TOOL-AFTER",
      detail: `cache-read | agent=${agent} | file=${filePath} | taskId=${taskId || "none"} | domainId=${domainId || "none"}`,
    });

    // Update knowledge-cache-state.json
    try {
      atomicWriteSubState("knowledge_cache_state", (state) => {
        state.session_access = state.session_access || {};
        state.session_access[agent] = state.session_access[agent] || {};

        // Always update agent-level metadata
        state.session_access[agent].last_read_at = new Date().toISOString();
        state.session_access[agent].last_file_read = filePath;
        state.session_access[agent].total_cache_reads =
          (state.session_access[agent].total_cache_reads || 0) + 1;

        // FW-UC7KS-DOMAIN-001: Per-domain cache_sufficiency when context available
        if (taskId && domainId) {
          const domainEntry = getDomainEntry(state.session_access, agent, taskId, domainId);
          domainEntry.pipeline_status = "completed";
          domainEntry.declared_at = domainEntry.declared_at || new Date().toISOString();
          domainEntry.cache_sufficiency = {
            status: "sufficient",
            missing_topics: [],
            declared_at: new Date().toISOString(),
            reason: "docs file read via uc7ks-after",
            files_read: [...(domainEntry.cache_sufficiency?.files_read || []), filePath],
            content_summary: `read ${path.basename(filePath)}`,
          };
          writeLog("uc7ks-after", "runtime", {
            sessionID: input.sessionID, callID: input.callID,
            event: "UC7KS-PER-DOMAIN-UPDATED",
            detail: `taskId=${taskId} domainId=${domainId} status=sufficient`,
          });
        }

        // Backward compat: also set global flag (needed for code paths
        // that don't have per-task/domain context yet)
        state.session_access[agent].uc7_001_compliant = true;
      });
    } catch (err: any) {
      writeLog("uc7ks-after", "runtime", {
        sessionID: input.sessionID, callID: input.callID,
        level: "ERROR", event: "TOOL-AFTER",
        detail: "cache-state update failed: " + err.message,
      });
    }
  }
}
