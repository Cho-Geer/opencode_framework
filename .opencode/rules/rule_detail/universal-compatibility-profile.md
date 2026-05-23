# Universal Compatibility Profile — Multi-Stack Conformance Levels

**Version**: v2.0.0
**Created**: 2026-05-23
**Author**: @Architect (RVW-REVIEW-09)
**Applies To**: All `.opencode/agents/*.md`, `.opencode/rules/**/*.md`, `.opencode/skills/**/SKILL.md`, `.opencode/subagent-preamble.md`, `project.config.json`
**Supersedes**: `COMPATIBILITY_PROFILE.md` (v1.0.0) — this document adds conformance-level categorization missing from v1
**References**:

- [TEMPLATE_VARIABLE_STANDARD.md](./TEMPLATE_VARIABLE_STANDARD.md)
- [COMPATIBILITY_PROFILE.md](./COMPATIBILITY_PROFILE.md) — detailed tech-stack override tables
- [enforcement-modes-standard.md](./enforcement-modes-standard.md)

---

## §1 Overview

### §1.1 Purpose

This document defines the **universal compatibility conformance levels** for the OpenCode Framework's multi-agent system. While [COMPATIBILITY_PROFILE.md](./COMPATIBILITY_PROFILE.md) documents the "how" (which `project.config.json` keys to change per stack), this document defines the "what" — **which features of the multi-agent system work for each stack category, and what must be built to bridge the gaps**.

### §1.2 Conformance Levels

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  NATIVE      ████████████████████████████████████████████████  All features   │
│  COMPATIBLE  ████████████████████████████████░░░░░░░░░░░░░░░░  Core + adapters│
│  PARTIAL     ████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  Major adapters │
│  MINIMAL     ████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  Workflow only  │
└──────────────────────────────────────────────────────────────────────────────┘
```

| Level          | Tech Stack Examples                                           | Key Characteristic                                       |
| -------------- | ------------------------------------------------------------- | -------------------------------------------------------- |
| **Native**     | Angular 21+ / NestJS 11+ / Prisma 7.x / Redis 7.x / BullMQ    | All 28 placeholders resolve natively; zero adapter work  |
| **Compatible** | React 19+ or Next.js / Express or Fastify / Prisma or TypeORM | Same JS/TS ecosystem; framework-specific adapters needed |
| **Partial**    | Vue 3 or Svelte / Django or Flask or Go / SQLAlchemy or GORM  | Different ecosystem; custom adapter contracts required   |
| **Minimal**    | Any stack (Ruby on Rails, Phoenix, Laravel, .NET, etc.)       | Only AGENTS.md + DAG + contract.yaml meta-workflow       |

### §1.3 Feature Catalog

The OpenCode multi-agent system comprises **8 agent roles**, **40 template variables** (28 dispatch-resolvable + 12 extended), **19 skills**, **11 quality gates**, and **3 enforcement modes**. This document classifies each feature by its availability at each conformance level.

---

## §2 Feature Classification Matrix

### §2.1 Legend

| Symbol | Meaning                                       |
| :----: | --------------------------------------------- |
|   ✅   | Works out-of-box; no changes needed           |
|   🔧   | Requires adapter implementation               |
|   ⚠️   | Available with constraints/partial coverage   |
|   ❌   | Unavailable; must be rebuilt for target stack |
|  N/A   | Not applicable to this conformance level      |

---

### §2.2 Core Workflow Features

| #    | Feature                                    | Native | Compatible | Partial | Minimal | Notes                                              |
| :--- | :----------------------------------------- | :----: | :--------: | :-----: | :-----: | :------------------------------------------------- |
| WF1  | AGENTS.md multi-agent protocol             |   ✅   |     ✅     |   ✅    |   ✅    | Framework-agnostic; only text references to agents |
| WF2  | Task.DAG.json planning & scheduling        |   ✅   |     ✅     |   ✅    |   ✅    | JSON format; no code dependencies                  |
| WF3  | contract.yaml interface contracts          |   ✅   |     ✅     |   ✅    |   ✅    | YAML format; stack-agnostic                        |
| WF4  | Project.graph dependency graph             |   ✅   |     ✅     |   ✅    |   ✅    | @Meta-Planner output; framework-agnostic           |
| WF5  | compliance_gate_check/confirm/complete     |   ✅   |     ✅     |   ✅    |   ✅    | Node.js scripts; works with any stack              |
| WF6  | enforcement-modes (advisory/strict/locked) |   ✅   |     ✅     |   ✅    |   ✅    | Config-driven in project.config.json               |
| WF7  | TECH_DEBT_REGISTRY.md tracking             |   ✅   |     ✅     |   ✅    |   ✅    | Markdown file; no code dependencies                |
| WF8  | WAIVE.md + @Arbiter adjudication           |   ✅   |     ✅     |   ✅    |   ✅    | Workflow-only feature                              |
| WF9  | Pre-commit hook (keystone hash, TDD order) |   ✅   |     ✅     |   ✅    |   ✅    | Shell scripts; OS-level feature                    |
| WF10 | Pre-execution DAG gate hook                |   ✅   |     ✅     |   ✅    |   ✅    | Shell script; validates Task.DAG.json              |

---

### §2.3 Agent Roles

| #   | Feature                                       | Native | Compatible | Partial | Minimal | Notes                                                                                                                                                 |
| :-- | :-------------------------------------------- | :----: | :--------: | :-----: | :-----: | :---------------------------------------------------------------------------------------------------------------------------------------------------- |
| AG1 | @Meta-Planner (DAG generation)                |   ✅   |     ✅     |   ✅    |   ✅    | Reads requirement docs; framework-agnostic                                                                                                            |
| AG2 | @Orchestrator (DAG scheduling)                |   ✅   |     ✅     |   ✅    |   ✅    | Reads Task.DAG.json only; no code interaction                                                                                                         |
| AG3 | @Architect (contract.yaml, architecture docs) |   ✅   |     ✅     |   ✅    |   ✅    | Framework-agnostic design role                                                                                                                        |
| AG4 | @Guardian (code review, quality gates)        |   ✅   |     🔧     |   🔧    |   ⚠️    | **Compatible**: per-framework checklists exist for React/Vue/Express/Fastify; **Partial**: add new checklist rows; **Minimal**: universal checks only |
| AG5 | @Arbiter (conflict resolution)                |   ✅   |     ✅     |   ✅    |   ✅    | Workflow role; reads WAIVE.md, TECH_DEBT_REGISTRY.md                                                                                                  |
| AG6 | @CI-CD-Agent (deployment, Docker)             |   ✅   |     🔧     |   🔧    |   ⚠️    | **Compatible**: Dockerfile/CI templates need framework-specific adjustments; **Minimal**: user-provided CI/CD                                         |
| AG7 | @Coder-BE (backend implementation)            |   ✅   |     🔧     |   🔧    |   ❌    | Requires framework-specific agent config and coding standards                                                                                         |
| AG8 | @Coder-FE (frontend implementation)           |   ✅   |     🔧     |   🔧    |   ❌    | Requires framework-specific agent config and coding standards                                                                                         |

---

### §2.4 Template Variable Resolution

| #   | Feature                                        | Native | Compatible | Partial | Minimal | Notes                                                                                                           |
| :-- | :--------------------------------------------- | :----: | :--------: | :-----: | :-----: | :-------------------------------------------------------------------------------------------------------------- |
| TV1 | 28 dispatch-resolvable placeholders            |   ✅   |     ✅     |   ✅    |   ✅    | All resolve from project.config.json                                                                            |
| TV2 | 12 extended placeholders (in-document mapping) |   ✅   |     🔧     |   🔧    |   ⚠️    | **Compatible/Partial**: mapping table entries needed for new frameworks; **Minimal**: use generic fallback text |
| TV3 | dispatch-subagent.js resolver engine           |   ✅   |     ✅     |   ✅    |   ✅    | Node.js universal; resolves all `{key}` patterns                                                                |
| TV4 | framework-self-test.js Check 17/18             |   ✅   |     ✅     |   ✅    |   ✅    | Validates placeholder resolution; language-agnostic                                                             |

---

### §2.5 Coding Standards

| #   | Feature                                            | Native | Compatible | Partial | Minimal | Notes                                                                                                                                   |
| :-- | :------------------------------------------------- | :----: | :--------: | :-----: | :-----: | :-------------------------------------------------------------------------------------------------------------------------------------- |
| CS1 | coding-standard-common.md (Tier 1 universal)       |   ✅   |     ✅     |   ✅    |   ✅    | Fully framework-agnostic                                                                                                                |
| CS2 | backend-coding-standard.md Tier 2 (parameterized)  |   ✅   |     🔧     |   🔧    |   ❌    | **Compatible**: Express/Fastify overrides exist in COMPATIBILITY_PROFILE.md §4.1; **Partial**: author new `template_resolution` entries |
| CS3 | frontend-coding-standard.md Tier 2 (parameterized) |   ✅   |     🔧     |   🔧    |   ❌    | **Compatible**: React/Vue overrides exist in COMPATIBILITY_PROFILE.md §4.2; **Partial**: author new entries                             |
| CS4 | test-coding-standard.md                            |   ✅   |     🔧     |   🔧    |   ⚠️    | **Compatible/Partial**: Jest→Vitest/pytest mapping needed; **Minimal**: universal TDD rules only                                        |

---

### §2.6 Guardian Review Gates

| #   | Feature                                  | Native | Compatible | Partial | Minimal | Notes                                                                                                                                                                |
| :-- | :--------------------------------------- | :----: | :--------: | :-----: | :-----: | :------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GR1 | Layer A Auto Gate (machine.json checks)  |   ✅   |     ✅     |   ✅    |   ✅    | Reads machine.json; no framework dependency                                                                                                                          |
| GR2 | Layer B Manual Review — universal checks |   ✅   |     ✅     |   ✅    |   ✅    | TDD evidence, coverage, no-any, file size limits                                                                                                                     |
| GR3 | Backend framework-specific checklists    |   ✅   |     ✅     |   🔧    |   ❌    | **Native**: NestJS full checklist; **Compatible**: Express/Fastify checklists pre-defined; **Partial**: add new rows (Django/Go/Spring); **Minimal**: universal only |
| GR4 | Frontend framework-specific checklists   |   ✅   |     ✅     |   🔧    |   ❌    | **Native**: Angular full checklist; **Compatible**: React/Vue checklists pre-defined; **Partial**: add Svelte row; **Minimal**: universal only                       |
| GR5 | ESLint mock-audit (CAT3.7)               |   ✅   |     ✅     |   ✅    |   ✅    | Uses project-specific ESLint config; tooling-agnostic                                                                                                                |
| GR6 | Write-audit integrity (CAT5.1)           |   ✅   |     ✅     |   ✅    |   ✅    | Tracks file changes; no framework dependency                                                                                                                         |
| GR7 | TDD order enforcement (CAT5.2)           |   ✅   |     ✅     |   ✅    |   ✅    | Compares file timestamps; language-agnostic                                                                                                                          |
| GR8 | Docs consistency check (DOC-CAT1.0)      |   ✅   |     ✅     |   ✅    |   ✅    | Checks TASK_LOG.md presence; workflow feature                                                                                                                        |

---

### §2.7 Skills (Agent Capabilities)

| #    | Feature                               | Native | Compatible | Partial | Minimal | Notes                                                                                                                      |
| :--- | :------------------------------------ | :----: | :--------: | :-----: | :-----: | :------------------------------------------------------------------------------------------------------------------------- |
| SK1  | execution-preflight-check             |   ✅   |     ✅     |   ✅    |   ✅    | Framework-agnostic P0 protocol                                                                                             |
| SK2  | context7-first (tech doc queries)     |   ✅   |     🔧     |   🔧    |   ⚠️    | **Compatible/Partial**: requires context7_task_mapping updates for new stacks; **Minimal**: may not have Context7 coverage |
| SK3  | brainstorming (requirements→design)   |   ✅   |     ✅     |   ✅    |   ✅    | Language/framework agnostic                                                                                                |
| SK4  | multi-agent-orchestration             |   ✅   |     ✅     |   ✅    |   ✅    | Meta-skill; coordinates all 8 agents                                                                                       |
| SK5  | devops-ci-cd-guardrails               |   ✅   |     🔧     |   🔧    |   ⚠️    | **Compatible**: Dockerfile templates need adjustment; **Minimal**: user-provided CI                                        |
| SK6  | fullstack-ci-cd-guardrails            |   ✅   |     🔧     |   🔧    |   ⚠️    | Same as SK5; Docker/CI templates                                                                                           |
| SK7  | global-cicd-practices-enforcement     |   ✅   |     ✅     |   ✅    |   ✅    | Best-practice rules; stack-agnostic                                                                                        |
| SK8  | cicd-database-seeding (generic)       |   ✅   |     🔧     |   🔧    |   ❌    | **Compatible**: Section 1 generic CI/CD seeding works; **Partial**: ORM-specific Section 2 needs new entries               |
| SK9  | cross-directory-ci                    |   ✅   |     ✅     |   ✅    |   ✅    | CWD management; OS-level, stack-agnostic                                                                                   |
| SK10 | spreadsheet-processor                 |   ✅   |     ✅     |   ✅    |   ✅    | Excel/CSV parsing; no framework dependency                                                                                 |
| SK11 | new-asset-integrator                  |   ✅   |     ✅     |   ✅    |   ✅    | MCP/skill registration; framework-agnostic                                                                                 |
| SK12 | customize-opencode                    |   ✅   |     ✅     |   ✅    |   ✅    | OpenCode config editing; framework-agnostic                                                                                |
| SK13 | (deprecated) nextjs-router-guardrails |   ❌   |     🔧     |   ❌    |   ❌    | Replaced by SK6; Next.js-specific guardrails only for React/Next stacks                                                    |
| SK14 | (deprecated) prisma-seed-cicd         |   ✅   |     ❌     |   ❌    |   ❌    | Replaced by SK8; Prisma-specific Section 2 works for Native only                                                           |

---

### §2.8 State Machine & Quality Gates

| #   | Feature                                    | Native | Compatible | Partial | Minimal | Notes                                                                                                                  |
| :-- | :----------------------------------------- | :----: | :--------: | :-----: | :-----: | :--------------------------------------------------------------------------------------------------------------------- |
| SM1 | machine.json (state tracking)              |   ✅   |     ✅     |   ✅    |   ✅    | JSON state file; no framework dependency                                                                               |
| SM2 | gate-state.json (session tracking)         |   ✅   |     ✅     |   ✅    |   ✅    | JSON session state; framework-agnostic                                                                                 |
| SM3 | keystone hash validation                   |   ✅   |     ✅     |   ✅    |   ✅    | SHA-256 hashing; no framework dependency                                                                               |
| SM4 | code-quality-gate (write-check, full-scan) |   ✅   |     🔧     |   🔧    |   ⚠️    | **Compatible/Partial**: tsc/prettier/depcruise are JS/TS tools; **Partial**: Python/Go projects need alternative tools |
| SM5 | eslint-audit (CAT3.7)                      |   ✅   |     ✅     |   ✅    |   ⚠️    | ESLint is JS/TS only; for non-JS stacks, this gate must be reconfigured                                                |
| SM6 | dependency-cruiser (import graph)          |   ✅   |     ✅     |   ✅    |   ⚠️    | JS/TS only; equivalent tool needed for non-JS stacks                                                                   |
| SM7 | TypeScript compiler check (tsc)            |   ✅   |     ✅     |   ✅    |   ❌    | Only applicable to TypeScript projects                                                                                 |
| SM8 | Prettier formatting check                  |   ✅   |     ✅     |   🌐    |   🌐    | Configurable for any language Prettier supports; must be configured                                                    |
| SM9 | state-machine-reset.sh                     |   ✅   |     ✅     |   ✅    |   ✅    | Shell script; no framework dependency                                                                                  |

---

### §2.9 CI/CD & DevOps

| #   | Feature                             | Native | Compatible | Partial | Minimal | Notes                                                                                                                       |
| :-- | :---------------------------------- | :----: | :--------: | :-----: | :-----: | :-------------------------------------------------------------------------------------------------------------------------- |
| CD1 | GitHub Actions workflow templates   |   ✅   |     🔧     |   🔧    |   ⚠️    | **Compatible/Partial**: build/test steps need adjustment; **Minimal**: user-provided                                        |
| CD2 | Docker Compose v2 orchestration     |   ✅   |     🔧     |   🔧    |   ⚠️    | **Compatible**: Node.js services work; **Partial**: need Python/Go service images                                           |
| CD3 | framework-ci.yml (integrity checks) |   ✅   |     🔧     |   🔧    |   ⚠️    | Framework integrity checks are Node.js-based; run anywhere with Node                                                        |
| CD4 | Prisma migration/seeding            |   ✅   |     🔧     |   ❌    |   ❌    | **Compatible**: TypeORM/Sequelize/Knex alternatives exist; **Partial**: Django ORM, GORM etc. need custom migration scripts |
| CD5 | Redis cache integration             |   ✅   |     ✅     |   ✅    |   ⚠️    | Redis client libraries available for most languages                                                                         |

---

### §2.10 Context7 Documentation Integration

| #   | Feature                                       | Native | Compatible | Partial | Minimal | Notes                                           |
| :-- | :-------------------------------------------- | :----: | :--------: | :-----: | :-----: | :---------------------------------------------- |
| CX1 | NestJS docs (context7: /nestjs/nest)          |   ✅   |     ❌     |   ❌    |   ❌    | NestJS-specific                                 |
| CX2 | Angular docs (context7: /angular/angular)     |   ✅   |     ❌     |   ❌    |   ❌    | Angular-specific                                |
| CX3 | Express docs (context7: /expressjs/express)   |   ❌   |     ✅     |   ❌    |   ❌    | Express-specific                                |
| CX4 | Fastify docs (context7: /fastify/fastify)     |   ❌   |     ✅     |   ❌    |   ❌    | Fastify-specific                                |
| CX5 | React docs (context7: /reactjs/react)         |   ❌   |     ✅     |   ❌    |   ❌    | React-specific                                  |
| CX6 | Vue docs (context7: /vuejs/vue)               |   ❌   |     ❌     |   ✅    |   ❌    | Vue-specific                                    |
| CX7 | Prisma docs (context7: /prisma/prisma)        |   ✅   |     ✅     |   ❌    |   ❌    | Prisma-specific; available for Node.js stacks   |
| CX8 | Redis/ioredis docs (context7: /redis/ioredis) |   ✅   |     ✅     |   ⚠️    |   ⚠️    | Redis client; available for Node.js stacks only |
| CX9 | General web docs (MDN, etc.)                  |   ✅   |     ✅     |   ✅    |   ✅    | Universal                                       |

---

## §3 Conformance Level Detail

### §3.1 NATIVE (Angular 21+ / NestJS 11+ / Prisma 7.x / Redis 7.x)

**Definition**: The current "reference implementation" stack. All 28 placeholder variables resolve to concrete, tested implementations. Every agent config, rule file, and skill has been validated against this stack.

#### Works Out-of-Box (✅)

All features listed in §2 with ✅ in the Native column — this is the complete set of ~55 features. Specifically:

- All 8 agent roles fully functional with framework-specific behavior
- All 40 template variables resolve to production-tested values
- Guardian has full 15-point Angular checklist and 8-point NestJS checklist
- CI/CD pipeline (GitHub Actions + Docker Compose) with Prisma migrations, Redis, BullMQ
- Backend Tier 2 rules: class-validator, NestJS Logger, ThrottlerModule, Swagger/OpenAPI decorators
- Frontend Tier 2 rules: NgRx SignalStore, PrimeNG, Atomic Design hierarchy, @defer lazy loading
- ESLint + Prettier + tsc + dependency-cruiser in code-quality-gate

#### Adapters Needed (🔧)

None. This is the reference implementation.

#### Unavailable (❌)

None.

---

### §3.2 COMPATIBLE (React/Next.js + Express/Fastify + Prisma/TypeORM)

**Definition**: Node.js/TypeScript ecosystem with a different frontend framework (React/Next.js) and/or a simpler backend framework (Express/Fastify). Same language, runtime, and package ecosystem as Native. Framework-specific adapters are needed but the underlying tooling (ESLint, Prettier, tsc, Jest, Prisma) remains the same.

#### Works Out-of-Box (✅) — 42 features

- All Core Workflow features (WF1–WF10): AGENTS.md, DAG, contract.yaml, compliance gates, enforcement modes
- Agent roles: @Meta-Planner, @Orchestrator, @Architect, @Arbiter (AG1–AG5)
- All 28 dispatch-resolvable placeholders (TV1, TV3, TV4)
- Template resolver engine (dispatch-subagent.js)
- coding-standard-common.md Tier 1 rules (CS1)
- Guardian Layer A Auto Gate + Layer B universal checks (GR1, GR2, GR5–GR8)
- State machine & keystone hash validation (SM1–SM3)
- ESLint, Prettier, tsc, dependency-cruiser (SM5–SM8)
- Context7: Prisma docs, Redis docs (CX7–CX9)
- CI/CD: framework-ci.yml, Docker Compose (Node.js services)
- Skills: execution-preflight-check, brainstorming, multi-agent-orchestration, global-cicd-practices, etc.

#### Adapters Needed (🔧) — 13 feature families

| Adapter ID  | Feature                           | What to Adapt                                                                                                                               |        Effort        |
| :---------- | :-------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------ | :------------------: |
| ADP-BE-01   | Backend Tier 2 coding standards   | Replace NestJS-specific `template_resolution` values with Express/Fastify equivalents (already documented in COMPATIBILITY_PROFILE.md §4.1) |          S           |
| ADP-FE-01   | Frontend Tier 2 coding standards  | Replace Angular-specific `template_resolution` values with React equivalents (already documented in COMPATIBILITY_PROFILE.md §4.2)          |          S           |
| ADP-GDN-01  | Guardian backend checklist        | Express/Fastify checklist rows are pre-defined in guardian.md; ensure they are selected                                                     | **0** (pre-existing) |
| ADP-GDN-02  | Guardian frontend checklist       | React checklist row is pre-defined in guardian.md; ensure it is selected                                                                    | **0** (pre-existing) |
| ADP-CTX-01  | Context7 queries                  | Update `context7_task_mapping` to include Express/Fastify/React keywords; already have library IDs                                          |          S           |
| ADP-SKL-03  | cicd-database-seeding (Section 2) | Add TypeORM/Knex/Sequelize seeding examples if not using Prisma                                                                             |          S           |
| ADP-CICD-01 | CI/CD build/test steps            | Adjust `npm run` commands for Express/Fastify instead of NestJS CLI                                                                         |          S           |
| ADP-CICD-02 | Docker Compose                    | Express/Fastify service configurations instead of NestJS                                                                                    |          S           |
| ADP-COD-01  | @Coder-BE agent config            | Replace NestJS-specific trigger scenarios with Express/Fastify patterns                                                                     |          S           |
| ADP-COD-02  | @Coder-FE agent config            | Replace Angular-specific trigger scenarios with React patterns                                                                              |          S           |
| ADP-QLT-01  | code-quality-gate tsc check       | Works for TypeScript React/Express projects; skip if using plain JS                                                                         |        **0**         |
| ADP-QLT-02  | dependency-cruiser                | Works for Node.js projects; configuration may need adjustment                                                                               |          S           |
| ADP-TST-01  | Test framework                    | Jest works for React/Express; Vitest alternative may be preferred for Vite-based projects                                                   |          S           |

**Total adapter effort for Compatible level**: ~8 small (S) tasks. Most adapters are configuration changes in `project.config.json` and `context/code_standards/`.

#### Unavailable (❌)

None. All features have a path to compatibility within the Node.js ecosystem.

---

### §3.3 PARTIAL (Vue 3 / Svelte + Django / Flask / Go / Spring Boot)

**Definition**: A different language ecosystem (Python, Go, Java) or a frontend framework without pre-existing Guardian checklists. Major adapters are needed for ORM, state management, testing, and CI/CD. The meta-workflow (AGENTS.md, DAG, contract.yaml) remains functional.

#### Works Out-of-Box (✅) — 30 features

- All Core Workflow features (WF1–WF10)
- Agent roles: @Meta-Planner, @Orchestrator, @Architect, @Arbiter (AG1–AG5)
- All 28 dispatch-resolvable placeholders (TV1, TV3, TV4)
- Template resolver engine
- coding-standard-common.md Tier 1 rules (CS1)
- Guardian Layer A Auto Gate (GR1)
- State machine & keystone hash validation (SM1–SM3)
- state-machine-reset.sh (SM9)
- Skills: execution-preflight-check, brainstorming, multi-agent-orchestration, global-cicd-practices, new-asset-integrator, customize-opencode

#### Adapters Needed (🔧) — 18 feature families

| Adapter ID      | Feature                               | What to Adapt                                                                                                                                                    | Effort |
| :-------------- | :------------------------------------ | :--------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----: |
| ADP-PRT-BE-01   | Backend Tier 2 coding standards       | Author new `template_resolution` entries for Django/Flask/Go/Spring patterns (ORM transactions, auth, rate limiting, error handling, logging, API docs, caching) |   M    |
| ADP-PRT-FE-01   | Frontend Tier 2 coding standards      | Author new `template_resolution` entries for Vue/Svelte (state management, component hierarchy, lazy loading, API pattern)                                       |   M    |
| ADP-PRT-GDN-01  | Guardian backend framework checklist  | Add new rows to guardian.md for Django/Flask/Go/Spring Boot                                                                                                      |   M    |
| ADP-PRT-GDN-02  | Guardian frontend framework checklist | Add new rows to guardian.md for Vue/Svelte (Svelte row may already exist)                                                                                        |   S    |
| ADP-PRT-CTX-01  | Context7 task mappings                | Add new entries for Python/Go/Java agents; verify Context7 library coverage                                                                                      |   M    |
| ADP-PRT-ORM-01  | ORM adapter (see §4.1)                | Replace Prisma with SQLAlchemy/GORM/Spring Data JPA; implement adapter contract                                                                                  |   L    |
| ADP-PRT-SM-01   | State management adapter (see §4.2)   | Replace NgRx SignalStore with Pinia/Svelte Store; implement adapter contract                                                                                     |   M    |
| ADP-PRT-TST-01  | Test framework adapter (see §4.3)     | Replace Jest with pytest/Go testing/JUnit; implement adapter contract                                                                                            |   M    |
| ADP-PRT-VAL-01  | Validation adapter (see §4.4)         | Replace class-validator with Pydantic/marshmallow/go-playground/validator/Bean Validation                                                                        |   M    |
| ADP-PRT-CICD-01 | CI/CD pipeline                        | Replace Node.js build steps with Python/Go/Java equivalents                                                                                                      |   M    |
| ADP-PRT-DKR-01  | Docker Compose                        | Replace Node.js services with Python/Go/Java service images                                                                                                      |   M    |
| ADP-PRT-QLT-01  | code-quality-gate tooling             | Replace tsc/prettier/eslint with mypy/black/ruff (Python) or gofmt/golangci-lint (Go) or checkstyle/spotbugs (Java)                                              |   L    |
| ADP-PRT-SKL-01  | cicd-database-seeding                 | Add Section 2 entries for ORM-specific seeding (SQLAlchemy, GORM, JPA)                                                                                           |   S    |
| ADP-PRT-COD-01  | @Coder-BE agent config                | Rewrite trigger scenarios for Python/Go/Java backend                                                                                                             |   M    |
| ADP-PRT-COD-02  | @Coder-FE agent config                | Rewrite trigger scenarios for Vue/Svelte frontend                                                                                                                |   M    |
| ADP-PRT-SKL-02  | Context7 coverage                     | Some stacks (Django, Go) may have limited Context7 coverage; supplement with web search                                                                          |   M    |
| ADP-PRT-PRE-01  | Prettier formatting                   | Ensure .prettierrc supports target language; skip for unsupported languages                                                                                      |   S    |
| ADP-PRT-DEP-01  | dependency-cruiser                    | Only works for JS/TS; find alternative for Python (import-linter), Go (goda), Java (jdeps)                                                                       |   M    |

**Total adapter effort for Partial level**: ~15 medium (M) + 2 large (L) tasks. Expect 3–5 days of focused work to achieve full functionality for a new Partial stack.

#### Unavailable (❌) — 7 features

| Feature                                           | Reason                                              |
| :------------------------------------------------ | :-------------------------------------------------- |
| Native Prisma skills (prisma-seed-cicd Section 2) | Prisma is Node.js/Typescript-only                   |
| NestJS-specific Context7 queries                  | NestJS docs not applicable                          |
| Angular-specific Context7 queries                 | Angular docs not applicable                         |
| ioredis Context7 queries (for non-Node stacks)    | ioredis is Node.js-only; use equivalent client docs |
| NestJS-specific @Coder-BE behavior                | Must be fully replaced                              |
| Angular-specific @Coder-FE behavior               | Must be fully replaced                              |
| Native CI/CD build steps                          | Full replacement needed                             |

---

### §3.4 MINIMAL (Any Stack — Ruby on Rails, Phoenix, Laravel, .NET, etc.)

**Definition**: Any stack not covered above. The OpenCode Framework provides only the **meta-workflow layer**: AGENTS.md protocol orchestration, Task.DAG.json planning, contract.yaml contracts, and compliance gates. All agent configs, coding standards, Guardian checklists, CI/CD, and skills must be written from scratch for the target stack.

#### Works Out-of-Box (✅) — 22 features

- All Core Workflow features (WF1–WF10): planning, contracting, compliance gates, enforcement modes
- Agent roles: @Meta-Planner, @Orchestrator, @Architect, @Arbiter (AG1–AG5)
- All 28 dispatch-resolvable placeholders (TV1) — they resolve but reference stack-unknown values
- Template resolver engine (TV3, TV4) — resolves any key pattern
- State machine & keystone hash (SM1–SM3, SM9)
- Skills: execution-preflight-check, brainstorming, multi-agent-orchestration, new-asset-integrator, customize-opencode

#### Adapters Needed (🔧) — build from scratch

At the Minimal level, **everything** below the meta-workflow layer needs to be built. The framework provides the **structure** (where to put things, what format to use) but not the **content** (what to write for a specific stack).

| Category                  | What Must Be Built                                                        | Reference                                                                          |
| :------------------------ | :------------------------------------------------------------------------ | :--------------------------------------------------------------------------------- |
| Agent configs             | Rewrite @Coder-BE, @Coder-FE body content for target stack patterns       | [COMPATIBILITY_PROFILE.md §5.3](../compatibility-profile/COMPATIBILITY_PROFILE.md) |
| Backend coding standards  | Write new `context/code_standards/backend-coding-standard.md`             | Native version as template                                                         |
| Frontend coding standards | Write new `context/code_standards/frontend-coding-standard.md`            | Native version as template                                                         |
| Guardian checklists       | Add new framework rows to guardian.md                                     | Existing rows as template                                                          |
| CI/CD pipeline            | Write new GitHub Actions workflows                                        | framework-ci.yml as template                                                       |
| Docker Compose            | Configure services for target stack                                       | Native version as template                                                         |
| Skills                    | Add stack-specific skill files if needed                                  | Existing skills as template                                                        |
| Context7                  | Map target stack libraries; may have no Context7 coverage                 | context7_task_mapping                                                              |
| Quality gates             | Configure ESLint-alternative, formatter, type checker for target language | code-quality-gate.js                                                               |

#### Unavailable (❌) — all implementation-layer features

| Category         | Unavailable Features                                             |
| :--------------- | :--------------------------------------------------------------- |
| Agent execution  | @Coder-BE and @Coder-FE cannot execute without rewritten configs |
| Code quality     | ESLint, tsc, dependency-cruiser are JS/TS-only                   |
| Guardian reviews | Framework-specific checklists absent                             |
| CI/CD            | No pre-built pipeline templates                                  |
| Skills           | All stack-specific skills inapplicable                           |
| Context7         | No pre-mapped library queries                                    |
| Coding standards | All Tier 2 parameterized rules unresolvable                      |
| Testing          | No test framework integration                                    |

---

## §4 Adapter Contracts

When implementing adapters for Compatible or Partial stacks, each adapter must fulfill a specific **contract** — a defined interface of behavior that the multi-agent system expects. This section defines those contracts.

### §4.1 ORM Adapter Contract

Replaces Prisma-specific assumptions in agent configs, CI/CD, and Guardian checks.

```yaml
# Conceptual contract — not a YAML file, but the interface an ORM adapter must satisfy
orm_adapter:
  required_capabilities:
    - transaction_api:
        description: "Programmatic transaction management with rollback capability"
        prisma_equivalent: "prisma.$transaction([...]) or interactive transactions"
        typeorm_equivalent: "dataSource.transaction(async (manager) => {...})"
        sqlalchemy_equivalent: "session.begin() with context manager"
        gorm_equivalent: "db.Transaction(func(tx *gorm.DB) error {...})"
    - migration_tool:
        description: "CLI or programmatic schema migration with up/down support"
        prisma_equivalent: "npx prisma migrate dev"
    - seed_script:
        description: "Deterministic seed data script callable from CI/CD"
        prisma_equivalent: "npx prisma db seed"
    - schema_introspection:
        description: "Ability to reverse-engineer schema for Guardian's schema-vs-code checks"
    - relation_queries:
        description: "Eager/lazy loading with nested includes/joins for 1:N and N:M relations"

  project_config_keys:
    # These keys in project.config.json must be set for the ORM adapter:
    - tech_stack.database.orm # e.g., "SQLAlchemy"
    - tech_stack.database.version # e.g., "2.0"
    - template_resolution.backend.orm.schema # path to schema definition
    - template_resolution.backend.orm.transaction # transaction API invocation pattern

  guardian_checks:
    - "Transactions used for all multi-table mutations"
    - "Migration files reviewed for destructive changes"
    - "N+1 query detection (if framework supports)"
```

### §4.2 State Management Adapter Contract

Replaces NgRx SignalStore assumptions in frontend agent configs and Guardian checks.

```yaml
state_management_adapter:
  required_capabilities:
    - reactive_state:
        description: "Reactive state container with change detection"
        ngrx_equivalent: "signalStore() with withState(), withComputed(), withMethods()"
        zustand_equivalent: "create() with immer middleware"
        pinia_equivalent: "defineStore() with state/getters/actions"
        svelte_equivalent: "writable/derived stores + $state rune"
    - computed_derivations:
        description: "Derived/computed values that auto-update when dependencies change"
    - immutable_updates:
        description: "State updates produce new references (not mutations)"
    - devtools_integration:
        description: "Optional: Redux DevTools or framework-specific state inspector"

  project_config_keys:
    - tech_stack.frontend.state_management # e.g., "Zustand"
    - template_resolution.frontend.state_pattern # e.g., "Zustand: create() with immer middleware"

  guardian_checks:
    - "State mutations only through defined store methods"
    - "No direct DOM manipulation bypassing reactive state"
    - "Store isolation per feature domain"
```

### §4.3 Test Framework Adapter Contract

Replaces Jest assumptions in TDD workflow, CI/CD, and Guardian checks.

```yaml
test_framework_adapter:
  required_capabilities:
    - unit_test_runner:
        description: "Test runner with describe/it or equivalent grouping"
        jest_equivalent: "describe/it/expect with --coverage"
        pytest_equivalent: "pytest with pytest-cov"
        go_testing_equivalent: "go test -cover ./..."
        junit_equivalent: "@Test with Assertions + jacoco"
    - coverage_reporting:
        description: "Line/branch/function coverage with ≥70% threshold enforcement"
        output_format: "lcov, cobertura, or JSON consumable by Guardian"
    - watch_mode:
        description: "Optional: file-watching re-run for TDD RED/GREEN cycle"
    - mock_support:
        description: "Function/module mocking capability for unit isolation"
    - ci_integration:
        description: "CLI invocation that returns non-zero exit code on failure"
        jest_equivalent: "npx jest --ci --coverage"
        pytest_equivalent: "pytest --cov=. --cov-report=xml --junitxml=report.xml"
        go_equivalent: "go test -coverprofile=coverage.out ./... && go tool cover -func=coverage.out"
    - execution_evidence:
        description: "Must produce structured output for test_report.json.execution_evidence"
        format: "{ exit_code: number, output_summary: string, coverage: { lines: number, branches: number, functions: number } }"

  project_config_keys:
    - tech_stack.testing.unit # e.g., "pytest 8.x"
    - tech_stack.testing.e2e # e.g., "Playwright" (cross-language)
    - tech_stack.testing.integration # e.g., "pytest-django"
    - tech_stack.testing.coverage_threshold # e.g., 80

  guardian_checks:
    - "RED phase: tests fail before implementation"
    - "GREEN phase: tests pass after implementation"
    - "Coverage ≥ threshold for all changed modules"
    - "No empty assertions (bogus test detection)"
    - "execution_evidence present in test_report.json"
```

### §4.4 Validation/DTO Adapter Contract

Replaces class-validator + class-transformer assumptions.

```yaml
validation_adapter:
  required_capabilities:
    - dto_validation:
        description: "Declarative validation rules on request/response DTOs"
        class_validator_equivalent: "@IsString(), @IsEmail(), @IsEnum() decorators"
        pydantic_equivalent: "BaseModel with Field(..., validator=...)"
        go_equivalent: "go-playground/validator struct tags"
        java_equivalent: "@NotNull, @Size, @Email annotations"
    - type_transformation:
        description: "Automatic type coercion from wire format to language types"
        class_transformer_equivalent: "@Type(() => Number) or enableImplicitConversion"
    - enum_validation:
        description: "Validate values against predefined enum sets"
    - nested_validation:
        description: "Validate nested object structures recursively"
    - error_formatting:
        description: "Produce structured validation error response format"
        expected_format: "{ field: string, messages: string[] }[]"
    - whitelist_stripping:
        description: "Optional: strip unknown properties from validated objects"

  project_config_keys:
    # No dedicated keys; validation is part of backend Tier 2 rules
    # Reference: template_resolution.backend.error_handler (for error format)

  guardian_checks:
    - "All DTOs have validation rules"
    - "Enum validation covers all contract.yaml enum values"
    - "Error responses follow contract.yaml error schema"
```

### §4.5 Logger Adapter Contract

Replaces NestJS Logger assumptions.

```yaml
logger_adapter:
  required_capabilities:
    - structured_logging:
        description: "Request logging with method, URL, status code, and duration"
        nestjs_equivalent: "NestJS Logger with request interceptor"
        express_equivalent: "Winston with request-logger middleware"
        fastify_equivalent: "Pino with request hook"
        django_equivalent: "Python logging with Django request middleware"
    - log_levels:
        description: "At minimum: error, warn, info, debug"
    - context_enrichment:
        description: "Add request ID, user ID, trace ID to log entries"

  project_config_keys:
    - template_resolution.backend.logger # e.g., "Python logging with Django request middleware"
```

---

## §5 UNIV-P Task Cross-Reference

This section maps the 15 UNIV-P\* universality enhancement tasks to conformance levels, showing which are stack-agnostic and which are stack-specific. This serves as a reference for future adopters to understand which work carries over and which must be redone.

### §5.1 Stack-Agnostic Tasks (carry over to ALL levels)

These tasks modified framework infrastructure in a way that benefits any stack:

| Task ID   | Title                                                         | Why Agnostic                                                | Benefit to Other Levels                        |
| :-------- | :------------------------------------------------------------ | :---------------------------------------------------------- | :--------------------------------------------- |
| UNIV-P0-E | Make coding-standard-common.md framework-agnostic             | Replaced NestJS/Angular-specific text with generic patterns | Compatible, Partial, Minimal all use this file |
| UNIV-P2-J | Remove "(含Salesforce)" from AGENTS.md                        | Vendor-agnostic text cleanup                                | All levels use AGENTS.md                       |
| UNIV-P5-K | Add placeholder compliance checks to framework-self-test.js   | Validates any project's template_resolution                 | All levels use framework-self-test.js          |
| UNIV-P5-L | Improve compliance-audit.sh pattern matching                  | Audits any agent, not stack-specific                        | All levels use compliance-audit.sh             |
| UNIV-P5-M | Add python3 fallback to pre-execution-hook.sh                 | OS-level improvement for minimal systems                    | All levels use pre-execution-hook.sh           |
| UNIV-P5-N | Support OPENCODE_ROOT env var                                 | Container/CI environment support                            | All levels use dispatch-subagent.js            |
| UNIV-P6-O | Update TECH_DEBT_REGISTRY.md and skill-invocation-standard.md | Registry maintenance; skill deprecation                     | All levels reference these files               |

### §5.2 Partially Applicable Tasks (carry over but need stack-specific extensions)

These tasks created parameterized templates that work for any JS/TS stack but need new values for Partial stacks:

| Task ID   | Title                                           | Works For                                  | Needs Extension For                                           |
| :-------- | :---------------------------------------------- | :----------------------------------------- | :------------------------------------------------------------ |
| UNIV-P1-C | backend-coding-standard.md tiered template      | Native, Compatible                         | Partial: add `template_resolution` entries for Python/Go/Java |
| UNIV-P1-D | frontend-coding-standard.md tiered template     | Native, Compatible                         | Partial: add `template_resolution` entries for Vue/Svelte     |
| UNIV-P2-A | Parameterize coder-be.md                        | Native, Compatible                         | Partial/Minimal: rewrite body for target backend framework    |
| UNIV-P2-B | Parameterize coder-fe.md                        | Native, Compatible                         | Partial/Minimal: rewrite body for target frontend framework   |
| UNIV-P3-F | Guardian conditional checklists                 | Native, Compatible                         | Partial: add new framework rows (Django, Go, Svelte, etc.)    |
| UNIV-P3-G | Parameterize architect.md                       | Native, Compatible, Partial, Minimal       | Already generic; no extension needed                          |
| UNIV-P4-H | Rename prisma-seed-cicd → cicd-database-seeding | Native (Section 2), Compatible (Section 1) | Partial: add Section 2 entries for new ORMs                   |
| UNIV-P4-I | Deprecate nextjs-router-guardrails              | Compatible (if using Next.js)              | Not needed for non-Next stacks                                |

### §5.3 Stack-Specific Tasks (must be redone for new stacks)

These tasks produced output that is fundamentally tied to the Angular/NestJS/Node.js ecosystem:

| Task ID      | Title                                     | What Must Be Redone                                                 | For Which Levels |
| :----------- | :---------------------------------------- | :------------------------------------------------------------------ | :--------------- |
| N/A — future | Backend Tier 2 values for Django/Flask/Go | Write `template_resolution.backend.*` entries for target framework  | Partial          |
| N/A — future | Frontend Tier 2 values for Vue/Svelte     | Write `template_resolution.frontend.*` entries for target framework | Partial          |
| N/A — future | Guardian Django/Go/Spring checklist       | Add new rows to guardian.md backend table                           | Partial          |
| N/A — future | Guardian Vue/Svelte checklist             | Add new rows to guardian.md frontend table                          | Partial          |
| N/A — future | Context7 mapping for Python/Go/Java       | Add new entries to context7_task_mapping                            | Partial          |
| N/A — future | ORM adapter implementation                | Implement §4.1 contract for SQLAlchemy/GORM/etc.                    | Partial          |
| N/A — future | State management adapter                  | Implement §4.2 contract for Pinia/Svelte Store                      | Partial          |
| N/A — future | Test framework adapter                    | Implement §4.3 contract for pytest/Go testing/JUnit                 | Partial          |
| N/A — future | Validation adapter                        | Implement §4.4 contract for Pydantic/marshmallow/etc.               | Partial          |
| N/A — future | Quality gate tooling replacement          | Configure mypy+black+ruff (Python) or golangci-lint (Go)            | Partial          |
| N/A — future | Full agent config rewrites                | Rewrite @Coder-BE + @Coder-FE for target stack                      | Minimal          |

---

## §6 Quick Conformance Reference Card

```
┌──────────────────────────────────────────────────────────────────────────┐
│                UNIVERSAL COMPATIBILITY QUICK REFERENCE                    │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  NATIVE (Angular/NestJS/Prisma)  ─  all 55 features ✅                   │
│  COMPATIBLE (React/Express)      ─  42 ✅ + 13 🔧 (S-effort adapters)    │
│  PARTIAL (Vue/Django/Go)         ─  30 ✅ + 18 🔧 (M/L-effort adapters)  │
│  MINIMAL (any stack)             ─  22 ✅ workflow-only                   │
│                                                                           │
│  ─────────────────────────────────────────────────────────────────────    │
│  KEY ADAPTER CONTRACTS:                                                  │
│    §4.1  ORM Adapter (Prisma → SQLAlchemy/GORM/TypeORM)                  │
│    §4.2  State Management (NgRx → Zustand/Pinia/Svelte Store)            │
│    §4.3  Test Framework (Jest → pytest/Go testing/JUnit)                 │
│    §4.4  Validation (class-validator → Pydantic/Bean Validation)         │
│    §4.5  Logger (NestJS Logger → Winston/Pino/Python logging)            │
│                                                                           │
│  ─────────────────────────────────────────────────────────────────────    │
│  CONFIGURATION:                                                          │
│    project.config.json.template_resolution.compatibility_profile         │
│    Values: "native" | "compatible" | "partial" | "minimal"               │
│                                                                           │
│  ─────────────────────────────────────────────────────────────────────    │
│  REFERENCE DOCUMENTS:                                                    │
│    COMPATIBILITY_PROFILE.md  — per-stack override tables                 │
│    TEMPLATE_VARIABLE_STANDARD.md  — placeholder catalog                  │
│    enforcement-modes-standard.md  — advisory/strict/locked               │
│                                                                           │
│  STACK-AGNOSTIC UNIV TASKS: 7 tasks (UNIV-P0-E, P2-J, P5-K/L/M/N, P6-O) │
│  PARTIALLY APPLICABLE:      8 tasks (needs extension for new stacks)     │
│  STACK-SPECIFIC:            must be redone for each new stack            │
│                                                                           │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## §7 Related Documents

| Document                                                         | Relationship                                                  |
| :--------------------------------------------------------------- | :------------------------------------------------------------ |
| [COMPATIBILITY_PROFILE.md](./COMPATIBILITY_PROFILE.md)           | Detailed per-stack override tables and migration guide        |
| [TEMPLATE_VARIABLE_STANDARD.md](./TEMPLATE_VARIABLE_STANDARD.md) | Placeholder catalog and resolution mechanism                  |
| [enforcement-modes-standard.md](./enforcement-modes-standard.md) | Advisory/strict/locked mode behavior                          |
| [state-machine-standard.md](./state-machine-standard.md)         | State machine configuration and Git hook integration          |
| [dag-generation-standard.md](./dag-generation-standard.md)       | DAG planning rules (stack-agnostic)                           |
| `project.config.json`                                            | **Source of truth** for current compatibility profile setting |
| `.opencode/agents/guardian.md`                                   | Per-framework review checklists                               |
| `.opencode/scripts/framework-self-test.js`                       | Checks 17/18 for placeholder validation                       |

---

_This document should be updated whenever: (1) a new stack is validated for a conformance level, (2) new adapter contracts are defined, (3) UNIV-P_ task coverage changes, or (4) the feature catalog expands.\*
