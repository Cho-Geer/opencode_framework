import * as fs from "node:fs"
import * as path from "node:path"
import { readJsonFile, getEnforcementMode } from "../../lib/gate-core"
import { STATE_PATHS } from "./utils/state-utils"

const EXTERNAL_DOC_TOOLS = new Set(["context7_resolve-library-id","context7_query-docs","context7","webfetch","websearch"])
const UC7KS_BYPASS_AGENTS = new Set(["Knowledge-Curator","@Knowledge-Curator"])

export async function toolExecuteBefore(input: { tool: string; sessionID: string; callID: string }, output: { args: Record<string, unknown> }): Promise<void> {
  fs.appendFileSync(path.join(process.env.OPENCODE_ROOT||".",".task_temp","_hooks_min.log"),`[${new Date().toISOString()}] BEFORE ${input.tool}\n`)
}
export async function toolExecuteAfter(input: { tool: string; sessionID: string; callID: string }, output: { title: string; output: string; metadata: any; args: any }): Promise<void> {
  fs.appendFileSync(path.join(process.env.OPENCODE_ROOT||".",".task_temp","_hooks_min.log"),`[${new Date().toISOString()}] AFTER ${input.tool}\n`)
}
