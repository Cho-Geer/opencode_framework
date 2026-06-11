// hooks/file-edit.ts — File Edit Hook (tamper detection)
import { getEnforcementMode } from "../../../lib/gate-core"
import { isCriticalFrameworkFile } from "../utils/state-utils"
import { logAuditEntry } from "../utils/audit-log"

export async function fileEdited(
  input: { path: string; agent?: string },
  _output: void,
): Promise<void> {
  const mode = getEnforcementMode()
  const filePath = input.path || ""
  if (!isCriticalFrameworkFile(filePath)) return
  if (mode === "locked") throw new Error(`[FW-ENFORCE][LOCKED] Tamper blocked: "${filePath}"`)
  logAuditEntry({ timestamp: new Date().toISOString(),
    event: mode === "strict" ? "critical_file_edited_strict" : "critical_file_edited_advisory",
    filePath, agent: input.agent || "" })
}
