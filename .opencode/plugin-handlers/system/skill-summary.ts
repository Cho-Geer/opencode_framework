// plugin-handlers/system/skill-summary.ts — Skill summary injection (Phase 3)
// v2.3 (2026-07-06): adds cold-start DB fallback for sessions where chat.message
//   hook hasn't populated the bridge yet (e.g. Orchestrator first LLM round
//   where SDK leaves input.agent="" before identity resolution). v2.2 bridge
//   remains the primary path; DB read is a best-effort substitute cached 60s.
// v2.2 (2026-07-06): cross-hook user-message bridge fixes keyword matching.
//   Prior v2.1 extractRecentMessage() guessed four input fields (lastUserMessage,
//   message, parts, conversation.messages) that are not present on the
//   experimental.chat.system.transform input `{ sessionID?, model }` — keyword
//   matching was therefore dead code. Fix: capture user text in chat.message hook
//   (session.ts) via captureUserMessage(), then consume here.
//
// Injection logic:
//   1. Base: agent-configured default skills (from AGENT_SKILLS map)
//   2. Boost: keyword-matched skills from recent user message
//   3. Inject combined recommendation into system prompt (~200 tokens)

import { writeLog } from "../../lib/log-manager";
import { resolveAgent } from "../../lib/agent-resolver";

export const name = "skill-summary";

// ── Cross-hook user-message bridge ──
// experimental.chat.system.transform input is `{ sessionID?, model }` — it has NO
// user-message content (see @opencode-ai/plugin/dist/index.d.ts:265-270). The only
// hook that carries the raw user message is chat.message (output.parts / output.message).
// So we capture in chat.message and consume here. Map is LRU-bounded and TTL-filtered.

interface BridgedMessage { text: string; capturedAt: number }
const recentMessageBridge = new Map<string, BridgedMessage>();
const BRIDGE_MAX_SIZE = 256;
const BRIDGE_TTL_MS = 30 * 60 * 1000; // 30 minutes

export function captureUserMessage(sessionID: string, text: string): void {
  if (!sessionID || !text) return;
  if (recentMessageBridge.size >= BRIDGE_MAX_SIZE) {
    const oldest = recentMessageBridge.keys().next().value;
    if (oldest) recentMessageBridge.delete(oldest);
  }
  recentMessageBridge.set(sessionID, { text, capturedAt: Date.now() });
}

export function consumeUserMessage(sessionID: string): string {
  if (!sessionID) return "";
  const entry = recentMessageBridge.get(sessionID);
  if (!entry) return "";
  if (Date.now() - entry.capturedAt > BRIDGE_TTL_MS) {
    recentMessageBridge.delete(sessionID);
    return "";
  }
  return entry.text;
}

// ── Cold-start DB fallback ──
// chat.message hook in session.ts skips when input.agent is undefined (which is
// the case for the Orchestrator's first LLM round in a fresh session, where the
// SDK assigns agent="" before identity resolution). In that case the bridge is
// empty at the first system.transform. As a best-effort fallback, we read the
// most recent text part from the SDK opencode.db `part` table. The row may be
// an assistant utterance from a previous round, but keyword matching on any
// recent in-session text is strictly better than falling back to base skills
// only. Cached per session for 60s to avoid SQLite hits on every LLM call.

interface ColdStartEntry { text: string; fetchedAt: number }
const coldStartCache = new Map<string, ColdStartEntry>();
const COLD_START_TTL_MS = 60 * 1000;

function coldStartDbFallback(sessionID: string): string {
  if (!sessionID) return "";
  const cached = coldStartCache.get(sessionID);
  if (cached && Date.now() - cached.fetchedAt < COLD_START_TTL_MS) return cached.text;
  try {
    const { Database } = require("bun:sqlite");
    const sdkDbPath = process.env.OPENCODE_DB || `${process.env.HOME}/.local/share/opencode/opencode.db`;
    const sdkDb = new Database(sdkDbPath, { readonly: true });
    const row = sdkDb.query(
      "SELECT json_extract(data, '$.text') AS t FROM part " +
      "WHERE session_id = ? AND json_extract(data, '$.type') = 'text' " +
      "ORDER BY time_created DESC LIMIT 1"
    ).get(sessionID) as { t: string | null } | undefined;
    sdkDb.close();
    const text = row?.t ? String(row.t).slice(0, 4000) : "";
    coldStartCache.set(sessionID, { text, fetchedAt: Date.now() });
    return text;
  } catch {
    coldStartCache.set(sessionID, { text: "", fetchedAt: Date.now() });
    return "";
  }
}

// ── Agent → base skill mapping ──
const AGENT_SKILLS: Record<string, string[]> = {
  Orchestrator: [
    "preflight-lite", "context7-first", "codegraph-first",
    "opencode-mcp-integration", "multi-agent-orchestration",
    "dispatch-protocol", "deliverable-contract", "review-arbitration",
  ],
  "Super-Admin": [
    "preflight-lite", "context7-first", "codegraph-first",
    "opencode-mcp-integration", "customize-opencode",
  ],
  "Coder-BE": [
    "preflight-lite", "context7-first", "codegraph-first",
    "opencode-mcp-integration", "cicd-database-seeding", "auto-commit",
  ],
  "Coder-FE": [
    "preflight-lite", "context7-first", "codegraph-first",
    "opencode-mcp-integration", "auto-commit",
  ],
  Guardian: [
    "preflight-lite", "context7-first", "codegraph-first",
    "opencode-mcp-integration", "sqlite-bloat-investigation",
  ],
  Architect: [
    "brainstorming", "preflight-lite", "context7-first",
    "codegraph-first", "opencode-mcp-integration",
  ],
  "Meta-Planner": [
    "brainstorming", "preflight-lite", "context7-first",
    "codegraph-first", "opencode-mcp-integration",
  ],
  Arbiter: [
    "preflight-lite", "context7-first", "codegraph-first",
    "opencode-mcp-integration",
  ],
  "CI-CD-Agent": [
    "preflight-lite", "ci-cd-guardrails", "cross-directory-ci",
    "context7-first", "codegraph-first", "opencode-mcp-integration",
  ],
  "Knowledge-Curator": [
    "preflight-lite", "context7-first", "codegraph-first",
    "opencode-mcp-integration", "spreadsheet-processor", "learning-mode-executor",
  ],
};

// ── Keyword → Skill trigger mapping (6 groups) ──
const KEYWORD_TRIGGERS: Array<{ patterns: RegExp[]; skills: string[]; group: string }> = [
  {
    group: "source-edit",
    patterns: [
      /\b(edit|modify|refactor|change|fix\s*bug|implement|update\s*code|rewrite)\b/i,
      /\b(safe_edit|safe_delete|safe_restore)\b/,
      /(修改|修复|重构|影响范围|调用链|源码|编辑|改动|改一下|修一下)/,
    ],
    skills: ["codegraph-first"],
  },
  {
    group: "architecture",
    patterns: [
      /\b(design|architect|plan|migrat|restructur|blueprint|schema\s*change)\b/i,
      /\b(refactor.*large|breaking\s*change|system\s*design)\b/i,
      /(需求不清|澄清|拆解|方案|风险|权衡|架构|设计|规划)/,
    ],
    skills: ["brainstorming"],
  },
  {
    group: "cicd",
    patterns: [
      /\b(deploy|CI|CD|pipeline|build|docker|container|release|tag|version)\b/i,
      /\b(test\s*run|integration\s*test|e2e|smoke\s*test)\b/i,
      /(部署|流水线|发布|构建|容器|镜像|测试运行|集成测试|端到端)/,
    ],
    skills: ["ci-cd-guardrails", "cross-directory-ci"],
  },
  {
    group: "database",
    patterns: [
      /\b(migrat|schema|database|table|SQL|prisma|seed|index|query\s*optim)\b/i,
      /\b(postgres|redis|sqlite|bloat|vacuum)\b/i,
      /(数据库|表结构|迁移|索引|查询优化|膨胀|种子数据)/,
    ],
    skills: ["cicd-database-seeding", "sqlite-bloat-investigation"],
  },
  {
    group: "data-processing",
    patterns: [
      /\b(spreadsheet|CSV|Excel|xlsx|data\s*table|export\s*report)\b/i,
      /(表格|电子表格|导出报告|数据处理)/,
    ],
    skills: ["spreadsheet-processor"],
  },
  {
    group: "library-dep",
    patterns: [
      /\b(library|dependency|package|npm|bun\s*add|import\s*from|module)\b/i,
      /\b(context7|documentation\s*lookup|API\s*reference)\b/i,
      /(官方文档|依赖|版本|最佳实践|外部框架|API文档|库)/,
    ],
    skills: ["context7-first"],
  },
];

const COMMON_SKILLS = [
  "preflight-lite", "context7-first",
  "codegraph-first", "opencode-mcp-integration",
];

type TaskRisk = "trivial" | "standard" | "high-risk";
type FreshnessLevel = "not-needed" | "recommended" | "required";
type TodoLevel = "not-needed" | "required";

interface PolicyAssessment {
  risk: TaskRisk;
  freshness: FreshnessLevel;
  todo: TodoLevel;
  scoutSuggested: boolean;
  reasons: string[];
}

// ── Extract recent user message text via cross-hook bridge (+ cold-start DB fallback) ──
// system.transform input is `{ sessionID?, model }` only; user text is supplied
// by the chat.message hook in plugins/session.ts via captureUserMessage(). When
// the bridge is empty (cold start), read most recent text part from SDK DB.
function extractRecentMessage(input: any): string {
  const sid = input?.sessionID || "";
  const bridged = consumeUserMessage(sid);
  if (bridged) return bridged;
  return coldStartDbFallback(sid);
}

// ── Match keywords to skills ──
function matchKeywords(text: string): { matched: string[]; groups: string[] } {
  if (!text) return { matched: [], groups: [] };
  const matched = new Set<string>();
  const groups: string[] = [];

  for (const trigger of KEYWORD_TRIGGERS) {
    for (const pattern of trigger.patterns) {
      if (pattern.test(text)) {
        trigger.skills.forEach(s => matched.add(s));
        groups.push(trigger.group);
        break; // One match per group is enough
      }
    }
  }

  return { matched: [...matched], groups };
}

function assessTask(text: string, groups: string[]): PolicyAssessment {
  const sourceEdit = groups.includes("source-edit");
  const architecture = groups.includes("architecture");
  const libraryDep = groups.includes("library-dep");
  const cicd = groups.includes("cicd");
  const database = groups.includes("database");
  const lower = text.toLowerCase();

  const trivial =
    text.length > 0 &&
    text.length < 80 &&
    !sourceEdit &&
    !architecture &&
    !libraryDep &&
    !cicd &&
    !database &&
    /(^|\b)(where|path|show|list|read|find|what is|在哪|路径|查看|列出|读取)(\b|$)/i.test(text);

  const highRisk =
    /(framework|plugin|hook|permission|policy|migration|migrate|schema|rollback|production|security|root\s*cause|large\s*refactor|架构|框架|迁移|重构|权限|根因|发布|生产|安全)/i.test(text) ||
    (sourceEdit && architecture) ||
    (database && /(migration|schema|transaction|索引|表结构|迁移)/i.test(text));

  const scoutSuggested =
    architecture ||
    /(unclear|ambiguous|conflict|conflicting|compare|tradeoff|research|investigate|探索|调研|歧义|冲突|权衡|复杂任务|不确定|卡住)/i.test(text);

  const freshness: FreshnessLevel = libraryDep ||
    /(version|dependency|api|sdk|framework|library|best practice|context7|官方文档|版本|依赖|框架|最佳实践|api文档)/i.test(text)
    ? "required"
    : architecture || cicd || database
      ? "recommended"
      : "not-needed";

  const risk: TaskRisk = trivial ? "trivial" : highRisk ? "high-risk" : "standard";
  const todo: TodoLevel = risk === "trivial" ? "not-needed" : "required";

  const reasons: string[] = [];
  if (sourceEdit) reasons.push("source-edit");
  if (architecture) reasons.push("architecture");
  if (libraryDep) reasons.push("external-docs");
  if (database) reasons.push("database");
  if (cicd) reasons.push("delivery");
  if (scoutSuggested) reasons.push("research-escalation");
  if (reasons.length === 0) reasons.push("general");

  return { risk, freshness, todo, scoutSuggested, reasons };
}

// ── Main handler ──
export async function handle(input: any, output: any): Promise<void> {
  const sessionId = input?.sessionID;
  if (!sessionId) return;

  try {
    const agent = resolveAgent(sessionId) || "unknown";
    const baseSkills = AGENT_SKILLS[agent] || COMMON_SKILLS;

    // Keyword matching from recent message
    const recentText = extractRecentMessage(input);
    const { matched: keywordSkills, groups } = matchKeywords(recentText);
    const policy = assessTask(recentText, groups);

    // Merge: keyword-matched first (higher priority), then agent base (deduplicated)
    const seen = new Set<string>();
    const merged: string[] = [];
    for (const s of [...keywordSkills, ...baseSkills]) {
      if (!seen.has(s)) {
        seen.add(s);
        merged.push(s);
      }
    }

    // Build directive (~200 tokens)
    const topSkills = merged.slice(0, 8);
    const lines = [
      `[SKILL-SUMMARY] Agent: ${agent}`,
    ];

    if (keywordSkills.length > 0) {
      lines.push(`Task-matched Skills (${groups.join(", ")}): ${keywordSkills.join(", ")}`);
    }

    lines.push(`Risk: ${policy.risk}`);
    lines.push(`Recommended: ${topSkills.join(", ")}`);
    lines.push(
      policy.todo === "required"
        ? `TodoWrite: required for this task. Create a compact task list, keep exactly one in_progress item, and map each write/validation/recovery action to it.`
        : `TodoWrite: optional for this task. Skip it only if the task remains truly trivial.`
    );
    lines.push(
      policy.freshness === "required"
        ? `Freshness: required. Gather Context7 or other authoritative local docs before planning or editing.`
        : policy.freshness === "recommended"
          ? `Freshness: recommended. Verify key framework/API assumptions before irreversible changes.`
          : `Freshness: not required unless you discover version-sensitive assumptions.`
    );
    lines.push(
      policy.risk === "trivial"
        ? `Preflight: optional. Skip preflight-lite for trivial read-only queries.`
        : `Preflight: required. Load preflight-lite skill FIRST, classify task, then select execution skills before starting work.`
    );
    if (policy.scoutSuggested) {
      lines.push(`Scout: if evidence conflicts, requirements stay unclear, or repeated failures occur, use native Task to dispatch Scout/research support.`);
    }
    lines.push(`Use 'skill' tool to load execution skills before complex work. 'skill_read_attest' certifies required skill reads.`);
    lines.push(`For source edits: load codegraph-first FIRST. For complex tasks: load brainstorming. No legacy preamble or DAG gate is required for small safe tasks.`);

    const directive = lines.join("\n");

    if (output?.system && Array.isArray(output.system)) {
      output.system.push(directive);
    }

    writeLog("plugin-skill-summary", "INFO", {
      event: "SKILL-SUMMARY-INJECTED",
      sessionId, agent,
      keywordGroups: groups.length > 0 ? groups.join(",") : "none",
      keywordSkills: keywordSkills.join(",") || "none",
      totalRecommended: merged.length,
    });
    writeLog("plugin-skill-summary", "INFO", {
      event: "knowledge_freshness_decision",
      sessionId, agent,
      risk: policy.risk,
      reasons: policy.reasons.join(","),
    });
    writeLog("plugin-skill-summary", "INFO", {
      event: "todo_policy_decision",
      sessionId, agent,
      risk: policy.risk,
    });
    writeLog("plugin-skill-summary", "INFO", {
      event: "preflight_policy_decision",
      sessionId, agent,
      risk: policy.risk,
    });
    if (policy.scoutSuggested) {
      writeLog("plugin-skill-summary", "INFO", {
        event: "scout_escalation_suggested",
        sessionId, agent,
        risk: policy.risk,
        reasons: policy.reasons.join(","),
      });
    }
  } catch (e: any) {
    writeLog("plugin-skill-summary", "ERROR", {
      event: "SKILL-SUMMARY-ERR",
      sessionId, error: e.message?.slice(0, 120),
    });
  }
}
