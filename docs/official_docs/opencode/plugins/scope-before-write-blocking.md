# OpenCode Plugin Enforcement: scope-before Write Blocking & R4 CONFIG-READ-ATTEST

**Date**: 2026-06-19
**Domain**: opencode_framework
**Library**: opencode-framework
**Sources**: Source code analysis (scope-before.ts, scope-after.ts, tool-scope.ts, uc7ks-utils.ts, gate-before.ts) + Official OpenCode docs (opencode.ai/docs/plugins, opencode.ai/docs/permissions) + Framework design docs (framework-enforcer-module-inventory.md)

---

## 1. Overview

The OpenCode multi-agent governance system uses **15 plugin modules** in a before/after hook architecture to enforce write scope, compliance gates, TDD, UC7KS knowledge pipeline, and dispatch lifecycle rules. These plugins hook into `tool.execute.before` and `tool.execute.after` events.

### Plugin Architecture (v2 Flat Design)

```
.opencode/plugins/                          .opencode/lib/
────────────────────────                    ────────────────

"tool.execute.before"       (6 plugins)    shared-infra.ts       demoLog, getDemoLogPath
scope-before.ts             写权限检查
uc7ks-before.ts             知识管道合规    agent-resolver.ts     resolveAgent, resolveTaskId
dispatch-before.ts          消费 pending                          resolveAgentFromSessionMap
gate-before.ts              门禁检查                              getSessionMapPath
audit-before.ts             写入审计
tdd-before.ts               TDD强制执行     tool-scope.ts         isModifyTool, getModifyPath, 
                                                                  getEffectivePathScopePaths,
"tool.execute.after"        (8 plugins)                           parseShellWriteTargets,
scope-after.ts              状态同步                               readDispatchAllowedTools,
uc7ks-after.ts              文档合规                               isToolAllowed
dispatch-after.ts           清理残留
gate-after.ts               过期门禁        uc7ks-utils.ts        checkUC7KS, checkUC7KSWrite,
audit-after.ts              审计日志                               checkUC7KSFileLevelDomain,
tdd-after.ts                TDD后验证                              buildBlockMessage
task-after.ts               失败记录
cache-after.ts              缓存同步        write-audit-lib.ts    executeWriteAuditCheck

"chat.message"              (1 plugin)     gate-core.ts           getEnforcementMode,
session.ts                  会话管理                               findArmedSession, computeSHA256

                                           gate-checks.ts         findTaskInDag, isWriteAllowed,
                                                                  checkStaleSessions

                                           route-validator.ts     readRouteConfig,
                                                                  findRouteAgentForFile,
                                                                  validateDagTaskAgentAssignment

                                           substate-manager.ts    readSubState, writeSubState
```

---

## 2. scope-before.ts — Write Scope Enforcement (Primary Plugin)

**File**: `.opencode/plugins/scope-before.ts`
**Hook**: `tool.execute.before`
**Purpose**: Gate all modify tool writes through 5 sequential enforcement checks.

### Enforcement Pipeline (executed for each target path)

```
Enter scope-before.ts
  │
  ├─ 1. Skip non-modify tools (read, glob, grep, etc.)
  │
  ├─ 2. Agent Dispatch Tool Check (readDispatchAllowedTools + isToolAllowed)
  │    • Checks if agent is allowed to use this tool per project.config.json
  │    • BLOCKED error: [FW-ENFORCE] Agent "X" not allowed to use tool "Y"
  │
  ├─ 3. Multi-Path Scope Resolution (getEffectivePathScopePaths)
  │    • Parses shell commands to extract write targets (cp/mv/rm/tee/sed/touch/dd)
  │    • Unparseable modify shell → BLOCKED in strict/locked mode
  │    • Error: [FW-ENFORCE][UC7-001] safe_shell write command unparseable
  │
  ├─ 4. For Each Target Path:
  │    │
  │    ├─ P0-3 ROUTE-MISMATCH (Agent ↔ File Scope)
  │    │   • Checks route_validation.scope_to_agent rules in project.config.json
  │    │   • Verifies the agent has authority to modify the target file
  │    │   • Error: [FW-ENFORCE][ROUTE-MISMATCH]
  │    │
  │    ├─ P1-2 UC7-008 (Knowledge-Curator Scope Isolation)
  │    │   • KC can only write to: docs/official_docs/**, .metadata/**, .task_temp/**
  │    │   • Error: [FW-ENFORCE][UC7-008]
  │    │
  │    ├─ P0-5 Write PATH Scope Check (isWriteAllowed)
  │    │   • Reads opencode.json permission.safe_edit rules for the agent
  │    │   • Error: [FW-ENFORCE][WRITE-SCOPE]
  │    │
  │    ├─ ═══ R4 (2026-06-19): CONFIG-READ-ATTEST ═══
  │    │   • Checks readSubState("config_read_state")
  │    │   • Verifies session_id matches current session
  │    │   • In strict/locked: BLOCKS writes if Step 0e not completed
  │    │   • Error: [FW-ENFORCE][CONFIG-READ-ATTEST]
  │    │
  │    ├─ P1-1 UC7-001 (Knowledge Cache Search Before Write)
  │    │   • If isUC7KSWriteTarget(file): calls checkUC7KSWrite()
  │    │   • Verifies per-domain cache attestation (dual-state discovery + attestation)
  │    │   • Error: [FW-ENFORCE][UC7-001]
  │    │
  │    └─ P1-4 UC7-005 (Knowledge Cache Size Cap)
  │        • Files in docs/official_docs/ must not exceed 500KB
  │        • Error: [FW-ENFORCE][UC7-005]
  │
  └─ Pass: exit (ok)
```

---

## 3. R4 CONFIG-READ-ATTEST Feature (2026-06-19)

**Location**: `scope-before.ts` lines 185–242
**Purpose**: Block writes until an agent completes P0 Step 0e (read 3 config files + call `config_read_attest()`)

### How It Works

```typescript
// Step 1: Read the sub-state
const configReadState = readSubState("config_read_state");

// Step 2: If config_read_state exists, verify session match
if (configReadState && configReadState.session_id) {
  if (configReadState.session_id !== input.sessionID) {
    // BLOCKED: wrong session — agent needs to re-attest
    throw new Error("[FW-ENFORCE][CONFIG-READ-ATTEST] ...");
  }
  // PASS: session matches
} else {
  // No config_read_state yet
  if (mode === "strict" || mode === "locked") {
    // BLOCKED: must complete Step 0e first
    throw new Error("[FW-ENFORCE][CONFIG-READ-ATTEST] ...");
  }
  // advisory: warn but allow (backward compatible)
}
```

### Required P0 Step 0e Flow

```
Step 0e-1: Read agent config file (.opencode/agents/{Type}.md)
           → auto-logged to read_audit SQLite by read-track-after.ts
Step 0e-2: Read opencode.json (runtime permissions — authoritative source)
Step 0e-3: Read .opencode/project.config.json (framework policies)
Step 0e-4: Call config_read_attest({ task_id })
           → verifies reads against read_audit DB
           → writes config_read_state sub-state
           → unlocks writes for this session
```

### Enforcement Modes

| Mode | No config_read_state | Wrong session_id | Correct session_id |
|------|---------------------|------------------|-------------------|
| Advisory  | ⚠️ WARN only | ⚠️ WARN only | ✅ PASS |
| Strict    | ❌ BLOCK      | ❌ BLOCK      | ✅ PASS |
| Locked    | ❌ BLOCK      | ❌ BLOCK      | ✅ PASS |

### Backward Compatibility

If no `config_read_state` sub-state entry exists at all (pre-R4 sessions), the check is skipped in advisory mode but blocks in strict/locked mode. This ensures pre-existing sessions are not broken while new sessions must comply.

---

## 4. tool-scope.ts — Path Resolution & UC7KS Write Targets

**File**: `.opencode/lib/tool-scope.ts`

### Key Functions

| Function | Purpose |
|----------|---------|
| `isModifyTool(tool)` | Checks if tool is write/edit/safe_edit/safe_mkdir/safe_delete/safe_shell |
| `getModifyPath(args)` | Extracts filePath/dirPath/command from tool args |
| `isModifyShell(args)` | Checks if shell command is cp/mv/rm/python3/node/bun/npx/tee/cat/sed/dd/sh/bash/touch |
| `getEffectivePathScopePaths(tool, args)` | Returns all target file paths for scope check |
| `parseShellWriteTargets(command)` | Parses shell commands to extract write target paths |
| `isUC7KSWriteTarget(filePath)` | Checks if file triggers UC7-001 write-before-read |
| `isUC7KSExcludedPath(filePath)` | Excludes logs, temp artifacts, node_modules, knowledge cache |
| `readDispatchAllowedTools(agent)` | Reads agent's allowed tools from project.config.json |
| `isToolAllowed(allowedList, tool)` | Checks if tool is in the allowed list |

### Shell Write Target Parsing

| Command | Write Targets | Behavior |
|---------|---------------|----------|
| `sed -i 's/x/y/' file.ts` | `[file.ts]` | Parse last non-option arg as file |
| `cp src dst` | `[dst]` | Last arg is destination |
| `mv src dst` | `[src, dst]` | Both source and destination |
| `rm file1 file2` | `[file1, file2]` | All non-option args |
| `tee file.ts` | `[file.ts]` | Non-option, non-redirect args |
| `touch file.ts` | `[file.ts]` | Non-option args |
| `dd if=a of=file.ts` | `[file.ts]` | Extract `of=` paths |
| `node -e / bun -e` | Unparseable | BLOCKED in strict/locked |
| `echo "x" >> file` | Unparseable | BLOCKED in strict/locked |
| `sh -c / bash -c` | Unparseable | BLOCKED in strict/locked |
| `cat file > dst` | Unparseable | BLOCKED in strict/locked |

### UC7KS Write Target Inclusion/Exclusion

**Include** (triggers UC7-001 write-before-read check):
- Source files: `.ts/.tsx/.js/.jsx/.html/.scss/.prisma`
- Framework files: `.opencode/**` (excl. logs)
- Review/design docs: `docs/review/**`, `docs/design/**`
- Root config: `AGENTS.md`, `contract.yaml`, `opencode.json`

**Exclude** (skipped from UC7-001 write check):
- Logs: `.opencode/logs/**`, `logs/**`
- Temp artifacts: `.task_temp/**`, `task_temp/**`
- node_modules: `node_modules/**`
- Knowledge cache: `docs/official_docs/**` (managed by KC via UC7-008)

---

## 5. uc7ks-utils.ts — UC7KS Pipeline Write-Time Enforcement

**File**: `.opencode/lib/uc7ks-utils.ts`

### Key Functions

| Function | Purpose |
|----------|---------|
| `readCacheIndex()` | Reads `docs/official_docs/index.json` manifest |
| `isLocalCacheAvailable()` | Checks if cache exists and has entries |
| `checkUC7KS(tool, agent, mode)` | Pre-execution: blocks direct external queries for non-KC agents |
| `checkUC7KSWrite(agent, mode, sessionId?, taskId?, domainId?)` | Write-time: blocks writes if cache not attested |
| `checkUC7KSFileLevelDomain(filePath, agent, mode, sessionId?, taskId?)` | M11: blocks writes if file domain != attested domain |
| `buildBlockMessage(title, agent, detail, remediation)` | Formats UC7-001 block error messages |

### checkUC7KSWrite — 3-Path Design

```
Path A: taskId + domainId present AND per-domain data exists
  → Dual-state: discovery (machine-generated) + attestation (agent-submitted)
  → A1: discovery insufficient → BLOCK
  → A2: discovery sufficient but attestation missing/pending → BLOCK in strict/locked
  → A3: discovery + attestation both OK → PASS

Path B: taskId + domainId present BUT per-domain data missing
  → M5: Tolerate if agent has >=1 attested domain in another task
  → Otherwise → BLOCK (agent must call knowledge_cache_search + attest)

Path C: No taskId/domainId (backward compat)
  → M3: Check ALL domains for this agent/task
  → All attested → PASS
  → Any unattested → BLOCK in strict/locked
```

### UC7-001c HARDEN — Three Required Evidence Fields

For valid cache sufficiency declaration:
1. **`reason`** — WHY the cache (in)sufficiency determination
2. **`files_read`** — Array of file paths actually read
3. **`content_summary`** — WHAT was learned from the read files

Missing any field → treated as `"insufficient"`

### M11 — File-Level Domain Check (2026-06-19)

Prevents bypass: "attest domain A, write domain B files". Matches filePath against `knowledge_semantic_map.save_path`. If the file maps to a domain that hasn't been attested → BLOCK.

---

## 6. scope-after.ts — Post-Write State Tracking

**File**: `.opencode/plugins/scope-after.ts`
**Hook**: `tool.execute.after`

### Key Behavior

- Only runs for modify tools with a valid file path
- Updates `machine.json.eslint_state.aggregate.dirty_modules`
- Appends the modified file path to the dirty modules list
- **CRITICAL**: after-hook args are in `input.args` (NOT `output.args` like before-hook)

```
before-hook: args in output.args
  yield* plugin.trigger("tool.execute.before", {tool, sessionID, callID}, {args})

after-hook:  args in input.args
  yield* plugin.trigger("tool.execute.after", {tool, sessionID, callID, args}, output)
```

---

## 7. gate-before.ts — Compliance Gate & DAG Enforcement

**File**: `.opencode/plugins/gate-before.ts`
**Hook**: `tool.execute.before`

### Enforcement Checks

| Check | Description | Block |
|-------|-------------|-------|
| Auto-armed gate | Creates/arms gate on OpenCode startup | ✅ |
| Gate armed check | Requires armed compliance session for modify tools (strict/locked) | ✅ |
| DAG task existence | Verifies task exists in Task.DAG.json (non-exempt agents) | ✅ (if require_dag_entry) |
| DAG task status | Verifies task status is pending/in_progress | ✅ |
| ROUTE-MISMATCH DAG validation | Validates DAG task.agent ←→ target_files routing | ✅ |

### DAG Exempt Agents
- @Meta-Planner (creates DAG)
- @Orchestrator (manages DAG)
- @Super-Admin
- @Knowledge-Curator

---

## 8. withPluginLifecycle — Boilerplate Elimination

**File**: `.opencode/lib/hook-lifecycle.ts`

Standardizes plugin initialization across all 15 plugins:

```typescript
// Before: 6 lines per plugin
ensureLogDir();
writeLog("scope-before", "loaded", { event: "PLUGIN-LOADED", detail: "scope-before.ts" });
updateIndex("scope-before", "PLUGIN-LOADED");
export default (async (_ctx: any) => {
  writeLog("scope-before", "hooks", { event: "HOOK-REGISTERED", detail: "tool.execute.before" });
  return { "tool.execute.before": myHook };
}) as any;

// After: 1 line
export default withPluginLifecycle("scope-before", { "tool.execute.before": myHook });
```

---

## 9. Enforcement Modes

From `project.config.json`:
```json
{
  "template_resolution": {
    "develop_enforcement_mode": "strict",
    "runtime_enforcement_mode": "strict"
  }
}
```

| Mode | scope-before behavior | gate-before behavior | uc7ks behavior |
|------|----------------------|---------------------|-----------------|
| **Advisory** | WARN on violation, never throw | Skip gate check, skip DAG audit | Allow writes even without cache search |
| **Strict** | Throw Error on violation | Require armed gate, enforce DAG | Block writes without cache attestation |
| **Locked** | Throw Error on ALL violations | Same as strict + no waivers | Block ALL external queries via KC |

---

## 10. Key File Paths

| File | Purpose |
|------|---------|
| `.opencode/plugins/scope-before.ts` | Write scope enforcement + R4 CONFIG-READ-ATTEST |
| `.opencode/plugins/scope-after.ts` | Post-write dirty_modules tracking |
| `.opencode/plugins/gate-before.ts` | Gate armed + DAG enforcement |
| `.opencode/plugins/gate-after.ts` | Stale gate session drain |
| `.opencode/plugins/uc7ks-before.ts` | UC7KS pre-execution check |
| `.opencode/plugins/uc7ks-after.ts` | UC7KS post-write cache tracking |
| `.opencode/plugins/audit-before.ts` | Write audit tracking |
| `.opencode/plugins/tdd-before.ts` | TDD per-write enforcement |
| `.opencode/lib/tool-scope.ts` | Path resolution, write target parsing, UC7KS inclusion/exclusion |
| `.opencode/lib/uc7ks-utils.ts` | UC7KS compliance checks (checkUC7KS, checkUC7KSWrite, checkUC7KSFileLevelDomain) |
| `.opencode/lib/gate-core.ts` | Enforcement mode, gate session management |
| `.opencode/lib/gate-checks.ts` | DAG lookup, write allowed, stale session checks |
| `.opencode/lib/agent-resolver.ts` | Agent identity resolution |
| `.opencode/lib/route-validator.ts` | Route scope rules, DAG agent validation |
| `.opencode/lib/state-utils.ts` | STATE_PATHS, isSourceFile, atomicWriteSubState |
| `.opencode/lib/hook-lifecycle.ts` | withPluginLifecycle boilerplate |
| `.opencode/lib/substate-manager.ts` | Sub-state CRUD (config_read_state, etc.) |
| `.opencode/hooks/pre-commit` | Pre-commit hook (4 layers) |
| `.opencode/state/machine.json` | Central state (contracts, tasks, ESLint, audit, knowledge, compliance, TDD) |
| `.opencode/state/gate-state.json` | Active gate sessions |
| `opencode.json` | Agent permissions (authoritative source for scope check P2-D) |

---

## 11. Agent Write Scopes (from opencode.json)

| Agent | Allowed Write Paths | Denied Paths |
|-------|--------------------|--------------|
| Knowledge-Curator | docs/official_docs/**, .task_temp/** | .opencode/**, booking_system_refactor/** |
| Meta-Planner | .task_temp/**, Task.DAG.json, Project.graph, TECH_DEBT_REGISTRY.md, WAIVE.md | .opencode/tools/**, .opencode/scripts/**, .opencode/state/**, contract.yaml, backend/src/**, frontend/src/** |
| Architect | contract.yaml, .opencode/state/machine.json, .opencode/context/**, docs/**, .task_temp/** | opencode.json, .opencode/state/**, .opencode/project.config.json, .opencode/rules/**, .opencode/agents/**, .opencode/scripts/**, .opencode/plugins/**, backend/src/**, frontend/src/** |
| Coder-BE | `booking_system_refactor/booking-backend/**`, .task_temp/** | contract.yaml, opencode.json, .opencode/**, frontend/** |
| Coder-FE | `booking_system_refactor/booking-frontend/**`, .task_temp/** | contract.yaml, opencode.json, .opencode/**, backend/** |
| Guardian | .task_temp/**, .opencode/state/machine.json, .opencode/state/gate-state.json | backend/src/**, frontend/src/**, contract.yaml, .opencode/**, AGENTS.md |
| Super-Admin | .opencode/**, opencode.json, AGENTS.md, contract.yaml, .task_temp/**, docs/** | backend/src/**, frontend/src/** |
| Orchestrator | .task_temp/**, docs/review/** | .opencode/**, Task.DAG.json (deny writes) |

---

## 12. Conclusion

The R4 CONFIG-READ-ATTEST feature (2026-06-19) adds an additional enforcement layer in scope-before.ts that **blocks all writes until the agent proves it has read the 3 mandatory configuration files** (agent config, opencode.json, project.config.json). This closes a gap where agents would attempt to write business/framework code without first understanding their permissions and scope constraints.

The enforcement pipeline executes checks in this order:
1. Agent dispatch tool check
2. Multi-path shell parse
3. Per-path: ROUTE-MISMATCH → UC7-008 → WRITE-SCOPE → **R4 CONFIG-READ-ATTEST** → UC7-001 write → UC7-005 size cap

This guarantees that no write operation occurs without passing through all scope and compliance gates.
