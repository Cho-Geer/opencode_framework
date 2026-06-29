// service/gate/state-machine.ts — Gate session state machine
// Source: Extracted from session-crud.ts, store.ts, checks.ts, drain.ts
// Defines all valid state transitions and status utilities for gate sessions.

// ════════════════════════════════════════════════
// TYPES
// ════════════════════════════════════════════════

export type GateStatus =
  | "checked"
  | "armed"
  | "delivered"
  | "approved"
  | "completed"
  | "failed"
  | "recoverable"
  | "drained";

// ════════════════════════════════════════════════
// STATE CATEGORIES
// ════════════════════════════════════════════════

/** Initial state after gate check */
export const INITIAL_STATUS: GateStatus = "checked";

/** States where session is actively being worked on */
export const LIVE_STATUSES: GateStatus[] = ["armed", "delivered", "approved"];

/** Terminal states — no further transitions possible */
export const TERMINAL_STATUSES: GateStatus[] = ["completed", "failed", "drained"];

/** States that can still make progress (non-terminal) */
export const ACTIVE_STATUSES: GateStatus[] = [
  "checked",
  "armed",
  "delivered",
  "approved",
  "recoverable",
];

// ════════════════════════════════════════════════
// TRANSITION MAP
// ════════════════════════════════════════════════

/**
 * Valid state transitions for gate sessions.
 *
 * State flow:
 *   checked → armed → delivered → approved → completed
 *                ↘ recoverable (retry → armed)
 *                ↘ failed
 *                ↘ completed (no approval required)
 *   delivered → armed (reject)
 *   delivered → completed (approve with summary)
 *   any active → drained (stale cleanup)
 */
export const VALID_TRANSITIONS: Record<GateStatus, GateStatus[]> = {
  checked: ["armed", "failed"],
  armed: ["delivered", "recoverable", "completed", "failed"],
  delivered: ["approved", "completed", "armed"],
  approved: ["completed"],
  recoverable: ["armed", "delivered"],
  completed: [],
  failed: [],
  drained: [],
};

// ════════════════════════════════════════════════
// FUNCTIONS
// ════════════════════════════════════════════════

/**
 * Check if a state transition is valid.
 */
export function isValidTransition(from: GateStatus, to: GateStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Check if a status is terminal (no further transitions).
 */
export function isTerminalStatus(status: GateStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * Check if a status is a live/active session.
 */
export function isLiveStatus(status: GateStatus): boolean {
  return LIVE_STATUSES.includes(status);
}

/**
 * Get all valid next states from a given state.
 */
export function getNextStates(from: GateStatus): GateStatus[] {
  return VALID_TRANSITIONS[from] || [];
}

/**
 * Validate a transition and return a descriptive error if invalid.
 * Returns null if the transition is valid.
 */
export function validateTransition(
  from: GateStatus,
  to: GateStatus,
  sessionId: string,
): string | null {
  if (isTerminalStatus(from)) {
    return `session ${sessionId} is in terminal state "${from}" and cannot transition to "${to}"`;
  }
  if (!isValidTransition(from, to)) {
    return `invalid transition for session ${sessionId}: "${from}" → "${to}". Valid targets: [${getNextStates(from).join(", ")}]`;
  }
  return null;
}
