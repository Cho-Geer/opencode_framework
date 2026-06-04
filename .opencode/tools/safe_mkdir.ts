import { tool } from "@opencode-ai/plugin"
import * as path from "node:path"
import { safeMkdir } from "../lib"

export default tool({
  description:
    "Safely create a directory. mkdir is inherently atomic — no TOCTOU needed.",
  args: {
    dirPath: tool.schema.string().describe("Absolute path of directory to create"),
    recursive: tool.schema.boolean().optional().describe("Create parents (default: true)"),
    dryRun: tool.schema.boolean().optional().describe("Validate without executing"),
  },
  async execute(args) {
    const absPath = path.resolve(args.dirPath)

    if (args.dryRun) {
      return `Validated mkdir for: ${absPath}`
    }

    const result = safeMkdir(absPath, { recursive: args.recursive })
    if (!result.success) {
      throw new Error(`safe_mkdir failed: ${result.error}`)
    }
    return `Directory created: ${result.path}`
  },
})
