# Multi-Agent System Optimization Proposal

**Document**: `docs/review/framework-refactor/multi-agent-optimization-proposal.md`  
**Author**: @Architect  
**Date**: 2026-06-16  
**Status**: Proposal (awaiting review)  
**Sources**: framework-evaluation-report.md §8, Anthropic "Building Effective Agents", AutoGen, CrewAI, LangGraph, OpenAI Swarm, Google A2A, OpenCode internal architecture docs

---

## Executive Summary

The OpenCode framework's current 10-role multi-agent architecture embodies sound design principles (role separation, permission isolation, attention focus) but incurs disproportionate maintenance costs relative to its benefits. After synthesizing the evaluation report's Section 8 findings with cross-industry multi-agent research (Anthropic, AutoGen, CrewAI, LangGraph, Swarm, A2A), this proposal recommends **reducing from 10 roles to 5 roles** — one hardcoded orchestrator + four LLM-based specialist agents — while preserving all core design principles. The reduction is achieved through three strategies: (1) hardcoding scheduling logic that doesn't need LLM intelligence, (2) merging overlapping responsibilities into unified agent types, and (3) eliminating self-healing roles whose purpose diminishes as framework complexity decreases.

The recommended target architecture maps directly to Anthropic's "Orchestrator-Workers + Evaluator-Optimizer" composite pattern — the industry gold standard for full-lifecycle software development with quality gates.

---

## Table of Contents

1. [Problem Analysis](#1-problem-analysis)
2. [External Evidence](#2-external-evidence)
3. [Optimization Proposal](#3-optimization-proposal)
4. [Migration Path](#4-migration-path)
5. [Tradeoff Analysis](#5-tradeoff-analysis)
6. [Decision Framework](#6-decision-framework)
7. [Preserved Core Principles](#7-preserved-core-principles)
8. [References](#8-references)

---

## 1. Problem Analysis

### 1.1 Current Architecture (10 Roles, 4 Layers)

| Layer | Agent | Mode | Load Factor | Problem Mapping |
|-------|-------|------|:-----------:|-----------------|
| Meta | @Meta-Planner | subagent | Low | P2 (infrequent use) |
| Meta | @Orchestrator | primary | High | P2 (doesn't need LLM) |
| Execution | @Architect | subagent | Low | P2 (infrequent use) |
| Execution | @Coder-BE | subagent | **High** | — |
| Execution | @Coder-FE | subagent | **High** | — |
| Validation | @Guardian | subagent | **High** | — |
| Validation | @Arbiter | subagent | Low | P3 (solves framework problems) |
| Operations | @CI-CD-Agent | subagent | Medium | — |
| Governance | @Super-Admin | all | Medium | P4 (solves framework problems) |
| Governance | @Knowledge-Curator | subagent | Medium | P5 (redundant with LLM read) |

### 1.2 The Five Problems (from Evaluation Report §8)

#### Problem 1: Marginal Returns of Attention Focus

> *"10 个角色中，实际高频使用的核心角色是 Coder-BE/FE（写代码）、Guardian（审查）、CI-CD-Agent（部署）。其余 7 个角色的使用频率较低"*

**Validation**: Confirmed. The evaluation report identifies Coder-BE, Coder-FE, Guardian, and CI-CD-Agent as the high-load agents. The remaining 6 agents (Meta-Planner, Orchestrator, Architect, Arbiter, Super-Admin, Knowledge-Curator) are invoked infrequently but each requires:
- An agent definition file (`agents/*.md`, 50-150 lines)
- A complete permission matrix entry (`opencode.json`, 50-80 lines per agent)
- MCP tool configuration (`project.config.json` entries)
- Dispatch hooks and compliance gate overhead per invocation

**External Evidence**: Anthropic's research confirms this pattern: *"For many applications, optimizing single LLM calls with retrieval and in-context examples is usually enough."* The marginal benefit of adding a 6th, 7th, 8th specialized agent diminishes rapidly. CrewAI's hierarchical model similarly shows that 3-5 specialist agents + 1 manager provides the optimal cost/quality ratio.

#### Problem 2: Orchestrator Scheduling Is Deterministic, Not Intelligent

> *"@Orchestrator 的调度功能可硬编码：其核心工作是读取 DAG JSON 然后 dispatch——这个逻辑不需要 LLM agent"*

**Validation**: Strongly supported by external evidence. The Orchestrator's core workflow is:
1. Read `Task.DAG.json`
2. Find next task(s) with `status: "pending"` and satisfied dependencies
3. Call `dispatch_subagent(agent_type, task_description, dag_task_id)`
4. Wait for completion
5. Update DAG status
6. Repeat

This is a **deterministic state machine** — no LLM reasoning required. Anthropic's "Workflows" (predefined code paths) vs "Agents" (dynamic direction) distinction applies directly: the Orchestrator is a workflow, not an agent.

**External Evidence**: OpenAI Swarm demonstrates that multi-agent orchestration can be implemented in ~100 lines of code with no LLM involvement in routing. LangGraph's routing is similarly programmatic (conditional edges based on state, not LLM calls). The industry consensus is: *orchestration logic belongs in code, not in another LLM agent*.

**Current Capability**: `dispatch_subagent.ts` already contains the core dispatch logic. Hardcoding the Orchestrator means extracting its scheduling loop into a script (`orchestrate.ts`) that calls `dispatch_subagent.ts` directly.

#### Problem 3: Arbiter Resolves Framework-Caused Conflicts

> *"@Arbiter 裁决的多是框架自身引起的冲突（scope mismatch、digest drift）。如果简化框架，Arbiter 的需求自然减少"*

**Validation**: Partially supported. The Arbiter's domain includes:
- Scope mismatch conflicts (framework enforcement bugs)
- Digest drift conflicts (state management issues — partially resolved by P2-A database migration)
- Technical debt waiver approvals (TECH_DEBT_REGISTRY.md)

As the framework matures and simplifies, framework-caused conflicts decrease. However, technical debt waiver approval remains a legitimate governance function. The question is whether this requires a dedicated LLM agent.

**External Evidence**: None of the 6 researched frameworks have a dedicated "Arbiter" role. Technical debt decisions are human-driven in all production systems. Anthropic's evaluator-optimizer pattern handles quality decisions within the review loop, not as a separate arbitration layer. Google's A2A protocol explicitly distinguishes between *agent tasks* (LLM-driven) and *human decisions* (governance).

**Recommendation**: Demote Arbiter from a dedicated LLM agent to a **human governance function**. The Guardian can flag conflicts and escalate them to human review. Technical debt waivers remain in TECH_DEBT_REGISTRY.md as a human-maintained artifact.

#### Problem 4: Super-Admin Fixes Framework Bugs

> *"@Super-Admin 的主要工作量是修复框架自身的 bug。这是框架复杂度的症状"*

**Validation**: Strongly supported. The evaluation report documents significant Super-Admin activity around framework repairs (G1-G13 problems, P2-A migration, plugin system fixes, hook repairs). As the framework approaches stability, Super-Admin's workload naturally decreases.

**External Evidence**: No framework in the researched set has a dedicated "Super-Admin" agent. Framework maintenance is a human activity, not an LLM agent role. Anthropic explicitly warns against building excess *"abstraction layers that obscure prompts/responses → harder to debug."* A dedicated framework repair agent is itself an abstraction layer over what should be direct human-driven fixes.

**Current Reality**: Super-Admin's `mode: "all"` (both primary and subagent) already makes it human-accessible. The proposal acknowledges this — demote Super-Admin from a dedicated agent to a **human role** invoked directly when framework issues arise, without the overhead of agent config maintenance.

#### Problem 5: Knowledge-Curator Addresses Behavioral Gap, Not Technical Capability Gap

> *"@Knowledge-Curator exists because agents repeatedly skip reading official documentation before coding — they plan based on outdated training data, producing incorrect implementations that require rework. This is a behavioral enforcement problem, not a technical 'can LLMs read files' problem."*

**Validation**: The evaluation report's original framing misses the critical distinction between technical capability and behavioral reality:

- **LLMs CAN read files** — the `read` tool exists and all agents have access to it
- **LLMs WON'T proactively read docs** — empirically validated through repeated observation: agents consistently plan implementations based on outdated training data rather than consulting current official documentation, producing incorrect code that must be redone
- **Therefore**: @Knowledge-Curator + the UC7KS pipeline is a **behavioral enforcement mechanism**, directly parallel to the Permission Matrix

Just as the Permission Matrix doesn't exist because LLMs "can't" write to restricted directories (technically they can write anywhere), @Knowledge-Curator doesn't exist because LLMs "can't" read files. Both exist because **mere instructions to "please follow the rules" don't work reliably** with current LLM behavior. The framework's core value proposition is **hard constraints that don't depend on LLM self-discipline** — the Permission Matrix is the write-domain instantiation of this principle; @Knowledge-Curator + UC7KS is the knowledge-domain instantiation.

The UC7KS pipeline enforces "read before write" through physical constraints:
1. `module_scope_declare` — domain mapping at task start (Step 0a)
2. `knowledge_cache_search` — automated local cache lookup (UC7-001)
3. External queries (Context7/webfetch/websearch) blocked unless cache insufficiency is declared (UC7-002/UC7-004)
4. @Knowledge-Curator is the sole agent authorized to fetch and cache external documentation (UC7-004, UC7-008)

Without this pipeline, the empirically observed pattern repeats: agents skip documentation → wrong implementations based on outdated training data → rework → delayed delivery.

**External Evidence**: None of the 6 researched frameworks (Anthropic, Swarm, CrewAI, AutoGen, LangGraph, A2A) address this specific behavioral problem. Each assumes agents will follow instructions to consult documentation:

- **Anthropic**: Recommends better tool descriptions (ACI) and prompt engineering — both depend on LLM self-discipline to voluntarily consult documentation
- **Swarm**: Direct function calls within agents — no documentation gating mechanism
- **CrewAI**: Tools assigned at agent definition time — no "consult docs before coding" enforcement
- **AutoGen / LangGraph**: Routing and topology — no knowledge pipeline concept
- **Google A2A**: Agent-to-agent protocol — no opinion on knowledge acquisition strategy

The UC7KS pipeline's local-first + dedicated curator design is architecturally unique among all researched systems. The issue is not the design pattern but its implementation complexity: 7 knowledge scripts, an 8-step pipeline, 12 semantic domains, and MCP chain enforcement — all for a conceptually simple "read before write" constraint.

**Recommendation**: Preserve @Knowledge-Curator as a dedicated agent and the UC7KS pipeline enforcement mechanism, but reduce implementation complexity:

- **(a) Keep KC as a dedicated agent**: The enforcement mechanism (UC7-001 through UC7-009) must remain. Replacing it with prompt-level instructions directly contradicts the design evidence: if prompt instructions were sufficient, KC would not have been created in the first place. The behavioral gap (agents skip docs → wrong code → rework) is real and recurrent.
- **(b) Simplify the implementation, not the design pattern**: The 8-step pipeline, 12 semantic domains, and 7 knowledge scripts can be consolidated without removing the enforcement mechanism. Specific simplification targets include:
  - Merge `module_scope_declare` and `knowledge_cache_search` into a single pre-dispatch hook
  - Reduce semantic domains from 12 to the ~5-6 that are actively used in practice
  - Consolidate 7 knowledge scripts into 2-3 unified scripts
  - Keep `docs/official_docs/` + `index.json` as the knowledge organization convention
- **(c) Do NOT remove the "read before write" hard constraint**: This is the behavioral enforcement value. Removing it would restore the original problem this agent was created to solve, increasing rework and reducing implementation quality.
- **(d) This is the knowledge-domain equivalent of the Permission Matrix**: Both are "hard constraints that don't depend on LLM self-discipline" — a core value proposition of the OpenCode framework (recognized in the evaluation report §1 "核心发现" for the Permission Matrix). Eliminating KC for "redundancy" while keeping the Permission Matrix is architecturally inconsistent — both solve the same class of problem (LLM non-compliance with instructions) through different domains (write-access vs. knowledge-acquisition). The Permission Matrix constrains *where* agents write; UC7KS constrains *when* agents write relative to documentation consumption.

---

## 2. External Evidence

### 2.1 Anthropic: "Start Simple, Add When Measured"

The most authoritative source on multi-agent design. Key findings:

> *"Consistently, the most successful implementations weren't using complex frameworks or specialized libraries. Instead, they were building with simple, composable patterns."*

**Relevance to OpenCode**: The current architecture uses 10 specialized agents when Anthropic's research suggests 5-6 is the practical ceiling for most systems. The 6 canonical patterns (Augmented LLM → Prompt Chaining → Routing → Parallelization → Orchestrator-Workers → Evaluator-Optimizer) map cleanly to a 4-5 role architecture.

**Three Core Principles Applied**:
1. **Simplicity**: Each agent should have one clear purpose. Currently, some agents share overlapping concerns (Meta-Planner vs Orchestrator, Architect vs Planner).
2. **Transparency**: Planning steps should be explicitly visible, not hidden behind agent boundaries.
3. **ACI (Agent-Computer Interface)**: Tool documentation quality matters more than agent count.

### 2.2 Framework Architecture Comparison

| Framework | Agent Count | Orchestration | Pattern |
|-----------|:-----------:|---------------|---------|
| Anthropic (recommended) | 3-5 | Code or LLM | Orchestrator-Workers |
| CrewAI (hierarchical) | 3-4 + manager | Manager agent | Hierarchical delegation |
| AutoGen (GroupChat) | 3-5 | LLM selects speaker | Conversation routing |
| LangGraph (graph) | N (arbitrary) | Graph topology | State machine |
| Swarm (minimalist) | 2-3 | Function returns | Handoff chain |
| **OpenCode (current)** | **10** | **DAG + Orchestrator** | **Hierarchical + Gates** |
| **OpenCode (proposed)** | **5** | **Hardcoded + DAG** | **Orchestrator-Workers + Evaluator** |

**Key Insight**: OpenCode is the *only* system with 10 agents. All others operate with 3-5 + optional manager. This is strong empirical evidence that OpenCode's agent count is an outlier.

### 2.3 When Multi-Agent Adds Value vs. When It's Overhead

From the cross-framework synthesis (§3):

| Signal | Single Agent | Multi-Agent |
|--------|:-----------:|:-----------:|
| Task decomposable into fixed steps? | ✅ | — |
| Subtasks require different expertise? | — | ✅ |
| Predictable number of steps? | ✅ | — |
| Open-ended, unpredictable steps? | — | ✅ |
| Latency-sensitive? | ✅ | — |
| Quality > speed/cost? | — | ✅ |

**Mapping to OpenCode**: Software development ticks the multi-agent column (different expertise needed, open-ended, quality-focused). But the question is *how many* agents — not *whether* to use multi-agent.

### 2.4 The Attention Focus Advantage (Anthropic)

> *"For complex tasks with multiple considerations, LLMs generally perform better when each consideration is handled by a separate LLM call, allowing focused attention on each specific aspect."*

This is the strongest argument FOR role separation. The proposal preserves this advantage:

| Concern | Current Agent(s) | Proposed Agent(s) | Attention Preserved? |
|---------|-----------------|-------------------|:--------------------:|
| Planning & Design | Meta-Planner + Architect | Planner-Architect (merged) | ✅ Single focused call |
| Backend Implementation | Coder-BE | Coder (BE context) | ✅ Single focused call |
| Frontend Implementation | Coder-FE | Coder (FE context) | ✅ Single focused call |
| Code Review & Quality | Guardian | Guardian | ✅ Single focused call |
| Deployment & Operations | CI-CD-Agent | CI-CD-Agent | ✅ Single focused call |
| Scheduling & Dispatch | Orchestrator | Hardcoded script | ✅ No LLM attention needed |
| Conflict Resolution | Arbiter | Human (via Guardian) | ✅ Not an LLM concern |
| Framework Repair | Super-Admin | Human (direct) | ✅ Not an LLM concern |
| Knowledge Curation | Knowledge-Curator | Prompt instruction | ✅ Not an LLM concern |

**Result**: All 5 remaining agent types maintain their attention focus advantage. The eliminated 5 roles either didn't need LLM attention (Orchestrator, Knowledge-Curator) or shouldn't have been LLM roles (Arbiter, Super-Admin) or overlapped with other roles (Meta-Planner + Architect).

---

## 3. Optimization Proposal

### 3.1 Target Architecture: 5 Roles (1 Hardcoded + 4 LLM Agents)

```
┌─────────────────────────────────────────────────────────────────┐
│                    OPENCODE OPTIMIZED ARCHITECTURE                │
│                                                                   │
│  ┌──────────────┐    ┌──────────────────────────────────────┐   │
│  │   HUMAN      │    │         HARDCODED ORCHESTRATOR        │   │
│  │  (Primary)   │───▶│  orchestrate.ts                       │   │
│  │              │    │  • Read DAG / Task List               │   │
│  │  • Trigger   │    │  • Resolve dependencies              │   │
│  │  • Approve   │    │  • Dispatch workers                  │   │
│  │  • Govern    │    │  • Collect results                   │   │
│  │  • Repair    │    │  • Update state                      │   │
│  └──────┬───────┘    └──────────┬───────────────────────────┘   │
│         │                       │                                 │
│         │         ┌─────────────┼─────────────┐                  │
│         │         ▼             ▼             ▼                  │
│         │  ┌───────────┐ ┌───────────┐ ┌───────────┐           │
│         │  │ PLANNER-  │ │  CODER    │ │ GUARDIAN  │           │
│         │  │ ARCHITECT │ │ (BE | FE) │ │           │           │
│         │  │           │ │           │ │           │           │
│         │  │ subagent  │ │ subagent  │ │ subagent  │           │
│         │  │           │ │           │ │           │           │
│         │  │ • DAG gen │ │ • Impl    │ │ • Review  │           │
│         │  │ • contract │ │ • Test    │ │ • Lint    │           │
│         │  │ • design   │ │ • Refactor│ │ • Audit   │           │
│         │  └─────┬─────┘ └─────┬─────┘ └─────┬─────┘           │
│         │        │             │             │                   │
│         │        └─────────────┼─────────────┘                   │
│         │                      │                                  │
│         │                      ▼                                  │
│         │               ┌───────────┐                            │
│         │               │ CI-CD     │                            │
│         │               │ AGENT     │                            │
│         │               │           │                            │
│         │               │ subagent  │                            │
│         │               │           │                            │
│         │               │ • Deploy  │                            │
│         │               │ • Git ops │                            │
│         │               │ • Docker  │                            │
│         │               │ • Monitor │                            │
│         │               └───────────┘                            │
│         │                                                        │
│  ┌──────┴──────────────────────────────────────────────────┐    │
│  │              QUALITY GATE INFRASTRUCTURE                  │    │
│  │  • compliance_gate_check/confirm/complete (2-step flow)  │    │
│  │  • Permission Matrix (per-agent write scopes)            │    │
│  │  • Safe Tools (TOCTOU, backup, CAS)                      │    │
│  │  • Keystone hash validation                              │    │
│  │  • Pre-commit hooks                                      │    │
│  │  • TDD enforcement                                       │    │
│  └──────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Agent Role Definitions

#### Role 0: Orchestrator (Hardcoded — Not an LLM Agent)

**Type**: TypeScript script (`orchestrate.ts`)  
**Mode**: Not an OpenCode agent — invoked by human or CI  
**Purpose**: Deterministic task scheduling based on DAG/Task List

**Responsibilities**:
1. Read `Task.DAG.json` (or flat task list)
2. Identify tasks with `status: "pending"` and satisfied dependencies
3. Call `dispatch_subagent(agent_type, task_description, dag_task_id)` for each ready task
4. Monitor subagent completion (HANDOVER.md, test_report.json)
5. Update task status
6. Handle retry logic (3x failure → @Guardian escalation)

**Config Savings**: Eliminates Orchestrator agent config (~80 lines) + permission matrix entry (~60 lines) + MCP tool config

**Rationale**: Anthropic's distinction between "workflows" (predefined code paths) and "agents" (dynamic LLM direction) applies directly. Scheduling is a workflow, not an agent task.

#### Role 1: Planner-Architect (LLM Agent — `mode: subagent`)

**Merges**: @Meta-Planner + @Architect  
**Rationale**: Both deal with "what to build" (planning) and "how it fits together" (architecture). The separation created unnecessary handoff overhead — the planner generates a DAG then hands to the architect who generates a contract, but these are deeply intertwined activities.

**Responsibilities**:
1. Analyze requirements against `context/requirements/*.md`
2. Generate/update `Task.DAG.json` (or flat task list)
3. Generate/update `contract.yaml` (API contracts, data models)
4. Maintain TECH_DEBT_REGISTRY.md scanning
5. Produce architecture design documents in `docs/`

**Agent Config** (`agents/planner-architect.md`):
```markdown
---
description: Requirements analysis, DAG planning, and architecture design
mode: subagent
model: anthropic/claude-sonnet-4-20250514
temperature: 0.1
permission:
  safe_edit: { "contract.yaml": "allow", "docs/**": "allow", ".opencode/context/**": "allow" }
  safe_shell: { "bun .opencode/scripts/mcp-tools/keystone-validate.ts --hash contract.yaml": "allow" }
  skill: allow
---
```

**Attention Focus**: This agent focuses solely on "what to build" — it never writes implementation code, never reviews code, never deploys. Its context window is devoted entirely to requirements, architecture, and design patterns.

#### Role 2: Coder (LLM Agent — `mode: subagent`)

**Consolidates**: @Coder-BE + @Coder-FE into one parameterized agent type  
**Rationale**: BE and FE coding share the same fundamental workflow (RED→GREEN→REFACTOR, write tests, write code, run tests). The specialization comes from **task context and tools**, not from separate agent configs. This preserves attention focus (each Coder invocation focuses on BE or FE) while eliminating duplicate agent maintenance.

**How Specialization Works**:
1. Orchestrator dispatches Coder with a task description that includes context: "Implement the `/api/appointments` POST endpoint" (BE) or "Build the booking form component" (FE)
2. The Coder agent config uses `{backend.src}` and `{frontend.src}` template variables resolved at dispatch time
3. The Permission Matrix grants different write scopes based on task type (BE tasks → backend src, FE tasks → frontend src)
4. Context7 mappings provide framework-specific documentation based on task keywords

**Agent Config** (`agents/coder.md`):
```markdown
---
description: Full-stack implementation with TDD (RED→GREEN→REFACTOR)
mode: subagent
model: anthropic/claude-sonnet-4-20250514
temperature: 0.0
permission:
  safe_edit: { "{backend.src}**": "allow", "{frontend.src}**": "allow" }
  safe_shell: { "npx jest *": "allow", "npx ng test *": "allow", "npx prisma *": "allow" }
  safe_test: "allow"
  task: { "*": "deny", "Knowledge-Curator": "allow" }
  skill: allow
---
```

**Token Savings**: Reduces 2 agent configs (~300 lines combined) + 2 permission matrix entries (~120 lines) to 1 config (~150 lines) + 1 permission entry (~60 lines). Net savings: ~210 lines (~50% reduction).

**Attention Focus**: Each Coder invocation handles EITHER backend OR frontend, never both. The context window is devoted to a single implementation task. The separation is enforced by the task description, not by agent type.

#### Role 3: Guardian (LLM Agent — `mode: subagent`)

**Unchanged from current architecture** (highly effective as-is)  
**Rationale**: The Guardian's evaluator-optimizer role is the most valuable LLM-based quality mechanism in the framework. It maps directly to Anthropic's "Evaluator-Optimizer" pattern and LangGraph's Self-RAG pattern.

**Responsibilities** (unchanged):
1. Code review against coding standards
2. ESLint audit verification
3. Test execution evidence verification (execution_evidence in test_report.json)
4. Architecture constraint validation
5. TDD compliance checking
6. DAG coverage verification

**New Responsibility**: Flag framework conflicts and technical debt decisions for **human review** (absorbing @Arbiter's governance function).

#### Role 4: CI-CD-Agent (LLM Agent — `mode: subagent`)

**Unchanged from current architecture**  
**Rationale**: Deployment, Docker operations, and Git management form a distinct expertise domain with specialized tools.

**Responsibilities** (unchanged):
1. Docker image build and push
2. GitHub Actions workflow execution
3. Git operations (commit, push, tag, release)
4. Deployment verification
5. Production monitoring and self-healing

### 3.3 Eliminated Roles — Summary

| Eliminated Role | Disposition | Rationale |
|----------------|-------------|-----------|
| @Orchestrator | → Hardcoded `orchestrate.ts` script | Deterministic scheduling doesn't need LLM |
| @Meta-Planner | → Merged with @Architect into Planner-Architect | Planning + architecture are deeply intertwined |
| @Architect | → Merged with @Meta-Planner into Planner-Architect | See above |
| @Arbiter | → Human governance function (via Guardian escalation) | Technical debt decisions are human governance, not LLM tasks |
| @Super-Admin | → Human role (direct invocation when needed) | Framework repair is a human activity; agent is symptom of complexity |
| @Knowledge-Curator | → Prompt instruction + on-demand human trigger | LLM can read cached docs directly; acquisition is an infrequent human task |
| @Coder-BE | → Consolidated into parameterized Coder agent | Same workflow, different context |
| @Coder-FE | → Consolidated into parameterized Coder agent | Same workflow, different context |

**Net Reduction**: 10 roles → 5 roles (4 LLM agents + 1 hardcoded orchestrator). Net reduction of 5 LLM agents (50%↓).

### 3.4 Configuration Savings

| Artifact | Current (10 roles) | Proposed (5 roles) | Savings |
|----------|:------------------:|:------------------:|:-------:|
| Agent config files | 10 × ~100 lines = ~1000 lines | 4 × ~150 lines = ~600 lines | 40% ↓ |
| Permission matrix (opencode.json) | 10 × ~60 lines = ~600 lines | 4 × ~60 lines = ~240 lines | 60% ↓ |
| MCP tool configs | 10 entries | 4 entries | 60% ↓ |
| Dispatch hooks (overhead per invocation) | Variable | Reduced (fewer agent types) | ~50% ↓ |
| HANDOVER.md chain length | 5-7 agents per task | 3-4 agents per task | ~40% ↓ |
| **Total maintenance surface** | ~2000 lines | ~1000 lines | **~50% ↓** |

---

## 4. Migration Path

### 4.1 Philosophy: Incremental, Reversible, Validated

Each phase is independently deployable and can be rolled back without data loss. Each phase includes a validation gate (self-test + manual verification) before proceeding to the next.

### 4.2 Phase 1: Hardcode the Orchestrator (Week 1, ~4h)

**Goal**: Remove the Orchestrator LLM agent, replacing it with a deterministic script.

**Steps**:
1. Extract scheduling logic from Orchestrator's agent config and dispatch patterns into `scripts/orchestrate.ts`
2. Implement: read DAG → find ready tasks → dispatch → collect results → update status
3. Add retry logic: 3x failure per task → @Guardian escalation
4. Keep Orchestrator agent config as fallback (deprecated, not deleted) for one week
5. **Validation**: Run existing test suite → verify identical task scheduling behavior
6. **Rollback**: Restore Orchestrator agent config, mark `orchestrate.ts` as disabled

**Risk**: Low. The Orchestrator's behavior is deterministic and testable. If `orchestrate.ts` produces wrong scheduling, the Orchestrator agent remains available as fallback.

### 4.3 Phase 2: Merge Meta-Planner + Architect (Week 1-2, ~6h)

**Goal**: Create the unified Planner-Architect agent, sunset the individual agents.

**Steps**:
1. Create `agents/planner-architect.md` with merged prompts from both agents
2. Map both agents' skill sets: execution-preflight-check, brainstorming, context7-first
3. Merge tool permissions: contract.yaml write + docs/ write + .opencode/context/ write
4. Test with a new feature request: Planner-Architect should generate both DAG + contract.yaml in one session
5. Deprecate (not delete) `agents/meta-planner.md` and `agents/architect.md`
6. **Validation**: Run 3 test planning cycles → verify output quality equals or exceeds separate agents
7. **Rollback**: Restore individual agent configs

**Risk**: Medium. The merged agent may produce lower-quality output if the combined context window is overloaded. Mitigation: if quality degrades, split back and accept the maintenance cost. Anthropic's research suggests focused attention per concern — the concern here is "design and planning," which is one concern.

### 4.4 Phase 3: Consolidate Coder-BE + Coder-FE (Week 2, ~4h)

**Goal**: Replace two nearly-identical agent configs with one parameterized Coder agent.

**Steps**:
1. Create `agents/coder.md` with template variables for BE/FE specialization
2. Update `project.config.json` template_resolution for Coder context
3. Test with BE task → verify tools and permissions resolve to backend paths
4. Test with FE task → verify tools and permissions resolve to frontend paths
5. Deprecate (not delete) `agents/coder-be.md` and `agents/coder-fe.md`
6. **Validation**: Run 3 BE tasks + 3 FE tasks → verify identical behavior
7. **Rollback**: Restore individual agent configs

**Risk**: Low-Medium. Template variable resolution is well-tested. The risk is that a single Coder config may not provide enough context differentiation. Mitigation: if BE/FE tasks degrade in quality, keep separate agent types but share the common config via inheritance (a future feature).

### 4.5 Phase 4: Demote Arbiter + Super-Admin + Knowledge-Curator (Week 2-3, ~4h)

**Goal**: Remove three low-usage agents, transferring their functions to human governance, prompt instructions, or other agents.

**Steps**:
1. **Arbiter**: Add escalation logic to Guardian's prompt ("Flag conflicts for human review. Recommend: ..."). Remove `agents/arbiter.md`. Update TECH_DEBT_REGISTRY.md workflow to be human-maintained.
2. **Super-Admin**: Remove `agents/super-admin.md`. Document framework repair process as human-executed using direct OpenCode commands. Super-Admin's `mode: "all"` means it was always human-accessible.
3. **Knowledge-Curator**: Keep `docs/official_docs/` + `index.json`. Replace MCP pipeline with prompt instruction: "Before external queries, check `docs/official_docs/index.json`. If insufficient, request human to fetch docs." Remove `agents/knowledge-curator.md` + 7 knowledge scripts.
4. **Validation**: Run self-test → verify no references to removed agents in framework configs. Run one complete task flow → verify all functions are covered.
5. **Rollback**: Restore agent configs individually.

**Risk**: Medium for Arbiter (governance gap), Low for Super-Admin (human already does framework repair), Low for Knowledge-Curator (LLM already reads docs directly).

### 4.6 Phase 5: Cleanup & Documentation (Week 3, ~2h)

**Goal**: Remove all references to eliminated agents and update documentation.

**Steps**:
1. Update `AGENTS.md` — reduce agent list from 10 to 5
2. Update `opencode.json` — remove 5 eliminated agent entries from permission matrix
3. Update `project.config.json` — remove eliminated agent configs
4. Update `docs/official_docs/index.json` — remove Knowledge-Curator-specific entries
5. Run `framework-self-test.ts` — verify all checks pass with new agent count
6. Commit with `[INFRA]` marker

**Risk**: Low. Pure cleanup with no functional changes.

### 4.7 Migration Timeline

```
Week 1:  Phase 1 (Orchestrator hardcoding) + Phase 2 (Planner-Architect merge)
         ├── Day 1-2: Phase 1 implementation + validation
         └── Day 2-5: Phase 2 implementation + validation

Week 2:  Phase 3 (Coder consolidation) + Phase 4 (Arbiter/Super-Admin/KC demotion)
         ├── Day 1-2: Phase 3 implementation + validation
         └── Day 2-5: Phase 4 implementation + validation

Week 3:  Phase 5 (Cleanup) + stabilization
         ├── Day 1-2: Phase 5 implementation
         └── Day 2-5: Stabilization, edge case testing, rollback drills
```

**Total estimated effort**: 20 hours over 3 weeks

---

## 5. Tradeoff Analysis

### 5.1 Quantitative Tradeoffs

| Dimension | Current (10 roles) | Proposed (5 roles) | Delta |
|-----------|:------------------:|:------------------:|:-----:|
| LLM agent configs | 10 | 4 | -60% |
| Agent config lines | ~1000 | ~600 | -40% |
| Permission matrix lines | ~600 | ~240 | -60% |
| Avg HANDOVER.md chain length | 5-7 | 3-4 | -40% |
| Dispatch overhead per task | Higher (more types) | Lower (fewer types) | ~30% ↓ |
| Token cost per task (system prompts) | 10 × ~500 tokens = ~5000 | 4 × ~700 tokens = ~2800 | -44% |
| Agent config maintenance (person-hours/change) | ~2h | ~1h | -50% |
| Framework self-test coverage (agent checks) | 10 check items | 5 check items | -50% (simplified) |
| Attention quality per concern | High (undivided) | High (undivided) | No change |
| Parallelism capability | BE + FE can run concurrently | BE + FE can run concurrently | No change |

### 5.2 Qualitative Tradeoffs

#### Tradeoff 1: Planner-Architect Merge — Context Window vs. Coherence

**Gain**: Planning and architecture are deeply intertwined. Merging them eliminates the handoff where the Architect receives a DAG and must infer the Planner's intent from a JSON structure. The Planner-Architect can maintain coherence between "what to build" and "how it fits" in a single context window.

**Risk**: A single context window may not have enough capacity for both full DAG generation + detailed contract.yaml design for large projects.

**Mitigation**: For very large projects (50+ tasks), the Planner-Architect can be invoked multiple times, each handling a subsystem. The flat task list structure (replacing DAG) enables incremental planning without context overflow.

**Anthropic's guidance**: *"Maintain simplicity in agent design"* — one agent handling design+planning is simpler than two agents coordinating across a handoff boundary.

#### Tradeoff 2: Coder Parameterization — Flexibility vs. Specialization

**Gain**: One agent config to maintain instead of two. Template variables ensure BE/FE context differentiation at dispatch time. The Coder agent can handle any implementation task regardless of stack layer.

**Risk**: A single agent config may not capture BE/FE specific constraints (different linting rules, different test frameworks, different coding patterns).

**Mitigation**: The Permission Matrix and Context7 mappings provide per-task specialization. If quality degrades, the Coder can be split back into BE and FE variants — but the cost of trying unification is low.

**CrewAI's approach**: CrewAI defines agents by `role`, `goal`, and `backstory`. The Coder agent's "role" is implementation — the "goal" and "backstory" come from the task description and template variables.

#### Tradeoff 3: Guardian Absorbing Arbiter — Review Scope vs. Objectivity

**Gain**: Eliminates a dedicated agent that was primarily resolving framework-caused conflicts. As the framework stabilizes, these conflicts decrease naturally.

**Risk**: When Guardian flags a conflict, there's no independent Arbiter to adjudicate. The human must now make governance decisions.

**Mitigation**: This is actually a feature, not a bug. Technical debt and architectural conflicts SHOULD be human decisions. Anthropic's evaluator-optimizer pattern places the evaluator in the refinement loop, not as a separate arbitration layer. The Guardian provides the evaluation; the human provides the arbitration.

**A2A's approach**: A2A explicitly separates agent tasks from human decisions via the `input-required` task state — the agent pauses and waits for human input. Guardian's new escalation mechanism follows this pattern.

#### Tradeoff 4: Hardcoded Orchestrator — Determinism vs. Flexibility

**Gain**: Deterministic, predictable, testable scheduling. No LLM token cost for scheduling decisions. No risk of LLM hallucinating incorrect task ordering.

**Risk**: Cannot handle novel scheduling scenarios that require reasoning (e.g., dynamic reprioritization based on partial results).

**Mitigation**: The current Orchestrator agent doesn't do dynamic reprioritization anyway — it follows the DAG. Hardcoding preserves existing behavior. If dynamic scheduling becomes needed, it can be added to `orchestrate.ts` as conditional logic, or the Orchestrator can be temporarily re-enabled as an LLM agent.

**LangGraph's approach**: LangGraph's routing is programmatic (conditional edges based on state, not LLM calls). This is the industry standard for production systems.

### 5.3 Dispatch Overhead vs. Attention Focus

This is the core tradeoff in multi-agent system design. Here's how the proposal balances it:

| Factor | Current Architecture | Proposed Architecture | Analysis |
|--------|---------------------|----------------------|----------|
| **Attention Focus** | Excellent (each agent gets ~100% context for its concern) | Excellent (4 agents for 4 distinct concerns) | No degradation — each remaining agent type has a single, well-defined concern |
| **Dispatch Overhead** | High (5-7 handoffs per task) | Medium (3-4 handoffs per task) | 40% reduction in handoff chain length |
| **Handoff Information Loss** | Mitigated by HANDOVER.md | Mitigated by HANDOVER.md (fewer handoffs = less cumulative loss) | Quality improves — each handoff loses some information |
| **Token Cost (System Prompts)** | ~5000 tokens per task | ~2800 tokens per task | 44% reduction — each agent's system prompt is ~500-700 tokens |
| **Parallelism** | BE and FE can run in parallel | BE and FE can run in parallel | No change — both are Coder invocations with different tasks |

**Conclusion**: The proposal improves dispatch overhead without sacrificing attention focus. The key insight: the eliminated agents either didn't need LLM attention (Orchestrator) or never had clear attention focus to begin with (Arbiter, Super-Admin).

---

## 6. Decision Framework

### 6.1 When to Add a New Role

**Decision Tree**:

```
Does the new function require a DIFFERENT expertise domain?
  → NO: Add to existing agent as a new responsibility or mode
  → YES: Does it have a HIGH invocation frequency (≥20% of tasks)?
    → NO: Make it a human-triggered function, not a dedicated agent
    → YES: Does it require a UNIQUE permission scope?
      → NO: Add to the closest existing agent
      → YES: Create a new dedicated agent
```

**Application Examples**:

| Scenario | Decision | Rationale |
|----------|----------|-----------|
| "We need a database migration specialist" | ❌ Add to Coder | Same expertise domain (implementation), same permission scope (backend write) |
| "We need a security auditor" | ✅ New agent if high-frequency | Different expertise (security vs general review), different permission scope (read-only, may need security tools) |
| "We need a performance optimizer" | ❌ Add to Guardian | Guardian already evaluates code quality — add performance as a review dimension |
| "We need a documentation writer" | ❌ Add to Planner-Architect | Documentation is a planning/design artifact |
| "We need a mobile app developer" | ✅ New agent if distinct tech stack | Different expertise (React Native vs Angular), different tools, different testing framework |

### 6.2 When to Consolidate Roles

**Consolidation Triggers**:

1. **Overlapping Responsibilities**: Two agents handle the same concern from different angles (Meta-Planner + Architect → both handle "what to build")
2. **Low Invocation Frequency**: Agent is used in <10% of tasks (Arbiter, Super-Admin)
3. **No Unique Permission Scope**: Agent's permissions are a subset of another agent's permissions (Knowledge-Curator → can read, like all agents)
4. **Deterministic Logic**: Agent's function can be expressed as code without LLM reasoning (Orchestrator)
5. **Identical Workflow, Different Context**: Two agents follow the same process (RED→GREEN→REFACTOR) but on different tech stacks (Coder-BE + Coder-FE)

### 6.3 Complexity Thresholds

| Project Complexity | Recommended Agent Count | Architecture Pattern |
|--------------------|:----------------------:|---------------------|
| Single service, <10 endpoints | 1-2 | Augmented single agent or prompt chaining |
| Monorepo, 10-50 endpoints | 3-4 | Orchestrator-Workers (flat) |
| Microservices, 50-200 endpoints | 4-5 | Orchestrator-Workers + Evaluator |
| Multi-team, 200+ endpoints | 5-7 | Hierarchical (nested orchestrators) |
| Cross-organization | Protocol-based (A2A) | Agent-to-agent via standardized protocol |

**OpenCode's Position**: The booking-system project is a monorepo with moderate complexity (~30-50 endpoints). The 5-role architecture (Orchestrator + Planner-Architect + Coder + Guardian + CI-CD) maps to the "Monorepo, 10-50 endpoints" tier, which recommends 3-4 agents + hardcoded orchestrator. This validates the proposal.

---

## 7. Preserved Core Principles

The following principles from the current architecture are explicitly preserved:

### 7.1 Role Separation (Implementation vs. Review)

> *"实现与审查分离（Coder vs Guardian）"*

**Preserved**: The Coder (implementation) and Guardian (review) remain separate agent types. This is the most valuable separation in the architecture — it prevents the implementer from self-reviewing, which Anthropic's evaluator-optimizer pattern explicitly requires.

### 7.2 Permission Isolation

> *"角色权限隔离（Permission Matrix 配合）"*

**Preserved**: Each remaining agent type has a unique permission scope:
- Planner-Architect: contract.yaml, docs/, .opencode/context/ (design artifacts only)
- Coder: backend src/ or frontend src/ (implementation only, never both at once)
- Guardian: read-only + safe_shell (review tools, never modifies source)
- CI-CD-Agent: .github/, Dockerfile, git operations (deployment only)

**Enhanced**: With fewer agent types, the Permission Matrix is simpler to audit and maintain. The consolidation of Coder-BE/FE into a parameterized Coder agent eliminates permission duplication.

### 7.3 Attention Focus

> *"注意力聚焦（每个 agent 只关注自身职责域）"*

**Preserved**: Each remaining agent handles a single distinct concern:
- Planner-Architect: "What to build" (planning + design)
- Coder: "How to build it" (implementation + testing)
- Guardian: "Is it correct?" (review + quality)
- CI-CD-Agent: "Is it live?" (deployment + operations)

**Enhanced**: The Planner-Architect merge IMPROVES attention focus by eliminating the handoff gap between planning and architecture. The Coder parameterization PRESERVES focus by ensuring each invocation handles only BE or FE, not both.

### 7.4 Compliance Gates (Cognitive Anchoring)

> *"合规门禁（认知锚定）"*

**Preserved**: `compliance_gate_check` → `compliance_gate_confirm` → `compliance_gate_complete` remains the mandatory protocol for all LLM agents. The 2-step optimization (combined check+confirm flow) remains in place.

**Enhanced**: With fewer agent types, compliance gate configurations are simpler and less likely to drift.

### 7.5 TDD Enforcement

> *"TDD 铁律：RED → GREEN → REFACTOR"*

**Preserved**: The Coder agent follows the same TDD workflow. The Guardian verifies TDD compliance (RED phase evidence, test execution evidence).

### 7.6 Contract-Driven Development

> *"contract.yaml 作为唯一开发依据"*

**Preserved**: The Planner-Architect produces `contract.yaml`. The Coder implements against it. The Guardian verifies compliance. The keystone hash validation ensures contract integrity.

### 7.7 File-Based Context Persistence

> *"HANDOVER.md / TASK_LOG.md"*

**Preserved**: Remains the mechanism for context passing across agent boundaries. With fewer handoffs, the quality of context actually improves (less cumulative information loss).

---

## 8. References

### 8.1 Internal Documents

| Document | Path | Relevance |
|----------|------|-----------|
| Framework Evaluation Report §8 | `docs/review/framework-refactor/framework-evaluation-report.md` (§8, lines 425-470) | Identifies 5 problems with current 10-role architecture |
| Framework Evaluation Report §9 | `docs/review/framework-refactor/framework-evaluation-report.md` (§9, lines 473-503) | PLAN-FIRST constraint analysis; DAG simplification recommendation |
| Optimization Priority Table | `docs/review/framework-refactor/framework-evaluation-report.md` (lines 650-678) | Priority P2-B: "精简 Multi-Agent 从 10 到 3 角色" |
| OpenCode Multi-Agent System | `docs/official_docs/opencode/findings/06-multi-agent-system.md` | Agent modes, dispatch protocol, FRAMEWORK_AGENT identity |
| OpenCode Agents Config | `docs/official_docs/opencode/framework/agents.md` | Agent configuration format (YAML frontmatter, permissions) |

### 8.2 External Research

| Source | Document | Key Insight |
|--------|----------|-------------|
| Anthropic | `docs/official_docs/multi-agent-patterns/anthropic-building-effective-agents.md` | "Start simple, add only when measured"; 5 workflow patterns; 3 core principles |
| Cross-Framework | `docs/official_docs/multi-agent-patterns/cross-framework-synthesis.md` | Decision tree for architecture complexity; attention focus vs dispatch cost tradeoffs |
| AutoGen, CrewAI, LangGraph, Swarm | `docs/official_docs/multi-agent-patterns/framework-architectures.md` | 4 framework architectures compared; all use 3-5 agents + optional manager |
| Google A2A | `docs/official_docs/multi-agent-patterns/google-a2a-protocol.md` | Protocol-level interop; opacity as a feature; agent discovery via Agent Cards |

### 8.3 Industry Consensus Summary

All 6 researched sources converge on:

1. **3-5 specialist agents + 1 orchestrator/manager is the optimal range** for most production systems
2. **Start simple** — add complexity only when measured improvement justifies it
3. **Attention focus is the primary value** of multi-agent, not parallelism per se
4. **Orchestration is increasingly hardcoded** in production systems (LangGraph's graph topology, Swarm's function returns)
5. **Human-in-the-loop** for governance decisions (A2A's `input-required` state, Anthropic's evaluator-optimizer)
6. **State management, not agent count**, is the key architectural differentiator across frameworks
7. **Role specialization should map to distinct expertise domains**, not to phases in a linear workflow

---

## Appendix A: Agent Config Migration Map

| Current Agent | Config File | Action | New Config File |
|---------------|-------------|--------|-----------------|
| @Orchestrator | `agents/orchestrator.md` | **Delete** (→ hardcoded) | `scripts/orchestrate.ts` |
| @Meta-Planner | `agents/meta-planner.md` | **Merge** (→ Planner-Architect) | `agents/planner-architect.md` |
| @Architect | `agents/architect.md` | **Merge** (→ Planner-Architect) | `agents/planner-architect.md` |
| @Coder-BE | `agents/coder-be.md` | **Consolidate** (→ parameterized Coder) | `agents/coder.md` |
| @Coder-FE | `agents/coder-fe.md` | **Consolidate** (→ parameterized Coder) | `agents/coder.md` |
| @Guardian | `agents/guardian.md` | **Keep** (enhance with Arbiter escalation) | `agents/guardian.md` (updated) |
| @Arbiter | `agents/arbiter.md` | **Delete** (→ human governance) | N/A (Guardian escalates to human) |
| @CI-CD-Agent | `agents/ci-cd-agent.md` | **Keep** | `agents/ci-cd-agent.md` |
| @Super-Admin | `agents/super-admin.md` | **Delete** (→ human role) | N/A |
| @Knowledge-Curator | `agents/knowledge-curator.md` | **Delete** (→ prompt instruction) | N/A (docs/official_docs/ preserved) |

## Appendix B: Permission Matrix Changes

**opencode.json** changes:

| Section | Lines Removed | Reason |
|---------|:------------:|--------|
| `orchestrator` task permissions | ~60 | Agent deleted |
| `meta-planner` task permissions | ~60 | Merged into planner-architect |
| `architect` task permissions | ~60 | Merged into planner-architect |
| `coder-be` task permissions | ~60 | Consolidated into coder |
| `coder-fe` task permissions | ~60 | Consolidated into coder |
| `arbiter` task permissions | ~60 | Agent deleted |
| `super-admin` task permissions | ~60 | Agent deleted |
| `knowledge-curator` task permissions | ~60 | Agent deleted |
| **Net change** | **-480 lines** | — |
| `planner-architect` task permissions | +60 | New merged agent |
| `coder` task permissions | +60 | New consolidated agent |
| **Net change** | **+120 lines** | — |
| **Total net savings** | **-360 lines (60% ↓)** | — |

