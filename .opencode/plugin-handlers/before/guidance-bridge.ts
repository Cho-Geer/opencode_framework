// guidance-bridge.ts — Merged from anti-bypass (guidance gate) + question-policy
// Phase 3 (2026-07-05)
import { writeLog } from "../../lib/log-manager";

export async function handle(input: any, output: any): Promise<void> {
  // Delegate to anti-bypass for guidance gate logic
  try {
    const antiBypass = require("./anti-bypass");
    if (antiBypass && antiBypass.handle) {
      await antiBypass.handle(input, output);
    }
  } catch (e: any) {
    // Re-throw to preserve blocking semantics
    throw e;
  }
  
  // Question pass-through: always allow question tool
  if (input.tool === "question" || (input.tool && input.tool.endsWith("_question"))) {
    return;
  }
}
