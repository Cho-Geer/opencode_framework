// tdd-before.ts — 'tool.execute.before' plugin: TDD per-write enforcement
// 纯 Middleware：调 Service 做判断，自身不含业务逻辑
import { writeLog } from '../lib/log-manager';
import { withPluginLifecycle } from '../lib/hook-lifecycle';
import { resolveAgent } from '../lib/agent-resolver';
import { checkTddEnforcement } from '../service/tdd';

const P = 'tdd-before';

export default withPluginLifecycle(P, { 'tool.execute.before': toolExecuteBefore });

async function toolExecuteBefore(input: any, output: any): Promise<void> {
  const agent = resolveAgent(input.sessionID);
  const filePath = (output.args?.filePath as string) || '';

  const result = checkTddEnforcement(agent, input.tool, filePath);

  if (!result.allowed) {
    writeLog(P, 'runtime', {
      sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
      level: 'ERROR', event: 'TOOL-BEFORE',
      detail: 'BLOCKED | ' + result.message,
    });
    throw new Error(result.message);
  }
}
