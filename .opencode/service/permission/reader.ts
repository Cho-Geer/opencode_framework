/**
 * permission-reader.ts — Shared permission data reader (AUTHORITATIVE: opencode.json)
 *
 * P2-D v2.1: opencode.json is the sole authoritative source for per-agent permission
 * decisions. Upstream constraint: OpenCode CLI reads agent.*.permission directly;
 * {env}/{file} only supports string substitution; project.config.json not in
 * 8 preset config locations.
 *
 * SEMANTIC PRESERVATION: This module MUST NOT change permission semantics —
 * only the data source. Glob matching uses pathMatchesGlob() (identical to
 * gate-checks.ts matchGlob). Shell "allow" means permissive (all commands).
 * Shell "ask" requires confirmation (NOT auto-allowed). Config failure
 * follows per-rule disposition rather than a global runtime mode.
 *
 * NOTE on rule ordering: OpenCode global semantics use "last matching wins",
 * but this project preserves the original deny-first priority (matching
 * gate-checks.ts pre-P2-D behavior). See plan §4.0.1 for equivalence matrix.
 *
 * @author @Super-Admin (P2-D v2.1)
 * @version 1.0.0
 * @since 2026-06-17 (P2-D implementation)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  pathMatchesGlob,
  resolveFrameworkPaths,
} from "../../lib/gate-core";
import { shouldBlock } from "../enforcement/rule-disposition";
import { writeLog } from "../../lib/log-manager";
import { toDisplayName } from "../../lib/agent-identity";
import { LEGACY_AGENT_PERMISSIONS } from "./legacy-agent-permissions";

// ── Types ──

export type PermissionAction = "allow" | "deny" | "ask";

export interface PermissionMap {
  [pattern: string]: PermissionAction;
}

export interface BifurcatedScopes {
  allowed: string[];
  denied: string[];
}

export interface AgentPermission {
  safe_edit?: PermissionMap | "allow" | "deny";
  safe_delete?: PermissionMap | "allow" | "deny";
  safe_mkdir?: PermissionMap | "allow" | "deny";
  safe_shell?: PermissionMap | "allow" | "deny";
  safe_test?: "allow" | "deny";
  [key: string]: any;
}

export interface ShellAllowlistResult {
  /** Commands explicitly allowed (action="allow") */
  allowed: string[];
  /** Commands explicitly denied (action="deny") — veto default_allowlist */
  denied: string[];
  /** Commands requiring confirmation (action="ask") — NOT auto-allowed */
  needsConfirmation: string[];
  /** "allow" string → all commands permitted, skip allowlist check */
  allAllowed: boolean;
  /** "deny" string → tool prohibited */
  toolDenied: boolean;
}

// ── Helpers ──

function getFrameworkRoot(): string {
  return resolveFrameworkPaths().root;
}

// ── Config reader ──

let _opencodeConfig: any = null;

export function readOpencodeConfig(): any {
  if (_opencodeConfig) return _opencodeConfig;
  try {
    const cfgPath = path.join(getFrameworkRoot(), "opencode.json");
    _opencodeConfig = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    writeLog("permission-reader", "runtime", {
      level: "INFO",
      event: "CONFIG-LOADED",
      detail: "opencode.json loaded as authoritative permission source",
    });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    writeLog("permission-reader", "ERROR", {
      level: "ERROR",
      event: "CONFIG-LOAD-FAILED",
      detail: `opencode.json unreadable: ${msg}`,
    });
    if (shouldBlock("permission-config-unreadable")) {
      writeLog("permission-reader", "ERROR", {
        level: "ERROR",
        event: "FAIL-CLOSED",
        detail: "Config unreadable under active permission policy — all permissions denied",
      });
    }
    _opencodeConfig = null;
  }
  return _opencodeConfig;
}

export function resetOpencodeConfigCache(): void {
  _opencodeConfig = null;
}

// ── Per-agent permission lookup ──

export function getAgentPermission(agentName: string): AgentPermission | null {
  const cfg = readOpencodeConfig();
  if (!cfg) {
    if (shouldBlock("permission-config-unreadable")) {
      return {
        safe_edit: "deny",
        safe_delete: "deny",
        safe_mkdir: "deny",
        safe_shell: "deny",
        safe_test: "deny",
      };
    }
    return null;
  }
  // FW-AGENT-IDENTITY: toDisplayName normalizes case + @ prefix for opencode.json lookup
  const agentKey = toDisplayName(agentName);
  const perms = cfg?.agent?.[agentKey]?.permission;
  if (!perms) {
    const legacyPerms = LEGACY_AGENT_PERMISSIONS[agentKey];
    if (legacyPerms) {
      writeLog("permission-reader", "runtime", {
        level: "INFO",
        event: "AGENT-PERMS-LEGACY-FALLBACK",
        detail: `Using legacy permission fallback for agent "${agentKey}"`,
      });
      return legacyPerms;
    }
    writeLog("permission-reader", "runtime", {
      level: "WARN",
      event: "AGENT-PERMS-MISSING",
      detail: `No permission block for agent "${agentName}" in opencode.json; using neutral legacy profile`,
    });
    return {};
  }
  return perms;
}

// ── Flat map → Bifurcated conversion (legacy compatibility) ──

export function permissionMapToBifurcated(
  map: PermissionMap,
): BifurcatedScopes {
  const allowed: string[] = [];
  const denied: string[] = [];
  for (const [pattern, action] of Object.entries(map)) {
    if (action === "allow") {
      allowed.push(pattern);
    } else if (action === "deny") {
      denied.push(pattern);
    }
    // "ask" cannot be represented in legacy bifurcated scope checks.
    // Non-interactive framework audits must safely degrade to deny.
    else if (action === "ask") {
      denied.push(pattern);
    }
  }
  return { allowed, denied };
}

// ── Write scope check (replaces isWriteAllowed from gate-checks.ts) ──

export function isPathAllowedForAgent(
  agentName: string,
  filePath: string,
  tool: "safe_edit" | "safe_delete" | "safe_mkdir" = "safe_edit",
): boolean {
  const perms = getAgentPermission(agentName);
  if (!perms) {
    if (shouldBlock("permission-config-unreadable")) return false;
    return true;
  }

  const permBlock = perms[tool];
  if (!permBlock) return true; // No scope definition = no restrictions

  // Simple string: "allow" → all allowed, "deny" → all denied
  if (typeof permBlock === "string") return permBlock === "allow";

  // Normalize filePath to relative path (same logic as gate-checks.ts)
  const root = getFrameworkRoot();
  const relPath = filePath.startsWith(root + "/")
    ? filePath.slice(root.length + 1)
    : filePath;

  // Flat map: deny-first priority, then allow (same as gate-checks.ts).
  // Uses pathMatchesGlob() — identical algorithm to gate-checks.ts matchGlob().
  // Project-specific decision: deny-first (NOT OpenCode global "last matching wins").
  const entries = Object.entries(permBlock);
  for (const [pattern, action] of entries) {
    if (action === "deny" && pathMatchesGlob(relPath, pattern)) {
      writeLog("permission-reader", "runtime", {
        agent: agentName,
        level: "DEBUG",
        event: "WRITE-DENIED",
        detail: `agent="${agentName}" path="${relPath}" denied_by="${pattern}" tool="${tool}"`,
      });
      return false;
    }
  }
  for (const [pattern, action] of entries) {
    if (action === "allow" && pathMatchesGlob(relPath, pattern)) {
      return true;
    }
  }

  // No match when scopes exist → default deny
  writeLog("permission-reader", "runtime", {
    agent: agentName,
    level: "WARN",
    event: "WRITE-NO-MATCH",
    detail: `agent="${agentName}" path="${relPath}" no_scope_match (default deny) tool="${tool}"`,
  });
  return false;
}

// ── Shell allowlist extraction (v2.1: structured result) ──

export function getAgentShellAllowlist(
  agentName: string,
): ShellAllowlistResult {
  const perms = getAgentPermission(agentName);

  // Default: no shell permissions defined
  const defaultResult: ShellAllowlistResult = {
    allowed: [],
    denied: [],
    needsConfirmation: [],
    allAllowed: false,
    toolDenied: false,
  };

  if (!perms) {
    if (shouldBlock("permission-config-unreadable")) {
      return {
        allowed: [],
        denied: [],
        needsConfirmation: [],
        allAllowed: false,
        toolDenied: true,
      };
    }
    return defaultResult;
  }

  const shell = perms.safe_shell;
  if (!shell) return defaultResult;

  // "allow" string → OpenCode permissive semantics: tool is allowed, all commands permitted
  if (typeof shell === "string") {
    if (shell === "allow") {
      writeLog("permission-reader", "runtime", {
        agent: agentName,
        level: "INFO",
        event: "SHELL-ALL-ALLOWED",
        detail: `agent="${agentName}" safe_shell="allow" (permissive: all commands)`,
      });
      return {
        allowed: [],
        denied: [],
        needsConfirmation: [],
        allAllowed: true,
        toolDenied: false,
      };
    }
    if (shell === "deny") {
      writeLog("permission-reader", "runtime", {
        agent: agentName,
        level: "INFO",
        event: "SHELL-TOOL-DENIED",
        detail: `agent="${agentName}" safe_shell="deny" (tool prohibited)`,
      });
      return {
        allowed: [],
        denied: [],
        needsConfirmation: [],
        allAllowed: false,
        toolDenied: true,
      };
    }
  }

  // Map: "allow" → allowed list, "deny" → denied list, "ask" → needsConfirmation list (NOT auto-allowed)
  const allowedPatterns: string[] = [];
  const deniedPatterns: string[] = [];
  const askPatterns: string[] = [];
  for (const [pattern, action] of Object.entries(shell)) {
    if (action === "allow") {
      allowedPatterns.push(pattern);
    } else if (action === "deny") {
      deniedPatterns.push(pattern);
    } else if (action === "ask") {
      askPatterns.push(pattern);
      writeLog("permission-reader", "runtime", {
        agent: agentName,
        level: "INFO",
        event: "SHELL-ASK-CMD",
        detail: `agent="${agentName}" cmd="${pattern}" requires confirmation (not auto-allowed)`,
      });
    }
  }
  return {
    allowed: allowedPatterns,
    denied: deniedPatterns,
    needsConfirmation: askPatterns,
    allAllowed: false,
    toolDenied: false,
  };
}
