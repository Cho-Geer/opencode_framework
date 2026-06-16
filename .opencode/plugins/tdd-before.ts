// tdd-before.ts — 'tool.execute.before' plugin: TDD per-write enforcement
// Ensures @Coder-BE/@Coder-FE write test files before implementation code
import { writeLog } from '../lib/log-manager';
import { readSubState } from '../lib/substate-manager';
import { withPluginLifecycle } from '../lib/hook-lifecycle';
import { resolveAgent } from '../lib/agent-resolver';
import { isBusinessSourceFile, isTddAgent, isTddTool } from '../lib/state-utils';
import { getEnforcementMode } from '../lib/gate-core';

const P = 'tdd-before';

export default withPluginLifecycle(P, { 'tool.execute.before': toolExecuteBefore });

async function toolExecuteBefore(input: any, output: any): Promise<void> {
  // Only enforce for Coder-BE and Coder-FE
  const agent = resolveAgent(input.sessionID);
  if (!isTddAgent(agent)) return;
  // Only enforce on write/edit/safe_edit (not safe_mkdir/safe_delete/safe_shell)
  if (!isTddTool(input.tool)) return;
  const filePath = (output.args?.filePath as string) || '';
  if (!filePath || !isBusinessSourceFile(filePath)) return;
  // Read tdd_enforcement_state from dedicated sub-state file (P1-B split)
  const mode = getEnforcementMode();
  let testWritten = false;
  try {
    const tdd = readSubState("tdd_enforcement_state");
    if (tdd && tdd.current_session && tdd.current_session.initialized) {
      testWritten = tdd.current_session.test_written === true;
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
  if (mode === 'strict' || mode === 'locked') throw new Error(msg);
}
