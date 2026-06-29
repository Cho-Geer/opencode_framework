// gate-before.ts — "tool.execute.before" plugin: gate & DAG enforcement
import { writeLog } from "../lib/log-manager";
import { withPluginLifecycle } from "../lib/hook-lifecycle";
import { resolveAgent } from "../lib/agent-resolver";
import { autoArmGateSession, validateGateBefore } from "../service/gate";

// ── Auto-arm gate session on OpenCode startup ──
autoArmGateSession();

export default withPluginLifecycle("gate-before", {
  "tool.execute.before": toolExecuteBefore,
});

async function toolExecuteBefore(input: any, output: any): Promise<void> {
  const result = validateGateBefore(input, output);
  if (result.blocked) {
    throw new Error(result.message);
  }
}
