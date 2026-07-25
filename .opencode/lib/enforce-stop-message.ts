// enforce-stop-message.ts — Shared utility: STOP directive for hard constraint errors
// ═══════════════════════════════════════════════════════════════
// All plugin error messages should use buildStopMessage() to ensure
// consistent STOP + no-bypass directives.
// ═══════════════════════════════════════════════════════════════

export interface StopMessageOptions {
  pluginName: string;
  ruleId: string;
  blockedTool: string;
  agentName?: string;
  reason: string;
  remediation?: string;
}

/**
 * Build a standardized STOP error message for hard constraint violations.
 * 
 * Format:
 * [FW-ENFORCE][STOP][<ruleId>] <pluginName>: <blockedTool> BLOCKED.
 * REASON: <reason>
 * STOP: Do NOT attempt alternative tools or workarounds to bypass this rule.
 * REPORT: Inform the user immediately with the rule ID and reason.
 * REMEDIATION: <remediation> (if provided)
 */
export function buildStopMessage(opts: StopMessageOptions): string {
  const parts: string[] = [];
  
  // Header with STOP directive
  parts.push(`[FW-ENFORCE][STOP][${opts.ruleId}] ${opts.pluginName}: tool "${opts.blockedTool}" BLOCKED.`);
  
  // Agent context (if available)
  if (opts.agentName) {
    parts.push(`AGENT: ${opts.agentName}`);
  }
  
  // Reason
  parts.push(`REASON: ${opts.reason}`);
  
  // STOP directive — the critical part
  parts.push(`STOP: Do NOT attempt alternative tools, different commands, or workarounds to bypass this rule. This is a HARD CONSTRAINT.`);
  
  // Report directive
  parts.push(`REPORT: Immediately inform the user that this action was blocked by rule ${opts.ruleId}. Do not continue the current task path.`);
  
  // Remediation (optional)
  if (opts.remediation) {
    parts.push(`REMEDIATION: ${opts.remediation}`);
  }
  
  return parts.join("\n");
}

/**
 * Wrap an existing error message with STOP directive.
 * Use this when you want to preserve the original message but add STOP behavior.
 */
export function wrapWithStop(originalMessage: string, ruleId: string): string {
  return `[FW-ENFORCE][STOP][${ruleId}] ${originalMessage}\nSTOP: Do NOT attempt alternative tools or workarounds. REPORT this block to the user immediately.`;
}
