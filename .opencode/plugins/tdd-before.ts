// tdd-before.ts — 'tool.execute.before' plugin: TDD per-write enforcement
// Ensures @Coder-BE/@Coder-FE write test files before implementation code
import * as fs from 'node:fs';
import {
  writeLog, updateIndex, ensureLogDir,
} from '../lib/log-manager';
import { resolveAgent } from '../lib/agent-resolver';
import { isSourceFile, isBusinessSourceFile } from '../lib/state-utils';
const P = 'tdd-before';
ensureLogDir();
writeLog(P, 'loaded', { event: 'PLUGIN-LOADED', detail: P + '.ts' });
updateIndex(P, 'PLUGIN-LOADED');
export default (async (_ctx: any) => {
  writeLog(P, 'hooks', { event: 'HOOK-REGISTERED', detail: 'tool.execute.before' });
  return { 'tool.execute.before': toolExecuteBefore };
}) as any;
async function toolExecuteBefore(input: any, output: any): Promise<void> {
  // Only enforce for Coder-BE and Coder-FE
  const agent = resolveAgent(input.sessionID);
  const isCoder = agent === '@Coder-BE' || agent === '@Coder-FE' || agent === 'Coder-BE' || agent === 'Coder-FE';
  if (!isCoder) return;
  // Only enforce on write/edit/safe_edit (not safe_mkdir/safe_delete/safe_shell)
  const TOOLS: Record<string, boolean> = { write: true, edit: true, safe_edit: true };
  if (!TOOLS[input.tool]) return;
  const filePath = (output.args?.filePath as string) || '';
  if (!filePath || !isBusinessSourceFile(filePath)) return;
  // Read machine.json tdd_enforcement_state
  const mode = 'strict';
  let testWritten = false;
  try {
    const mp = (process.env.OPENCODE_ROOT || '.') + '/.opencode/state/machine.json';
    if (fs.existsSync(mp)) {
      const m = JSON.parse(fs.readFileSync(mp, 'utf8'));
      const tdd = m.tdd_enforcement_state;
      if (tdd && tdd.current_session && tdd.current_session.initialized) {
        testWritten = tdd.current_session.test_written === true;
      }
    }
  } catch {}
  if (testWritten) {
    writeLog(P, 'runtime', {
      sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
      event: 'TOOL-BEFORE',
      detail: 'exit (pass) test written, impl allowed: ' + filePath,
    });
    return;
  }
  // TDD violation - block
  const msg = '[FW-ENFORCE][TDD] TDD violation: writing to "' + filePath + '" without prior test changes. Write a .spec.ts/.test.ts file first.';
  writeLog(P, 'runtime', {
    sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
    level: 'ERROR', event: 'TOOL-BEFORE',
    detail: 'BLOCKED | ' + msg,
  });
  if (mode !== 'advisory') throw new Error(msg);
// end function
}
