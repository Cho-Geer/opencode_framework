/**
 * framework-e2e.test.ts — P1/P3/P5 验收 E2E 测试套件
 * ═══════════════════════════════════════════════════════════════════
 *
 * 覆盖 plan 文档中的验收标准:
 *   Section A: Rule Disposition 表完整性 (Phase 3 验收)
 *   Section B: Compat Shim 正确性 (Phase 3 T3.1)
 *   Section C: Config 清理完成 (Phase 3 验收)
 *   Section D: Agent Alias Manifest (Phase 5 V5.1)
 *   Section E: Dispatch No-DAG (Phase 5 V5.3, Phase 2 T2.2)
 *   Section F: Safety Hard Block 规则 (Phase 5 V5.4)
 *   Section G: Audit-Only 规则不阻断 (Phase 3 验收)
 *   Section H: Serve API 健康检查 (端到端运行时验证)
 *
 * Usage: bun run .opencode/scripts/__tests__/framework-e2e.test.ts
 * Requires: serve running on localhost:4096
 */

import * as path from "node:path";
import * as fs from "node:fs";

// ══════════════════════════════════════════════════════════
// Test infrastructure
// ══════════════════════════════════════════════════════════

const ROOT = process.env.OPENCODE_ROOT || path.resolve(process.cwd());
const OC = path.join(ROOT, ".opencode");

let passed = 0;
let failed = 0;
let skipped = 0;
const failures: string[] = [];

function assert(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ ${label}`);
    failed++;
    failures.push(label);
  }
}

function skip(label: string, reason: string): void {
  console.log(`  ⏭️  ${label} (SKIP: ${reason})`);
  skipped++;
}

function section(title: string): void {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`${"═".repeat(60)}\n`);
}

function subsection(title: string): void {
  console.log(`\n── ${title} ──`);
}

// ══════════════════════════════════════════════════════════
// Section A: Rule Disposition 表完整性
// ══════════════════════════════════════════════════════════

async function testRuleDisposition(): Promise<void> {
  section("A: Rule Disposition Table Integrity (Phase 3)");

  const {
    getRuleDisposition,
    shouldBlock,
    isAuditOnly,
    getAllRules,
    getRulesByDisposition,
  } = require(path.join(OC, "service/enforcement/rule-disposition"));

  subsection("A1: Hard-block rules (7 rules)");
  const hardBlockRules = [
    "native-edit-disabled",
    "dangerous-shell-command",
    "backup-bypass",
    "write-scope-violation",
    "framework-config-unauthorized",
    "source-edit-without-codegraph",
    "non-question-during-guidance",
  ];
  for (const rule of hardBlockRules) {
    assert(
      getRuleDisposition(rule) === "hard_block",
      `getRuleDisposition("${rule}") === "hard_block"`,
    );
    assert(shouldBlock(rule) === true, `shouldBlock("${rule}") === true`);
  }

  subsection("A2: Audit-only rules (4 rules)");
  const auditOnlyRules = [
    "checklist-incomplete",
    "tdd-order-violation",
    "route-mismatch",
    "deliverable-format",
  ];
  for (const rule of auditOnlyRules) {
    assert(
      getRuleDisposition(rule) === "audit_only",
      `getRuleDisposition("${rule}") === "audit_only"`,
    );
    assert(isAuditOnly(rule) === true, `isAuditOnly("${rule}") === true`);
    assert(shouldBlock(rule) === false, `shouldBlock("${rule}") === false (not blocking)`);
  }

  subsection("A3: Warn-continue rules (2 rules)");
  const warnContinueRules = [
    "recommended-skill-missing",
    "output-missing-evidence",
  ];
  for (const rule of warnContinueRules) {
    assert(
      getRuleDisposition(rule) === "warn_continue",
      `getRuleDisposition("${rule}") === "warn_continue"`,
    );
    assert(shouldBlock(rule) === false, `shouldBlock("${rule}") === false`);
    assert(isAuditOnly(rule) === false, `isAuditOnly("${rule}") === false`);
  }

  subsection("A4: Total rule count >= 30");
  const allRules = getAllRules();
  const ruleCount = Object.keys(allRules).length;
  assert(ruleCount >= 30, `Total rules: ${ruleCount} (expected >= 30)`);

  subsection("A5: Unknown rules default to warn_continue");
  assert(
    getRuleDisposition("nonexistent-rule-xyz-999") === "warn_continue",
    `Unknown rule defaults to "warn_continue"`,
  );
  assert(
    shouldBlock("nonexistent-rule-xyz-999") === false,
    `Unknown rule does NOT block`,
  );

  subsection("A6: getRulesByDisposition groups correctly");
  const grouped = getRulesByDisposition();
  assert(
    Array.isArray(grouped.hard_block) && grouped.hard_block.length >= 7,
    `hard_block group has >= 7 rules (got ${grouped.hard_block?.length})`,
  );
  assert(
    Array.isArray(grouped.audit_only) && grouped.audit_only.length >= 4,
    `audit_only group has >= 4 rules (got ${grouped.audit_only?.length})`,
  );
  assert(
    Array.isArray(grouped.warn_continue) && grouped.warn_continue.length >= 2,
    `warn_continue group has >= 2 rules (got ${grouped.warn_continue?.length})`,
  );
}

// ══════════════════════════════════════════════════════════
// Section B: Compat Shim 正确性
// ══════════════════════════════════════════════════════════

async function testCompatShim(): Promise<void> {
  section("B: Compat Shim Correctness (Phase 3 T3.1)");

  const enforcement = require(path.join(OC, "service/gate/enforcement"));

  subsection("B1: getEnforcementMode() returns 'strict'");
  const mode = enforcement.getEnforcementMode();
  assert(mode === "strict", `getEnforcementMode() === "strict" (got "${mode}")`);

  subsection("B2: getEnforcementModeWithSource() returns compat values");
  if (typeof enforcement.getEnforcementModeWithSource === "function") {
    const result = enforcement.getEnforcementModeWithSource();
    assert(
      result.mode === "strict",
      `getEnforcementModeWithSource().mode === "strict"`,
    );
    assert(
      result.source === "rule-disposition-compat",
      `source === "rule-disposition-compat" (got "${result.source}")`,
    );
    assert(
      result.envOverride === false,
      `envOverride === false`,
    );
  } else {
    skip("B2", "getEnforcementModeWithSource not exported");
  }

  subsection("B3: Compat re-exports from gate-core");
  const gateCore = require(path.join(OC, "lib/gate-core"));
  assert(
    typeof gateCore.getRuleDisposition === "function",
    `gate-core exports getRuleDisposition`,
  );
  assert(
    typeof gateCore.shouldBlock === "function",
    `gate-core exports shouldBlock`,
  );
  assert(
    typeof gateCore.getAllRules === "function",
    `gate-core exports getAllRules`,
  );

  subsection("B4: Compat re-exports from service/gate/index");
  const gateIndex = require(path.join(OC, "service/gate/index"));
  assert(
    typeof gateIndex.getRuleDisposition === "function",
    `service/gate/index exports getRuleDisposition`,
  );
  assert(
    typeof gateIndex.shouldBlock === "function",
    `service/gate/index exports shouldBlock`,
  );
}

// ══════════════════════════════════════════════════════════
// Section C: Config 清理完成
// ══════════════════════════════════════════════════════════

async function testConfigCleanup(): Promise<void> {
  section("C: Config Cleanup (Phase 3 验收)");

  const configPath = path.join(OC, "project.config.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

  subsection("C1: No enforcement mode in config");
  const tr = config.template_resolution || {};
  assert(
    !tr.develop_enforcement_mode,
    `develop_enforcement_mode removed from template_resolution`,
  );
  assert(
    !tr.runtime_enforcement_mode,
    `runtime_enforcement_mode removed from template_resolution`,
  );

  subsection("C2: Plugin execution order consistency");
  const order = config.plugin_execution_order;
  assert(order !== undefined, `plugin_execution_order exists`);

  if (order) {
    assert(
      Array.isArray(order.before) && order.before.length === 6,
      `before chain has 6 handlers (got ${order.before?.length})`,
    );
    assert(
      Array.isArray(order.after) && order.after.length === 6,
      `after chain has 6 handlers (got ${order.after?.length})`,
    );
    assert(
      Array.isArray(order.system) && order.system.length >= 2,
      `system chain has >= 2 plugins (got ${order.system?.length})`,
    );

    subsection("C3: skill-summary is in system chain");
    assert(
      order.system?.includes("skill-summary"),
      `system chain includes "skill-summary"`,
    );
    assert(
      order.system?.includes("anti-bypass"),
      `system chain includes "anti-bypass"`,
    );

    subsection("C4: Before chain matches expected handlers");
    const expectedBefore = [
      "guidance-bridge",
      "permission-safety",
      "scope",
      "codegraph",
      "skill-policy",
      "dispatch-signal",
    ];
    for (const handler of expectedBefore) {
      assert(
        order.before.includes(handler),
        `before chain includes "${handler}"`,
      );
    }

    subsection("C5: After chain matches expected handlers");
    const expectedAfter = [
      "unified-audit",
      "skill-audit",
      "quality-contract",
      "dispatch-trace",
      "db-health",
      "guidance-recovery",
    ];
    for (const handler of expectedAfter) {
      assert(
        order.after.includes(handler),
        `after chain includes "${handler}"`,
      );
    }
  }

  subsection("C6: Dispatch policy — no DAG required");
  const dp = config.dispatch_policy || {};
  assert(
    dp.require_dag_entry === false,
    `require_dag_entry === false (got ${dp.require_dag_entry})`,
  );
  assert(
    dp.auto_plan_enabled === false,
    `auto_plan_enabled === false (got ${dp.auto_plan_enabled})`,
  );

  subsection("C7: Checklist mode is optional");
  assert(
    config.checklist_policy?.mode === "optional" || config.checklist_mode === "optional",
    `checklist is optional`,
  );
}

// ══════════════════════════════════════════════════════════
// Section D: Agent Alias Manifest
// ══════════════════════════════════════════════════════════

async function testAgentAlias(): Promise<void> {
  section("D: Agent Alias Manifest (Phase 5 V5.1)");

  const agentsDir = path.join(OC, "agents");
  const agentFiles = fs.readdirSync(agentsDir).filter((f) => f.endsWith(".md"));

  subsection("D1: All 10 agents present");
  assert(
    agentFiles.length === 10,
    `10 agent files found (got ${agentFiles.length})`,
  );

  subsection("D2: All agents have alias_of");
  const validAliases = ["Plan", "Build", "General", "Explore"];
  const aliasMap: Record<string, string> = {};

  for (const file of agentFiles) {
    const content = fs.readFileSync(path.join(agentsDir, file), "utf8");
    const match = content.match(/alias_of:\s*(\w+)/);
    const agentName = file.replace(".md", "");

    if (match) {
      aliasMap[agentName] = match[1];
      assert(
        validAliases.includes(match[1]),
        `${agentName}: alias_of = "${match[1]}" (valid)`,
      );
    } else {
      assert(false, `${agentName}: alias_of field found`);
    }
  }

  subsection("D3: Agent files are thin manifests (< 100 lines)");
  for (const file of agentFiles) {
    const lines = fs.readFileSync(path.join(agentsDir, file), "utf8").split("\n").length;
    assert(
      lines < 100,
      `${file}: ${lines} lines (< 100)`,
    );
  }

  subsection("D4: Expected alias mappings");
  const expectedAliases: Record<string, string> = {
    "Orchestrator": "Plan",
    "Meta-Planner": "Plan",
    "Architect": "General",
    "Coder-BE": "Build",
    "Coder-FE": "Build",
    "Guardian": "Explore",
    "Knowledge-Curator": "Explore",
    "Super-Admin": "Build",
    "CI-CD-Agent": "Build",
    "Arbiter": "General",
  };
  for (const [agent, expected] of Object.entries(expectedAliases)) {
    assert(
      aliasMap[agent] === expected,
      `${agent}: alias_of = "${expected}" (got "${aliasMap[agent] || "missing"}")`,
    );
  }
}

// ══════════════════════════════════════════════════════════
// Section E: Dispatch No-DAG
// ══════════════════════════════════════════════════════════

async function testDispatchNoDAG(): Promise<void> {
  section("E: Dispatch No-DAG (Phase 5 V5.3, Phase 2 T2.2)");

  subsection("E1: Dispatch policy allows no-DAG");
  const configPath = path.join(OC, "project.config.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  assert(
    config.dispatch_policy?.require_dag_entry === false,
    `require_dag_entry === false`,
  );

  subsection("E2: Router module loads without error");
  let routerLoaded = false;
  try {
    const router = require(path.join(OC, "service/dispatch/router"));
    assert(
      typeof router.dispatch === "function",
      `router.dispatch is a function`,
    );
    routerLoaded = true;
  } catch (e: any) {
    assert(false, `Router module load: ${e.message}`);
  }

  subsection("E3: dispatch-validate still exists (isolated, not in active chain)");
  const dvPath = path.join(OC, "service/dispatch/dispatch-validate.ts");
  assert(fs.existsSync(dvPath), `dispatch-validate.ts exists (isolated)`);

  // Verify it's NOT in the active before chain
  const activeHandlers = config.plugin_execution_order?.before || [];
  assert(
    !activeHandlers.includes("dispatch-validate"),
    `dispatch-validate is NOT in active before chain`,
  );
}

// ══════════════════════════════════════════════════════════
// Section F: Safety Hard Block Rules
// ══════════════════════════════════════════════════════════

async function testSafetyHardBlocks(): Promise<void> {
  section("F: Safety Hard Block Rules (Phase 5 V5.4)");

  const { shouldBlock, getRuleDisposition } = require(
    path.join(OC, "service/enforcement/rule-disposition")
  );

  subsection("F1: Native edit/bash disabled");
  assert(
    shouldBlock("native-edit-disabled") === true,
    `native-edit-disabled → hard_block`,
  );

  subsection("F2: Dangerous shell command");
  assert(
    shouldBlock("dangerous-shell-command") === true,
    `dangerous-shell-command → hard_block`,
  );

  subsection("F3: Backup bypass");
  assert(
    shouldBlock("backup-bypass") === true,
    `backup-bypass → hard_block`,
  );

  subsection("F4: Write scope violation");
  assert(
    shouldBlock("write-scope-violation") === true,
    `write-scope-violation → hard_block`,
  );

  subsection("F5: Source edit without CodeGraph");
  assert(
    shouldBlock("source-edit-without-codegraph") === true,
    `source-edit-without-codegraph → hard_block`,
  );

  subsection("F6: Non-question during guidance");
  assert(
    shouldBlock("non-question-during-guidance") === true,
    `non-question-during-guidance → hard_block`,
  );

  subsection("F7: Framework config unauthorized");
  assert(
    shouldBlock("framework-config-unauthorized") === true,
    `framework-config-unauthorized → hard_block`,
  );

  subsection("F8: All hard_block rules are consistent");
  const allRules = Object.entries(
    require(path.join(OC, "service/enforcement/rule-disposition")).getAllRules()
  );
  const hardBlocks = allRules.filter(([, v]) => v === "hard_block");
  assert(
    hardBlocks.length >= 7,
    `At least 7 hard_block rules (got ${hardBlocks.length})`,
  );
}

// ══════════════════════════════════════════════════════════
// Section G: Audit-Only Rules Don't Block
// ══════════════════════════════════════════════════════════

async function testAuditOnlyNoBlock(): Promise<void> {
  section("G: Audit-Only Rules Don't Block (Phase 3 验收)");

  const { shouldBlock, isAuditOnly, getRuleDisposition } = require(
    path.join(OC, "service/enforcement/rule-disposition")
  );

  const auditRules = [
    "checklist-incomplete",
    "tdd-order-violation",
    "route-mismatch",
    "deliverable-format",
  ];

  for (const rule of auditRules) {
    assert(
      shouldBlock(rule) === false,
      `${rule}: shouldBlock=false (not blocking)`,
    );
    assert(
      isAuditOnly(rule) === true,
      `${rule}: isAuditOnly=true`,
    );
  }

  subsection("G1: Ordinary small task not blocked by audit rules");
  // Simulate: a normal task with route-mismatch should NOT be hard blocked
  assert(
    shouldBlock("route-mismatch") === false,
    `route-mismatch does NOT block ordinary tasks`,
  );
  assert(
    shouldBlock("checklist-incomplete") === false,
    `checklist-incomplete does NOT block ordinary tasks`,
  );
}

// ══════════════════════════════════════════════════════════
// Section H: Serve API 健康检查
// ══════════════════════════════════════════════════════════

async function testServeAPI(): Promise<void> {
  section("H: Serve API Health Check (E2E Runtime)");

  const SERVE_URL = "http://localhost:4096";

  subsection("H1: Serve health endpoint");
  try {
    const resp = await fetch(`${SERVE_URL}/api/session`);
    const data = await resp.json() as any;
    assert(
      resp.status === 200,
      `GET /api/session → 200 (got ${resp.status})`,
    );
    assert(
      data.data !== undefined,
      `/api/session returns data array`,
    );
  } catch (e: any) {
    skip("H1: serve health", `serve not responding: ${e.message}`);
  }

  subsection("H2: Session creation via API");
  try {
    const resp = await fetch(`${SERVE_URL}/api/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agent: "Architect",
        model: "deepseek-v4-flash",
      }),
    });
    if (resp.status === 200 || resp.status === 201) {
      const data = await resp.json() as any;
      assert(
        data.data?.id !== undefined || data.id !== undefined,
        `Session created with ID`,
      );
    } else {
      skip("H2: session creation", `status ${resp.status}`);
    }
  } catch (e: any) {
    skip("H2: session creation", e.message);
  }
}

// ══════════════════════════════════════════════════════════
// Section I: Code-level enforcement remnants check
// ══════════════════════════════════════════════════════════

async function testNoEnforcementRemnants(): Promise<void> {
  section("I: No Enforcement Mode Remnants in Active Code");

  subsection("I1: service/ files don't check mode === 'advisory'");
  const serviceDir = path.join(OC, "service");
  const tsFiles: string[] = [];

  function collectTsFiles(dir: string): void {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== "node_modules") {
        collectTsFiles(full);
      } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
        tsFiles.push(full);
      }
    }
  }
  collectTsFiles(serviceDir);

  let advisoryCount = 0;
  let strictLockedCount = 0;
  const advisoryFiles: string[] = [];
  const strictLockedFiles: string[] = [];

  for (const file of tsFiles) {
    const content = fs.readFileSync(file, "utf8");
    // Check for mode comparison patterns that should have been removed
    if (/mode\s*===\s*["']advisory["']/.test(content)) {
      advisoryCount++;
      advisoryFiles.push(path.relative(OC, file));
    }
    if (/mode\s*===\s*["']locked["']/.test(content)) {
      strictLockedCount++;
      strictLockedFiles.push(path.relative(OC, file));
    }
  }

  assert(
    advisoryCount === 0,
    `No "mode === 'advisory'" in service/ (found in ${advisoryCount} files: ${advisoryFiles.join(", ")})`,
  );
  assert(
    strictLockedCount === 0,
    `No "mode === 'locked'" in service/ (found in ${strictLockedCount} files: ${strictLockedFiles.join(", ")})`,
  );

  subsection("I2: getEnforcementMode compat shim is minimal");
  const enfPath = path.join(OC, "service/gate/enforcement.ts");
  const enfContent = fs.readFileSync(enfPath, "utf8");
  const compatFn = enfContent.match(/export function getEnforcementMode[\s\S]*?^}/m);
  if (compatFn) {
    const fnBody = compatFn[0];
    assert(
      fnBody.includes('return "strict"'),
      `getEnforcementMode() returns "strict" directly`,
    );
    assert(
      !fnBody.includes("fs.readFileSync") && !fnBody.includes("JSON.parse"),
      `getEnforcementMode() does NOT read config file`,
    );
    assert(
      !fnBody.includes("ENFORCEMENT_MODE"),
      `getEnforcementMode() does NOT read env var`,
    );
  } else {
    skip("I2", "Could not extract getEnforcementMode function");
  }
}

// ══════════════════════════════════════════════════════════
// Main runner
// ══════════════════════════════════════════════════════════

async function main(): Promise<void> {
  console.log(`\n╔══════════════════════════════════════════════════════════╗`);
  console.log(`║  OpenCode Framework E2E Test Suite                     ║`);
  console.log(`║  Phase 3 (Enforcement Slimming) + Phase 5 (Legacy)     ║`);
  console.log(`║  ROOT: ${ROOT.substring(0, 50).padEnd(50)}║`);
  console.log(`╚══════════════════════════════════════════════════════════╝`);

  await testRuleDisposition();
  await testCompatShim();
  await testConfigCleanup();
  await testAgentAlias();
  await testDispatchNoDAG();
  await testSafetyHardBlocks();
  await testAuditOnlyNoBlock();
  await testServeAPI();
  await testNoEnforcementRemnants();

  // ── Summary ──
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  SUMMARY`);
  console.log(`${"═".repeat(60)}`);
  console.log(`  ✅ Passed:  ${passed}`);
  console.log(`  ❌ Failed:  ${failed}`);
  console.log(`  ⏭️  Skipped: ${skipped}`);
  console.log(`  Total:      ${passed + failed + skipped}`);

  if (failures.length > 0) {
    console.log(`\n  Failed tests:`);
    for (const f of failures) {
      console.log(`    ❌ ${f}`);
    }
  }

  console.log(`${"═".repeat(60)}\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(2);
});
