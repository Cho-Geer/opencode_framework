// deliverables-templates.ts — BRIDGE → service/gate/deliverables.ts
// Phase 1b migration: all logic moved to service/gate/deliverables.ts

export {
  APPROVAL_EXEMPT_AGENTS,
  DELIVERABLES_TEMPLATES,
  getDeliverablesTemplate,
  isExemptAgent,
  deliverablesTemplateMarkdown,
} from "../service/gate/deliverables";

export type { DeliverableTemplate } from "../service/gate/deliverables";
