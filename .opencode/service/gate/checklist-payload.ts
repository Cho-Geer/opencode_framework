// service/gate/checklist-payload.ts — Dispatch payload integrity + validation
// Source: execution-checklist.ts (recordDispatchPayloadIntegrity, validateDispatchPayload)

import { getDb } from "../../lib/db-manager";
import { writeLog } from "../../lib/log-manager";
import {
  now,
  generatePayloadId,
  type DispatchPayloadIntegrityInput,
  type ValidatePayloadInput,
  type ValidatePayloadResult,
} from "./checklist-phase";

const SRC = "execution-checklist";

// ════════════════════════════════════════════════
// recordDispatchPayloadIntegrity
// ════════════════════════════════════════════════

export function recordDispatchPayloadIntegrity(
  input: DispatchPayloadIntegrityInput,
): boolean {
  const db = getDb();
  const ts = now();

  try {
    db.run(
      `INSERT INTO dispatch_payload_integrity
       (payload_id, dispatch_ref_id, parent_session_id, agent_type, dag_task_id,
        task_description, normalized_payload, sha256, completeness_status,
        completeness_error, prompt_path, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.payload_id,
        input.dispatch_ref_id ?? null,
        input.parent_session_id ?? null,
        input.agent_type,
        input.dag_task_id ?? null,
        input.task_description,
        input.normalized_payload,
        input.sha256,
        input.completeness_status,
        input.completeness_error ?? null,
        input.prompt_path ?? null,
        ts,
      ],
    );

    writeLog(SRC, "runtime", {
      event: "DISPATCH-PAYLOAD-RECORDED",
      detail: `payload_id=${input.payload_id} agent=${input.agent_type} status=${input.completeness_status}`,
    });

    return true;
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "DISPATCH-PAYLOAD-RECORD-FAILED",
      detail: `payload_id=${input.payload_id} err=${e.message}`,
    });
    return false;
  }
}

// ════════════════════════════════════════════════
// validateDispatchPayload
// ════════════════════════════════════════════════

export function validateDispatchPayload(
  input: ValidatePayloadInput,
): ValidatePayloadResult {
  const { task_description, agent_type } = input;

  if (!task_description || task_description.trim().length === 0) {
    return {
      passed: false,
      error: "Task description is empty",
    };
  }

  if (task_description.trim().length < 20) {
    return {
      passed: false,
      error: `Task description too short (${task_description.trim().length} chars, minimum 20)`,
    };
  }

  if (!agent_type || agent_type.trim().length === 0) {
    return {
      passed: false,
      error: "Agent type is empty",
    };
  }

  return { passed: true };
}
