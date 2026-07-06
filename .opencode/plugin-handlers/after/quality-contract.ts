// quality-contract.ts — Merged from format + tdd + checklist (AUDIT ONLY)
// Phase 3 (2026-07-05): Quality signals without blocking
import { writeLog } from "../../lib/log-manager";
import { writeJsonl } from "../../lib/jsonl-writer";
import { resolveAgent } from "../../lib/agent-resolver";

const sessionsWithTodoWrite = new Set<string>();
const sessionsWarnedForMissingTodo = new Set<string>();
const sessionsWarnedForStaleTodo = new Set<string>();
const sessionsWarnedForBlockedTodo = new Set<string>();

type TodoStatus = "pending" | "in_progress" | "completed" | "failed" | "blocked" | "canceled";

interface TodoState {
  lastUpdatedAt: string;
  total: number;
  inProgress: number;
  blocked: number;
  completed: number;
  actionCountSinceUpdate: number;
}

const todoStateBySession = new Map<string, TodoState>();
const VALID_TODO_STATUSES = new Set<TodoStatus>([
  "pending",
  "in_progress",
  "completed",
  "failed",
  "blocked",
  "canceled",
]);

const NONTRIVIAL_TOOLS = new Set([
  "task",
  "safe_edit",
  "safe_delete",
  "safe_restore",
  "safe_shell",
  "context7",
  "context7_query-docs",
  "context7_resolve-library-id",
  "webfetch",
  "websearch",
]);

function parseTodoState(args: any): TodoState | null {
  const todos = args?.todos;
  if (!Array.isArray(todos)) return null;

  let inProgress = 0;
  let blocked = 0;
  let completed = 0;
  for (const todo of todos) {
    const status = String(todo?.status || "").trim() as TodoStatus;
    if (status === "in_progress") inProgress++;
    if (status === "blocked") blocked++;
    if (status === "completed") completed++;
  }

  return {
    lastUpdatedAt: new Date().toISOString(),
    total: todos.length,
    inProgress,
    blocked,
    completed,
    actionCountSinceUpdate: 0,
  };
}

function invalidTodoStatuses(args: any): string[] {
  const todos = args?.todos;
  if (!Array.isArray(todos)) return [];
  const invalid = new Set<string>();
  for (const todo of todos) {
    const status = String(todo?.status || "").trim();
    if (status && !VALID_TODO_STATUSES.has(status as TodoStatus)) {
      invalid.add(status);
    }
  }
  return [...invalid];
}

export async function handle(input: any, output: any): Promise<void> {
  const sessionID = input.sessionID || "unknown";
  const agent = resolveAgent(sessionID) || "unknown";
  const tool = input.tool || "";

  writeLog("quality-contract", "INFO", {
    event: "QUALITY-CHECK",
    tool,
    timestamp: new Date().toISOString(),
  });

  if (tool === "todowrite") {
    sessionsWithTodoWrite.add(sessionID);
    sessionsWarnedForMissingTodo.delete(sessionID);
    sessionsWarnedForStaleTodo.delete(sessionID);
    sessionsWarnedForBlockedTodo.delete(sessionID);
    const todoState = parseTodoState(input.args || output?.args || {});
    if (todoState) {
      todoStateBySession.set(sessionID, todoState);
    }
    const invalidStatuses = invalidTodoStatuses(input.args || output?.args || {});
    writeJsonl("quality", {
      event: "todo_write_observed",
      policy: "soft-governance",
    }, { sessionID, agent, tool });
    if (invalidStatuses.length > 0) {
      writeLog("quality-contract", "WARN", {
        event: "todo_write_invalid_status",
        sessionID,
        agent,
        detail: `Invalid todo statuses: ${invalidStatuses.join(", ")}`,
      });
      writeJsonl("quality", {
        event: "todo_write_invalid_status",
        policy: "warn_continue",
        invalid_statuses: invalidStatuses,
      }, { sessionID, agent, tool });
    }
    if (todoState) {
      if (todoState.total > 0 && todoState.inProgress !== 1 && todoState.blocked === 0) {
        writeLog("quality-contract", "WARN", {
          event: "todo_write_mismatch",
          sessionID,
          agent,
          detail: `Expected exactly one in_progress todo, got ${todoState.inProgress}`,
        });
        writeJsonl("quality", {
          event: "todo_write_mismatch",
          policy: "warn_continue",
          total: todoState.total,
          in_progress: todoState.inProgress,
          blocked: todoState.blocked,
          completed: todoState.completed,
        }, { sessionID, agent, tool });
      }
    }
  } else if (NONTRIVIAL_TOOLS.has(tool) && !sessionsWithTodoWrite.has(sessionID) && !sessionsWarnedForMissingTodo.has(sessionID)) {
    sessionsWarnedForMissingTodo.add(sessionID);
    writeLog("quality-contract", "WARN", {
      event: "todo_missing_for_nontrivial",
      sessionID,
      agent,
      tool,
      detail: `No TodoWrite observed before non-trivial tool ${tool}; audit only`,
    });
    writeJsonl("quality", {
      event: "todo_missing_for_nontrivial",
      policy: "warn_continue",
      detail: `No TodoWrite observed before non-trivial tool ${tool}`,
    }, { sessionID, agent, tool });
  } else if (NONTRIVIAL_TOOLS.has(tool) && todoStateBySession.has(sessionID)) {
    const state = todoStateBySession.get(sessionID)!;
    state.actionCountSinceUpdate += 1;
    if (state.blocked > 0 && !sessionsWarnedForBlockedTodo.has(sessionID)) {
      sessionsWarnedForBlockedTodo.add(sessionID);
      writeLog("quality-contract", "WARN", {
        event: "todo_failure_without_recovery",
        sessionID,
        agent,
        detail: `Blocked todo state present but non-trivial tool ${tool} was used without todo recovery update`,
      });
      writeJsonl("quality", {
        event: "todo_failure_without_recovery",
        policy: "warn_continue",
        blocked: state.blocked,
      }, { sessionID, agent, tool });
    }
    if (
      state.total > 0 &&
      state.inProgress === 1 &&
      state.actionCountSinceUpdate >= 3 &&
      !sessionsWarnedForStaleTodo.has(sessionID)
    ) {
      sessionsWarnedForStaleTodo.add(sessionID);
      writeLog("quality-contract", "WARN", {
        event: "todo_stale_after_tools",
        sessionID,
        agent,
        detail: `No TodoWrite update after ${state.actionCountSinceUpdate} non-trivial tool calls`,
      });
      writeJsonl("quality", {
        event: "todo_stale_after_tools",
        policy: "warn_continue",
        actions_since_update: state.actionCountSinceUpdate,
      }, { sessionID, agent, tool });
    }
  }

  if (tool.startsWith("context7") || tool === "webfetch" || tool === "websearch") {
    writeJsonl("quality", {
      event: "knowledge_freshness_evidence_observed",
      source: tool,
    }, { sessionID, agent, tool });
  }

  // Delegate to existing handlers for quality logging
  for (const handler of ["format", "tdd"]) {
    try {
      const mod = require("./" + handler);
      if (mod && mod.handle) await mod.handle(input, output);
    } catch {}
  }
}
