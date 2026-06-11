import * as fs from "node:fs"
import * as path from "node:path"

export async function toolExecuteBefore(input: any, output: any): Promise<void> {
  fs.appendFileSync(path.join(process.env.OPENCODE_ROOT||".",".task_temp","_fw_diag.log"),`[${new Date().toISOString()}] FW BEFORE\n`)
}
export async function toolExecuteAfter(input: any, output: any): Promise<void> {
  fs.appendFileSync(path.join(process.env.OPENCODE_ROOT||".",".task_temp","_fw_diag.log"),`[${new Date().toISOString()}] FW AFTER\n`)
}
