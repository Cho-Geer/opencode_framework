// service/file-guard/codegraph-state.ts — CodeGraph impact state management
// Extracted from plugins/codegraph-enforce.ts (Batch 2)

import * as fs from "node:fs";
import * as path from "node:path";
import { writeLog } from "../../lib/log-manager";

const SRC = "service-codegraph-state";
const STATE_FILE = ".task_temp/.codegraph-impact-sessions.json";

export interface ImpactState {
  sessions: Record<string, { impact_called: boolean; at: number; targets?: string[] }>;
}

function getStatePath(): string {
  const root = process.env.OPENCODE_ROOT || ".";
  return path.join(root, STATE_FILE);
}

/** Read codegraph impact tracking state from disk */
export function readImpactState(): ImpactState {
  try {
    const p = getStatePath();
    if (!fs.existsSync(p)) return { sessions: {} };
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return { sessions: {} };
  }
}

/** Write codegraph impact tracking state to disk */
export function writeImpactState(state: ImpactState): void {
  try {
    const p = getStatePath();
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(p, JSON.stringify(state, null, 2));
  } catch (e: any) {
    writeLog(SRC, "ERROR", { event: "WRITE-STATE-FAILED", detail: e.message });
  }
}
