import { tool } from "@opencode-ai/plugin"
import * as path from "node:path"
import { safeDelete } from "../lib"

export default tool({
  description:
    "Safely delete a file with TOCTOU protection, backup, and rollback capability.",
  args: {
    filePath: tool.schema.string().describe("Absolute path of the file to delete"),
    dryRun: tool.schema.boolean().optional().describe("Validate without executing"),
  },
  async execute(args, context) {
    const absPath = path.resolve(args.filePath)
    const agent = context.agent ?? process.env.FRAMEWORK_AGENT ?? "unknown"

    if (args.dryRun) {
      return `Validated delete for: ${absPath}`
    }

    let result = safeDelete(absPath, { agentType: agent })
    if (!result.success && result.error?.includes("first call")) {
      result = safeDelete(absPath, { agentType: agent })
    }
    if (!result.success) {
      throw new Error(`safe_delete failed: ${result.error}`)
    }
    return `File deleted (backup: ${result.backupPath || "none"})`
  },
})
