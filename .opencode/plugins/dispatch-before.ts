// dispatch-before.ts — PLAN-FIRST Layer 1 dispatch policy enforcement
import { withPluginLifecycle } from "../lib/hook-lifecycle";
import { validateDispatchBefore } from "../service/dispatch";

export default withPluginLifecycle("dispatch-before", {
  "tool.execute.before": async (input: any, output: any) => {
    const result = validateDispatchBefore(input, output);
    if (result.blocked) {
      throw new Error(result.message);
    }
  },
});
