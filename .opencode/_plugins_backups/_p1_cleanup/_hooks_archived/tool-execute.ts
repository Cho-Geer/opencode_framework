import * as fs from "node:fs"
import * as path from "node:path"
import { readJsonFile, getEnforcementMode } from "../../../lib/gate-core"
import { PermissionIsolation } from "../../../lib/permission-isolation-core"
import { STATE_PATHS, getOpenCodeRoot, isSourceFile } from "../utils/state-utils"
import { writeAuditLogEntry } from "../utils/audit-log"

export async function toolExecuteBefore(input: { tool: string; sessionID: string; callID: string }, output: { args: Record<string, unknown> }): Promise<void> {
  fs.appendFileSync(path.join(process.env.OPENCODE_ROOT || ".", ".task_temp", "_te_nano.log"), `[${new Date().toISOString()}] BEFORE ${input.tool}\n`)
}
export async function toolExecuteAfter(input: { tool: string; sessionID: string; callID: string }, output: { title: string; output: string; metadata: any; args: any }): Promise<void> {
  fs.appendFileSync(path.join(process.env.OPENCODE_ROOT || ".", ".task_temp", "_te_nano.log"), `[${new Date().toISOString()}] AFTER ${input.tool} fp=${(output.args?.filePath as string) || ""}\n`)
}
