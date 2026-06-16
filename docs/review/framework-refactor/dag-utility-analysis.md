# DAG Design Utility Analysis

**Date**: 2026-06-17  
**Author**: @Architect (investigation)  
**Source**: `docs/review/framework-refactor/framework-evaluation-report.md` §8-9  
**Status**: READ-ONLY investigation — no code changes

---

## 1. Evaluation Report Critique Summary

The framework evaluation report (§8-9) makes these specific claims about the DAG/PLAN-FIRST system:

### §8 — Multi-Agent System
- @Orchestrator's core job (read DAG JSON → dispatch) could be done by code, not an LLM agent
- @Meta-Planner's planning could be human + LLM conversation instead of a separate agent
- Recommend reducing from 10 agents to 3 core roles + framework-internal scheduling

### §9 — PLAN-FIRST Constraint
- **DAG ROI is questionable**: 261 tasks with mostly linear dependencies don't need a graph structure
- **DAG generation is token-heavy**: @Meta-Planner's main job is generating and maintaining large DAG documents
- **Three-layer defense protects a low-value constraint**: Layers 1/2/3 all enforce DAG existence, but DAG itself has limited utility
- **auto_plan is disabled**: `auto_plan_enabled: false` — the self-healing mechanism has never been validated in practice
- **Suggested P2-C action**: Simplify DAG → flat task list (3-6h effort)

### Summary of the Critique
The evaluation report argues that the DAG is "defense-in-depth protecting a low-value target" — the multi-layered enforcement is technically well-designed but the thing it protects (a graph-structured task document) has questionable ROI for single-developer projects.

---

## 2. DAG Code Map

### 2.1 Primary Enforcement Files

| # | File | Total LOC | DAG LOC | % DAG | Role |
|---|------|-----------|---------|-------|------|
| 1 | `lib/dag-policy.ts` | 399 | 399 | 100% | Canonical exempt list, dispatch_policy, auto_plan |
| 2 | `lib/dag-version-manager.ts` | 439 | 439 | 100% | Version snapshots, changelog, indexing, hot/warm/cold tiers |
| 3 | `plugins/dispatch-before.ts` | 193 | 193 | 100% | **Layer 1** — policy-driven dispatch gate |
| 4 | `plugins/gate-before.ts` | 153 | ~60 | ~39% | **Layer 3** — P2-1 DAG task existence audit at modify-tool time |
| 5 | `tools/dispatch_subagent.ts` | 532 | ~120 | ~23% | **Layer 2** — unconditional DAG check + auto_plan integration; dual-semantic `dag_task_id` |
| 6 | `lib/gate-checks.ts` | 272 | ~74 | ~27% | `findTaskInDag()` — two-phase lookup (tasks[] + execution_order) |
| 7 | `scripts/pre-execution-gate.ts` | 967 | ~120 | ~12% | `checkDagCoverage()` — 6-check gate including DAG coverage (Check 2/6) |
| 8 | `scripts/pre-execution-hook.sh` | 598 | ~70 | ~12% | Stage 1: DAG gate with jq/python3/bun fallback chain |
| 9 | `hooks/lib/hook-layers.ts` | 333 | ~8 | ~2% | DAG changelog externalization check in pre-commit |

### 2.2 Secondary / Support Files

| # | File | Total LOC | DAG LOC | Role |
|---|------|-----------|---------|------|
| 10 | `lib/state-manager.ts` | 312 | ~10 | DAG types (DAGTask, DAGMeta), STATE_PATHS.dag() |
| 11 | `lib/state-utils.ts` | ~400 | ~10 | STATE_PATHS for DAG paths |
| 12 | `lib/critical-files.ts` | ~100 | ~5 | Task.DAG.json in critical infrastructure list |
| 13 | `scripts/archive-dag-tasks.ts` | 91 | 91 | Nightly DAG archival utility |
| 14 | `scripts/migrate-dag-v2.ts` | 283 | 283 | One-time v1→v2 migration with timestamp assignment |
| 15 | `scripts/framework-doctor.ts` | ~1100 | ~40 | Check 12: dispatch_policy consistency validation |
| 16 | `scripts/framework-self-test.ts` | ~2700 | ~70 | Check 37: PLAN-FIRST 3-layer stack consistency |
| 17 | `scripts/state-integrity-scan.ts` | ~500 | ~20 | auto_plan_history cross-check |
| 18 | `scripts/state-reconciliation.ts` | ~800 | ~30 | DAG ↔ Gate ↔ Machine consistency |
| 19 | `scripts/monitoring-status.ts` | ~200 | ~10 | DAG monitoring status |
| 20 | `scripts/nightly-compaction.ts` | ~150 | ~10 | DAG compaction |

### 2.3 Configuration & Documentation Files

| # | File | DAG Content |
|---|------|-------------|
| 21 | `project.config.json` | `dispatch_policy` block (require_dag_entry, auto_plan_enabled, etc.) |
| 22 | `agents/Meta-Planner.md` | ~30 lines — DAG creation rules, coverage constraints |
| 23 | `agents/Orchestrator.md` | ~60 lines — PLAN-FIRST protocol, dag_task_id uniqueness, auto_plan usage |
| 24 | `agents/Super-Admin.md` | ~10 lines — DAG exemption references |
| 25 | `rules/rule_detail/dag-generation-standard.md` | ~200 lines — complete DAG standard (C1-C6, G1-G4, T1-T4, D1-D4) |
| 26 | `rules/rule_detail/TEMPLATE_VARIABLE_STANDARD.md` | ~40 lines — §2.12 dispatch_policy block documentation |
| 27 | `AGENTS.md` | ~30 lines — PLAN-FIRST enforcement description |
| 28 | `rules/common-project.md` | ~15 lines — P0 PLAN-FIRST hard constraint |
| 29 | `rules/rule_detail/enforcement-modes-standard.md` | ~10 lines — locked mode auto_plan=false |
| 30 | `rules/rule_detail/universal-compatibility-profile.md` | ~15 lines — DAG in feature catalog |

### 2.4 Aggregate Metrics

| Metric | Count |
|--------|-------|
| **Total DAG-specific TypeScript LOC** | ~1,650 lines |
| **Total DAG-specific shell LOC** | ~70 lines |
| **Total DAG-specific documentation LOC** | ~400 lines |
| **Total DAG-specific agent config LOC** | ~100 lines |
| **Grand total DAG-related code** | **~2,220 lines** |
| **Number of files with DAG logic** | **30+** |
| **Number of enforcement layers** | **3** (dispatch-before, dispatch_subagent, gate-before) |
| **Number of DAG-exempt agents** | **4** (meta-planner, orchestrator, super-admin, knowledge-curator) |
| **Non-exempt agents blocked** | **6** (architect, coder-be, coder-fe, guardian, arbiter, ci-cd-agent) |

---

## 3. Value Analysis — What DAG Actually Prevents

### 3.1 Current Enforcement State

The DAG enforcement system is **currently effectively disabled**:

```
require_dag_entry: false   ← Master switch OFF (rollout observation mode)
auto_plan_enabled: false   ← Self-healing OFF
```

**Consequence**: In the current configuration, Layer 1 (`dispatch-before.ts`) and Layer 2 (`dispatch_subagent.ts`) both pass through without blocking when `require_dag_entry=false`. Only Layer 3 (`gate-before.ts` P2-1) actively checks DAG task existence, and that only at modify-tool time for non-exempt agents.

### 3.2 What Each Layer Checks

| Layer | File | What It Checks | When It Blocks | Currently Active? |
|-------|------|---------------|----------------|-------------------|
| **L1** | `dispatch-before.ts` | `dag_task_id` exists in DAG, status is pending/in_progress | `require_dag_entry=true` AND (strict/locked) | ❌ (`require_dag_entry=false`) |
| **L2** | `dispatch_subagent.ts` | Same as L1, plus auto_plan | `require_dag_entry=true` | ❌ (`require_dag_entry=false`) |
| **L3** | `gate-before.ts` | `FRAMEWORK_TASK_ID` exists in DAG for modify tools | Non-exempt agent, strict/locked mode | ✅ (always active for modify tools) |

### 3.3 Actual Block Events

A search for `FW-ENFORCE.*DAG|PLAN.FIRST.*block` across the log directory returned **zero matches**. No evidence was found that DAG enforcement has ever blocked an invalid dispatch. This is consistent with:
- `require_dag_entry=false` in the rollout phase
- The project being a single-developer system where dispatch without planning is rare
- @Orchestrator naturally follows DAG scheduling

### 3.4 What Real Problems Does DAG Solve?

| Problem | DAG's Role | Actually Solves It? |
|---------|-----------|---------------------|
| **Unplanned execution** | Enforces that a task is in DAG before agents modify files | ⚠️ Unclear — agents follow instructions; the guard prevents accidents but has never triggered |
| **Status tracking** | Tasks have status: pending → in_progress → completed | ✅ Yes — status is useful for @Orchestrator scheduling |
| **Dependency ordering** | Tasks declare dependencies; @Orchestrator respects them | ⚠️ Marginal — most dependencies are linear (analyze→design→implement→test→review) |
| **Coverage verification** | Guardian checks that all requirement clauses map to DAG tasks | ✅ Yes — this is a genuinely useful constraint for large projects |
| **Prevent duplicate work** | Two agents can't work on the same task simultaneously | ✅ Yes — task status gating prevents this |
| **Audit trail** | DAG changelog + version snapshots provide history | ⚠️ Marginal — the changelog is auto-generated and rarely consulted |

### 3.5 Summary of Value

The DAG provides **real but modest** value:
- **Strongest value**: Status tracking (prevents duplicate/redundant work), coverage verification (all requirements mapped)
- **Weakest value**: Dependency graph (linear in practice), three-layer defense (overkill for current threat model), version management subsystem (over-engineered for single-developer use)

---

## 4. Cost Analysis

### 4.1 Code Volume Cost

| Category | LOC | % of Framework |
|----------|-----|----------------|
| DAG enforcement code (TS) | ~1,650 | ~8% of all `.opencode/` TypeScript |
| DAG docs/rules/agent configs | ~500 | ~5% of all `.opencode/` markdown |
| DAG shell scripts | ~70 | ~3% of all shell scripts |
| **Total** | **~2,220** | **~6% of framework codebase** |

### 4.2 Token Cost per Dispatch

Every `dispatch_subagent()` call consumes DAG-related tokens:

| Component | Token Cost (est.) | Description |
|-----------|-------------------|-------------|
| Tool description (`dag_task_id` + `auto_plan` params) | ~300 tokens | Dual-semantic dag_task_id docs, auto_plan param |
| Layer 1 plugin inject | ~50 tokens | dispatch-before.ts in plugin chain |
| Layer 2 execution | ~200 tokens | findTaskInDag + policy check per dispatch |
| Layer 3 gate-before runtime | ~100 tokens | DAG audit on every modify tool call |
| @Orchestrator agent config | ~800 tokens | PLAN-FIRST procedures, dag_task_id uniqueness rules |
| @Meta-Planner agent config | ~600 tokens | DAG creation rules, coverage constraints |
| **Per-dispatch overhead** | **~200-500 tokens** | Per non-exempt dispatch |
| **Per-session overhead** | **~2,000 tokens** | Agent config preamble load |

For context: a typical single feature task (T-014) consumes ~50,000-100,000 tokens end-to-end. The DAG overhead is ~2-5% of that.

### 4.3 @Meta-Planner Token Overhead

@Meta-Planner's primary job is DAG generation:

| Activity | Token Cost (est.) |
|----------|-------------------|
| Reading all 6 requirement docs | ~20,000 tokens |
| Reading existing DAG (261 tasks) | ~10,000 tokens |
| Generating new DAG version | ~15,000 tokens |
| Writing DAG + version management | ~5,000 tokens |
| **Per-DAG-generation total** | **~50,000 tokens** |

For a single-developer project with one new task, this is disproportionate. For a large team with many parallel tasks, it's reasonable overhead.

### 4.4 Maintenance Burden

Git history analysis shows DAG-related code is **actively maintained**:

- `dag-policy.ts`: Created 2026-06-14 (3 days ago) — brand new
- `dispatch-before.ts`: Created 2026-06-14 — brand new
- `PLAN-FIRST redesign`: 2026-06-14 — recent major change
- `dag-version-manager.ts`: Multiple commits for hot/warm/cold architecture
- `dag-generation-standard.md`: v1.1 (2026-05-18) — recently updated

The PLAN-FIRST subsystem alone is ~500 lines of brand-new code added in the last week, with framework-doctor Check 12, framework-self-test Check 37, and state-integrity-scan all updated to verify it.

### 4.5 Dispatch Overhead

| Overhead Type | Cost | Notes |
|---------------|------|-------|
| **Time**: Layer 1 (plugin) | <1ms | In-memory check; reads cached policy |
| **Time**: Layer 2 (dispatch_subagent) | <5ms | findTaskInDag reads DAG from disk |
| **Time**: Layer 3 (gate-before) | <2ms | Only on modify tools; cached DAG-exempt check |
| **Complexity**: dag_task_id semantics | High | Dual-purpose (path namespace + DAG audit); major source of confusion |
| **Complexity**: auto_plan polling | 1-120s | When enabled, polls DAG file every 1s for up to 120s |

---

## 5. Flat Task List Feasibility Assessment

### 5.1 What Would Be Lost

| Capability | Loss Assessment |
|------------|----------------|
| **Dependency graph** | Minimal loss — dependencies are linear in practice |
| **execution_order groups** | Could be replaced by priority field + status field |
| **DAG version management** (snapshots, indexing, changelog) | Lost — but was this actually used? The hot/warm/cold tier system is complex |
| **findTaskInDag two-phase lookup** | Simplified to single flat array lookup |
| **dag-generation-standard.md compliance rules** | C1-C6, G1-G4, T1-T4, D1-D4 would need rewriting |
| **@Meta-Planner DAG generation** | Would become simpler: generate flat JSON array instead of graph |
| **Coverage verification** (C4: 100% coverage gate) | Can be preserved with flat list + requirement_source field |
| **Status tracking** | Preserved: flat tasks still have status field |
| **Duplicate prevention** | Preserved: status gating still works |

### 5.2 What Would Be Gained

| Gain | Impact |
|------|--------|
| **Simpler dispatch** | Single flat array lookup instead of two-phase tasks[]+execution_order scan |
| **Fewer tokens** | Remove DAG complexity from agent configs, tool descriptions, rules |
| **Less @Meta-Planner overhead** | Generate flat JSON array, not a graph with edges |
| **No dependency validation** | One less thing to maintain and verify |
| **No DAG version management** | Remove dag-version-manager.ts (439 lines), archive-dag-tasks.ts (91 lines), migrate-dag-v2.ts (283 lines) |
| **Lower maintenance** | Remove ~800 lines of version management + simplify enforcement |
| **Simpler dag_task_id semantics** | No more dual-purpose confusion |

### 5.3 PLAN-FIRST with a Flat List

The PLAN-FIRST constraint (plan before execute) can work **identically** with a flat task list:

```
Layer 1: dispatch-before → check task_id exists in flat_tasks.json
Layer 2: dispatch_subagent → same check, auto_plan still works
Layer 3: gate-before → same check at modify-tool time
```

The only change: `findTaskInDag()` becomes `findTaskInFlatList()` — a single array `.find()` instead of a two-phase scan across `tasks[]` and `execution_order`.

### 5.4 Migration Effort Estimate

| Task | Effort | Files Affected |
|------|--------|----------------|
| Replace `findTaskInDag` with single-array lookup | 1h | gate-checks.ts, dispatch-before.ts, dispatch_subagent.ts, gate-before.ts, pre-execution-gate.ts |
| Update `dag_task_id` → `task_id` semantics | 1h | dispatch_subagent.ts (tool args), pre-execution-hook.sh |
| Remove DAG version management | 1h | dag-version-manager.ts, archive-dag-tasks.ts, migrate-dag-v2.ts (DELETE) |
| Simplify @Meta-Planner DAG generation | 2h | Meta-Planner.md, generation prompt |
| Update rules/docs | 2h | dag-generation-standard.md, AGENTS.md, TEMPLATE_VARIABLE_STANDARD.md |
| Update framework-doctor, self-test | 1h | Remove Check 12/37, add flat list equivalent |
| **Total** | **~8h** | 15+ files |

---

## 6. Verdict & Recommendation

### 6.1 Core Finding

**The DAG is defense-in-depth applied to a low-value target.** The evaluation report's critique is largely validated by this investigation:

1. **The enforcement is technically well-designed**: Three independent layers, fail-closed in strict/locked, auto_plan self-healing. Professional engineering.

2. **But the protected target has limited value**: 
   - `require_dag_entry` is `false` — the enforcement is off
   - Dependencies are linear in practice
   - The version management subsystem (hot/warm/cold, snapshots, indexing) is over-engineered for single-developer use
   - No log evidence of DAG having caught violations
   - @Meta-Planner spends ~50K tokens per DAG generation for what could be a flat JSON array

3. **The DAG is a 2026-06-14 creation**: The PLAN-FIRST subsystem (dag-policy.ts, dispatch-before.ts, updated dispatch_subagent) was built just 3 days ago. This is a very recent addition to an already complex framework.

### 6.2 Recommendation: **SIMPLIFY to Flat Task List + Priority Field**

Replacing the graph-structured DAG with a flat task list (`tasks.json`) preserves the genuinely valuable features while eliminating the complexity:

| Keep | Remove |
|------|--------|
| ✅ PLAN-FIRST constraint (plan before execute) | ❌ Graph dependency structure |
| ✅ Task status tracking (pending→in_progress→completed) | ❌ execution_order group nesting |
| ✅ Coverage verification (requirement_source field) | ❌ DAG version management (snapshots, indexing, changelog) |
| ✅ Three-layer dispatch enforcement | ❌ Two-phase findTaskInDag lookup |
| ✅ Agent exemption list (dag-policy.ts) | ❌ dag-version-manager.ts (439 lines) |
| ✅ auto_plan self-healing (when enabled) | ❌ archive-dag-tasks.ts, migrate-dag-v2.ts |

### 6.3 Quantified Net Value

| Metric | Current DAG | Flat Task List | Delta |
|--------|-------------|----------------|-------|
| Framework code (LOC) | ~2,220 | ~1,200 | **-1,020** |
| Files with DAG logic | 30+ | ~15 | **-15** |
| Per-dispatch check | 2-phase scan | 1-phase `.find()` | **-50% complexity** |
| @Meta-Planner token cost | ~50K | ~20K | **-60%** |
| Version management | Hot/warm/cold tiers | Single file | **-800 LOC** |
| Dependency validation | Graph walk | None needed | — |
| Status tracking | ✅ | ✅ | No change |
| Coverage verification | ✅ | ✅ | No change |
| PLAN-FIRST enforcement | ✅ (3 layers) | ✅ (2-3 layers) | Can simplify to 2 layers |

### 6.4 Migration Priority

**P2 (nice-to-have, not urgent)**. The DAG works correctly and doesn't break anything. The simplification would reduce maintenance burden and token costs but is not blocking any current work. The evaluation report's P2-C classification is appropriate.

### 6.5 Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Breaking @Orchestrator scheduling | Implement behind feature flag; run both DAG and flat list in parallel for observation period |
| Losing dependency information | Most dependencies are linear; edge cases can use `depends_on: ["T001"]` array in flat tasks |
| Coverage verification regression | Preserve `requirement_source` field in flat tasks; update Guardian checks |
| Migration bugs | Existing Task.DAG.json can be auto-converted to flat_tasks.json with a migration script |

---

## Appendix A: Key File References

| File | Path |
|------|------|
| Evaluation Report | `docs/review/framework-refactor/framework-evaluation-report.md` |
| DAG Policy (SSOT) | `.opencode/lib/dag-policy.ts` |
| DAG Version Manager | `.opencode/lib/dag-version-manager.ts` |
| Layer 1 Enforcement | `.opencode/plugins/dispatch-before.ts` |
| Layer 2 Enforcement | `.opencode/tools/dispatch_subagent.ts` |
| Layer 3 Enforcement | `.opencode/plugins/gate-before.ts` |
| Pre-Execution Gate | `.opencode/scripts/pre-execution-gate.ts` |
| Pre-Execution Hook | `.opencode/scripts/pre-execution-hook.sh` |
| Gate Checks (findTaskInDag) | `.opencode/lib/gate-checks.ts` |
| DAG Archival | `.opencode/scripts/archive-dag-tasks.ts` |
| DAG Migration v1→v2 | `.opencode/scripts/migrate-dag-v2.ts` |
| DAG Generation Standard | `.opencode/rules/rule_detail/dag-generation-standard.md` |
| Framework Self-Test (Check 37) | `.opencode/scripts/framework-self-test.ts` |
| Framework Doctor (Check 12) | `.opencode/scripts/framework-doctor.ts` |
| PLAN-FIRST Design Doc | `docs/review/cicd-dag-block/plan-first-redesign.md` |
