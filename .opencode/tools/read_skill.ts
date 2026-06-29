/**
 * read_skill.ts — Skill Full-Content Reader
 * ==========================================
 *
 * Returns the full SKILL.md content for a given skill name.
 * Works with the directory-ified skill system:
 *   - SKILL.md = stub (directory entry, ~10-15L, injected into context)
 *   - FULL.md  = complete skill document (read on demand via this tool)
 *
 * Fallback: if FULL.md doesn't exist, returns SKILL.md content.
 *
 * @since 2026-06-29
 */

import { tool } from "@opencode-ai/plugin";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export default tool({
  description:
    "Read the full documentation for a skill. Call this before using a skill " +
    "to understand its complete workflow, constraints, and best practices. " +
    "The skill directory listing is already in your context; use this tool " +
    "to get the detailed instructions for a specific skill.",
  args: {
    skill_name: tool.schema
      .string()
      .describe("Name of the skill (e.g., 'codegraph-first', 'brainstorming')"),
  },
  async execute(args, context) {
    const skillName = args.skill_name.trim();
    if (!skillName) {
      return { error: "skill_name is required" };
    }

    // Resolve skill directory relative to project root
    const projectRoot = context?.cwd ?? process.cwd();
    const skillDir = join(projectRoot, ".opencode/skills", skillName);

    if (!existsSync(skillDir)) {
      // List available skills for helpful error
      const skillsBase = join(projectRoot, ".opencode/skills");
      try {
        const { readdirSync } = await import("node:fs");
        const available = readdirSync(skillsBase).filter((d: string) =>
          existsSync(join(skillsBase, d, "SKILL.md"))
        );
        return {
          error: `Skill '${skillName}' not found. Available skills: ${available.join(", ")}`,
        };
      } catch {
        return { error: `Skill '${skillName}' not found and could not list available skills.` };
      }
    }

    // Try FULL.md first, fallback to SKILL.md
    const fullPath = join(skillDir, "FULL.md");
    const stubPath = join(skillDir, "SKILL.md");

    try {
      if (existsSync(fullPath)) {
        return { content: readFileSync(fullPath, "utf-8") };
      }
      return { content: readFileSync(stubPath, "utf-8") };
    } catch (err: any) {
      return { error: `Failed to read skill: ${err.message}` };
    }
  },
});
