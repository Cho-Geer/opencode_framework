// service/knowledge/declare-scope.ts — Module scope declaration
// Source: tools/module_scope_declare.ts
// Handles: validation + domain lookup + DB writes (discovery, session_map, audit, checklist)

import * as fs from "node:fs";
import * as path from "node:path";
import { writeLog } from "../../lib/log-manager";
import { tolerantParse } from "../../lib/tolerant-json";
import { resolvePipelineId, atomicUpsertDiscovery } from "./pipeline-db";
import { pushAuditEvent } from "./audit";
import { resolveDomainId } from "../session/resolver";
import { upsertSessionMap } from "../session/session-map";
import { checklistWirePassed } from "../../lib/checklist-hooks";

const SRC = "service-declare-scope";

const VALID_MODULES = [
  "backend_api",
  "persistence",
  "frontend_ui",
  "caching",
  "queue",
  "testing",
  "auth_security",
  "framework_tools",
  "devops_ci",
  "opencode_framework",
  "infrastructure",
  "state_management",
];

export interface DeclareModuleScopeInput {
  module: string;
  agent: string;
  sessionID: string;
  taskId: string;
}

export interface DeclareModuleScopeResult {
  domain?: string;
  cache_path?: string;
  context7_libraries?: string[];
  fallback_url?: string;
  next_step?: string;
  error?: string;
  available?: string[];
}

/**
 * Declare the target module scope for the current task.
 * Maps module to knowledge domain, writes discovery + session_map + audit + checklist.
 */
export function declareModuleScope(input: DeclareModuleScopeInput): DeclareModuleScopeResult {
  const { module: moduleName, agent, sessionID, taskId } = input;
  const projectRoot = process.env.OPENCODE_ROOT || process.cwd();
  const configPath = path.resolve(projectRoot, ".opencode", "project.config.json");

  // ── Validate module ──
  if (!VALID_MODULES.includes(moduleName)) {
    return { error: "Invalid module: " + moduleName, available: VALID_MODULES };
  }

  // ── Read project.config.json ──
  let config: any;
  try {
    config = tolerantParse(fs.readFileSync(configPath, "utf8"));
  } catch {
    return { error: "Cannot read project.config.json" };
  }

  // ── Find domain in semantic map ──
  const domains: any[] = config.knowledge_semantic_map?.domains || [];
  const domain = domains.find((d: any) => d.domain_id === moduleName);
  if (!domain) {
    return {
      error: "Unknown domain: " + moduleName,
      available: domains.map((d: any) => d.domain_id),
    };
  }

  const domainId: string = moduleName;

  // ── DB writes: discovery + session_map ──
  try {
    const pipelineId = resolvePipelineId({ module: moduleName }, sessionID || undefined);

    // FW-P0-FIX-F11: status "declared" (not "undeclared") to avoid pipeline chain break
    atomicUpsertDiscovery({
      pipelineId,
      agent,
      domainId: moduleName,
      sessionId: sessionID || undefined,
      dagTaskId: taskId || undefined,
      discovery: {
        status: "declared",
        discovered_files: [],
        missing_topics: [],
        discovered_at: new Date().toISOString(),
      },
    });

    // GAP-SESSION-MAP-LINK: Write dag_task_id → session_map
    if (sessionID && taskId) {
      upsertSessionMap(sessionID, agent, taskId, moduleName);
    }
  } catch (e) {
    /* non-fatal */
  }

  // ── Audit event ──
  try {
    pushAuditEvent({
      event: "KC-DECLARATION",
      agent,
      timestamp: new Date().toISOString(),
      detail: `Module scope declared: ${domainId}`,
      task_id: taskId,
      domain: domainId,
    });
  } catch {}

  // ── Domain mismatch detection + session_map update ──
  try {
    if (sessionID) {
      const dispatchDomainId = resolveDomainId(sessionID);
      if (dispatchDomainId && dispatchDomainId !== domainId) {
        writeLog(SRC, "WARN", {
          event: "DOMAIN-OVERRIDE",
          detail: `dispatch domain="${dispatchDomainId}" overridden by declare domain="${domainId}"`,
        });
        upsertSessionMap(sessionID, agent, undefined, domainId);
      }
    }
  } catch {}

  // ── Checklist wire ──
  try {
    checklistWirePassed(
      sessionID || "",
      agent,
      taskId || null,
      "module_scope_declared",
      `domain=${domainId}`,
    );
  } catch {}

  return {
    domain: domain.domain_id,
    cache_path: "docs/official_docs/" + domain.save_path,
    context7_libraries: domain.context7_libraries,
    fallback_url: domain.fallback_pattern,
    next_step: "Read docs/official_docs/index.json",
  };
}
