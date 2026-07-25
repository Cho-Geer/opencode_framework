// service/dispatch/coding-standards-loader.ts — Role-based coding standards injection
// ═══════════════════════════════════════════════════════════════
// A-5: Loads coding standard rules per agent role instead of
// globally loading all standards for every agent (~6.6K tokens saved).
// ═══════════════════════════════════════════════════════════════

import * as fs from "node:fs";
import * as path from "node:path";

const RULES_DIR = path.join(
  process.env.OPENCODE_ROOT || process.cwd(),
  ".opencode",
  "rules",
  "coding"
);

/**
 * Agent → coding standards mapping.
 * Each agent gets only the standards relevant to their role.
 */
const AGENT_CODING_STANDARDS: Record<string, string[]> = {
  "coder-be": ["coding-standard-common.md", "backend-coding-standard.md", "test-coding-standard.md"],
  "coder-fe": ["coding-standard-common.md", "frontend-coding-standard.md", "test-coding-standard.md"],
  architect: ["coding-standard-common.md", "backend-coding-standard.md", "frontend-coding-standard.md"],
  guardian: [
    "coding-standard-common.md",
    "backend-coding-standard.md",
    "frontend-coding-standard.md",
    "test-coding-standard.md",
  ],
  "super-admin": ["coding-standard-common.md", "backend-coding-standard.md", "frontend-coding-standard.md"],
};

/**
 * Load coding standards markdown for a given agent type.
 * Returns concatenated markdown string, or empty string if no standards apply.
 */
export function loadCodingStandardsForAgent(agentType: string): string {
  const key = agentType.toLowerCase();
  const files = AGENT_CODING_STANDARDS[key];
  if (!files || files.length === 0) return "";

  const sections: string[] = [];
  for (const file of files) {
    const filePath = path.join(RULES_DIR, file);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf8").trim();
      const name = file.replace(".md", "").replace(/-/g, " ");
      sections.push(`### ${name}\n\n${content}`);
    }
  }

  if (sections.length === 0) return "";

  return `---\n\n## 📏 Coding Standards (Role: ${agentType})\n\n${sections.join("\n\n---\n\n")}`;
}
