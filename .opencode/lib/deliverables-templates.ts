/**
 * deliverables-templates.ts — Agent-type deliverables templates
 * =============================================================
 * Defines the expected deliverables for each agent type.
 * Used by dispatch-subagent.ts to inject deliverables hints into wrapped prompts,
 * and by compliance-gate.ts to validate declared_deliverables at confirm phase.
 *
 * @module deliverables-templates
 * @since 2026-06-17
 */

export interface DeliverableTemplate {
  name: string;
  description: string;
  artifact_path?: string;
  required: boolean;
}

/**
 * Agents that are exempt from the deliverables hard constraint.
 * Their sessions set approval_required=0 and can go directly from armed to completed.
 */
export const APPROVAL_EXEMPT_AGENTS = [
  "@Orchestrator",
  "@Super-Admin",
  "Orchestrator",
  "Super-Admin",
];

/**
 * Per-agent deliverables templates.
 * Each agent type has a list of required and optional deliverables.
 * Template variables like {taskId} are replaced at dispatch time.
 */
export const DELIVERABLES_TEMPLATES: Record<string, DeliverableTemplate[]> = {
  "Coder-BE": [
    { name: "HANDOVER.md", description: "Handover summary of backend API changes", artifact_path: ".task_temp/{taskId}/HANDOVER.md", required: true },
    { name: "TASK_LOG.md", description: "Working memory log with implementation details", artifact_path: ".task_temp/{taskId}/TASK_LOG.md", required: true },
    { name: "test_report.json", description: "Test execution evidence with execution_evidence field", artifact_path: ".task_temp/{taskId}/test_report.json", required: true },
  ],
  "Coder-FE": [
    { name: "HANDOVER.md", description: "Handover summary of frontend component changes", artifact_path: ".task_temp/{taskId}/HANDOVER.md", required: true },
    { name: "TASK_LOG.md", description: "Working memory log with implementation details", artifact_path: ".task_temp/{taskId}/TASK_LOG.md", required: true },
    { name: "test_report.json", description: "Test execution evidence with execution_evidence field", artifact_path: ".task_temp/{taskId}/test_report.json", required: true },
  ],
  "Architect": [
    { name: "HANDOVER.md", description: "Handover summary of architecture decisions and contract changes", artifact_path: ".task_temp/{taskId}/HANDOVER.md", required: true },
    { name: "TASK_LOG.md", description: "Working memory log with design rationale", artifact_path: ".task_temp/{taskId}/TASK_LOG.md", required: true },
  ],
  "Guardian": [
    { name: "HANDOVER.md", description: "Handover summary of code review findings", artifact_path: ".task_temp/{taskId}/HANDOVER.md", required: true },
    { name: "TASK_LOG.md", description: "Working memory log with review evidence", artifact_path: ".task_temp/{taskId}/TASK_LOG.md", required: true },
  ],
  "Arbiter": [
    { name: "HANDOVER.md", description: "Handover summary of arbitration ruling", artifact_path: ".task_temp/{taskId}/HANDOVER.md", required: true },
    { name: "TASK_LOG.md", description: "Working memory log with deliberation notes", artifact_path: ".task_temp/{taskId}/TASK_LOG.md", required: true },
  ],
  "CI-CD-Agent": [
    { name: "HANDOVER.md", description: "Handover summary of deployment actions", artifact_path: ".task_temp/{taskId}/HANDOVER.md", required: true },
    { name: "TASK_LOG.md", description: "Working memory log with CI/CD pipeline status", artifact_path: ".task_temp/{taskId}/TASK_LOG.md", required: true },
  ],
  "Knowledge-Curator": [
    { name: "HANDOVER.md", description: "Handover summary of knowledge cache updates", artifact_path: ".task_temp/{taskId}/HANDOVER.md", required: true },
  ],
  "Meta-Planner": [
    { name: "HANDOVER.md", description: "Handover summary of planning outputs", artifact_path: ".task_temp/{taskId}/HANDOVER.md", required: true },
  ],
};

/**
 * Get deliverables template for a given agent type.
 * Falls back to a generic template with HANDOVER.md + TASK_LOG.md.
 */
export function getDeliverablesTemplate(agentType: string): DeliverableTemplate[] {
  const normalized = agentType.replace(/^@/, "");
  return DELIVERABLES_TEMPLATES[normalized] || [
    { name: "HANDOVER.md", description: "Handover summary of task completion", artifact_path: ".task_temp/{taskId}/HANDOVER.md", required: true },
    { name: "TASK_LOG.md", description: "Working memory log", artifact_path: ".task_temp/{taskId}/TASK_LOG.md", required: true },
  ];
}

/**
 * Check if an agent is exempt from deliverables hard constraint.
 */
export function isExemptAgent(agentName: string): boolean {
  return APPROVAL_EXEMPT_AGENTS.some(
    (exempt) => agentName === exempt || `@${agentName}` === exempt,
  );
}

/**
 * Generate a markdown snippet for dispatch prompt injection.
 * Shows the agent's expected deliverables.
 */
export function deliverablesTemplateMarkdown(agentType: string): string {
  const templates = getDeliverablesTemplate(agentType);
  const lines = [
    "### Deliverables Declaration — MANDATORY",
    "",
    "When calling `compliance_gate_confirm`, you MUST include `declared_deliverables`.",
    `Your agent type's (${agentType}) typical deliverables:`,
    "",
    ...templates.map(
      (t, i) =>
        `${i + 1}. **${t.name}**: ${t.description}` +
        (t.required ? " (required)" : " (optional)"),
    ),
    "",
    "After writing ALL deliverables, call `compliance_gate_submit_deliverables(session_id, evidence)`.",
    "Then wait for Orchestrator approval before the gate can be closed.",
  ];
  return lines.join("\n");
}
