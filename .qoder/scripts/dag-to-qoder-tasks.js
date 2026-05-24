#!/usr/bin/env node
"use strict";

/**
 * dag-to-qoder-tasks.js — Bridge Task.DAG.json to Qoder's native task board
 * ===========================================================================
 * Reads Task.DAG.json from project root and outputs tasks in a format
 * suitable for Qoder's TaskCreate or create_plan tools.
 *
 * Usage:
 *   node .qoder/scripts/dag-to-qoder-tasks.js                        # pending tasks, JSON output
 *   node .qoder/scripts/dag-to-qoder-tasks.js --status pending       # pending tasks only (default)
 *   node .qoder/scripts/dag-to-qoder-tasks.js --status all           # all tasks regardless of status
 *   node .qoder/scripts/dag-to-qoder-tasks.js --output json          # JSON array for TaskCreate (default)
 *   node .qoder/scripts/dag-to-qoder-tasks.js --output markdown      # Markdown for create_plan tool
 *   node .qoder/scripts/dag-to-qoder-tasks.js --status all --output markdown
 *
 * Exit codes:
 *   0 — success
 *   1 — Task.DAG.json not found or malformed
 */

const fs = require("fs");
const path = require("path");

// ──────────────────────────────────────────────
// Path resolution
// ──────────────────────────────────────────────
const PROJECT_ROOT =
  process.env.OPENCODE_ROOT || path.resolve(__dirname, "..", "..");
const DAG_PATH = path.join(PROJECT_ROOT, "Task.DAG.json");

// ──────────────────────────────────────────────
// CLI argument parsing (no external deps)
// ──────────────────────────────────────────────
function parseArgs(argv) {
  const args = { status: "pending", output: "json" };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--status" && argv[i + 1]) {
      const val = argv[i + 1].toLowerCase();
      if (val === "pending" || val === "all") {
        args.status = val;
      } else {
        console.error(
          `[dag-to-qoder-tasks] Invalid --status value: "${argv[i + 1]}". Use "pending" or "all".`
        );
        process.exit(1);
      }
      i++;
    } else if (argv[i] === "--output" && argv[i + 1]) {
      const val = argv[i + 1].toLowerCase();
      if (val === "json" || val === "markdown") {
        args.output = val;
      } else {
        console.error(
          `[dag-to-qoder-tasks] Invalid --output value: "${argv[i + 1]}". Use "json" or "markdown".`
        );
        process.exit(1);
      }
      i++;
    } else if (argv[i] === "--help" || argv[i] === "-h") {
      printUsage();
      process.exit(0);
    }
  }
  return args;
}

function printUsage() {
  console.log(`
Usage: node .qoder/scripts/dag-to-qoder-tasks.js [options]

Options:
  --status <pending|all>     Filter tasks by status (default: pending)
  --output <json|markdown>   Output format (default: json)
  --help, -h                 Show this help message

Examples:
  node .qoder/scripts/dag-to-qoder-tasks.js --status all --output markdown
  node .qoder/scripts/dag-to-qoder-tasks.js --output json
`);
}

// ──────────────────────────────────────────────
// DAG loading and validation
// ──────────────────────────────────────────────
function loadDAG() {
  if (!fs.existsSync(DAG_PATH)) {
    console.error(
      `[dag-to-qoder-tasks] ERROR: Task.DAG.json not found at: ${DAG_PATH}`
    );
    console.error(
      `  Ensure Task.DAG.json exists at the project root.`
    );
    console.error(
      `  Current PROJECT_ROOT: ${PROJECT_ROOT}`
    );
    process.exit(1);
  }

  let raw;
  try {
    raw = fs.readFileSync(DAG_PATH, "utf-8");
  } catch (err) {
    console.error(
      `[dag-to-qoder-tasks] ERROR: Failed to read Task.DAG.json: ${err.message}`
    );
    process.exit(1);
  }

  let dag;
  try {
    dag = JSON.parse(raw);
  } catch (err) {
    console.error(
      `[dag-to-qoder-tasks] ERROR: Task.DAG.json is not valid JSON: ${err.message}`
    );
    process.exit(1);
  }

  if (!dag.tasks || !Array.isArray(dag.tasks)) {
    console.error(
      `[dag-to-qoder-tasks] ERROR: Task.DAG.json does not contain a valid "tasks" array.`
    );
    console.error(
      `  Found top-level keys: ${Object.keys(dag).join(", ")}`
    );
    process.exit(1);
  }

  return dag;
}

// ──────────────────────────────────────────────
// Task filtering
// ──────────────────────────────────────────────
function filterTasks(tasks, statusFilter) {
  if (statusFilter === "all") {
    return tasks;
  }
  // "pending" filter: include tasks with status "pending", "in_progress", or any non-completed status
  return tasks.filter(
    (t) => t.status !== "completed" && t.status !== "done"
  );
}

// ──────────────────────────────────────────────
// Build description from DAG task fields
// ──────────────────────────────────────────────
function buildDescription(task) {
  const parts = [];

  if (task.owner) {
    parts.push(`**Owner**: ${task.owner}`);
  }
  if (task.priority) {
    parts.push(`**Priority**: ${task.priority}`);
  }
  if (task.estimated_effort) {
    parts.push(`**Effort**: ${task.estimated_effort}`);
  }
  if (task.requirement_source) {
    parts.push(`**Requirement**: ${task.requirement_source}`);
  }
  if (task.contract_reference) {
    parts.push(`**Contract**: ${task.contract_reference}`);
  }
  if (task.tdd_phase) {
    parts.push(`**TDD Phase**: ${task.tdd_phase}`);
  }
  if (task.tech_debt_id) {
    parts.push(`**Tech Debt**: ${task.tech_debt_id}`);
  }
  if (task.deadline) {
    parts.push(`**Deadline**: ${task.deadline}`);
  }
  if (task.target_files && task.target_files.length > 0) {
    parts.push(`**Target files**:\n${task.target_files.map((f) => `  - ${f}`).join("\n")}`);
  }
  if (task.acceptance_criteria && task.acceptance_criteria.length > 0) {
    parts.push(
      `**Acceptance criteria**:\n${task.acceptance_criteria.map((c) => `  - ${c}`).join("\n")}`
    );
  }

  return parts.join("\n");
}

// ──────────────────────────────────────────────
// Output: JSON format (for Qoder TaskCreate)
// ──────────────────────────────────────────────
function outputJSON(tasks) {
  const output = tasks.map((task) => ({
    subject: task.title,
    description: buildDescription(task),
    blockedBy: task.dependencies || [],
    dagTaskId: task.id,
    status: task.status,
    owner: task.owner || null,
    priority: task.priority || null,
  }));

  console.log(JSON.stringify(output, null, 2));
}

// ──────────────────────────────────────────────
// Output: Markdown format (for create_plan tool)
// ──────────────────────────────────────────────
function outputMarkdown(tasks, dag) {
  const lines = [];

  lines.push(`# Task.DAG.json → Qoder Task Board`);
  lines.push(`**Project**: ${dag.project || "unknown"}`);
  lines.push(`**DAG Version**: ${dag.version || "unknown"}`);
  lines.push(`**Total tasks shown**: ${tasks.length}`);
  lines.push("");
  lines.push("---");
  lines.push("");

  for (const task of tasks) {
    lines.push(`## Task ${task.id}: ${task.title}`);
    lines.push(`**Status**: ${task.status}`);

    if (task.owner) {
      lines.push(`**Owner**: ${task.owner}`);
    }
    if (task.priority) {
      lines.push(`**Priority**: ${task.priority}`);
    }
    if (task.estimated_effort) {
      lines.push(`**Effort**: ${task.estimated_effort}`);
    }
    if (task.dependencies && task.dependencies.length > 0) {
      lines.push(`**Blocked by**: ${task.dependencies.join(", ")}`);
    }
    if (task.requirement_source) {
      lines.push(`**Requirement source**: ${task.requirement_source}`);
    }
    if (task.contract_reference) {
      lines.push(`**Contract reference**: ${task.contract_reference}`);
    }
    if (task.tdd_phase) {
      lines.push(`**TDD Phase**: ${task.tdd_phase}`);
    }
    if (task.tech_debt_id) {
      lines.push(`**Tech Debt ID**: ${task.tech_debt_id}`);
    }
    if (task.deadline) {
      lines.push(`**Deadline**: ${task.deadline}`);
    }
    if (task.target_files && task.target_files.length > 0) {
      lines.push(`**Target files**:`);
      for (const f of task.target_files) {
        lines.push(`  - ${f}`);
      }
    }
    if (task.acceptance_criteria && task.acceptance_criteria.length > 0) {
      lines.push(`**Acceptance criteria**:`);
      for (const c of task.acceptance_criteria) {
        lines.push(`  - ${c}`);
      }
    }

    lines.push("");
    lines.push("---");
    lines.push("");
  }

  console.log(lines.join("\n"));
}

// ──────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────
function main() {
  const args = parseArgs(process.argv);
  const dag = loadDAG();
  const filtered = filterTasks(dag.tasks, args.status);

  if (filtered.length === 0) {
    if (args.output === "json") {
      console.log("[]");
    } else {
      console.log(
        `# Task.DAG.json → Qoder Task Board\n\nNo tasks match filter --status=${args.status}.\nAll ${dag.tasks.length} tasks are completed.`
      );
    }
    return;
  }

  if (args.output === "json") {
    outputJSON(filtered);
  } else {
    outputMarkdown(filtered, dag);
  }
}

main();
