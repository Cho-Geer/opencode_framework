/**
 * tsc-gate-reset.ts — Emergency TSC gate lock reset (Thin Controller)
 * Delegates to FileGuardService.tscGate.resetAllLocks()
 * @see service/file-guard/tsc-gate.ts
 */

import { tool } from "@opencode-ai/plugin";
import { resetAllTscGateLocks } from "../service/file-guard/";
import type { FrameworkToolContext } from "./tool-context";

export default tool({
  description:
    "Emergency TSC gate lock reset. Releases ALL file-level TSC gate locks " +
    "held by any session. Also cleans expired locks as a side-effect. " +
    "RESTRICTED to @Super-Admin for use when an agent crashes and leaves " +
    "dangling locks that prevent other agents from modifying files. " +
    "Returns the number of locks released.",

  args: {
    force: tool.schema
      .boolean()
      .default(false)
      .describe("Must be true to confirm the reset operation"),
  },

  async execute(args: { force?: boolean }, _context: FrameworkToolContext) {
    if (!args.force) {
      return JSON.stringify({
        success: false,
        locks_released: 0,
        error: "Operation requires `force: true` to proceed.",
        hint: "Call tsc_gate_reset({ force: true }) to confirm.",
      });
    }

    const { cleaned, released } = resetAllTscGateLocks();

    return JSON.stringify({
      success: true,
      cleaned_expired: cleaned,
      locks_released: released,
      total: cleaned + released,
      detail: `Cleaned ${cleaned} expired + released ${released} active lock(s).`,
    });
  },
});
