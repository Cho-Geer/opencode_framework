// checklist-before.ts — P0 checklist enforcement + parent-run fallback plugin
import { withPluginLifecycle } from "../lib/hook-lifecycle";
import { validateChecklistBefore } from "../service/gate";

export default withPluginLifecycle("checklist-before", {
  "tool.execute.before": async (input: any, output: any) => {
    const result = validateChecklistBefore(input, output);
    if (result.blocked) {
      throw new Error(result.message);
    }
  },
});
