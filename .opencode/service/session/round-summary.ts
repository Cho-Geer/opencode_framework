// service/session/round-summary.ts — Round-summary generator
// Scans .task_temp/*/HANDOVER.md and aggregates into round-summary
// Source: session.ts generateRoundSummary + helpers

import * as fs from "node:fs";
import * as path from "node:path";
import { writeLog } from "../../lib/log-manager";

const SRC = "service-round-summary";
const PROJECT_ROOT = process.env.OPENCODE_ROOT || process.cwd();

/** Timestamp of the last generated round-summary (in-memory, per-process). */
let _lastRoundSummaryTime: number = 0;

/**
 * Scan .task_temp/{task-dir}/HANDOVER.md for files modified since last idle
 * and aggregate them into a single round-summary markdown file.
 *
 * Source: session.ts generateRoundSummary()
 */
export function generateRoundSummary(sessionId: string): void {
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

    writeLog(SRC, "INFO", {
      sessionID: sessionId,
      event: "ROUND-SUMMARY-GENERATED",
      detail: `${handovers.length} handover(s) -> ${summaryPath}`,
    });
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      sessionID: sessionId,
      event: "ROUND-SUMMARY-FAILED",
      detail: e.message,
    });
  }
}

// ── Markdown parsing helpers ───────────────────────────────────────

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
