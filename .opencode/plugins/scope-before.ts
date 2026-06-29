// scope-before.ts — "tool.execute.before" plugin: write scope enforcement
import { withPluginLifecycle } from "../lib/hook-lifecycle";
import { validateWriteScope } from "../service/gate";

export default withPluginLifecycle("scope-before", {
  "tool.execute.before": toolExecuteBefore,
});

async function toolExecuteBefore(input: any, output: any): Promise<void> {
  const result = validateWriteScope(input, output);
  if (result.blocked) {
    throw new Error(result.message);
  }
}
