/**
 * interrupt-guard.ts — Cooperative interrupt trap for local tools & MCP servers
 * =============================================================================
 *
 * Purpose:
 *   OpenCode's TUI renders tool errors verbatim. When the upstream interrupt
 *   handler formats `Unexpected {interrupt}` with an uninterpolated template
 *   placeholder, the TUI leaks the raw string and can leave ToolRegistry-
 *   derived state stale. This module traps cooperative interrupts inside
 *   local `.opencode/tools/`, `.opencode/plugins/`, and
 *   `.opencode/scripts/mcp-tools/` and converts them into structured
 *   string payloads so the TUI never sees the raw template.
 *
 * Detection heuristics (any match triggers trap):
 *   - Error instance name === "InterruptError" / "AbortError"
 *   - Error message contains literal token "interrupt" (case-insensitive)
 *   - Error message contains the literal placeholder "{interrupt}"
 *   - Node/Bun AbortSignal `aborted` flag true
 *   - SIGINT captured during execution
 *
 * Contract:
 *   - Returns a structured JSON string on intercept (never throws).
 *   - On the success path, the wrapped value is passed through unchanged.
 *   - Logs a single INTERRUPT-TRAPPED event via the shared log-manager.
 *
 * Usage:
 *   import { withInterruptGuard } from "../lib/interrupt-guard";
 *   export default tool({
 *     ...
 *     async execute(args, context) {
 *       return withInterruptGuard("safe_shell", async () => {
 *         // original body
 *       });
 *     },
 *   });
 *
 * @author @Super-Admin (framework repair)
 * @version 1.0.0
 * @since 2026-06-14
 */

import { writeLog } from "./log-manager";

export interface InterruptTrapPayload {
  interrupted: true;
  tool: string;
  reason: string;
  kind: "interrupt" | "abort" | "sigint";
  timestamp: string;
}

const INTERRUPT_TOKEN_RE = /interrupt/i;
const INTERRUPT_PLACEHOLDER_RE = /\{interrupt\}/;

/**
 * Returns true if the given unknown value looks like a cooperative interrupt.
 * Pure predicate — no side effects.
 */
export function isInterruptError(value: unknown): {
  matched: boolean;
  kind: InterruptTrapPayload["kind"];
  reason: string;
} {
  if (value instanceof Error) {
    const name = value.name || "";
    if (name === "InterruptError" || name === "AbortError") {
      return { matched: true, kind: "interrupt", reason: `${name}: ${value.message}` };
    }
    const msg = value.message || "";
    if (INTERRUPT_PLACEHOLDER_RE.test(msg)) {
      return {
        matched: true,
        kind: "interrupt",
        reason: `uninterpolated placeholder in message: ${msg}`,
      };
    }
    if (INTERRUPT_TOKEN_RE.test(msg)) {
      return { matched: true, kind: "interrupt", reason: msg };
    }
  }
  if (typeof value === "string") {
    if (INTERRUPT_PLACEHOLDER_RE.test(value)) {
      return {
        matched: true,
        kind: "interrupt",
        reason: `uninterpolated placeholder: ${value}`,
      };
    }
    if (INTERRUPT_TOKEN_RE.test(value)) {
      return { matched: true, kind: "interrupt", reason: value };
    }
  }
  return { matched: false, kind: "interrupt", reason: "" };
}

/**
 * Wraps an async tool/MCP handler body. On cooperative interrupt, returns a
 * structured JSON string instead of rethrowing — preventing the upstream
 * TUI from rendering raw template text.
 */
export async function withInterruptGuard<T>(
  label: string,
  fn: () => Promise<T> | T,
): Promise<T | string> {
  let sigintFired = false;
  const onSigint = () => {
    sigintFired = true;
  };
  if (typeof process !== "undefined" && typeof process.on === "function") {
    try {
      process.on("SIGINT", onSigint);
    } catch {
      /* ignore listener install failures */
    }
  }

  try {
    const result = await fn();
    if (sigintFired) {
      return emitTrap(label, "sigint", "SIGINT captured during execution");
    }
    return result;
  } catch (err: unknown) {
    if (sigintFired) {
      return emitTrap(label, "sigint", "SIGINT captured during execution");
    }
    const detection = isInterruptError(err);
    if (detection.matched) {
      return emitTrap(label, detection.kind, detection.reason);
    }
    throw err;
  } finally {
    if (typeof process !== "undefined" && typeof process.off === "function") {
      try {
        process.off("SIGINT", onSigint);
      } catch {
        /* ignore */
      }
    }
  }
}

function emitTrap(
  label: string,
  kind: InterruptTrapPayload["kind"],
  reason: string,
): string {
  const payload: InterruptTrapPayload = {
    interrupted: true,
    tool: label,
    reason,
    kind,
    timestamp: new Date().toISOString(),
  };
  try {
    writeLog("session", "runtime", {
      event: "INTERRUPT-TRAPPED",
      detail: JSON.stringify(payload),
    });
  } catch {
    /* log-manager failure must not break the trap */
  }
  return JSON.stringify(payload);
}

/**
 * Installs a one-shot SIGINT handler that runs the given cleanup callback
 * before exiting. Intended for long-running MCP servers that hold locks
 * (e.g. gate-state.json) and must release them on interrupt.
 */
export function installSigintCleanup(cleanup: () => void | Promise<void>): void {
  if (typeof process === "undefined" || typeof process.on !== "function") return;
  let handling = false;
  process.on("SIGINT", async () => {
    if (handling) return;
    handling = true;
    try {
      await cleanup();
    } catch {
      /* cleanup failure must not block exit */
    }
    process.exit(0);
  });
}
