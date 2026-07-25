# Universal Compatibility Profile — Multi-Stack Conformance Levels

**Version**: v2.0.0
**Created**: 2026-05-23
**Author**: @Architect (RVW-REVIEW-09)
**Applies To**: All `.opencode/agents/*.md`, `.opencode/rules/**/*.md`, `.opencode/skills/**/SKILL.md`, `.opencode/legacy/subagent-preamble.md (deprecated → Skills)`, `project.config.json`
**Supersedes**: `COMPATIBILITY_PROFILE.md` (v1.0.0)
**References**:
- [TEMPLATE_VARIABLE_STANDARD.md](./TEMPLATE_VARIABLE_STANDARD.md)
- [COMPATIBILITY_PROFILE.md](./COMPATIBILITY_PROFILE.md) — detailed tech-stack override tables
- [enforcement-modes-standard.md](./enforcement-modes-standard.md)

---

## §1 Overview

### §1.1 Purpose

Defines the **universal compatibility conformance levels** for the OpenCode multi-agent system. [COMPATIBILITY_PROFILE.md](./COMPATIBILITY_PROFILE.md) documents the "how" (which `project.config.json` keys to change per stack); this document defines the "what" — **which features work for each stack category, and what must be built to bridge the gaps**.

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

The system comprises **8 agent roles**, **40 template variables** (28 dispatch-resolvable + 12 extended), **19 skills**, **11 quality gates**, and **3 enforcement modes**. Each feature is classified by availability at each conformance level.

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
| AG4 | @Guardian (code review, quality gates)        |   ✅   |     🔧     |   🔧    |   ⚠️    | **Compatible**: per-framework checklists for React/Vue/Express/Fastify; **Partial**: add new checklist rows; **Minimal**: universal checks only |
| AG5 | @Arbiter (conflict resolution)                |   ✅   |     ✅     |   ✅    |   ✅    | Workflow role; reads WAIVE.md, TECH_DEBT_REGISTRY.md                                                                                                  |
| AG6 | @CI-CD-Agent (deployment, Docker)             |   ✅   |     🔧     |   🔧    |   ⚠️    | **Compatible**: Dockerfile/CI templates need framework-specific adjustments; **Minimal**: user-provided CI/CD                                         |
| AG7 | @Coder-BE (backend implementation)            |   ✅   |     🔧     |   🔧    |   ❌    | Requires framework-specific agent config and coding standards                                                                                         |
| AG8 | @Coder-FE (frontend implementation)           |   ✅   |     🔧     |   🔧    |   ❌    | Requires framework-specific agent config and coding standards                                                                                         |

---

### §2.4–§2.10 Feature Summaries

| Section | Feature Area | Native | Compatible | Partial | Minimal | Key Constraint |
|---------|-------------|:------:|:----------:|:-------:|:-------:|----------------|
| §2.4 Template Variable Resolution | 28 dispatch-resolvable + 12 extended placeholders | ✅ | 🔧 (mapping table entries needed) | 🔧 (custom entries) | ⚠️ (generic fallback) | All resolve from project.config.json; dispatch-subagent.ts universal |
| §2.5 Coding Standards | Tier 1 universal + Tier 2 parameterized (backend/frontend/test) | ✅ | 🔧 (Express/Fastify/React overrides exist) | 🔧 (author new entries) | ❌ (except universal TDD) | Tier 2 requires `template_resolution` entries per framework |
| §2.6 Guardian Review Gates | Layer A auto + Layer B manual + framework checklists | ✅ | ✅ (pre-defined checklists) | 🔧 (add new framework rows) | ❌ (universal only) | ESLint mock-audit, write-audit, TDD order are stack-agnostic |
| §2.7 Skills | 14 skills (SK1–SK14, 2 deprecated) | ✅ | 🔧 (context7 mapping, CI templates) | 🔧 (ORM-specific) | ⚠️ (workflow-only) | SK13/SK14 deprecated; SK8 cicd-database-seeding needs ORM entries |
| §2.8 State Machine & Quality Gates | machine.json, keystone hash, code-quality-gate | ✅ | 🔧 (tsc/prettier/depcruise are JS/TS) | 🔧 (need alt tools) | ⚠️ (reconfig needed) | SM7 (tsc) is TS-only; SM5–SM6 need non-JS alternatives |
| §2.9 CI/CD & DevOps | GitHub Actions, Docker Compose, Prisma migration, Redis | ✅ | 🔧 (adjust build/test steps) | 🔧 (need Python/Go images) | ⚠️ (user-provided) | CD4 Prisma→TypeORM/Sequelize for Compatible; custom scripts for Partial |
| §2.10 Context7 Docs Integration | 9 Context7 library mappings (CX1–CX9) | ✅ | 🔧 (Express/Fastify/React available) | 🔧 (Vue only) | ⚠️ (CX9 general only) | CX1–CX8 are stack-specific; CX9 (MDN) is universal |

---

## §3 Conformance Level Summary

| Level | Stack | ✅ Features | 🔧 Adapters | ❌ Unavailable | Total Adapter Effort |
|-------|-------|:-----------:|:-----------:|:--------------:|:--------------------:|
| **Native** | Angular/NestJS/Prisma/Redis | All ~55 | None | None | 0 |
| **Compatible** | React/Express/Fastify/TypeORM | 42 | 13 families (ADP-BE-01 through ADP-TST-01) | None | ~8 small (S) tasks |
| **Partial** | Vue/Django/Flask/Go/Spring | 30 | 18 families (major adapters for ORM, state, test, CI/CD) | Coder execution, JS-only quality tools, framework checklists | Significant (M/L) |
| **Minimal** | Any stack | 22 (workflow-only) | N/A | All implementation-layer features | N/A — meta-workflow only |

**Compatible key adapters**: Backend/Frontend Tier 2 coding standards, Guardian checklists (pre-existing), Context7 mapping, CI/CD build steps, Docker Compose, Coder agent configs, test framework.

**Partial unavailable features**: @Coder-BE/FE execution, ESLint/tsc/dependency-cruiser, framework-specific Guardian checklists, CI/CD templates, stack-specific skills, Context7 library queries, Tier 2 coding standards, test framework integration.

---

## §4 Adapter Contracts (Summary)

Each adapter for Compatible/Partial stacks MUST fulfill the corresponding contract:

| Contract | Replaces | Required Capabilities | Key Guardian Checks |
|----------|----------|----------------------|---------------------|
| **§4.1 ORM Adapter** | Prisma assumptions | Transaction API, migration tool, seed script, schema introspection, relation queries | Transactions for multi-table mutations; migration review; N+1 detection |
| **§4.2 State Management Adapter** | NgRx SignalStore | Reactive state, computed derivations, immutable updates, devtools (optional) | State mutations via store methods only; no direct DOM manipulation; store isolation |
| **§4.3 Test Framework Adapter** | Jest assumptions | Unit test runner, coverage reporting (>=70%), watch mode (optional), mock support, CI integration, execution_evidence | RED/GREEN TDD phases; coverage >= threshold; no empty assertions |
| **§4.4 Validation/DTO Adapter** | class-validator + class-transformer | DTO validation, type transformation, enum validation, nested validation, error formatting (`{field, messages[]}[]`) | All DTOs validated; enum coverage; error responses follow contract.yaml |
| **§4.5 Logger Adapter** | NestJS Logger | Structured logging (method/URL/status/duration), log levels (error/warn/info/debug), context enrichment (request/user/trace ID) | — |

**Project config keys** for all adapters: set under `tech_stack.*` and `template_resolution.*` in `project.config.json`.

---

## §5 UNIV-P Task Cross-Reference

### §5.1 Stack-Agnostic Tasks (carry over to ALL levels)

| Task ID   | Title                                                         | Benefit to Other Levels                        |
| :-------- | :------------------------------------------------------------ | :--------------------------------------------- |
| UNIV-P0-E | Make coding-standard-common.md framework-agnostic             | All levels use this file                       |
| UNIV-P2-J | Remove "(含Salesforce)" from AGENTS.md                        | All levels use AGENTS.md                       |
| UNIV-P5-K | Add placeholder compliance checks to framework-self-test.ts   | All levels use framework-self-test.ts          |
| UNIV-P5-L | Improve compliance-audit.sh pattern matching                  | All levels use compliance-audit.sh             |
| UNIV-P5-M | Add python3 fallback to pre-execution-hook.sh                 | All levels use pre-execution-hook.sh           |
| UNIV-P5-N | Support OPENCODE_ROOT env var                                 | All levels use dispatch-subagent.ts            |
| UNIV-P6-O | Update TECH_DEBT_REGISTRY.md and skill-invocation-standard.md | All levels reference these files               |

### §5.2 Partially Applicable Tasks (need stack-specific extensions)

| Task ID   | Title                                           | Works For                          | Needs Extension For                                           |
| :-------- | :---------------------------------------------- | :--------------------------------- | :------------------------------------------------------------ |
| UNIV-P1-C | backend-coding-standard.md tiered template      | Native, Compatible                 | Partial: add entries for Python/Go/Java |
| UNIV-P1-D | frontend-coding-standard.md tiered template     | Native, Compatible                 | Partial: add entries for Vue/Svelte     |
| UNIV-P2-A | Parameterize coder-be.md                        | Native, Compatible                 | Partial/Minimal: rewrite for target backend framework    |
| UNIV-P2-B | Parameterize coder-fe.md                        | Native, Compatible                 | Partial/Minimal: rewrite for target frontend framework   |
| UNIV-P3-F | Guardian conditional checklists                 | Native, Compatible                 | Partial: add new framework rows         |
| UNIV-P3-G | Parameterize architect.md                       | All levels                         | Already generic; no extension needed                         |
| UNIV-P4-H | Rename prisma-seed-cicd to cicd-database-seeding | Native (Section 2), Compatible (Section 1) | Partial: add Section 2 entries for new ORMs                   |
| UNIV-P4-I | Deprecate nextjs-router-guardrails              | Compatible (if using Next.js)              | Not needed for non-Next stacks                                |

### §5.3 Stack-Specific Tasks (must be redone for new stacks)

All future tasks for Partial/Minimal levels: Backend/Frontend Tier 2 values, Guardian checklists, Context7 mapping, ORM/state/test/validation adapter implementations, quality gate tooling replacement, full agent config rewrites.

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

_This document should be updated whenever: (1) a new stack is validated for a conformance level, (2) new adapter contracts are defined, (3) UNIV-P_ task coverage changes, or (4) the feature catalog expands._
