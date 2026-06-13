/**
 * scout-trigger.js — UC7KS Scout Trigger Condition Detector v1.0.0
 *
 * Analyzes task descriptions for trigger keywords that indicate
 * documentation-tier sources are insufficient and Scout source-code
 * analysis (Layer 3) should be escalated.
 *
 * Trigger patterns (from §11.6 of UC7KS design):
 *   - "internally", "under the hood" → implementation pipeline questions
 *   - "why does X behave", "unexpected" → potential implementation bugs
 *   - "edge case", "undocumented" → undocumented behavior
 *   - "source code", "implementation" → source inspection requests
 *   - "type narrowing", "generic" → type system internals
 *
 * Usage: bun .opencode/scripts/knowledge/scout-trigger.ts "<task description>"
 * Returns: { should_escalate: boolean, matched_triggers: string[], confidence: "low"|"medium"|"high" }
 */


  { keywords: ["internally", "under the hood", "how does it work"], category: "implementation_pipeline", weight: 3 },
  { keywords: ["why does", "unexpected", "surprising", "bug"], category: "potential_implementation_bug", weight: 2 },
  { keywords: ["edge case", "undocumented", "not documented", "missing docs"], category: "undocumented_behavior", weight: 3 },
  { keywords: ["source code", "implementation detail", "look at the code", "inspect"], category: "source_inspection", weight: 3 },
  { keywords: ["type narrowing", "generic constraint", "type system", "tsc behavior", "compiler"], category: "type_system_internals", weight: 2 },
  { keywords: ["plugin api", "hook internals", "dispatch mechanism", "execution order"], category: "framework_internals", weight: 3 },
];

function detect(taskDescription) {
  const desc = (taskDescription || "").toLowerCase();
  const matched = [];
  let totalWeight = 0;

  for (const pattern of TRIGGER_PATTERNS) {
    for (const kw of pattern.keywords) {
      if (desc.includes(kw.toLowerCase())) {
        matched.push({ keyword: kw, category: pattern.category });
        totalWeight += pattern.weight;
        break; // One match per category
      }
    }
  }

  const confidence = totalWeight >= 6 ? "high" : totalWeight >= 3 ? "medium" : "low";
  const shouldEscalate = totalWeight >= 3;

  return {
    should_escalate: shouldEscalate,
    matched_triggers: matched.map(m => m.keyword),
    matched_categories: [...new Set(matched.map(m => m.category))],
    confidence,
    total_weight: totalWeight,
  };
}



module.exports = { detect };
