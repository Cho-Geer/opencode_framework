// tdd-before.ts — 'tool.execute.before' plugin: TDD per-write enforcement
// Ensures @Coder-BE/@Coder-FE write test files before implementation code
import * as fs from 'node:fs';
import { writeLog } from '../lib/log-manager';
import { withPluginLifecycle } from '../lib/hook-lifecycle';
import { resolveAgent } from '../lib/agent-resolver';
import { isBusinessSourceFile, STATE_PATHS, isTddAgent, isTddTool } from '../lib/state-utils';
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
  // Read machine.json tdd_enforcement_state
  const mode = getEnforcementMode();
  let testWritten = false;
  try {
    const mp = STATE_PATHS.machine();
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
  if (mode === 'strict' || mode === 'locked') throw new Error(msg);
}
