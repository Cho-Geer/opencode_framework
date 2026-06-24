// session.ts — Plugin: session management + chat.message hook
// ═══════════════════════════════════════════════════════════════
// Logs session lifecycle and manages session-agent mapping.
// Part of framework log system v2.0.
//
// Hook events:
//   - chat.message:     Track session → agent mapping
//   - session.error:    Detect cooperative interrupts; write sentinel
//   - session.compacted: Reset in-memory session map after compaction
//   - session.idle:     Clear interrupt sentinel when session idles
//
// @author @Super-Admin
// @version 2.2.0
// @since 2026-06-10
// @since 2026-06-14  FW-INTERRUPT-GUARD — added session.error / compacted / idle
// @since 2026-06-21  FW-SESSION-HOOK-WRITE-CONSTRAINT — check resolved_from before writing dagTaskId/domainId
// @since 2026-06-24  FW-SESSION-STARTUP-CLEANUP — interrupt cleanup on chat.message
// @since 2026-06-24  FW-SESSION-ROUND-SUMMARY — end-of-round handover aggregation on session.idle
// ═══════════════════════════════════════════════════════════════

import { writeLog } from "../lib/log-manager";
import { withPluginLifecycle } from "../lib/hook-lifecycle";
import { isInterruptError } from "../lib/interrupt-guard";
import { atomicWriteJson } from "../lib/state-utils";
import { dbWriteSessionMap } from "../lib/db-state-manager";
import { getDb } from "../lib/db-manager";
import { markChecklistRunInterrupted } from "../lib/execution-checklist";
import {
  resolveTaskIdWithSource,
  resolveDomainIdWithSource,
} from "../lib/agent-resolver";
import { isSuperAdmin } from "../lib/agent-identity";
import * as path from "node:path";
import * as fs from "node:fs";

const PROJECT_ROOT = process.env.OPENCODE_ROOT || process.cwd();
const INTERRUPT_SENTINEL_PATH = path.join(
  PROJECT_ROOT,
  ".opencode",
  "state",
  ".last-interrupt.json",
);

// In-memory session map — reset on session.compacted to avoid stale scope.
let _sessionMap: Record<string, { agent: string; ts: string }> = {};

// Agent model cache — lazy-loaded from opencode.json agent->model config.
let _agentModelCache: Record<string, string> = {};

export default withPluginLifecycle("session", {
  "chat.message": chatMessageHook,
  "session.error": sessionErrorHook,
  "session.compacted": sessionCompactedHook,
  "session.idle": sessionIdleHook,
});

// ═══════════════════════════════════════════════════════════════
// [RUNTIME] Inside hook function body — triggered on event
// ═══════════════════════════════════════════════════════════════
async function chatMessageHook(input: any, _output: any) {
  const agent = input.agent || "";
  const sid = input.sessionID || "";

  writeLog("session", "runtime", {
    sessionID: sid,
    agent,
    agent,
    event: "CHAT-HOOK",
    detail: "enter",
  });

  if (!sid || !agent) {
    writeLog("session", "runtime", {
      sessionID: sid,
      agent,
      agent,
      event: "CHAT-HOOK",
      detail: "exit (no sid/agent)",
    });
    return;
  }

  writeLog("session", "INFO", {
    sessionID: sid,
    agent,
    event: "ROUND-START",
    detail: "new conversation round detected",
  });

  // ═══════════════════════════════════════════════════════════════
  // FW-SESSION-STARTUP-CLEANUP (2026-06-24): Interrupt residue cleanup.
  // When the previous conversation round was interrupted (user interrupt,
  // framework crash, or session timeout), the P0 checklist and gate
  // sessions may be left in unrecoverable states. This hook detects the
  // interrupt sentinel and performs emergency cleanup BEFORE any agent
  // tools are executed, preventing deadlocks (e.g., dispatch_payload
  // checklist blocking safe_shell, delivered gate session blocking new
  // dispatches).
  //
  // Cleanup actions (each in independent try/catch — never blocks chat):
  //   1. Mark stuck dispatch_payload checklist runs as 'interrupted'
  //   2. Auto-approve delivered gate sessions (skip sha256 — emergency)
  //   3. Drain armed gate sessions older than 1 hour
  //   4. Clear the interrupt sentinel file
  //
  // Concurrency: chat.message hook is serial per session (OpenCode guarantee).
  // DB operations use transactions for atomicity.
  // ═══════════════════════════════════════════════════════════════
  try {
    if (fs.existsSync(INTERRUPT_SENTINEL_PATH)) {
      writeLog("session", "INFO", {
        sessionID: sid,
        agent,
        event: "SESSION-STARTUP-CLEANUP",
        detail: "Interrupt sentinel detected — performing emergency cleanup",
      });

      let db: any = null;
      try {
        db = getDb();
      } catch {
        // DB unavailable — skip cleanup gracefully
      }

      // Step 1: Mark stuck dispatch_payload checklist runs as interrupted
      try {
        if (db) {
          const interrupted = markChecklistRunInterrupted(
            "dispatch_payload",
            "active",
          );
          writeLog("session", "INFO", {
            sessionID: sid,
            agent,
            event: "CHECKLIST-INTERRUPT-CLEANUP",
            detail: `${interrupted} stuck dispatch_payload checklist run(s) marked as interrupted`,
          });
        }
      } catch (e: any) {
        writeLog("session", "ERROR", {
          sessionID: sid,
          agent,
          event: "CHECKLIST-INTERRUPT-CLEANUP-FAILED",
          detail: e.message,
        });
      }

      // Step 2: Auto-approve delivered gate sessions
      try {
        if (db) {
          const txn = db.transaction(() => {
            const now = Date.now();
            const result = db.run(
              `UPDATE gate_sessions
               SET status = 'approved',
                   deliverables_approved_by = 'auto-approve-interrupt',
                   updated_at = ?
               WHERE status = 'delivered'`,
              [now],
            );
            return result.changes;
          });
          const approved = txn();
          if (approved > 0) {
            writeLog("session", "WARN", {
              sessionID: sid,
              agent,
              event: "GATE-AUTO-APPROVE-INTERRUPT",
              detail: `${approved} delivered gate session(s) auto-approved (interrupt recovery)`,
            });
          }
        }
      } catch (e: any) {
        writeLog("session", "ERROR", {
          sessionID: sid,
          agent,
          event: "GATE-AUTO-APPROVE-FAILED",
          detail: e.message,
        });
      }

      // Step 3: Drain armed gate sessions older than 1 hour
      try {
        if (db) {
          const txn = db.transaction(() => {
            const oneHourAgo = Date.now() - 3600000;
            const result = db.run(
              `UPDATE gate_sessions
               SET status = 'drained', updated_at = ?
               WHERE status = 'armed' AND confirmed_at IS NOT NULL AND confirmed_at < ?`,
              [Date.now(), oneHourAgo],
            );
            return result.changes;
          });
          const drained = txn();
          if (drained > 0) {
            writeLog("session", "INFO", {
              sessionID: sid,
              agent,
              event: "GATE-DRAIN-STALE-INTERRUPT",
              detail: `${drained} stale armed gate session(s) drained (>1h)`,
            });
          }
        }
      } catch (e: any) {
        writeLog("session", "ERROR", {
          sessionID: sid,
          agent,
          event: "GATE-DRAIN-STALE-FAILED",
          detail: e.message,
        });
      }

      // Step 4: Clear interrupt sentinel
      try {
        clearInterruptSentinel();
        writeLog("session", "INFO", {
          sessionID: sid,
          agent,
          event: "INTERRUPT-SENTINEL-CLEARED",
          detail: "Emergency cleanup complete — sentinel removed",
        });
      } catch (e: any) {
        writeLog("session", "ERROR", {
          sessionID: sid,
          agent,
          event: "INTERRUPT-SENTINEL-CLEAR-FAILED",
          detail: e.message,
        });
      }
    }
  } catch {
    /* startup cleanup must never block chat.message hook */
  }

  // ═══════════════════════════════════════════════════════════════
  // FW-COMPLIANCE-AUDIT (#3, 2026-06-24): Gate armed + knowledge
  // cache compliance audit at each round start.
  //
  // In strict/locked mode, non-SA agents are expected to have:
  //   1. An armed compliance gate session (compliance_gate_confirm)
  //   2. Attested knowledge cache (knowledge_cache_attest)
  //
  // This check is AUDIT-ONLY (cannot physically block LLM text output)
  // but provides visibility via structured WARN logs for downstream
  // monitoring (framework-doctor, self-test Check 50).
  // ═══════════════════════════════════════════════════════════════
  try {
    const { getEnforcementMode: _gem } = require("../lib/gate-core");
    const _mode = _gem();
    const _isSA = isSuperAdmin(agent);

    if ((_mode === "strict" || _mode === "locked") && !_isSA && sid) {
      // Check 1: Gate session armed
      let _gateArmed = false;
      try {
        const _db = getDb();
        if (_db) {
          const _armed = _db
            .query("SELECT COUNT(*) AS c FROM gate_sessions WHERE status = ?")
            .get("armed") as { c: number } | null;
          _gateArmed = (_armed?.c || 0) > 0;
        }
      } catch {}

      if (!_gateArmed) {
        writeLog("session", "WARN", {
          sessionID: sid,
          agent,
          event: "GATE-NOT-ARMED",
          detail:
            "No armed gate session — agent may have skipped compliance_gate_check",
        });
      }

      // Check 2: Knowledge cache attested
      let _kcsAttested = false;
      try {
        const { readSubState: _rss } = require("../lib/substate-manager");
        const _kcs = _rss("knowledge_cache_state");
        _kcsAttested = _kcs?.status === "attested";
      } catch {}

      if (!_kcsAttested) {
        writeLog("session", "WARN", {
          sessionID: sid,
          agent,
          event: "KNOWLEDGE-NOT-ATTESTED",
          detail:
            "knowledge_cache_state not attested — agent may have skipped UC7-001",
        });
      }
    }
  } catch {
    /* compliance audit must never block chat.message hook */
  }

  try {
    // S25-v4: Write session → agent mapping to DB (replaces .session_map.json)
    // dbWriteSessionMap handles upsert (INSERT OR REPLACE) and preserves created_at.
    //
    // FW-SESSION-HOOK-WRITE-CONSTRAINT (2026-06-21, @Super-Admin):
    //   dagTaskId and domainId are supplementary metadata that MUST come from
    //   the session_map DB itself (exact per-session match). We must NOT write
    //   dagTaskId/domainId resolved from ambiguous sources (ctx_newest, dispatch_ctx,
    //   dispatch_target) because these could belong to a concurrent dispatch
    //   and would pollute the per-session mapping. Only 'session_map' source
    //   guarantees the data belongs to THIS specific session.
    //
    //   The agent mapping (sid → agent) is always written because it comes from
    //   the hook input directly — no resolution ambiguity.
    const taskIdResult = resolveTaskIdWithSource(sid);
    const domainResult = resolveDomainIdWithSource(sid);

    const dagTaskId =
      taskIdResult.resolved_from === "session_map"
        ? taskIdResult.value || undefined
        : undefined;
    const domainId =
      domainResult.resolved_from === "session_map"
        ? domainResult.value || undefined
        : undefined;

    if (taskIdResult.resolved_from !== "session_map" && taskIdResult.value) {
      writeLog("session", "runtime", {
        sessionID: sid,
        agent,
        agent,
        level: "WARN",
        event: "CHAT-HOOK",
        detail: `dagTaskId skipped: resolved_from=${taskIdResult.resolved_from} (value=${taskIdResult.value}) — only session_map source accepted`,
      });
    }
    if (domainResult.resolved_from !== "session_map" && domainResult.value) {
      writeLog("session", "runtime", {
        sessionID: sid,
        agent,
        agent,
        level: "WARN",
        event: "CHAT-HOOK",
        detail: `domainId skipped: resolved_from=${domainResult.resolved_from} (value=${domainResult.value}) — only session_map source accepted`,
      });
    }

    dbWriteSessionMap(sid, agent, dagTaskId, domainId);

    // Keep in-memory map for session.compacted reset
    _sessionMap[sid] = { agent, ts: new Date().toISOString() };

    writeLog("session", "runtime", {
      sessionID: sid,
      agent,
      agent,
      event: "CHAT-HOOK",
      detail: `exit (ok) map size=${Object.keys(_sessionMap).length}`,
    });
  } catch (err: any) {
    writeLog("session", "runtime", {
      sessionID: sid,
      agent,
      agent,
      level: "ERROR",
      event: "CHAT-HOOK",
      detail: `exit (error) ${err.message}`,
    });
  }
}

// ═══════════════════════════════════════════════════════════════
// [FW-INTERRUPT-GUARD 2026-06-14] session.error / compacted / idle
// ═══════════════════════════════════════════════════════════════

async function sessionErrorHook(input: any, _output: any) {
  const sid = input?.sessionID || input?.session?.id || "";
  const error = input?.error ?? input?.message ?? "";
  const errorStr =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? `${error.name}: ${error.message}`
        : JSON.stringify(error);

  const detection = isInterruptError(error);

  writeLog("session", "runtime", {
    sessionID: sid,
    event: "SESSION-ERROR",
    kind: detection.matched ? "interrupt" : "error",
    detail: errorStr.slice(0, 500),
  });

  if (detection.matched) {
    writeInterruptSentinel({
      sessionID: sid,
      reason: detection.reason,
      kind: detection.kind,
      raw: errorStr.slice(0, 500),
    });
  }
}

async function sessionCompactedHook(input: any, _output: any) {
  const sid = input?.sessionID || input?.session?.id || "";
  _sessionMap = {};
  writeLog("session", "runtime", {
    sessionID: sid,
    event: "SESSION-COMPACTED",
    detail: "in-memory session map reset",
  });
}

async function sessionIdleHook(input: any, _output: any) {
  const sid = input?.sessionID || input?.session?.id || "";
  clearInterruptSentinel();
  writeLog("session", "runtime", {
    sessionID: sid,
    event: "SESSION-IDLE",
    detail: "interrupt sentinel cleared",
  });

  // ═══════════════════════════════════════════════════════════════
  // FW-SESSION-ROUND-SUMMARY (2026-06-24): End-of-round handover aggregation.
  // When the session goes idle (conversation round ends), scan all
  // .task_temp/*/HANDOVER.md files written during this round and
  // aggregate them into a round-summary markdown file.
  //
  // Structure:
  //   .task_temp/_global/round-summary-{timestamp}.md
  //
  // This provides a single-entry overview of all sub-agent deliverables
  // produced during the round, including core changes, key assumptions,
  // and findings.
  // ═══════════════════════════════════════════════════════════════
  try {
    generateRoundSummary(sid);
  } catch {
    /* round-summary generation must never block session.idle */
  }
}

function writeInterruptSentinel(info: {
  sessionID: string;
  reason: string;
  kind: string;
  raw: string;
}): void {
  try {
    const payload = {
      interrupted: true,
      sessionID: info.sessionID,
      reason: info.reason,
      kind: info.kind,
      raw_message: info.raw,
      timestamp: new Date().toISOString(),
    };
    atomicWriteJson(INTERRUPT_SENTINEL_PATH, payload);
  } catch {
    /* sentinel write must never break the hook */
  }
}

function clearInterruptSentinel(): void {
  try {
    if (fs.existsSync(INTERRUPT_SENTINEL_PATH)) {
      fs.unlinkSync(INTERRUPT_SENTINEL_PATH);
    }
  } catch {
    /* ignore */
  }
}

// ═══════════════════════════════════════════════════════════════
// SESSION-MODEL-IDENTITY: Resolve agent model from opencode.json
// ═══════════════════════════════════════════════════════════════

function resolveAgentModel(agent: string): string {
  if (_agentModelCache[agent]) return _agentModelCache[agent];
  try {
    const cfgPath = path.join(PROJECT_ROOT, ".opencode", "opencode.json");
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
      const model = cfg?.agent?.[agent]?.model;
      if (model) {
        _agentModelCache[agent] = model;
        return model;
      }
    }
  } catch {
    /* ignore */
  }
  return "default-model";
}

// ═══════════════════════════════════════════════════════════════
// FW-SESSION-ROUND-SUMMARY (2026-06-24): Round-summary generator.
// Scans .task_temp/*/HANDOVER.md for files modified since last idle
// and aggregates them into a single round-summary markdown file.
// ═══════════════════════════════════════════════════════════════

/** Timestamp of the last generated round-summary (in-memory, per-process). */
let _lastRoundSummaryTime: number = 0;

function generateRoundSummary(sessionId: string): void {
  try {
    const taskTempDir = path.join(PROJECT_ROOT, ".task_temp");
    const globalDir = path.join(taskTempDir, "_global");
    if (!fs.existsSync(taskTempDir)) return;

    const now = Date.now();
    const entries = fs.readdirSync(taskTempDir, { withFileTypes: true });
    const handovers: Array<{
      taskDir: string;
      agent: string;
      coreChanges: string;
      findings: string[];
      assumptions: string[];
    }> = [];

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith("_")) continue;
      const hoPath = path.join(taskTempDir, entry.name, "HANDOVER.md");
      if (!fs.existsSync(hoPath)) continue;

      const stat = fs.statSync(hoPath);
      if (stat.mtimeMs < _lastRoundSummaryTime) continue;

      try {
        const content = fs.readFileSync(hoPath, "utf8");
        const agent = extractField(content, "Agent") || "unknown";
        const coreChanges =
          extractField(content, "Core Changes") ||
          extractSection(content, "## Core Changes") ||
          "—";
        const findings = extractListItems(content, "## Findings");
        const assumptions = extractListItems(content, "## Key Assumptions");

        handovers.push({
          taskDir: entry.name,
          agent,
          coreChanges: coreChanges.substring(0, 200),
          findings,
          assumptions,
        });
      } catch {
        /* skip unreadable handover files */
      }
    }

    if (handovers.length === 0) return;

    // Write round-summary
    if (!fs.existsSync(globalDir)) {
      fs.mkdirSync(globalDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const summaryPath = path.join(globalDir, `round-summary-${timestamp}.md`);

    let md = `# Round Summary — ${new Date().toISOString().slice(0, 10)}\n\n`;
    md += `**Session**: ${sessionId}\n`;
    md += `**Sub-Agent Deliverables**: ${handovers.length}\n\n`;
    md += `## Sub-Agent Deliverables\n\n`;
    md += `| Agent | Task Dir | Core Changes | Findings |\n`;
    md += `|-------|----------|-------------|----------|\n`;

    const allFindings: string[] = [];
    for (const ho of handovers) {
      md += `| ${ho.agent} | ${ho.taskDir} | ${ho.coreChanges} | ${ho.findings.join("; ") || "—"} |\n`;
      allFindings.push(...ho.findings.map((f) => `[${ho.taskDir}] ${f}`));
    }

    md += `\n## Aggregate Findings\n\n`;
    if (allFindings.length > 0) {
      for (const f of allFindings) {
        md += `- ${f}\n`;
      }
    } else {
      md += `_No findings reported_\n`;
    }

    fs.writeFileSync(summaryPath, md);

    _lastRoundSummaryTime = now;

    writeLog("session", "INFO", {
      sessionID: sessionId,
      event: "ROUND-SUMMARY-GENERATED",
      detail: `${handovers.length} handover(s) → ${summaryPath}`,
    });
  } catch (e: any) {
    writeLog("session", "ERROR", {
      sessionID: sessionId,
      event: "ROUND-SUMMARY-FAILED",
      detail: e.message,
    });
  }
}

function extractField(content: string, field: string): string | null {
  const re = new RegExp(`\\*\\*${field}\\*\\*[:\\s]+(.+?)\\n`, "i");
  const m = content.match(re);
  return m ? m[1].trim() : null;
}

function extractSection(content: string, heading: string): string | null {
  const re = new RegExp(`${heading}\\n+([\\s\\S]*?)(?=\\n## |$)`, "i");
  const m = content.match(re);
  return m ? m[1].trim() : null;
}

function extractListItems(content: string, heading: string): string[] {
  const section = extractSection(content, heading);
  if (!section) return [];
  const items: string[] = [];
  const re = /^[*-]\s+(.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(section)) !== null) {
    items.push(match[1].trim());
  }
  return items;
}
