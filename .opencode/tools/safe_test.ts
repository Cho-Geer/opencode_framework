import { tool } from "@opencode-ai/plugin"
import { validateTestReport, withInterruptGuard } from "../lib"

export default tool({
  description:
    "Validate test_report.json against TDD phase rules. " +
    "Checks execution_evidence, exit_code, and coverage thresholds. " +
    "Use this after running tests to verify TDD compliance.",
  args: {
    taskId: tool.schema.string().describe("Task ID to validate"),
    phase: tool.schema.string().describe("TDD phase (red or green)"),
    dryRun: tool.schema.boolean().optional().describe("Validate parameters without checking report"),
  },
  async execute(args) {
    return withInterruptGuard("safe_test", async () => {
      // Validate phase parameter
      if (args.phase !== "red" && args.phase !== "green") {
        throw new Error(
          `safe_test validation failed: phase must be 'red' or 'green', got '${args.phase}'`,
        )
      }

      if (args.dryRun) {
        return `Validated test report check for task: ${args.taskId} (${args.phase} phase)`
      }

      const result = validateTestReport(args.taskId, args.phase)
      if (!result.passed) {
        throw new Error(`safe_test validation failed: ${result.violations.join("; ")}`)
      }
      return `Validation passed for ${args.taskId} (${args.phase} phase)`
    })
  },
})
