import * as fs from "node:fs"
import * as path from "node:path"
import { readJsonFile, getEnforcementMode } from "../../lib/gate-core"
import { STATE_PATHS } from "./state-utils"
import { writeAuditLogEntry } from "./audit-log"

let _envDumped = false

export async function toolExecuteBefore(input: { tool: string; sessionID: string; callID: string }, output: { args: Record<string, unknown> }): Promise<void> {
  const EXTERNAL = new Set(["context7_resolve-library-id","context7_query-docs","context7","webfetch","websearch"])
  const BYPASS = new Set(["Knowledge-Curator","@Knowledge-Curator"])
  const agent = process.env.FRAMEWORK_AGENT || process.env.AGENT || ""
  if (EXTERNAL.has(input.tool) && !BYPASS.has(agent)) {
    const healthy = (() => { try { const p = path.join(process.env.OPENCODE_ROOT||".","docs","official_docs","index.json"); return fs.existsSync(p) && JSON.parse(fs.readFileSync(p,"utf8")).entries?.length>0 } catch { return false } })()
    if (healthy && getEnforcementMode() !== "advisory") throw new Error(`[FW-ENFORCE][UC7-001] External query "${input.tool}" blocked: must search local cache first`)
  }
}

export async function toolExecuteAfter(input: { tool: string; sessionID: string; callID: string; args: any }, output: { title: string; output: string; metadata: any; args: any }): Promise<void> {
  const tool = input.tool
  const agent = process.env.FRAMEWORK_AGENT || process.env.AGENT || ""
  const filePath = (input.args?.filePath as string) || ""

  // ── DIAGNOSTIC: dump all relevant env vars once ──
  if (!_envDumped) { _envDumped = true;
    try {
      const relevant = Object.keys(process.env).filter(k =>
        /AGENT|FRAMEWORK|DISPATCH|OPENCODE|SESSION|TASK|ROLE|MODE|CALLER|NAME/i.test(k)
      ).sort()
      const all: Record<string,string> = {}
      for (const k of relevant) all[k] = process.env[k] || ""
      fs.writeFileSync(path.join(process.env.OPENCODE_ROOT||".",".task_temp","_env_dump.json"), JSON.stringify(all, null, 2))
    } catch {}
  }

  // (a) Audit
  writeAuditLogEntry({ timestamp: new Date().toISOString(), tool, agent, sessionID: input.sessionID, callID: input.callID, filePath, action: tool==="write"||tool==="edit"?"modify":"execute", result: "success" })

  // (f) knowledge_state sync
  if ((tool==="write"||tool==="edit"||tool==="safe_edit") && filePath && filePath.includes("docs/official_docs/")) {
    try {
      const idx = path.join(process.env.OPENCODE_ROOT||".","docs","official_docs","index.json")
      if (fs.existsSync(idx)) {
        const m = JSON.parse(fs.readFileSync(idx,"utf8")); const mp = path.join(process.env.OPENCODE_ROOT||".",".opencode","state","machine.json")
        if (fs.existsSync(mp)) {
          const mm = JSON.parse(fs.readFileSync(mp,"utf8")); const n = (m.entries||[]).length; let s = 0
          for (const e of m.entries||[]) for (const f of e.files||[]) s += f.size_bytes||0
          mm.knowledge_state = mm.knowledge_state || {}; mm.knowledge_state.total_docs_count = n; mm.knowledge_state.total_size_bytes = s; mm.knowledge_state.last_reconciliation = new Date().toISOString()
          mm.knowledge_cache_state = mm.knowledge_cache_state || {}; mm.knowledge_cache_state.total_entries = n; mm.knowledge_cache_state.last_index_check = new Date().toISOString()
          fs.writeFileSync(mp, JSON.stringify(mm,null,2))
        }
      }
    } catch {}
  }
}
