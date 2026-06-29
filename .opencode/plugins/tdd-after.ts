// tdd-after.ts — 'tool.execute.after' plugin: post-write TDD verification
// 纯 Middleware：调 Service 做验证，自身不含业务逻辑
import { writeLog } from '../lib/log-manager';
import { withPluginLifecycle } from '../lib/hook-lifecycle';
import { verifyTddWrite } from '../service/tdd';

export default withPluginLifecycle('tdd-after', { 'tool.execute.after': toolExecuteAfter });

async function toolExecuteAfter(input: any, output: any): Promise<void> {
  verifyTddWrite(
    input.sessionID,
    input.callID,
    input.tool,
    input.args || {},
  );
}
